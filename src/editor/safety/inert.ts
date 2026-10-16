/**
 * safety/inert — the only path from source to preview DOM (EDITOR.md §8).
 *
 * `renderAuthorInert(source)` parses markup in an inert `<template>`
 * (its contents never run scripts) and neutralises what a browser would
 * still execute once inserted:
 *   - every `<script>` becomes `<template data-sem-inert
 *     data-sem-script-type="…">` carrying the original body — code view and
 *     export serialize from the MODEL, never from this preview, so the swap
 *     is preview-only and byte-exact output is unaffected;
 *   - inline event-handler attributes (`on*`) and `srcdoc` are stripped
 *     from the PREVIEW only — the model keeps them (safety filters
 *     rendering and insertion, never the document, §8);
 *   - `iframe`/`embed`/`object` payloads (`src`, `data`) are dropped in the
 *     preview; authored inline `style` stays (CSS cannot script, and the
 *     preview must stay faithful to what the author wrote).
 */

export const INERT_ATTR = 'data-sem-inert';
export const SCRIPT_TYPE_ATTR = 'data-sem-script-type';

const STRIPPED_ATTRS = new Set(['srcdoc']);

function stripDangerousAttrs(el: Element): void {
  for (const name of el.getAttributeNames()) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || STRIPPED_ATTRS.has(lower)) el.removeAttribute(name);
  }
}

/** Every element under `frag`, not descending into inert holders (the
 *  neutralised script bodies stay verbatim). */
function elementsUnder(frag: DocumentFragment): Element[] {
  const out: Element[] = [];
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child instanceof Element && child.tagName !== 'TEMPLATE') {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(frag);
  return out;
}

function neutralise(frag: DocumentFragment): void {
  const doc = frag.ownerDocument ?? document;
  for (const script of Array.from(frag.querySelectorAll('script'))) {
    const holder = doc.createElement('template');
    holder.setAttribute(INERT_ATTR, '');
    const type = script.getAttribute('type');
    if (type) holder.setAttribute(SCRIPT_TYPE_ATTR, type);
    holder.content.appendChild(doc.createTextNode(script.textContent ?? ''));
    script.replaceWith(holder);
  }
  for (const el of Array.from(frag.querySelectorAll('iframe, embed, object'))) {
    el.removeAttribute('src');
    el.removeAttribute('data');
  }
  for (const el of elementsUnder(frag)) stripDangerousAttrs(el);
}

export function renderAuthorInert(source: string, doc: Document = document): DocumentFragment {
  const template = doc.createElement('template');
  template.innerHTML = source; // inert: contents are not rendered, not run
  const frag = doc.importNode(template.content, true);
  neutralise(frag);
  return frag;
}
