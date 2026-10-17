/**
 * fallback/attrs — mirror canonical bare attributes to their `data-*` alias.
 *
 * The tag form spells parameters bare (`<sem-facts view-as="quiz">`); the
 * class-form alias and every runtime-mutable state the tiers write
 * (`data-view-as`, `data-active`) use the `data-*` spelling, and the
 * vocabulary's gated hide rules key on it. Copying each bare parameter to
 * its `data-*` twin once, before any other handler runs, lets the handlers
 * and the CSS read one spelling. An existing `data-*` value wins (the same
 * precedence as extraction, spec/extraction.md §3.6). Only `sem-*` custom
 * elements are touched; the copy runs after the `sem-source` snapshot so
 * the fence still shows the markup as authored.
 */

const MIRRORED = ['view-as', 'variant', 'name', 'active', 'summary', 'value', 'label', 'key'];
const SELECTOR = MIRRORED.map((a) => '[' + a + ']').join(',');

export function enhanceAttrs(scope: ParentNode): void {
  scope.querySelectorAll(SELECTOR).forEach((el) => {
    if (el.tagName.slice(0, 4) !== 'SEM-') return;
    for (const a of MIRRORED) {
      if (el.hasAttribute(a) && !el.hasAttribute('data-' + a)) {
        el.setAttribute('data-' + a, el.getAttribute(a) as string);
      }
    }
  });
}
