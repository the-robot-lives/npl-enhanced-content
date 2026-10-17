/**
 * insert/panel — the block-inserter panel (EDITOR.md §5.5 road 3).
 *
 * A modal dialog grouped by descriptor `bucket` with a filter box on top.
 * Tiles are placement-filtered: only entries the schema permits at the
 * target render at all (§5.5 "disallowed insert points never render").
 * Picking a tile with a wizard opens the stepper (road 4); picking a plain
 * entry inserts in ONE op and closes.
 *
 * A11y (§7): the filter box is the initial focus; tiles rove with arrows
 * (flat order across groups); Enter picks; Esc cancels and restores focus.
 * Everything is text — no HTML from schema/descriptor data.
 */

import type { EditorContext } from '../controller/types.js';
import { INSERT_CSS } from './insert-css.js';
import { entriesForTarget, filterEntries, groupEntries } from './catalog.js';
import { containerTagAt } from './placement.js';
import { documentMovedSince, insertEntryAt } from './apply.js';
import { openWizard } from './wizard.js';
import type { InsertEntry, InsertOpenOptions, InsertTarget } from './types.js';

export interface InsertPanelOptions extends InsertOpenOptions {}

function injectCss(doc: Document): void {
  if (doc.querySelector(`style[data-sem-editor-css][data-sem-ed-block="insert"]`) !== null) return;
  const style = doc.createElement('style');
  style.setAttribute('data-sem-editor-css', '');
  style.setAttribute('data-sem-ed-block', 'insert');
  style.textContent = INSERT_CSS;
  doc.head?.appendChild(style) ?? doc.appendChild(style);
}

/**
 * Open the inserter panel for `target`. Returns the dialog (already in the
 * DOM and shown), or null when nothing can be inserted there — refusal is
 * announced, not silent.
 */
export function openInsertPanel(
  ctx: EditorContext,
  target: InsertTarget,
  options: InsertPanelOptions = {},
): HTMLDialogElement | null {
  const doc = ctx.doc;
  // single-panel invariant: a second activation (e.g. Enter replayed while
  // the edit bundle was still importing) must replace any open panel, not
  // stack a second modal on the top layer — two open modals make every
  // later focus() into the canvas a silent no-op.
  for (const stale of Array.from(document.querySelectorAll('dialog.sem-ed-ins-panel'))) {
    (stale as HTMLDialogElement).close();
  }
  const openedAtVersion = doc.version;
  const available = entriesForTarget(doc, target);
  if (available.length === 0) {
    ctx.announce('No blocks can be inserted at this position.');
    options.onCancel?.();
    return null;
  }

  injectCss(document);

  const dialog = document.createElement('dialog');
  dialog.className = 'sem-ed-modal sem-ed-ins-panel';

  const heading = document.createElement('h2');
  heading.id = 'sem-ed-ins-title';
  heading.textContent = 'Insert block';
  dialog.appendChild(heading);

  const containerTag = containerTagAt(doc, target);
  const hint = document.createElement('p');
  hint.className = 'sem-ed-ins-hint';
  hint.textContent = containerTag === null ? 'At the top level of the document.' : `Into <${containerTag}>.`;
  dialog.appendChild(hint);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'sem-ed-input';
  search.placeholder = 'Filter blocks…';
  search.setAttribute('aria-label', 'Filter blocks');
  const searchWrap = document.createElement('div');
  searchWrap.className = 'sem-ed-ins-search';
  searchWrap.appendChild(search);
  dialog.appendChild(searchWrap);

  const body = document.createElement('div');
  body.className = 'sem-ed-ins-body';
  dialog.appendChild(body);

  let active = 0;

  const visibleTiles = (): HTMLButtonElement[] =>
    Array.from(body.querySelectorAll<HTMLButtonElement>('.sem-ed-ins-tile:not([hidden])'));

  const syncRoving = (): void => {
    const tiles = visibleTiles();
    active = Math.max(0, Math.min(active, tiles.length - 1));
    tiles.forEach((tile, i) => tile.tabIndex = i === active ? 0 : -1);
  };

  const pick = (entry: InsertEntry): void => {
    if (documentMovedSince(ctx, openedAtVersion)) {
      // §5.4 pattern: the tree moved under us — say so, stay open.
      hint.textContent = 'The document changed while this panel was open — try again.';
      return;
    }
    finish('insert'); // a pick, not a cancel — the close handler skips onCancel
    if (entry.wizard !== null) {
      openWizard(ctx, entry, target, options);
    } else {
      insertEntryAt(ctx, entry, target, { onInsert: (e, t) => options.onInsert?.(e, t) });
    }
  };

  const render = (query: string): void => {
    body.textContent = '';
    const filtered = filterEntries(available, query);
    if (filtered.length === 0) {
      const none = document.createElement('p');
      none.className = 'sem-ed-ins-empty';
      none.textContent = query.trim() === '' ? 'No blocks can be inserted here.' : 'No blocks match.';
      body.appendChild(none);
      return;
    }
    for (const group of groupEntries(filtered)) {
      const section = document.createElement('section');
      section.className = 'sem-ed-ins-group';
      section.setAttribute('aria-labelledby', `sem-ed-ins-g-${group.bucket}`);
      const label = document.createElement('h3');
      label.className = 'sem-ed-ins-group-label';
      label.id = `sem-ed-ins-g-${group.bucket}`;
      label.textContent = group.label; // textContent — never HTML
      const tiles = document.createElement('div');
      tiles.className = 'sem-ed-ins-tiles';
      for (const entry of group.entries) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'sem-ed-ins-tile';
        const title = document.createElement('span');
        title.className = 'sem-ed-ins-tile-title';
        title.textContent = entry.wizard !== null ? `${entry.title}…` : entry.title;
        const tag = document.createElement('span');
        tag.className = 'sem-ed-ins-tile-tag';
        tag.textContent = `<${entry.tag}>`;
        const summary = document.createElement('span');
        summary.className = 'sem-ed-ins-tile-summary';
        summary.textContent = entry.summary;
        tile.append(title, tag, summary);
        tile.addEventListener('click', () => pick(entry));
        tiles.appendChild(tile);
      }
      section.append(label, tiles);
      body.appendChild(section);
    }
    active = 0;
    syncRoving();
  };

  search.addEventListener('input', () => render(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      visibleTiles()[0]?.focus();
    }
  });
  body.addEventListener('keydown', (e) => {
    const tiles = visibleTiles();
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (tiles.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      active = at < 0 ? 0 : (at + delta + tiles.length) % tiles.length;
      syncRoving();
      tiles[active].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      active = e.key === 'Home' ? 0 : tiles.length - 1;
      syncRoving();
      tiles[active]?.focus();
    }
  });

  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const finish = (result: 'insert' | 'cancel'): void => {
    dialog.dataset.semEdResult = result; // happy-dom has no returnValue
    dialog.close();
  };

  dialog.addEventListener('close', () => {
    // leave the top layer BEFORE restoring focus: focus() into an open
    // modal dialog's inert background is a silent no-op, so a focus-first
    // order can strand the caret on <body> under slow/throttled renderers.
    dialog.remove();
    if (priorFocus?.isConnected) priorFocus.focus();
    // result 'insert' means a pick already ran; anything else is a cancel
    if (dialog.dataset.semEdResult !== 'insert') options.onCancel?.();
  });

  document.body.appendChild(dialog);
  render('');
  dialog.showModal();
  search.focus();
  return dialog;
}
