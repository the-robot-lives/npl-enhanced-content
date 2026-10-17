/**
 * outline — the semantic left rail (§5.3, Instrument shell) and the
 * breadcrumb row above the canvas.
 *
 * The rail is a TREE of meaningful blocks only: `sem-*` elements, headings
 * and sections. Presentational wrappers (`p`, `strong`, `div`, …) never
 * become rows — but their semantic descendants still do, so structure reads
 * like the document, not the serialization. Labels come from CONTENT
 * ("Note — info", the heading's own words), never a column of repeated tag
 * names; the tag rides along as a small chip.
 *
 * Rows are `role=treeitem` under one `role=tree` (§7 keyboard parity):
 * arrows move, Left/Right collapse/expand, Enter selects (again = F2
 * properties), Delete removes. Neither the rail nor the breadcrumb owns
 * state beyond collapse — `<sem-editor>` refreshes them on doc change /
 * selectionchange and routes the verbs to its own handlers.
 */

import type { EditorNode, ElementNode } from '../model/types.js';
import type { EditorContext } from './context.js';

export interface OutlineEntry {
  id: string;
  tag: string;
  title: string;
  /** Visible nesting level among INCLUDED rows (1-based; aria-level). */
  depth: number;
  /** True when the subtree contains at least one included descendant. */
  hasChildren: boolean;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const MAX_LABEL = 48;

/** Meaningful blocks only: the sem-* vocabulary, headings (the vocab's
 *  `heading` element and bare h1–h6) and sections. Presentational wrappers
 *  (`p`, `strong`, `div`, …) and document metadata (`title`) never become
 *  rows — but their semantic descendants still do. */
const isSemantic = (tag: string): boolean =>
  tag.startsWith('sem-') || HEADING_TAGS.has(tag) || tag === 'section' || tag === 'heading';

const truncate = (text: string, max = MAX_LABEL): string => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** Content-derived label: heading words, or descriptor title + a
 *  distinguishing qualifier (variant → label-ish attr → first text). */
export function outlineLabelFor(ctx: EditorContext, node: ElementNode): string {
  const tag = node.name.toLowerCase();
  const attr = (name: string): string | null => {
    const a = node.attrs.find((x) => x.name.toLowerCase() === name);
    return a === undefined || a.value === null || a.value === '' ? null : a.value;
  };
  if (HEADING_TAGS.has(tag) || tag === 'heading') {
    const text = truncate(ctx.doc.textOf(node.id));
    if (text !== '') return text;
    const level = attr('level') ?? tag.replace(/\D/g, '') ?? '';
    return level !== '' ? `Heading ${level}` : 'Heading';
  }
  const base = ctx.descriptorView?.descriptorFor(tag)?.title ?? tag;
  const qualifier =
    attr('variant') ?? attr('label') ?? attr('name') ?? attr('title') ?? truncate(ctx.doc.textOf(node.id), 32);
  return qualifier !== null ? `${base} — ${truncate(qualifier, 32)}` : base;
}

/** Depth-first walk over semantic blocks only (text/comments and
 *  presentational elements are never rows; their subtrees still are). */
export function outlineEntries(ctx: EditorContext): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  const subtreeHasSemantic = (children: readonly EditorNode[]): boolean => {
    for (const node of children) {
      if (node.kind !== 'element') continue;
      const tag = node.name.toLowerCase();
      if (isSemantic(tag) || subtreeHasSemantic((node as ElementNode).children)) return true;
    }
    return false;
  };

  const walk = (children: readonly EditorNode[], depth: number): void => {
    for (const node of children) {
      if (node.kind !== 'element') continue;
      const el = node as ElementNode;
      const tag = el.name.toLowerCase();
      if (isSemantic(tag)) {
        entries.push({
          id: el.id,
          tag,
          title: outlineLabelFor(ctx, el),
          depth,
          hasChildren: subtreeHasSemantic(el.children),
        });
        walk(el.children, depth + 1);
      } else {
        walk(el.children, depth);
      }
    }
  };
  walk(ctx.doc.root.children, 1);
  return entries;
}

export interface OutlineHooks {
  /** Enter / click — make this id the selection (and scroll it into view). */
  onSelect(id: string): void;
  /** F2, or Enter on the already-selected row — open Properties. */
  onProperties(id: string): void;
  /** Delete — remove the node (one op, announced upstream). */
  onDelete(id: string): void;
}

/**
 * The semantic outline tree. One roving tab stop (§7); collapsed state
 * lives here (by node id) and survives re-renders.
 */
export class OutlineList {
  readonly root: HTMLElement;
  #tree: HTMLElement;
  #ctx: EditorContext;
  #hooks: OutlineHooks;
  #rows: Array<{ id: string; row: HTMLElement }> = [];
  #collapsed = new Set<string>();
  #entries: OutlineEntry[] = [];

