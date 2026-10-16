/**
 * md/element — sem-md: chrome, rendered body, raw fence, toggle and copy.
 *
 * Spec: spec/schema/sem-md.md. Idempotent per element: chrome already
 * present means nothing is built again, which lets the Lit component call
 * this after the bundle scan may already have run (or vice versa). The
 * marker is NOT set here — the calling layer (bundle scan or component)
 * stamps `data-sem-upgraded`.
 *
 * The element's text is consumed: after enhancement it holds exactly the
 * chrome, the rendered `.sem-md-body` and the `.sem-md-raw` fence whose
 * `<code>` carries the normalised source byte-identically. Extraction reads
 * `source` from that fence (spec/extraction.md §4), so the raw view is
 * the record, not a copy of it.
 *
 * The clipboard helper is shared with sem-code (src/shared/clipboard.ts);
 * the fence's own copy / wrap chrome is sem-code's, supplied by the caller
 * (see `enhanceFence`) so this bundle does not carry the listing code.
 */

import { param } from '../shared/attr.js';
import { normalizeMd } from '../shared/mdsource.js';
import { parseBlocks } from './parse.js';
import { copyText, canCopy } from '../shared/clipboard.js';

export const MD = ':is(sem-md, .sem-md)';

declare global {
  interface Window {
    SemTextReading?: { enhanceCodeElement?: (el: Element) => void };
  }
}

/** sem-code's enhance function: the caller's, else the reading bundle's
 *  global, resolved at call time so load order does not matter. */
const fenceEnhancer = (given?: (fence: Element) => void): ((fence: Element) => void) | undefined =>
  given || (typeof window !== 'undefined' ? window.SemTextReading?.enhanceCodeElement : undefined);

/**
 * `enhanceFence` gives the raw fence its sem-code chrome (copy, wrap). The
 * Lit wrapper passes the imported `enhanceCodeElement`; the Markdown bundle
 * passes nothing and the reading bundle's global is looked up when the
 * fence is built — and again on re-entry, so a fence built before the
 * reading bundle ran gets its chrome on the next scan. The listing code is
 * never bundled twice; without the reading bundle the fence is a plain
 * (CSS-captioned) sem-code.
 *
 * Idempotent on the chrome's presence. A parser failure (it should not
 * happen — nesting is capped — but the element's text has already been
 * consumed by then) restores the source text so nothing is lost.
 */
export function enhanceMdElement(el: Element, enhanceFence?: (fence: Element) => void): void {
  if (el.querySelector(':scope > .sem-md-chrome')) {
    const fence = el.querySelector(':scope > .sem-md-raw > .sem-code');
    const f = fenceEnhancer(enhanceFence);
    if (fence && f && !fence.querySelector(':scope > .sem-code-chrome')) f(fence);
    return;
  }
  const source = normalizeMd(el.textContent || '');
  try {
    build(el, source, enhanceFence);
  } catch (err) {
    el.textContent = source;
    console.warn('sem-md: render failed', err);
  }
}

function build(el: Element, source: string, enhanceFence?: (fence: Element) => void): void {
  const controls = (param(el, 'controls') || 'toggle,copy').split(/[,\s]+/).filter(Boolean);
  const label = param(el, 'label') || '';
  let raw = param(el, 'view-as') === 'raw';
  // Marker-preserving wipe: lit light-DOM part markers are runtime chrome —
  // ejecting them makes the NEXT render throw ("ChildPart has no parentNode").
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.COMMENT_NODE) continue; // lit part markers
    el.removeChild(n);
  }

  const div = (cls: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  };
  const chrome = div('sem-md-chrome');
  if (label) {
    const s = document.createElement('span');
    s.className = 'sem-md-label';
    s.textContent = label;
    chrome.appendChild(s);
  }
  const status = document.createElement('span');
  status.className = 'sem-md-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const button = (act: string, text: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-act', act);
    b.textContent = text;
    chrome.appendChild(b);
    return b;
  };
  let toggle: HTMLButtonElement | null = null;
  const copyOk = canCopy();
  controls.forEach((c) => {
    if (c === 'toggle' && !toggle) toggle = button('toggle', 'Markdown');
    if (c === 'copy' && copyOk) button('copy', 'Copy').setAttribute('aria-label', 'Copy Markdown');
  });
  chrome.appendChild(status);

  const body = div('sem-md-body');
  parseBlocks(source, body);

  const rawBox = div('sem-md-raw');
  const fence = div('sem-code');
  fence.setAttribute('data-lang', 'markdown');
  fence.setAttribute('data-controls', 'copy,wrap');
  const code = document.createElement('code');
  code.textContent = source;
  fence.appendChild(document.createElement('pre')).appendChild(code);
  rawBox.appendChild(fence);
  const f = fenceEnhancer(enhanceFence);
  if (f) f(fence);

  el.append(chrome, body, rawBox);

  const setView = (r: boolean): void => {
    raw = r;
    el.setAttribute('data-view-as', r ? 'raw' : 'rendered');
    if (toggle) toggle.setAttribute('aria-pressed', String(r));
  };
  setView(raw);

  chrome.addEventListener('click', (e) => {
    const act = (e.target as Element).closest('button')?.getAttribute('data-act');
    if (act === 'toggle') setView(!raw);
    if (act === 'copy') copyText(source, status);
  });
}
