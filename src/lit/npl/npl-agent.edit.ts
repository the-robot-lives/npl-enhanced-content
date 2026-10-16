/**
 * npl-agent — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The agent card's authored content is the element's own unwrapped body —
 * the description and behavioural spec prose. The `.npl-agent-header` card
 * is generated display chrome (lit render, order-enforced in `updated()`);
 * it is never authored content and needs no descriptor entry.
 *
 * The three header fields (name/type/version) are required attributes; the
 * property modal edits them from the schema. The wizard makes a VALID first
 * insert a guided form (per brief §6: >2 required fields ⇒ wizard).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-agent',
  title: 'Agent',
  bucket: 'npl-a',
  summary: 'Agent definition card: the name/type/version header plus the behavioural spec.',
  textSlots: [
    {
      // the body is the element's own unwrapped content — the host is the
      // slot (controller resolves `:scope` to the binding root, map.ts)
      selector: ':scope',
      label: 'Behavioural spec',
      multiline: true,
      placeholder: 'What this agent does — and must not do…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-agent',
      label: 'Agent card',
      group: 'NPL',
      xml:
        '<npl-agent name="${1:scout}" type="${2:scout}" version="${3:0.3}" extends="${4:base-agent}">\n' +
        '${5:Agent description and behavioural spec}\n' +
        '</npl-agent>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Agent card',
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'scout' },
          { name: 'type', label: 'Type', type: 'text', required: true, placeholder: 'scout' },
          { name: 'version', label: 'Version', type: 'text', required: true, placeholder: '0.3' },
          {
            name: 'body',
            label: 'Behavioural spec',
            type: 'textarea',
            placeholder: 'What this agent does — and must not do…',
          },
        ],
        template: {
          id: 'npl-agent-wizard',
          label: 'Agent card',
          group: 'NPL',
          xml:
            '<npl-agent name="${1:scout}" type="${2:scout}" version="${3:0.3}">\n' +
            '${4:Agent description and behavioural spec}\n' +
            '</npl-agent>',
        },
      },
    ],
  },
});
