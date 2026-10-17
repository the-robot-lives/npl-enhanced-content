/**
 * insert/slash — the `/` command (EDITOR.md §5.5 road 2).
 *
 * Typing `/` in an EMPTY text slot opens a filterable template menu. The
 * typed `/` is consumed as the trigger (removed from the editable, restored
 * on dismissal); a `/` typed with any preceding text is literal — the
 * trigger only fires when the editable holds no text.
 *
 * Target resolution: insertion goes at the first enclosing level the schema
 * permits blocks (the slot's host's parent in the common case) — a slash in
 * a note body inserts AFTER the note, not inside it. Entries are
 * placement-filtered to that target, so the menu never offers a block the
 * schema would refuse.
 *
 * A11y (§7): the filter box takes focus; options rove with arrows; Enter
 * picks; Esc dismisses and restores the literal `/`; focus-out dismisses.
 */

import type { EditorContext } from '../controller/types.js';
import { bindingFor } from '../controller/attach.js';
import { modelIdFor } from '../controller/map.js';
import { INSERT_CSS } from './insert-css.js';
import { entriesForTarget, filterEntries } from './catalog.js';
import { allowedTagsAt, indexAmongChildren } from './placement.js';
import { insertEntryAt } from './apply.js';
import type { InsertEntry, InsertTarget } from './types.js';

export interface SlashOptions {
  /** Where keydown/input is observed (the canvas, or document.body). */
  root: HTMLElement;
  ctx: EditorContext;
}

/** Detach fn. */
export function attachSlashCommand(opts: SlashOptions): () => void {
  const { root, ctx } = opts;
  let open: { close: () => void } | null = null;

  const onInput = (e: Event): void => {
    if (open !== null) return;
    const editable = e.target as HTMLElement;
    if (!editable.isContentEditable) return;
    if (editable.closest('[data-sem-chrome]') !== null) return;
    if (editable.textContent !== '/') return; // empty slot + the typed slash only
    const target = resolveSlashTarget(ctx, editable);
    if (target === null) return;
    if (entriesForTarget(ctx.doc, target).length === 0) return;
    editable.textContent = ''; // consume the trigger
    open = openSlashMenu(ctx, {
      anchor: editable,
      target,
      // any close resets the trigger latch
      onClose: () => {
        open = null;
      },
      // dismissal restores the literal `/` — it was never committed
      onDismiss: () => {
        editable.textContent = '/';
        placeCaretAtEnd(editable);
        ctx.announce('Insert dismissed — / kept as text.');
      },
    });
    if (open !== null) ctx.announce('Insert menu open — type to filter, Enter picks, Escape dismisses.');
  };

  root.addEventListener('input', onInput, true);
  return () => {
    root.removeEventListener('input', onInput, true);
    open?.close();
  };
}

/**
 * First enclosing level that accepts blocks: walk from the editable to its
 * bound host, then up through the host's ancestors; each level offers the
 * position right AFTER that element. Null = nothing allowed anywhere.
 */
export function resolveSlashTarget(ctx: EditorContext, editable: Element): InsertTarget | null {
  for (let el: Element | null = editable; el !== null; el = el.parentElement) {
    const binding = bindingFor(el);
    if (binding === undefined) continue;
    const id = modelIdFor(ctx, binding, el);
    if (id === null) continue;
    if (id === ctx.doc.root.id) {
      // the host IS the document projection — only the top level remains
      if (allowedTagsAt(ctx.doc, ctx.doc.root.id).size === 0) continue;
      return { parentId: ctx.doc.root.id, index: ctx.doc.root.children.length };
    }
    const node = ctx.doc.node(id);
    if (node === undefined) continue;
    const parentId = node.parentId ?? ctx.doc.root.id;
    const index = indexAmongChildren(ctx.doc, id) + 1;
    if (allowedTagsAt(ctx.doc, parentId).size === 0) continue; // try the next level up
    return { parentId, index };
  }
  return null;
}

// ── the menu ────────────────────────────────────────────────────────────────

