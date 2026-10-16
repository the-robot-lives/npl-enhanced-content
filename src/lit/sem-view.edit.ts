/**
 * sem-view — edit descriptor (disclosure bucket, Phase 2 lane; descriptor
 * bucket `views` per EDITOR.md §3.3).
 *
 * One perspective tab inside `sem-views`. Minimal valid form needs name +
 * id (both required by the schema) plus nested content — that is the
 * >2-fields-and-nested-children bar for a wizard, so insertion runs the
 * stepped form; simple views also edit their body inline via the
 * host-is-slot slot (rich bodies refuse per §4.5 and go through the code
 * view). `role="tabpanel"` in templates matches the canonical example;
 * the validator's unknown-attr warning for it is advisory by design.
 *
 * The wizard convention for the insert lane: field array order matches
 * template stop order, so field[i] fills stop ${i+1}.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-view',
  title: 'View',
  bucket: 'views',
  summary: 'One perspective tab inside sem-views.',
  textSlots: [
    {
      selector: ':scope',
      label: 'View content',
      multiline: true,
      placeholder: 'View content…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-view',
      label: 'View',
      group: 'Disclosure',
      xml: '<sem-view name="${1:View name}" id="${2:view-id}" role="tabpanel">${3:View content}</sem-view>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'View',
        fields: [
          { name: 'name', label: 'View name', type: 'text', required: true, placeholder: 'Helm' },
          { name: 'id', label: 'View id (deep link)', type: 'text', required: true, placeholder: 'helm' },
          { name: 'content', label: 'View content', type: 'textarea', required: true, placeholder: 'View content…' },
        ],
        template: {
          id: 'sem-view-wizard',
          label: 'View',
          xml: '<sem-view name="${1:View name}" id="${2:view-id}" role="tabpanel">${3:View content}</sem-view>',
        },
      },
    ],
  },
});
