/**
 * npl-cot — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * Children contract (spec/schema/npl/cot.md): reasoning steps —
 * conventionally `sem-step` — plus at most one outcome element marked
 * `outcome` / `data-outcome`. Steps are the item list (+/− glyphs); each
 * step's text and the outcome's body are the text slots.
 *
 * No `rerender` yet: the element moves authored children into its generated
 * `<details>` hosts under a one-shot `#wired` guard with no exported
 * idempotent seam. Cross-lane request filed for an exported
 * `enhanceCotElement(el)`; until then `requestUpdate()` re-renders the
 * hosts and the authored form stays intact (model is truth).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const STEP = ':scope > :is(sem-step, .sem-step)';
const OUTCOME = ':scope > :is([outcome], [data-outcome])';

registerDescriptor({
  tag: 'npl-cot',
  title: 'Chain of thought',
  bucket: 'npl-a',
  summary: 'Chain-of-thought steps plus the outcome, folded in a native details block.',
  textSlots: [
    { selector: STEP, label: 'Step', placeholder: 'Reasoning step…', escape: 'entities' },
    {
      selector: OUTCOME,
      label: 'Outcome',
      multiline: true,
      placeholder: 'What the reasoning concluded…',
      escape: 'entities',
    },
  ],
  itemList: {
    childSelector: STEP,
    label: 'step',
    template: {
      id: 'npl-cot-step',
      label: 'Step',
      group: 'NPL',
      xml: '<sem-step>${1:Reasoning step}</sem-step>',
    },
  },
  templates: [
    {
      id: 'npl-cot',
      label: 'Chain of thought',
      group: 'NPL',
      xml:
        '<npl-cot>\n' +
        '  <sem-step>${1:First step}</sem-step>\n' +
        '  <sem-step>${2:Second step}</sem-step>\n' +
        '  <div outcome>${3:Outcome}</div>\n' +
        '</npl-cot>',
    },
    {
      id: 'npl-cot-collapsed',
      label: 'Collapsed chain of thought',
      group: 'NPL',
      xml:
        '<npl-cot collapsed>\n' +
        '  <sem-step>${1:First step}</sem-step>\n' +
        '  <div outcome>${2:Outcome}</div>\n' +
        '</npl-cot>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Chain of thought',
        fields: [
          { name: 'step1', label: 'First step', type: 'text', required: true, placeholder: 'What to check first…' },
          { name: 'step2', label: 'Second step', type: 'text', placeholder: 'What to compare next…' },
          {
            name: 'outcome',
            label: 'Outcome',
            type: 'textarea',
            required: true,
            placeholder: 'What the reasoning concluded…',
          },
        ],
        template: {
          id: 'npl-cot-wizard',
          label: 'Chain of thought',
          group: 'NPL',
          xml:
            '<npl-cot>\n' +
            '  <sem-step>${1:First step}</sem-step>\n' +
            '  <sem-step>${2:Second step}</sem-step>\n' +
            '  <div outcome>${3:Outcome}</div>\n' +
            '</npl-cot>',
        },
      },
    ],
  },
});
