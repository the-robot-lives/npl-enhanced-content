/**
 * reading/data-modal — phase 6: the full-page modal viewer and the deep
 * links (spec/data-visualizer.md §10).
 *
 * The modal TELEPORTS the container's own children into a role="dialog"
 * panel: the same enhance output, still live (sort, view buttons, the query
 * chrome all keep their listeners — moving a node never re-binds them),
 * rendered large; closing moves the nodes back in document order. While the
 * modal is open the container is marked data-sem-modal-open and the enhance
 * declines to re-run on it (its children are elsewhere).
 *
 * Deep links use the shared/state.ts `&`-joined hash form, parsed by the
 * pure src/data/deeplink.ts: `#view=<name>&bucket=<source>` scopes to one
 * source, `#dv=<id>&view=<name>&q=<query>` scopes to a container (query
 * chrome included, DV-Q5), and `modal=1` — set only when the link was minted
 * from the modal — reopens it. The tools row (Expand, Copy link) is the
 * authorable chrome that mints and consumes those links.
 */

import { param } from '../shared/attr.js';
import { canCopy, copyText } from '../shared/clipboard.js';
import { closeModalShell, modalShellOpenFor, openModalShell } from '../shared/modal.js';
import { setParam } from '../shared/state.js';
import { parseViews, resolveView, visibleColumns } from '../data/table.js';
import { activeViewName, parseDataDeepLink } from '../data/deeplink.js';
import { normalizeRef } from '../data/names.js';
import { applyView } from './data-tableview.js';
import { currentQueryEdit, setQueryText } from './data-query.js';

const VISUALIZER = 'sem-data-visualizer, .sem-data-visualizer';
const SOURCE = 'sem-data-source, .sem-data-source';

/* ------------------------------------------------------------------ modal */

const MODAL_FLAG = 'data-sem-modal-open';

/** A deep link opens the modal at most once per page load. */
let openedByLink = false;

export function modalOpenFor(container: Element): boolean {
  return modalShellOpenFor(container, MODAL_FLAG);
}

/**
 * Open the full-page modal: teleport the container's children into it.
 * The dialog semantics (backdrop, panel, close button, Escape, focus
 * trap, teleport/restore) live in shared/modal.ts since 0.9.5 — the
 * visualizer names its historical `sem-data-modal*` classes and resets
 * its own Expand chrome on close.
 */
export function openDataModal(container: Element): void {
  openModalShell(container, {
    label: 'Expanded data' + (container.id ? ' — ' + container.id : ''),
    backdropClass: 'sem-data-modal',
    panelClass: 'sem-data-modal-panel',
    closeClass: 'sem-data-modal-close',
    contentClass: 'sem-data-modal-content',
    flagAttr: MODAL_FLAG,
    onClose: (c) => c.querySelectorAll('.sem-data-expand').forEach((b) => b.setAttribute('aria-expanded', 'false')),
  });
}

/** Close the modal: restore the children in order, hand focus back. */
export function closeDataModal(): void {
  closeModalShell({ flagAttr: MODAL_FLAG });
}

/* ------------------------------------------------------------ tools row */

/** What a copy-link for this container can name: its id, or its one named source. */
function linkTarget(container: Element): { dv: string } | { bucket: string } | null {
  if (container.id) return { dv: container.id };
  const named = Array.from(container.querySelectorAll(':scope > ' + SOURCE))
    .map((s) => (param(s, 'name') ?? '').trim())
    .filter((n) => n !== '');
  return named.length === 1 ? { bucket: named[0] } : null;
}

/** The first rendered view-bearing source: its active view and default. */
function currentView(container: Element): { name: string; isDefault: boolean } | null {
  for (const src of Array.from(container.querySelectorAll(':scope > ' + SOURCE))) {
    const table = src.querySelector(':scope .sem-data-body table');
    if (!table) continue;
    const views = parseViews(param(src, 'views'));
    if (!views.length) continue;
    const heads = Array.from(table.querySelectorAll('thead tr:first-of-type th'));
    const columns = heads.map((th) => (th.textContent ?? '').trim());
    const shown = heads.map((th) => !th.hasAttribute('hidden'));
    const name = activeViewName(views, columns, shown);
    if (name) {
      return { name, isDefault: name === resolveView(views, param(src, 'view')).name };
    }
  }
  return null;
}

