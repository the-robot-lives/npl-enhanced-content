/**
 * npl-flags — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The item list is the `npl-flag` children (element or `.npl-flag` class
 * form); the inserted flag rebuilds through the document factories with
 * fresh ids (adoption rule, EDITOR.md §2.3). Loose note text between the
 * flags is authored content but is deliberately NOT a text slot — the host
 * mixes element and text children, so the inline slot would refuse (slot
 * contains markup); notes edit through the code view.
 *
 * Chrome (the preset badge) is lit-rendered with order enforcement in
 * `updated()` — presence-guarded, no `rerender` seam needed.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const FLAG = ':scope > :is(npl-flag, .npl-flag)';

registerDescriptor({
  tag: 'npl-flags',
  title: 'Flags',
  bucket: 'npl-a',
  summary: 'Container of runtime flag rows with an optional preset badge and notes.',
  itemList: {
    childSelector: FLAG,
    label: 'flag',
    template: {
      id: 'npl-flag',
      label: 'Flag',
      group: 'NPL',
      xml: '<npl-flag name="${1:calm_factor}" value="${2:0.5}"></npl-flag>',
    },
  },
  templates: [
    {
      id: 'npl-flags',
      label: 'Flags',
      group: 'NPL',
      xml:
        '<npl-flags preset="${1|minimal,full,production,creative,tireless|}">\n' +
        '  <npl-flag name="${2:calm_factor}" value="${3:0.5}"></npl-flag>\n' +
        '  ${4:tuning notes}\n' +
        '</npl-flags>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Flags',
        fields: [
          {
            name: 'preset',
            label: 'Preset',
            type: 'select',
            options: ['minimal', 'full', 'production', 'creative', 'tireless'],
            placeholder: 'production',
          },
          { name: 'name', label: 'First flag name', type: 'text', required: true, placeholder: 'calm_factor' },
          { name: 'value', label: 'First flag value', type: 'text', placeholder: '0.5' },
        ],
        template: {
          id: 'npl-flags-wizard',
          label: 'Flags',
          group: 'NPL',
          xml:
            '<npl-flags preset="${1:production}">\n' +
            '  <npl-flag name="${2:calm_factor}" value="${3:0.5}"></npl-flag>\n' +
            '</npl-flags>',
        },
      },
    ],
  },
});
