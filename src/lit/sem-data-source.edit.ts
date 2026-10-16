/**
 * sem-data-source — edit descriptor (data bucket, Phase 2).
 *
 * The authored payload is the element's own text body (a Markdown table,
 * CSV, YAML, JSON or SQL text). The reading enhancer parks that text in a
 * `.sem-data-raw` box (byte-identical textContent) and renders a
 * `.sem-data-body` table beside it — so the descriptor declares BOTH slot
 * forms (the parked box first, the authored `:scope` body second — the
 * sem-note two-forms pattern) and `regions()` re-anchors the parked box and
 * everything inside it to the host's model id, the same bridge the sem-md
 * descriptor builds for its raw fence (EDITOR.md §3.3).
 *
 * `source` (the file/API form) is the one URL field and passes the §8 URL
 * rule through the link popover. The URL form is insertable via template;
 * the wizard authors the inline form (a conditionally-absent `source`
 * attribute is not expressible in v1 templates — an empty `source` beside a
 * payload would be the spec's authoring-error form), and the link field
 * adds the URL afterwards.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { bindingFor } from '../editor/controller/attach.js';
import type { RegionMap } from '../editor/schema/types.js';

/** Model id of every node inside the parked payload box (the host's own
 *  subtree — parkPayload keeps the text byte-identical). */
function parkedRegions(el: HTMLElement): RegionMap | null {
  const root = bindingFor(el)?.rootId;
  if (root === undefined) return null;
  return [{ selector: '.sem-data-raw, .sem-data-raw *', nodeId: root }];
}

registerDescriptor({
  tag: 'sem-data-source',
  title: 'Data source',
  bucket: 'data',
  summary: 'One named data bucket: an inline payload or a file/API source.',
  textSlots: [
    {
      // the enhanced form: the parked box holds the payload byte-identically
      selector: ':scope > .sem-data-raw',
      label: 'Payload',
      multiline: true,
      placeholder: '| Column | Column |…',
      escape: 'entities',
    },
    {
      // the authored form: the payload is the element's own unwrapped body
      selector: ':scope',
      label: 'Payload',
      multiline: true,
      placeholder: '| Column | Column |…',
      escape: 'entities',
    },
  ],
  regions: parkedRegions,
  linkFields: [{ attr: 'source', label: 'Source URL' }],
  templates: [
    {
      id: 'sem-data-source',
      label: 'Data source (inline table)',
      group: 'Data',
      xml:
        '<sem-data-source data-name="${1:Bucket name}" data-format="${2|table,csv,yaml,json,sql|}">\n' +
        '  ${3:| Column | Column |}\n' +
        '</sem-data-source>',
    },
    {
      id: 'sem-data-source-csv',
      label: 'Data source (CSV)',
      group: 'Data',
      xml:
        '<sem-data-source data-name="${1:Bucket name}" data-format="csv">\n' +
        '  ${2:col-one,col-two\n  1,2}\n' +
        '</sem-data-source>',
    },
    {
      id: 'sem-data-source-url',
      label: 'Data source (file/API)',
      group: 'Data',
      xml:
        '<sem-data-source data-name="${1:Bucket name}" source="${2:data/bucket.csv}">' +
        '</sem-data-source>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Data source',
        fields: [
          { name: 'data-name', label: 'Bucket name', type: 'text', placeholder: 'Token lifetimes' },
          {
            name: 'data-format',
            label: 'Payload format',
            type: 'select',
            options: ['table', 'csv', 'yaml', 'json', 'sql'],
          },
          { name: 'payload', label: 'Inline payload', type: 'textarea', required: true, placeholder: '| Column | Column |…' },
        ],
        template: {
          id: 'sem-data-source-wizard',
          label: 'Data source',
          xml:
            '<sem-data-source data-name="${1:data-name}" data-format="${2:data-format}">\n' +
            '  ${3:payload}\n' +
            '</sem-data-source>',
        },
      },
    ],
  },
});
