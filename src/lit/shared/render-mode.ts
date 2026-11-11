/**
 * render-mode — the shared rich/terminal render-mode controller.
 *
 * One resolver, one DOM contract, one document driver. Every SemText
 * component can be viewed as rich content (the default) or as a terminal
 * text block — the same content `semtext format --text` prints, framed
 * with unicode box-drawing (src/shared/text-render). The mode is never
 * per-component code: components carry no render-mode logic at all. This
 * module resolves the mode for any element and, through the document
 * driver, mounts/unmounts the `<pre class="sem-tui">` text view.
 *
 * Resolution (first match wins):
 *   1. the element's own `render-mode="tui|rich"` attribute (or the
 *      boolean `tui` spelling, `tui="rich"` opting back out),
 *   2. the nearest ancestor `<sem-tui>` frame's current mode
 *      (`data-mode`, default `tui`) — a subtree switch, not per-element,
 *   3. `rich`.
 *
 * Mounting contract: the OUTERMOST tui-mode element in a subtree renders
 * the text — its whole subtree goes through the extractor, so nested
 * sem-* elements are rendered INLINE by their parent and never mount a
 * second frame (no double framing). A mounted element carries
 * `data-sem-tui-active` and a trailing `pre.sem-tui` child; the
 * vocabulary CSS hides the authored children while that attribute is
 * present, so nothing is moved, destroyed or re-wired — flipping back to
 * rich is removing one attribute and one node.
 *
 * The driver installs once per document (the core barrel calls it; pages
 * that load only a lazy chunk get static `<sem-tui>` framing without the
 * toggle). It re-scans on DOMContentLoaded, on DOM mutations and on the
 * bubbling `sem-render-mode-change` event the `<sem-tui>` toggle
 * dispatches. Purity note: text comes from the pure renderer, which
 * never writes; the only writes here are the attribute and the one
 * `<pre>` — generated chrome the extractor deliberately ignores, so JS-on
 * and JS-off extraction stay byte-identical (conventions §8).
 */

import { renderElementAsText, PASS_THROUGH_TAGS } from '../../shared/text-render/index.js';

export type RenderMode = 'rich' | 'tui';

/** The mounted text view. Lives as the LAST child of the host. */
export const TUI_PRE_SELECTOR = 'pre.sem-tui';

/** The marker that gates the vocabulary CSS hide-rule. */
export const TUI_ACTIVE_ATTR = 'data-sem-tui-active';

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

function ownMode(el: Element): RenderMode | null {
  const rm = el.getAttribute('render-mode');
  if (rm === 'tui' || rm === 'rich') return rm;
  if (el.hasAttribute('tui')) {
    const v = el.getAttribute('tui');
    return v === 'rich' || v === 'off' || v === 'false' ? 'rich' : 'tui';
  }
  return null;
}

/** The resolved mode of one element (attribute > ancestor frame > rich). */
export function resolveRenderMode(el: Element): RenderMode {
  const own = ownMode(el);
  if (own) return own;
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.localName === 'sem-tui') {
      return cur.getAttribute('data-mode') === 'rich' ? 'rich' : 'tui';
    }
    cur = cur.parentElement;
  }
  return 'rich';
}

/** Wrap width from the nearest enclosing `<sem-tui cols>` (default 80). */
export function nearestTuiCols(el: Element): number {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.localName === 'sem-tui') {
      const raw = parseInt(cur.getAttribute('cols') || '', 10);
      if (Number.isFinite(raw)) return Math.min(500, Math.max(20, raw));
      return 80;
    }
    cur = cur.parentElement;
  }
  return 80;
}

/**
 * Does a sem-* ancestor of `el` render its subtree as text? Such an
 * ancestor renders `el` inline, so `el` must not mount its own frame.
 * Pass-through wrappers (sem-source, the sem-tui frame itself) are
 * transparent here: the walk continues through them.
 */
export function hasTuiRenderingAncestor(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    const tag = cur.localName;
    if (!PASS_THROUGH_TAGS.has(tag) && tag.startsWith('sem-')) {
      if (resolveRenderMode(cur) === 'tui') return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Mount / unmount
 * ------------------------------------------------------------------ */

function tuiLabel(el: Element): string {
  const id = el.getAttribute('id');
  return `${el.localName}${id ? ' #' + id : ''} — terminal text view`;
}

/** Mount (or refresh) the terminal text view of one element. Idempotent. */
export function mountTui(el: Element, text: string): void {
  let pre = el.querySelector(':scope > ' + TUI_PRE_SELECTOR);
  if (!pre) {
    pre = document.createElement('pre');
    pre.className = 'sem-tui';
    pre.setAttribute('part', 'tui');
    el.appendChild(pre);
  }
  if (!el.hasAttribute(TUI_ACTIVE_ATTR)) el.setAttribute(TUI_ACTIVE_ATTR, '');
  if (pre.textContent !== text) pre.textContent = text;
  if (pre.getAttribute('aria-label') !== tuiLabel(el)) pre.setAttribute('aria-label', tuiLabel(el));
}

/** Remove the terminal text view; the authored content shows again. */
export function unmountTui(el: Element): void {
  if (!el.hasAttribute(TUI_ACTIVE_ATTR)) return;
  el.removeAttribute(TUI_ACTIVE_ATTR);
  const pre = el.querySelector(':scope > ' + TUI_PRE_SELECTOR);
  if (pre) pre.remove();
}

/* ------------------------------------------------------------------ *
 * The document driver
 * ------------------------------------------------------------------ */

const driven = /* @__PURE__ */ new WeakSet<Document>();
const pending = /* @__PURE__ */ new Set<Document>();

function renderTextFor(el: Element): string {
  return renderElementAsText(el, { cols: nearestTuiCols(el) });
}

/** One pass over the document: mount outermost tui elements, unmount the
 *  rest. Idempotent; safe to call directly (the driver schedules it). */
export function rescanRenderModes(doc: Document = document): void {
  if (doc.readyState === 'loading') return;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const tag = el.localName;
    if (!tag.startsWith('sem-') || PASS_THROUGH_TAGS.has(tag)) continue;
    const mode = resolveRenderMode(el);
    if (mode === 'rich' || hasTuiRenderingAncestor(el)) {
      unmountTui(el);
      continue;
    }
    mountTui(el, renderTextFor(el));
  }
}

function scheduleRescan(doc: Document): void {
  if (doc.readyState === 'loading') return;
  if (pending.has(doc)) return;
  pending.add(doc);
  queueMicrotask(() => {
    pending.delete(doc);
    rescanRenderModes(doc);
  });
}

/**
 * Install the per-document driver: initial scan at DOMContentLoaded, a
 * mutation watch for late-authored/dynamic subtrees, and the
 * `sem-render-mode-change` listener the `<sem-tui>` toggle fires. One
 * driver per document; repeated calls are no-ops.
 */
export function installRenderModeDriver(doc: Document = document): void {
  if (driven.has(doc)) return;
  driven.add(doc);

  const onMutation = (): void => scheduleRescan(doc);

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => rescanRenderModes(doc), { once: true });
  } else {
    // Element upgrades can stream in around an already-loaded script;
    // one microtask lets the batch settle before the first scan.
    queueMicrotask(() => rescanRenderModes(doc));
  }

  new MutationObserver(onMutation).observe(doc, { childList: true, subtree: true });
  new MutationObserver(onMutation).observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['render-mode', 'tui', 'data-mode', 'cols', 'theme'],
    subtree: true,
  });
  doc.addEventListener('sem-render-mode-change', onMutation, true);
}
