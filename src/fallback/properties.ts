/**
 * fallback/properties — duplicate property-key diagnostic.
 *
 * Non-fatal by design: a duplicate key is an authoring mistake, not a reason
 * to hide content, so this warns and renders everything. Both attribute
 * spellings are checked — `data-key` and the bare `key` alias the reading
 * bundle and the conventions examples use — and a property carrying either
 * (or both, same value) counts once per key value. The message text is
 * asserted by test/e2e/sem-properties.cy.js.
 */

import { sel } from '../shared/sel.js';

export function enhanceProperties(scope: ParentNode): void {
  scope.querySelectorAll(sel('properties')).forEach((root) => {
    const seen: Record<string, boolean> = {};
    root.querySelectorAll(sel('property')).forEach((p) => {
      const k = p.getAttribute('data-key') ?? p.getAttribute('key');
      if (k === null) return;
      if (seen[k]) console.warn('sem-properties: duplicate key "' + k + '"');
      seen[k] = true;
    });
  });
}
