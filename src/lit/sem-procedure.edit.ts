/**
 * sem-procedure — edit descriptor (sequence bucket, Phase 2).
 *
 * Container of `sem-step` items; ordinals are positional (CSS counters),
 * so the +/− glyphs and moves are the ONLY renumbering path — exactly
 * right for the editor. The per-step instruction slot lives on the
 * sem-step descriptor. No `rerender`: zero-JS element, pure CSS render.
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `sequence` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const STEP = ':scope > ' + sel('step');

registerDescriptor({
  tag: 'sem-procedure',
  title: 'Procedure',
  bucket: 'data',
  summary: 'An ordered, status-annotated procedure — steps in execution order.',
  itemList: {
    childSelector: STEP,
    label: 'step',
    template: {
      id: 'sem-step',
      label: 'Step',
      xml: '<sem-step>${1:Do the thing}</sem-step>',
    },
  },
  templates: [
    {
      id: 'sem-procedure',
      label: 'Procedure',
      group: 'Sequence',
      xml:
        '<sem-procedure kind="${1:runbook}">\n' +
        '  <sem-step>${2:First step}</sem-step>\n' +
        '  <sem-step status="${3|done,current,todo,blocked|}">${4:Next step}</sem-step>\n' +
        '</sem-procedure>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Procedure',
        fields: [
          { name: 'kind', label: 'Kind', type: 'text', placeholder: 'runbook, recipe, migration…' },
          { name: 'first', label: 'First step', type: 'textarea', required: true, placeholder: 'Do the thing' },
        ],
        template: {
          id: 'sem-procedure-wizard',
          label: 'Procedure',
          xml:
            '<sem-procedure kind="${1:runbook}">\n' +
            '  <sem-step>${2:First step}</sem-step>\n' +
            '</sem-procedure>',
        },
      },
    ],
  },
  containerOf: 'sem-step',
});
