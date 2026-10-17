/**
 * npl-intent — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * The overview and scope sections are the inline slots (their authored
 * text child is the model slot; the generated `.npl-intent-label` sits
 * INSIDE the section, so host-level authored indexes — the mapping
 * contract, EDITOR.md §3.3 — are unaffected). The assumption rows are
 * deliberately NOT an item list: `#buildGrid` copies row text into table
 * cells and `row.remove()`s the authored rows, so post-enhancement there
 * is nothing for glyphs to bind to and a `+` would misparent. Assumptions
 * are edited through the wizard/template and the code view until the
 * element grows a re-runnable, non-destructive grid (cross-lane request
 * in the lane report).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const SECTION = (name: string): string =>
  `:scope > :is(npl-intent-${name}, .npl-intent-${name})`;

registerDescriptor({
  tag: 'npl-intent',
  title: 'Intent',
  bucket: 'npl-b',
  summary: 'An NPL intent block: goal, scope, outcomes and an assumptions grid.',
  textSlots: [
    {
      selector: SECTION('overview'),
      label: 'Goal',
      placeholder: 'What the effort is trying to do…',
      escape: 'entities',
    },
    {
      selector: SECTION('scope'),
      label: 'Scope',
      placeholder: 'What is in and out of scope…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-intent',
      label: 'Intent',
      group: 'NPL',
      xml:
        '<npl-intent id="${1:intent-id}" kind="${2:initiative}">\n' +
        '  <npl-intent-overview>${3:Goal}</npl-intent-overview>\n' +
        '  <npl-intent-scope>${4:Scope}</npl-intent-scope>\n' +
        '  <npl-intent-outcomes>${5:Outcomes}</npl-intent-outcomes>\n' +
        '  <npl-intent-assumptions>\n' +
        '    <npl-intent-assumption confidence="high">${6:Assumption}</npl-intent-assumption>\n' +
        '  </npl-intent-assumptions>\n' +
        '</npl-intent>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Intent',
        fields: [
          { name: 'overview', label: 'Goal', type: 'textarea', required: true },
          { name: 'scope', label: 'Scope', type: 'textarea' },
          { name: 'outcomes', label: 'Outcomes', type: 'textarea' },
          { name: 'assumption', label: 'Assumption', type: 'text' },
          {
            name: 'confidence',
            label: 'Confidence',
            type: 'select',
            options: ['high', 'medium', 'low'],
          },
          { name: 'id', label: 'id', type: 'text', placeholder: 'intent-id' },
        ],
        template: {
          id: 'npl-intent-wizard',
          label: 'Intent',
          xml:
            '<npl-intent id="${6:id}">\n' +
            '  <npl-intent-overview>${1:overview}</npl-intent-overview>\n' +
            '  <npl-intent-scope>${2:scope}</npl-intent-scope>\n' +
            '  <npl-intent-outcomes>${3:outcomes}</npl-intent-outcomes>\n' +
            '  <npl-intent-assumptions>\n' +
            '    <npl-intent-assumption confidence="${5:confidence}">${4:assumption}</npl-intent-assumption>\n' +
            '  </npl-intent-assumptions>\n' +
            '</npl-intent>',
        },
      },
    ],
  },
});
