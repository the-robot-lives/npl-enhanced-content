/**
 * outline — the left rail (§5.3) and the breadcrumb row above the canvas.
 *
 * Both are projections of `ctx` selection + document state: the outline is a
 * keyboard-navigable listbox of element nodes (descriptor titles, tag chips),
 * the breadcrumb the ancestor chain of the selection. Neither owns state —
 * `<sem-editor>` refreshes them on doc change / selectionchange and routes
 * the verbs (select / properties / delete) to its own handlers.
 */

import type { ElementNode } from '../model/types.js';
import type { EditorContext } from './context.js';

export interface OutlineEntry {
  id: string;
  tag: string;
  title: string;
  depth: number;
}

/** Depth-first walk of element nodes (text/comments are not outline rows). */
export function outlineEntries(ctx: EditorContext): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const walk = (children: readonly import('../model/types.js').EditorNode[], depth: number): void => {
    for (const node of children) {
      if (node.kind !== 'element') continue;
      const el = node as ElementNode;
      const tag = el.name.toLowerCase();
      entries.push({
        id: el.id,
        tag,
        title: ctx.descriptorView?.descriptorFor(tag)?.title ?? tag,
        depth,
      });
      walk(el.children, depth + 1);
    }
  };
  walk(ctx.doc.root.children, 0);
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
 * The outline listbox. Roving tabindex across rows (§7); arrows move the
 * selection; Enter selects (again = properties); Delete deletes.
 */
export class OutlineList {
  readonly root: HTMLElement;
  #list: HTMLElement;
  #ctx: EditorContext;
  #hooks: OutlineHooks;
  #rows: Array<{ id: string; row: HTMLElement }> = [];

  constructor(ctx: EditorContext, hooks: OutlineHooks) {
    this.#ctx = ctx;
    this.#hooks = hooks;
    this.root = document.createElement('aside');
    this.root.className = 'sem-ed-outline';

    const label = document.createElement('h2');
    label.className = 'sem-ed-outline-label';
    label.id = 'sem-ed-outline-label';
    label.textContent = 'Outline';
    this.root.appendChild(label);

    this.#list = document.createElement('div');
    this.#list.className = 'sem-ed-outline-list';
    this.#list.setAttribute('role', 'listbox');
    this.#list.setAttribute('aria-labelledby', label.id);
    this.#list.addEventListener('keydown', (e) => this.#onKey(e));
    this.#list.addEventListener('click', (e) => this.#onClick(e));
    this.#list.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this.root.appendChild(this.#list);
  }

  /** Swap in the real context (the shell constructs the list before
   *  openDocument hands it a document-backed one). */
  setContext(ctx: EditorContext): void {
    this.#ctx = ctx;
  }

  /** Rebuild rows from the current document. Keeps keyboard position when
   *  the previously focused row still exists. */
  refresh(): void {
    const focusedId = document.activeElement?.closest?.('[data-sem-ed-node]')?.getAttribute('data-sem-ed-node') ?? null;
    this.#list.textContent = '';
    this.#rows = [];
    const entries = outlineEntries(this.#ctx);
    const selected = this.#ctx.selectedId;
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'sem-ed-outline-item';
      row.setAttribute('role', 'option');
      row.style.setProperty('--sem-ed-depth', String(entry.depth));
      row.dataset.semEdNode = entry.id;
      row.tabIndex = -1;

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
      this.#list.appendChild(row);
      this.#rows.push({ id: entry.id, row });
    }
    if (this.#rows.length > 0 && this.#list.querySelector('[tabindex="0"]') === null) {
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

  #onClick(e: MouseEvent): void {
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
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(index + 1, this.#rows.length - 1) : Math.max(index - 1, 0);
        const row = this.#rows[next];
        if (row) {
          this.#hooks.onSelect(row.id);
          row.row.focus();
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
    const title = ctx.descriptorView?.descriptorFor(tag)?.title ?? tag;
    crumb.textContent = isCurrent ? `${title} (${tag})` : title; // text — never HTML
    host.appendChild(crumb);
  }
}
