/**
 * sem-views — edit descriptor (disclosure bucket, phase 2 lane; descriptor
 * bucket `views` per EDITOR.md §3.3 — the tabs half of "Disclosure & views").
 *
 * Tab-family container of `sem-view` panels. The item list drives +/− on
 * the view children; views keep their authored identity (`name` label,
 * `id` for `#<container>/<view>` deep links), so the insert template
 * carries both. Per-view attributes (name required, active, id required)
 * are declared in elements.json on this CONTAINER entry — a data quirk
 * noted in the lane report; the per-view wizard still collects them.
 *
 * No `rerender`: the tab bar is built by the page's reading pass
 * (fallback/views enhanceViews) and never exists in the editor canvas
 * (authored form canonical — see sem-reveal.edit.ts).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const VIEW = ':scope > ' + sel('view');

registerDescriptor({
  tag: 'sem-views',
  title: 'Views',
  bucket: 'views',
  summary: 'The same content under perspective tabs.',
  itemList: {
    childSelector: VIEW,
    label: 'view',
    template: {
      id: 'sem-view',
      label: 'View',
      xml:
        '<sem-view name="${1:View name}" id="${2:view-id}" role="tabpanel">${3:View content}</sem-view>',
    },
  },
  containerOf: 'sem-view',
  templates: [
    {
      id: 'sem-views',
      label: 'Tab views',
      group: 'Disclosure',
      xml:
        '<sem-views id="${1:views-id}">\n' +
        '  <sem-view name="${2:First view}" id="${3:first-view}" role="tabpanel">${4:Content}</sem-view>\n' +
        '  <sem-view name="${5:Second view}" id="${6:second-view}" role="tabpanel">${7:Content}</sem-view>\n' +
        '</sem-views>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Tab views block',
        fields: [
          { name: 'id', label: 'Container id', type: 'text', required: true, placeholder: 'deploy' },
          { name: 'name', label: 'First view name', type: 'text', required: true, placeholder: 'Helm' },
          { name: 'viewId', label: 'First view id', type: 'text', required: true, placeholder: 'helm' },
          { name: 'content', label: 'First view content', type: 'textarea', required: true, placeholder: 'View content…' },
        ],
        template: {
          id: 'sem-views-wizard',
          label: 'Tab views block',
          xml:
            '<sem-views id="${1:views-id}">\n' +
            '  <sem-view name="${2:First view}" id="${3:first-view}" role="tabpanel">${4:Content}</sem-view>\n' +
            '</sem-views>',
        },
      },
    ],
  },
});
