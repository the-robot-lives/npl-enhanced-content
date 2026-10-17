/**
 * sem-progress — edit descriptor (sequence bucket, Phase 2).
 *
 * Attribute-driven scalar meter (value 0..1, optional label) — no authored
 * children, so no text slots and no item list; `value`/`label` edit through
 * the property modal. No `rerender`: zero-JS element (JS-off reads the
 * value as text via CSS attr()).
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `sequence` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-progress',
  title: 'Progress',
  bucket: 'sequence',
  summary: 'A completion meter — one scalar completion assertion (value 0..1).',
  templates: [
    {
      id: 'sem-progress',
      label: 'Progress',
      group: 'Sequence',
      xml: '<sem-progress value="${1:0.5}" label="${2:progress}"></sem-progress>',
    },
  ],
});
