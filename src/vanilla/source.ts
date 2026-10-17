/**
 * fallback/source — snapshot every sem-source's authored markup.
 *
 * Runs FIRST in the handler list: the snapshot must see the subtree
 * before any handler adds chrome, wraps lines or sets `hidden`. The copy
 * is a DOM CLONE of the children placed in an inert
 * `template.sem-source-raw` child — never a string: nothing is serialised
 * and re-parsed, so there is no HTML sink and no `</script` escaping.
 * The reader reads the template's content; template content is not part
 * of the document tree, so extraction, CSS and the no-JS artifact never
 * see it. Idempotent. `snapshotSourceElement` is exported so the Lit
 * component (src/lit/sem-source.ts) can take its own snapshot the moment
 * it enhances — the same guarantee, per element, whatever order the one
 * bundle's scan and the component's upgrade run in.
 * Spec: spec/schema/sem-source.md.
 */

import { warn } from '../shared/audience.js';

const SOURCE = ':is(sem-source, .sem-source)';

/** Capture one element's children into its `template.sem-source-raw`. */
export function snapshotSourceElement(el: Element): void {
  if (el.querySelector(':scope > template.sem-source-raw')) return;
  // Nested wrappers are unsupported: the inner markup is part of the outer's.
  if (el.parentElement?.closest(SOURCE)) { warn('sem-source: nested wrapper ignored'); return; }
  const t = document.createElement('template');
  t.className = 'sem-source-raw';
  // Iterates the LIVE childNodes list: only clones are appended, so the
  // list never mutates mid-walk. Never switch this to moving the originals.
  el.childNodes.forEach((n) => t.content.appendChild(n.cloneNode(true)));
  el.insertBefore(t, el.firstChild);
}

export function enhanceSource(scope: ParentNode): void {
  scope.querySelectorAll(SOURCE).forEach(snapshotSourceElement);
}