function injectCss(doc: Document): void {
  if (doc.querySelector(`style[data-sem-editor-css][data-sem-ed-block="insert"]`) !== null) return;
  const style = doc.createElement('style');
  style.setAttribute('data-sem-editor-css', '');
  style.setAttribute('data-sem-ed-block', 'insert');
  style.textContent = INSERT_CSS;
  doc.head?.appendChild(style) ?? doc.appendChild(style);
}

interface SlashMenuHandle {
  close: () => void;
}

function openSlashMenu(
  ctx: EditorContext,
  opts: {
    anchor: HTMLElement;
    target: InsertTarget;
    /** fires on EVERY close (insert or dismiss) — resets the trigger latch */
    onClose: () => void;
    /** fires only on dismissal (Esc / focus-out) — restores the literal `/` */
    onDismiss: () => void;
  },
): SlashMenuHandle | null {
  const available = entriesForTarget(ctx.doc, opts.target);
  if (available.length === 0) return null;
  const ownerDoc = opts.anchor.ownerDocument ?? globalThis.document;
  injectCss(ownerDoc);

  const menu = ownerDoc.createElement('div');
  menu.className = 'sem-ed-ins-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Insert block');

  const filter = ownerDoc.createElement('input');
  filter.type = 'search';
  filter.className = 'sem-ed-input';
  filter.setAttribute('aria-label', 'Filter blocks');
  menu.appendChild(filter);

  const list = ownerDoc.createElement('div');
  menu.appendChild(list);

  let active = 0;
  const options = (): HTMLElement[] =>
    Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));

  const syncSelected = (): void => {
    const els = options();
    active = Math.max(0, Math.min(active, els.length - 1));
    els.forEach((el, i) => el.setAttribute('aria-selected', i === active ? 'true' : 'false'));
  };

  const pick = (entry: InsertEntry): void => {
    close('insert');
    insertEntryAt(ctx, entry, opts.target);
  };

  const render = (query: string): void => {
    list.textContent = '';
    const filtered = filterEntries(available, query);
    if (filtered.length === 0) {
      const none = ownerDoc.createElement('div');
      none.className = 'sem-ed-ins-empty';
      none.textContent = 'No blocks match.';
      list.appendChild(none);
      return;
    }
    for (const entry of filtered) {
      const item = ownerDoc.createElement('button');
      item.type = 'button';
      item.className = 'sem-ed-ins-menu-item';
      item.setAttribute('role', 'option');
      const title = ownerDoc.createElement('span');
      title.textContent = entry.title;
      const tag = ownerDoc.createElement('span');
      tag.className = 'sem-ed-ins-tile-tag';
      tag.textContent = `<${entry.tag}>`;
      item.append(title, tag);
      item.addEventListener('click', () => pick(entry));
      list.appendChild(item);
    }
    active = 0;
    syncSelected();
  };

  filter.addEventListener('input', () => render(filter.value));
  filter.addEventListener('keydown', (e) => {
    const els = options();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (els.length === 0) return;
      active = e.key === 'ArrowDown' ? (active + 1) % els.length : (active + els.length - 1) % els.length;
      syncSelected();
      els[active].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const el = els[active];
      if (el !== undefined) (el as HTMLButtonElement).click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close('dismiss');
    }
  });

  // position near the anchor (fixed to the viewport is enough for v1)
  const rect = opts.anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 4)}px`;

  const close = (why: 'insert' | 'dismiss'): void => {
    filter.removeEventListener('focusout', onFocusOut);
    menu.remove();
    opts.onClose();
    if (why === 'dismiss') opts.onDismiss();
  };
  const onFocusOut = (e: FocusEvent): void => {
    const next = e.relatedTarget;
    if (next !== null && menu.contains(next as Node)) return;
    close('dismiss');
  };
  filter.addEventListener('focusout', onFocusOut);

  ownerDoc.body.appendChild(menu);
  render('');
  filter.focus();
  return { close: () => close('dismiss') };
}

function placeCaretAtEnd(el: HTMLElement): void {
  const selection = window.getSelection?.();
  if (selection === undefined || selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
