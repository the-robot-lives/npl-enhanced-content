/**
 * sem-step — edit descriptor (sequence bucket, Phase 2).
 *
 * One instruction inside `sem-procedure`; the body is the element's own
 * unwrapped text (host-is-slot form, map.ts's unwrapped-content contract).
 * `status` is an enum the property modal edits; display-only sugar
 * (✅/→/❌) never enters the model.
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `sequence` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-step',
  title: 'Step',
  bucket: 'sequence',
  summary: 'One instruction in a procedure — status-annotated, positionally numbered.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Instruction',
      multiline: true,
      placeholder: 'Do the thing',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-step',
      label: 'Step',
      group: 'Sequence',
      xml: '<sem-step status="${1|done,current,todo,blocked|}">${2:Do the thing}</sem-step>',
    },
  ],
});
