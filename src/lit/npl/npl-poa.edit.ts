/**
 * npl-poa — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * `reasoning` and `selected` are the inline slots (the generated
 * `.npl-poa-choice` lands AFTER `<selected>`, and the fence attrs ride the
 * `pre` — neither shifts authored indexes). `direction` is an enum in the
 * property modal; the mermaid fence is deliberately not a slot (its model
 * child is a code element — inline editing would refuse), it is a wizard
 * textarea instead: the block's minimal valid form needs direction + tree
 * + selection, which qualifies it for the stepped insert (EDITOR.md §5.5
 * names npl-poa a Phase-2 wizard candidate). One step whose template is
 * the complete element — robust under any step-combining rule the stepper
 * lands.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-poa',
  title: 'Plan of action',
  bucket: 'npl-b',
  summary: 'An NPL plan-of-action block: a decision tree with weighted reasoning.',
  textSlots: [
    {
      selector: ':scope > :is(reasoning, .npl-poa-reasoning)',
      label: 'Reasoning',
      multiline: true,
      placeholder: 'Why each path carries its weight…',
      escape: 'entities',
    },
    {
      selector: ':scope > :is(selected, .npl-poa-selected)',
      label: 'Selected',
      placeholder: 'The chosen path…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-poa',
      label: 'Plan of action',
      group: 'NPL',
      xml:
        '<npl-poa direction="${1:lr}">\n' +
        '  <pre><code class="language-mermaid">${2:graph LR\n  A{Decision} -->|"90%"| B[Path B]}</code></pre>\n' +
        '  <reasoning>${3:Reasoning}</reasoning>\n' +
        '  <selected>${4:Selected path}</selected>\n' +
        '</npl-poa>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Plan of action',
        fields: [
          {
            name: 'direction',
            label: 'Direction',
            type: 'select',
            required: true,
            options: ['lr', 'td'],
          },
          {
            name: 'mermaid',
            label: 'Decision tree (mermaid)',
            type: 'textarea',
            required: true,
            placeholder: 'graph LR\n  A{Decision} -->|"90%"| B[Path B]',
          },
          { name: 'reasoning', label: 'Reasoning', type: 'textarea' },
          { name: 'selected', label: 'Selected path', type: 'textarea', required: true },
        ],
        template: {
          id: 'npl-poa-wizard',
          label: 'Plan of action',
          xml:
            '<npl-poa direction="${1:direction}">\n' +
            '  <pre><code class="language-mermaid">${2:mermaid}</code></pre>\n' +
            '  <reasoning>${3:reasoning}</reasoning>\n' +
            '  <selected>${4:selected}</selected>\n' +
            '</npl-poa>',
        },
      },
    ],
  },
});
