/**
 * sem-table — edit descriptor (pilot, schema lane).
 *
 * Thin Lit wrapper over src/reading/table.ts: rows live in the authored
 * <table> (the contract — sem-table has no JSON payload), so the item list
 * targets tbody rows and `rerender` re-runs the idempotent enhance after
 * the model replaces children (EDITOR.md §3.3 one-shot-wrapper seam).
 * `data-value` (the per-cell sort key) is the link-ish field.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { enhanceTableElement } from '../reading/table.js';

registerDescriptor({
  tag: 'sem-table',
  title: 'Table',
  bucket: 'data',
  summary: 'A data table a reader can sort and filter.',
  itemList: {
    childSelector: ':scope > table > tbody > tr',
    label: 'row',
    template: {
      id: 'sem-table-row',
      label: 'Row',
      xml: '<tr><th scope="row">${1:Label}</th><td>${2:Value}</td></tr>',
    },
  },
  linkFields: [{ attr: 'data-value', label: 'Sort key (data-value)' }],
  rerender(el) {
    enhanceTableElement(el);
  },
});