/** The Expand / Copy-link chrome. Idempotent per container. */
export function wireDataTools(container: Element): void {
  if (container.hasAttribute('data-sem-tools')) return;
  container.setAttribute('data-sem-tools', '');
  // NOTE (integrate 2026-10): the container itself is AUTHORED content — it
  // must NOT carry data-sem-chrome. The editor's positional mapping treats
  // [data-sem-chrome] as non-content: with the mark present the projector
  // skips the visualizer entirely (no stamp binding, no controller) and the
  // authored index of every following sibling drifts. Only the GENERATED
  // bar/buttons below are chrome.
  const bar = document.createElement('div');
  bar.className = 'sem-data-tools';
  // Runtime chrome (§2.4): positional mapping must skip it.
  bar.setAttribute('data-sem-chrome', '');

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'sem-data-expand';
  // Runtime chrome (§2.4): positional mapping must skip it.
  expand.setAttribute('data-sem-chrome', '');
  expand.textContent = 'Expand';
  expand.setAttribute('aria-haspopup', 'dialog');
  expand.setAttribute('aria-expanded', 'false');
  expand.addEventListener('click', () => {
    openDataModal(container);
    expand.setAttribute('aria-expanded', 'true');
  });
  bar.appendChild(expand);

  const target = linkTarget(container);
  if (target && canCopy()) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'sem-data-copy';
    copy.textContent = 'Copy link';
    const status = document.createElement('span');
    status.className = 'sem-data-copy-status';
    status.setAttribute('role', 'status');
    copy.addEventListener('click', () => {
      // Mint from live state through setParam, so every other hash segment —
      // sem-views bare links, audience — survives verbatim (state.ts form).
      if ('dv' in target) {
        setParam('dv', target.dv);
        setParam('bucket', null);
      } else {
        setParam('bucket', target.bucket);
        setParam('dv', null);
      }
      const view = currentView(container);
      setParam('view', view && !view.isDefault ? view.name : null);
      setParam('q', currentQueryEdit(container));
      setParam('modal', modalOpenFor(container) ? '1' : null);
      copyText(location.href, status);
    });
    bar.appendChild(copy);
    bar.appendChild(status);
  }
  container.insertBefore(bar, container.firstChild);
}

/* ------------------------------------------------------------- deep links */

/** Flip one source's rendered table to a named declared view. */
function applyNamedView(src: Element, viewName: string): boolean {
  const views = parseViews(param(src, 'views'));
  const view = views.find((v) => v.name === viewName);
  if (!view) return false;
  const table = src.querySelector(':scope .sem-data-body table');
  if (!table) return false;
  const heads = Array.from(table.querySelectorAll('thead tr:first-of-type th'));
  const columns = heads.map((th) => (th.textContent ?? '').trim());
  applyView(table as HTMLTableElement, visibleColumns(view, columns));
  src.querySelectorAll('.sem-data-view').forEach((b) => {
    b.setAttribute('aria-pressed', (b.textContent ?? '').trim() === viewName ? 'true' : 'false');
  });
  return true;
}

function openLinkedModal(container: Element): void {
  if (openedByLink) return;
  openedByLink = true;
  openDataModal(container);
}

/**
 * Apply every hash segment that names this container. Called from the
 * enhance after rendering, so sync sources already have tables; async
 * (file/API) sources re-enter through applyDeepLinkToSource when they land.
 */
export function applyDeepLinkToContainer(container: Element): void {
  const link = parseDataDeepLink(location.hash);
  if (!link) return;
  let hit = false;
  if (link.dv !== null && link.dv === container.id) {
    if (link.view) {
      container.querySelectorAll(':scope > ' + SOURCE).forEach((src) => {
        if (applyNamedView(src, link.view as string)) hit = true;
      });
    }
    if (link.q !== null && setQueryText(container, link.q)) hit = true;
    if (link.view || link.q !== null || link.modal) hit = true;
  }
  if (link.bucket !== null && link.view) {
    for (const src of Array.from(container.querySelectorAll(':scope > ' + SOURCE))) {
      const name = (param(src, 'name') ?? '').trim();
      if (!name || normalizeRef(name) !== normalizeRef(link.bucket)) continue;
      if (applyNamedView(src, link.view)) hit = true;
      break;
    }
  }
  if (hit && link.modal) openLinkedModal(container);
}

/** Late path: a bucket-scoped link whose source has just finished loading. */
export function applyDeepLinkToSource(src: Element): void {
  const link = parseDataDeepLink(location.hash);
  if (!link || link.bucket === null || !link.view) return;
  const name = (param(src, 'name') ?? '').trim();
  if (!name || normalizeRef(name) !== normalizeRef(link.bucket)) return;
  if (!applyNamedView(src, link.view)) return;
  const container = src.closest(VISUALIZER);
  if (container && link.modal) openLinkedModal(container);
}

/** Test hook: reset the once-per-page link-open latch. */
export function resetDeepLinkLatch(): void {
  openedByLink = false;
}
