/**
 * sem-data-query — edit descriptor (data bucket, Phase 2).
 *
 * The element's whole content is ONE query in the read-only SQL subset —
 * the authored form is a single unwrapped text body, so the host itself is
 * the slot (the contract's `:scope` form, resolved by
 * controller/map.resolveSlotEl). No attributes beyond the global catalog,
 * no children, no item list, no wizard (one field inserts from the plain
 * template; the text edit covers everything else).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-data-query',
  title: 'Data query',
  bucket: 'data',
  summary: 'The visualizer’s default query in the read-only SQL subset.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Query',
      multiline: true,
      placeholder: 'SELECT name, value FROM bucket LIMIT 5',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-data-query',
      label: 'Data query',
      group: 'Data',
      xml: '<sem-data-query>${1:SELECT name, value FROM bucket LIMIT 5}</sem-data-query>',
    },
  ],
});
