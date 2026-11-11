/**
 * reading/references — citation previews, backlinks, external links.
 *
 * Spec: spec/schema/sem-references.md. Numbering is CSS; this module only
 * wires the citing anchors (plain `<a href="#id">` outside the container)
 * to a preview popover and appends per-reference backlinks. Idempotent
 * per anchor (`.sem-references-ref` is the "already wired" mark) and per
 * reference (chrome children are looked up before being created), so the
 * bundle scan and the Lit wrapper may both run. The tier marker is set by
 * the caller, never here.
 */

import { param } from '../shared/attr.js';
import { attachPreview, cloneContent } from '../shared/popover.js';
import { ensureReferenceId } from '../shared/reference-id.js';

export const REFERENCES = ':is(sem-references, .sem-references)';
const REFERENCE = ':is(sem-reference, .sem-reference)';
const CHROME = '.sem-references-backlinks, .sem-references-link';

/** Anchors citing `id`, excluding the references block and any preview. */
export function citers(id: string, exclude: Element): HTMLAnchorElement[] {
  const sel = 'a[href="#' + id.replace(/["\\]/g, '\\$&') + '"]';
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(sel)).filter(
    (a) => !exclude.contains(a) && !a.closest('.sem-popover'),
  );
}

export function enhanceReferencesElement(root: Element): void {
  root.querySelectorAll(':scope > ' + REFERENCE).forEach((ref) => {
    // id-less refs get the derived AUTO-ID (shared/reference-id.ts) first
    const id = ensureReferenceId(ref);
    if (!id) return;
    // cite is the locator (v0.6+); href its compat alias — link whichever is a URL
    const cite = param(ref, 'cite');
    const href = param(ref, 'href') || (cite && /^https?:\/\//i.test(cite) ? cite : null);
    if (href && !ref.querySelector(':scope > .sem-references-link')) {
      const a = document.createElement('a');
      a.className = 'sem-references-link';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '↗';
      a.setAttribute('aria-label', 'Open ' + (param(ref, 'cite') || href));
      ref.appendChild(a);
    }
    const anchors = citers(id, root);
    if (!anchors.length) return;
    let back = ref.querySelector(':scope > .sem-references-backlinks');
    if (!back) {
      back = document.createElement('span');
      back.className = 'sem-references-backlinks';
      ref.appendChild(back);
    }
    anchors.forEach((a, i) => {
      if (a.classList.contains('sem-references-ref')) return;
      a.classList.add('sem-references-ref');
      if (!a.id) a.id = id + '-ref-' + (i + 1);
      attachPreview(a, () => cloneContent(ref, CHROME));
      const b = document.createElement('a');
      b.href = '#' + a.id;
      b.textContent = '↩';
      b.setAttribute('aria-label', 'Back to citation ' + (i + 1));
      back!.appendChild(b);
    });
  });
}
