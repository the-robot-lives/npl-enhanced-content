/**
 * sem-property — edit descriptor (definitions bucket, Phase 2).
 *
 * One key/value assertion inside `sem-properties`: `key` is the term (an
 * attribute — property modal), the element's own unwrapped text is the
 * value (host-is-slot form, map.ts's unwrapped-content contract). The
 * `aria-label` mirror of the key is NOT auto-synced by edits — authoring
 * both is the spec's accessible form; a modal change to `key` alone leaves
 * `aria-label` as authored (cross-lane note in the lane report).
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `definitions` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-property',
  title: 'Property',
  bucket: 'data',
  summary: 'One key/value assertion — key is the term, the text is the value.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Value',
      multiline: true,
      placeholder: 'Value',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-property',
      label: 'Property',
      group: 'Definitions',
      xml: '<sem-property key="${1:Key}" role="definition" aria-label="${1:Key}">${2:Value}</sem-property>',
    },
  ],
});
