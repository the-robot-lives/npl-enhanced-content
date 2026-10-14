/**
 * reading/source — sem-source: flip a section between its rendered form
 * and the literal authored markup.
 *
 * Spec: spec/schema/sem-source.md. The markup comes from the snapshot the
 * fallback CORE takes before any handler runs (`src/fallback/source.ts`,
 * a DOM clone of the children inside a `template.sem-source-raw`); this
 * module only builds the chrome and, on first request, a fence holding one
 * class-form `sem-code` enhanced by the same `enhanceCodeElement` as any
 * listing.
 * Idempotent on the chrome's presence, so bundle scan and Lit wrapper may
 * both run. Mode is `data-view-as` on the element (presentation, never
 * extracted); nothing is persisted.
 */

import { param } from '../shared/attr.js';
import { warn } from '../shared/audience.js';
import { enhanceCodeElement } from './code.js';

export const SOURCE = ':is(sem-source, .sem-source)';

/**
 * Snapshot nodes → fence text.
 *
 * 1. Work on a CLONE of the snapshot's nodes inside a fresh, inert
 *    `<template>`: no string is ever parsed as HTML, so there is no sink;
 *    serialisation (`template.innerHTML` read) is the only text step.
 * 2. Drop the parse-time tier markers by removing the ATTRIBUTES — never
 *    a string replace, so prose or a listing that happens to contain the
 *    marker text is untouched.
 * 3. Remove the common leading indentation of the section, computed and
 *    applied only OUTSIDE preformatted elements (`<pre>`, `<textarea>`),
 *    whose line content is verbatim. The elements are located in the
 *    clone and swapped for a one-line sentinel before the dedent. The
 *    sentinel is a control character chosen to be absent from the
 *    serialised text, so authored content can never collide with it.
 */
function clean(nodes: DocumentFragment): string {
  const tpl = document.createElement('template');
  tpl.content.appendChild(nodes.cloneNode(true));
  const root = tpl.content;
  root.querySelectorAll('[data-sem-upgraded]').forEach((e) => {
    e.removeAttribute('data-sem-upgraded');
  });
  const keep: string[] = [];
  // Sentinel: a C0 control (U+0001–U+001F) absent from the text; bounded
  // so the search never wanders into printable or surrogate ranges. If all
  // 31 occur (pathological), fall back to a run of U+0001 longer than any
  // present, which is absent by construction.
  const html = tpl.innerHTML;
  let mark = '';
  for (let c = 1; c < 0x20 && !mark; c++) if (html.indexOf(String.fromCharCode(c)) < 0) mark = String.fromCharCode(c);
  if (!mark) { mark = '\u0001'; while (html.indexOf(mark) >= 0) mark += '\u0001'; }
  root.querySelectorAll('pre, textarea').forEach((e) => {
    if (e.parentElement?.closest('pre, textarea')) return; // inner: kept whole with its outer
    e.replaceWith(document.createTextNode(mark + (keep.push(e.outerHTML) - 1) + mark));
  });
  const lines = tpl.innerHTML.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let indent = Infinity;
  lines.forEach((l) => {
    // A line holding only a sentinel is the placeholder for verbatim
    // preformatted content: pre lines are authored flush-left, so the
    // placeholder sits at column 0 and must not drive the common indent.
    // The sentinel payload is the keep-index digits only.
    const bare = l.trim();
    if (bare.length > 2 * mark.length && bare.startsWith(mark) && bare.endsWith(mark)
      && /^\d+$/.test(bare.slice(mark.length, -mark.length))) return;
    if (l.trim()) indent = Math.min(indent, l.match(/^[ \t]*/)![0].length);
  });
  return lines.map((l) => l.slice(indent < Infinity ? indent : 0)).join('\n')
    .split(mark).map((s, i) => (i % 2 ? keep[+s] : s)).join('');
}

export function enhanceSourceElement(el: Element): void {
  if (el.querySelector(':scope > .sem-source-chrome')) return;
  if (el.parentElement?.closest(SOURCE)) return; // nested: the outer wrapper owns it (core warned)
  const snap = el.querySelector<HTMLTemplateElement>(':scope > template.sem-source-raw');
  // No core snapshot (reading bundle alone): best effort, chrome and all —
  // clone the live children now (a DOM clone, still never parsed text).
  if (!snap) warn('sem-source: no snapshot (load semtext-fallback.js before the reading bundle); showing the live DOM');
  let raw: DocumentFragment;
  if (snap) {
    raw = snap.content;
  } else {
    raw = document.createDocumentFragment();
    el.childNodes.forEach((n) => raw.appendChild(n.cloneNode(true)));
  }

  const chrome = document.createElement('div');
  chrome.className = 'sem-source-chrome';
  chrome.setAttribute('role', 'group');
  chrome.setAttribute('aria-label', 'View as');
  const label = param(el, 'label');
  if (label) {
    const s = document.createElement('span');
    s.className = 'sem-source-label';
    s.textContent = label;
    chrome.appendChild(s);
  }
  const button = (act: string, text: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-act', act);
    b.textContent = text;
    chrome.appendChild(b);
    return b;
  };
  const html = button('html', 'Rendered');
  const src = button('source', 'Source');
  el.insertBefore(chrome, el.firstChild);

  let fence: HTMLElement | null = null;
  const build = (): void => {
    if (fence) return;
    fence = document.createElement('div');
    fence.className = 'sem-source-fence';
    const code = document.createElement('div');
    code.className = 'sem-code';
    code.setAttribute('data-lang', 'html');
    code.setAttribute('data-controls', 'copy,wrap');
    const pre = document.createElement('pre');
    const c = document.createElement('code');
    c.textContent = clean(raw); // text, never markup
    pre.appendChild(c);
    code.appendChild(pre);
    fence.appendChild(code);
    el.appendChild(fence);
    enhanceCodeElement(code);
    code.setAttribute('data-sem-upgraded', '');
  };
  const mode = (m: string): void => {
    if (m == 'source') build();
    el.setAttribute('data-view-as', m);
    html.setAttribute('aria-pressed', String(m != 'source'));
    src.setAttribute('aria-pressed', String(m == 'source'));
  };
  mode(param(el, 'view-as') == 'source' ? 'source' : 'html');
  chrome.addEventListener('click', (e) => {
    const act = (e.target as Element).closest('button')?.getAttribute('data-act');
    if (act) mode(act);
  });
}