  constructor(ctx: EditorContext, hooks: OutlineHooks) {
    this.#ctx = ctx;
    this.#hooks = hooks;
    this.root = document.createElement('nav');
    this.root.className = 'sem-ed-outline';
    this.root.setAttribute('aria-label', 'Outline');

    const label = document.createElement('h2');
    label.className = 'sem-ed-outline-label';
    label.id = 'sem-ed-outline-label';
    label.textContent = 'Outline';
    this.root.appendChild(label);

    this.#tree = document.createElement('div');
    this.#tree.className = 'sem-ed-outline-list';
    this.#tree.setAttribute('role', 'tree');
    this.#tree.setAttribute('aria-labelledby', label.id);
    this.#tree.addEventListener('keydown', (e) => this.#onKey(e));
    this.#tree.addEventListener('click', (e) => this.#onClick(e));
    this.#tree.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this.root.appendChild(this.#tree);
  }

  /** Swap in the real context (the shell constructs the list before
   *  openDocument hands it a document-backed one). */
  setContext(ctx: EditorContext): void {
    this.#ctx = ctx;
  }

  /** Rows currently visible (a collapsed row hides its whole subtree). */
  #visibleEntries(): OutlineEntry[] {
    const out: OutlineEntry[] = [];
    const all = this.#entries;
    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      out.push(entry);
      if (entry.hasChildren && this.#collapsed.has(entry.id)) {
        while (i + 1 < all.length && all[i + 1].depth > entry.depth) i++;
      }
    }
    return out;
  }

  /** Rebuild rows from the current document. Keeps keyboard position when
   *  the previously focused row still exists. */
  refresh(): void {
    const focusedId = document.activeElement?.closest?.('[data-sem-ed-node]')?.getAttribute('data-sem-ed-node') ?? null;
    this.#entries = outlineEntries(this.#ctx);
    const visible = this.#visibleEntries();
    this.#tree.textContent = '';
    this.#rows = [];
    const selected = this.#ctx.selectedId;

    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sem-ed-outline-empty';
      empty.textContent = 'No blocks yet — use Add block to insert one.';
      this.#tree.appendChild(empty);
      return;
    }

    for (const entry of visible) {
      const row = document.createElement('div');
      row.className = 'sem-ed-outline-item';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth));
      row.style.setProperty('--sem-ed-depth', String(entry.depth - 1));
      row.dataset.semEdNode = entry.id;
      row.tabIndex = -1;

      if (entry.hasChildren) {
        row.setAttribute('aria-expanded', this.#collapsed.has(entry.id) ? 'false' : 'true');
        const twisty = document.createElement('button');
        twisty.type = 'button';
        twisty.className = 'sem-ed-outline-twisty';
        twisty.setAttribute('aria-hidden', 'true');
        twisty.tabIndex = -1;
        twisty.textContent = this.#collapsed.has(entry.id) ? '▸' : '▾';
        row.appendChild(twisty);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'sem-ed-outline-twisty';
        spacer.setAttribute('aria-hidden', 'true');
        row.appendChild(spacer);
      }

      const title = document.createElement('span');
      title.className = 'sem-ed-outline-title';
      title.textContent = entry.title; // textContent — titles are never HTML
      row.appendChild(title);

      const chip = document.createElement('code');
      chip.className = 'sem-ed-outline-tag';
      chip.textContent = entry.tag;
      row.appendChild(chip);

      if (entry.id === selected) {
        row.setAttribute('aria-selected', 'true');
        row.tabIndex = 0;
      }
      this.#tree.appendChild(row);
      this.#rows.push({ id: entry.id, row });
    }
    if (this.#rows.length > 0 && this.#tree.querySelector('[tabindex="0"]') === null) {
      this.#rows[0].row.tabIndex = 0; // the roving stop must exist
    }
    if (focusedId !== null) {
      const again = this.#rows.find((r) => r.id === focusedId);
      if (again && again.row.getAttribute('aria-selected') !== 'true') {
        again.row.tabIndex = 0;
        for (const r of this.#rows) {
          if (r !== again && r.row.tabIndex === 0) r.row.tabIndex = -1;
        }
      }
    }
  }

  /** Move the roving stop + aria-selected to `id` (canvas-driven sync). */
  syncSelection(id: string | null, scroll = false): void {
    for (const { id: rowId, row } of this.#rows) {
      const on = rowId === id;
      if (on) row.setAttribute('aria-selected', 'true');
      else row.removeAttribute('aria-selected');
      row.tabIndex = on ? 0 : -1;
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Focus the selected (or first) row — Cmd/Ctrl+Shift+O lands here. */
  focus(): void {
    const target =
      this.#rows.find((r) => r.row.getAttribute('aria-selected') === 'true')?.row ??
      this.#rows.find((r) => r.row.tabIndex === 0)?.row ??
      this.#rows[0]?.row;
    target?.focus();
  }

  #rowOf(target: EventTarget | null): { id: string; row: HTMLElement } | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-sem-ed-node]') : null;
    if (el === null) return null;
    const id = el.dataset.semEdNode;
    const found = this.#rows.find((r) => r.row === el);
    return found && id ? found : null;
  }

  #toggle(entryId: string): void {
    if (this.#collapsed.has(entryId)) this.#collapsed.delete(entryId);
    else this.#collapsed.add(entryId);
    this.refresh();
    this.syncSelection(this.#ctx.selectedId);
  }

  #onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const twisty = target?.closest?.('.sem-ed-outline-twisty');
    if (twisty !== null && twisty !== undefined) {
      const hit = this.#rowOf(target);
      if (hit) this.#toggle(hit.id);
      return;
    }
    const hit = this.#rowOf(e.target);
    if (hit) this.#hooks.onSelect(hit.id);
  }

  #onDblClick(e: MouseEvent): void {
    const hit = this.#rowOf(e.target);
    if (hit) this.#hooks.onProperties(hit.id);
  }

  #onKey(e: KeyboardEvent): void {
    const hit = this.#rowOf(e.target);
    if (hit === null) return;
    const index = this.#rows.indexOf(hit);
    const entry = this.#entries.find((en) => en.id === hit.id);
    const move = (delta: number): void => {
      const next = this.#rows[Math.min(this.#rows.length - 1, Math.max(0, index + delta))];
      if (next) {
        this.#hooks.onSelect(next.id);
        next.row.focus();
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (entry?.hasChildren && this.#collapsed.has(entry.id)) this.#toggle(entry.id);
        else move(1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (entry?.hasChildren && !this.#collapsed.has(entry.id)) this.#toggle(entry.id);
        else {
          // nothing to collapse → jump to the nearest visible parent row
          const depth = entry?.depth ?? 1;
          for (let i = index - 1; i >= 0; i--) {
            const parent = this.#rows[i];
            if (parent !== undefined && Number(parent.row.getAttribute('aria-level')) < depth) {
              this.#hooks.onSelect(parent.id);
              parent.row.focus();
              break;
            }
          }
        }
        break;
      }
      case 'Home':
        e.preventDefault();
        this.#rows[0] && (this.#hooks.onSelect(this.#rows[0].id), this.#rows[0].row.focus());
        break;
      case 'End':
        e.preventDefault();
        this.#rows.length > 0 &&
          (this.#hooks.onSelect(this.#rows[this.#rows.length - 1].id), this.#rows[this.#rows.length - 1].row.focus());
        break;
      case 'Enter':
        e.preventDefault();
        if (this.#ctx.selectedId === hit.id) this.#hooks.onProperties(hit.id);
        else this.#hooks.onSelect(hit.id);
        break;
      case 'F2':
        e.preventDefault();
        this.#hooks.onProperties(hit.id);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.#hooks.onDelete(hit.id);
        break;
      default:
        break;
    }
  }
}

/**
 * The breadcrumb nav above the canvas: ancestor chain of the selection,
 * current node as the non-interactive tail. Clicking an ancestor selects it.
 * Labels match the outline (content-derived).
 */
export function renderBreadcrumb(ctx: EditorContext, host: HTMLElement): void {
  host.textContent = '';
  host.setAttribute('aria-label', 'Breadcrumb');

  const docCrumb = document.createElement('button');
  docCrumb.type = 'button';
  docCrumb.className = 'sem-ed-crumb';
  docCrumb.textContent = 'Document';
  docCrumb.addEventListener('click', () => ctx.select(null));
  host.appendChild(docCrumb);

  const selected = ctx.selectedId;
  if (selected === null) return;

  const chain = [...ctx.doc.ancestorsOf(selected), ctx.doc.node(selected)].filter(
    (n): n is ElementNode => n !== undefined && n !== null && n.kind === 'element',
  );
  for (const node of chain) {
    const tag = node.name.toLowerCase();
    const isCurrent = node.id === selected;
    const crumb = document.createElement(isCurrent ? 'span' : 'button');
    crumb.className = 'sem-ed-crumb';
    if (isCurrent) crumb.setAttribute('aria-current', 'location');
    else crumb.addEventListener('click', () => ctx.select(node.id));
    const label = outlineLabelFor(ctx, node);
    crumb.textContent = isCurrent ? `${label} (${tag})` : label; // text — never HTML
    host.appendChild(crumb);
  }
}
