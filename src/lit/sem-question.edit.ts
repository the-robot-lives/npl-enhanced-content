/**
 * sem-question — edit descriptor (recall bucket, Phase 2).
 *
 * Tier-1 quiz element (spec/conventions.md: "quiz question types — Tier 1
 * flagship buildout"). SPEC'd but not yet in `elements.json` and with no
 * Lit element class — a hand-authored, out-of-schema descriptor (the
 * sem-chat precedent, schema lane). Registered descriptors are reachable
 * through `registry.handDescriptors()` for the inserter; `getDescriptor`
 * resolves it once the schema grows the tag. Until the Tier-1 element
 * lands, inserted markup renders plainly (unknown-element degradation).
 *
 * The prompt slot targets the spec form `<p data-kind="prompt">`; options
 * are the item list (`sem-option`, `correct` marks the right one). One
 * wizard step whose numbered stops follow the field order — field→stop
 * binding mechanics are the insert lane's stepper (open question in the
 * lane report).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { part } from '../shared/sel.js';

const TYPES = ['mc', 'multi', 'blank', 'match', 'order', 'tf', 'short'];

registerDescriptor({
  tag: 'sem-question',
  title: 'Quiz question',
  bucket: 'data', // recall family — EditBucket lacks 'recall' yet (see report)
  summary: 'A quiz question with candidate options (Tier 1).',
  textSlots: [
    {
      selector: ':scope > [data-kind="prompt"]',
      label: 'Prompt',
      placeholder: 'Which header carries the OIDC token?',
      escape: 'entities',
    },
  ],
  itemList: {
    childSelector: ':scope > ' + part('option'),
    label: 'option',
    template: {
      id: 'sem-option',
      label: 'Option',
      xml: '<sem-option>${1:Option}</sem-option>',
    },
  },
  wizard: {
    steps: [
      {
        title: 'Quiz question',
        fields: [
          {
            name: 'type',
            label: 'Type',
            type: 'select',
            options: TYPES,
            required: true,
          },
          {
            name: 'prompt',
            label: 'Prompt',
            type: 'text',
            required: true,
            placeholder: 'Which header carries the OIDC token?',
          },
          {
            name: 'correct',
            label: 'Correct option',
            type: 'text',
            required: true,
          },
          {
            name: 'distractor',
            label: 'Distractor option',
            type: 'text',
          },
        ],
        template: {
          id: 'sem-question-wizard',
          label: 'Quiz question',
          xml:
            '<sem-question type="${1|' + TYPES.join(',') + '|}">\n' +
            '  <p data-kind="prompt">${2:Prompt}</p>\n' +
            '  <sem-option correct>${3:Correct option}</sem-option>\n' +
            '  <sem-option>${4:Distractor option}</sem-option>\n' +
            '</sem-question>',
        },
      },
    ],
  },
  templates: [
    {
      id: 'sem-question',
      label: 'Quiz question',
      group: 'Recall',
      xml:
        '<sem-question type="${1|' + TYPES.join(',') + '|}">\n' +
        '  <p data-kind="prompt">${2:Prompt}</p>\n' +
        '  <sem-option correct>${3:Correct answer}</sem-option>\n' +
        '  <sem-option>${4:Distractor}</sem-option>\n' +
        '</sem-question>',
    },
  ],
});
