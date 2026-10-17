/**
 * sem-details — edit descriptor (disclosure bucket, Phase 2).
 *
 * Container of `sem-detail` prose blocks whose `<highlight>` targets the
 * quiz view occludes. The item list drives the +/− glyphs on the detail
 * children; the per-detail body slot lives on the sem-detail descriptor.
 *
 * No `rerender`: the element's quiz occlusion REPLACES authored
 * `<highlight>` content in place (SemDetails.updated, `#wired` one-shot).
 * Re-running that inside edit-mode would fight the editor invariant that
 * authored content stays the element's own (EDITOR.md §4.2) and would
 * destroy the inline slot on every commit. Reading-mode occlusion belongs
 * to the reading pass; the editor canvas keeps the authored form — new
 * highlights added in quiz view simply stay visible until the page's
 * reading pass runs again (cross-lane note in the lane report).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const DETAIL = ':scope > ' + sel('detail');

registerDescriptor({
  tag: 'sem-details',
  title: 'Details',
  bucket: 'disclosure',
  summary: 'Prose with occludable highlights; quiz view occludes the highlights.',
  itemList: {
    childSelector: DETAIL,
    label: 'detail',
    template: {
      id: 'sem-detail',
      label: 'Detail',
      xml: '<sem-detail>\n  ${1:Detail prose}\n</sem-detail>',
    },
  },
  containerOf: 'sem-detail',
  templates: [
    {
      id: 'sem-details',
      label: 'Occluded details',
      group: 'Disclosure',
      xml:
        '<sem-details id="${1:details-id}">\n' +
        '  <sem-detail>\n' +
        '    ${2:Detail prose}\n' +
        '  </sem-detail>\n' +
        '</sem-details>',
    },
    {
      id: 'sem-details-quiz',
      label: 'Quiz details',
      group: 'Disclosure',
      xml:
        '<sem-details id="${1:details-id}" view-as="quiz">\n' +
        '  <sem-detail>\n' +
        '    The token travels in the <highlight>${2:recall target}</highlight> header.\n' +
        '  </sem-detail>\n' +
        '</sem-details>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Occluded details block',
        fields: [
          { name: 'id', label: 'Container id', type: 'text', placeholder: 'oidc-details' },
          { name: 'prose', label: 'First detail prose', type: 'textarea', required: true, placeholder: 'Detail prose…' },
        ],
        template: {
          id: 'sem-details-wizard',
          label: 'Details block',
          xml:
            '<sem-details id="${1:details-id}">\n' +
            '  <sem-detail>\n' +
            '    ${2:Detail prose}\n' +
            '  </sem-detail>\n' +
            '</sem-details>',
        },
      },
    ],
  },
});
