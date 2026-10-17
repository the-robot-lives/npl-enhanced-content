/**
 * reading/code — sem-code chrome, line marks, copy and wrap.
 *
 * Spec: spec/schema/sem-code.md. Idempotent per element: chrome already
 * present means nothing is added again, which is what lets the Lit
 * component call this after the bundle scan may already have run (or vice
 * versa). The marker is NOT set here — the calling layer (bundle scan or
 * component) stamps `data-sem-upgraded`.
 *
 * Line wrapping keeps the `<code>` text byte-identical: lines become spans
 * with `\n` text nodes between them, so extraction's verbatim `source`
 * reads the same before and after (spec/extraction.md §5).
 */

import { param, hasParam } from '../shared/attr.js';
import { trimTrailingWs } from '../shared/trim.js';
import { parseMarks } from '../shared/marks.js';
import { copyText, canCopy } from '../shared/clipboard.js';

export const CODE = ':is(sem-code, .sem-code)';

/**
 * Flat authoring form (spec/schema/sem-code.md): the listing may be
 * authored as the element's own text, with no `<pre>` child — the element
 * wraps it in `<pre><code>` itself, so authors never nest by hand. Runs
 * before the chrome build; idempotent (a `<pre>` child wins, and an empty
 * or element-bearing host is left untouched — author-side highlighting
 * without a `<pre>` is never flattened away).
 */
function adoptTextListing(el: Element): void {
  if (el.querySelector(':scope > pre')) return;
  if (el.children.length > 0) return;
  const raw = el.textContent ?? '';
  // One structural leading newline (after the open tag) and trailing
  // whitespace carrying the close tag are authoring layout, not content;
  // interior whitespace stays byte-identical (the verbatim contract).
  const source = trimTrailingWs(raw.replace(/^\n/, ''));
  if (!source) return;
  el.textContent = '';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.appendChild(code);
  el.appendChild(pre);
}

function wrapLines(code: Element, marks: number[]): void {
  if (code.children.length) return; // author-side markup: leave as authored
  const lines = (code.textContent || '').split('\n');
  const set = new Set(marks);
  code.textContent = '';
  lines.forEach((line, i) => {
    if (i) code.appendChild(document.createTextNode('\n'));
    const span = document.createElement(set.has(i + 1) ? 'mark' : 'span');
    span.className = 'sem-code-line';
    span.textContent = line;
    code.appendChild(span);
  });
}

export function enhanceCodeElement(el: Element): void {
  if (el.querySelector(':scope > .sem-code-chrome')) return;
  adoptTextListing(el);
  const pre = el.querySelector<HTMLElement>(':scope > pre');
  if (!pre) return;
  const code = pre.querySelector('code') || pre;
  const filename = param(el, 'filename') || '';
  const lang = param(el, 'lang') || '';
  const controls = (param(el, 'controls') ?? 'copy').split(/[,\s]+/).filter(Boolean);

  wrapLines(code, parseMarks(param(el, 'mark'), (code.textContent || '').split('\n').length));

  const chrome = document.createElement('div');
  chrome.className = 'sem-code-chrome';
  const label = (cls: string, text: string): void => {
    if (!text) return;
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    chrome.appendChild(s);
  };
  label('sem-code-filename', filename);
  label('sem-code-lang', lang);

  const status = document.createElement('span');
  status.className = 'sem-code-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const copyOk = canCopy();
  const button = (act: string, text: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-act', act);
    b.textContent = text;
    chrome.appendChild(b);
    return b;
  };
  let wrapBtn: HTMLButtonElement | null = null;
  controls.forEach((c) => {
    if (c === 'copy' && copyOk) button('copy', 'Copy');
    if (c === 'wrap' && !wrapBtn) {
      wrapBtn = button('wrap', 'Wrap');
      wrapBtn.setAttribute('aria-pressed', String(hasParam(el, 'wrap')));
    }
  });
  chrome.appendChild(status);
  el.insertBefore(chrome, el.firstChild);

  chrome.addEventListener('click', (e) => {
    const act = (e.target as Element).closest('button')?.getAttribute('data-act');
    if (act === 'copy') copyText(code.textContent || '', status);
    if (act === 'wrap' && wrapBtn) {
      const on = !hasParam(el, 'wrap');
      el.toggleAttribute('data-wrap', on);
      el.removeAttribute('wrap');
      wrapBtn.setAttribute('aria-pressed', String(on));
    }
  });

  if (pre.scrollWidth > pre.clientWidth) {
    pre.setAttribute('tabindex', '0');
    pre.setAttribute('aria-label', filename || 'code');
  }
}
