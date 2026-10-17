/**
 * sem-data-visualizer — edit descriptor (data bucket, Phase 2).
 *
 * Container of `sem-data-source` buckets (plus optional `sem-data-join` /
 * `sem-data-query` declaration children). The +/− item list covers the
 * SOURCE children — the repeatable bucket every query addresses; joins and
 * queries are not list items (one list, one template — a mixed-type list
 * would stamp a source for every +) and insert through templates instead.
 *
 * No `rerender`: the reading enhancer (src/reading/data.ts) parks each
 * payload in a `.sem-data-raw` box and renders a `.sem-data-body` table.
 * Inside the editor canvas that fights the authored-form invariant (§4.2)
 * the way sem-details' quiz occlusion does: the §4.4 re-render re-projects
 * the AUTHORED form, the rendered copies are gone, and the visualizer's
 * `#wired` one-shot never re-runs. The canvas keeps the zero-JS authored
 * form (payloads read as pre-wrapped text); the per-source payload slot and
 * the parked-box regions bridge live on the sem-data-source descriptor.
 *
 * Bucket note: `data` is a first-class EditBucket, so no bridging is needed
 * here (unlike the sequence/definitions lanes).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

// Modal-side matching (shell/selector.ts) supports `:scope > tag`, `:scope >
// .class` and comma alternatives — NOT `:is()` — so the item list uses the
// contract's comma form and resolves the same children model-side that the
// DOM-side `+`/`−` glyphs do.
const SOURCE = ':scope > sem-data-source, :scope > .sem-data-source';

registerDescriptor({
  tag: 'sem-data-visualizer',
  title: 'Data visualizer',
  bucket: 'data',
  summary: 'A container of named data buckets the reader can query, join and view.',
  itemList: {
    childSelector: SOURCE,
    label: 'data source',
    template: {
      id: 'sem-data-source',
      label: 'Data source',
      // The +/− glyphs insert READY items (stripTemplateStops): plain stops
      // only — the choice stop here would strip to the literal alternative
      // list, so the format is hardcoded to the table default.
      xml:
        '<sem-data-source data-name="${1:Bucket name}" data-format="table">\n' +
        '  ${2:| Column | Column |}\n' +
        '</sem-data-source>',
    },
  },
  containerOf: 'sem-data-source',
  templates: [
    {
      id: 'sem-data-visualizer',
      label: 'Data visualizer',
      group: 'Data',
      xml:
        '<sem-data-visualizer id="${1:dv-id}">\n' +
        '  <sem-data-source data-name="${2:Bucket name}" data-format="${3|table,csv,yaml,json,sql|}">\n' +
        '    ${4:| Column | Column |}\n' +
        '  </sem-data-source>\n' +
        '</sem-data-visualizer>',
    },
    {
      id: 'sem-data-visualizer-full',
      label: 'Visualizer with join + query',
      group: 'Data',
      xml:
        '<sem-data-visualizer id="${1:dv-id}">\n' +
        '  <sem-data-source data-name="${2:Bucket name}" data-format="${3|table,csv,yaml,json,sql|}">\n' +
        '    ${4:| Column | Column |}\n' +
        '  </sem-data-source>\n' +
        '  <sem-data-join data-name="${5:data-name}" data-left="${6:data-left}" data-right="${7:data-right}"' +
        ' data-on="${8:data-on}">\n' +
        '  </sem-data-join>\n' +
        '  <sem-data-query>SELECT name, value FROM ${9:bucket} LIMIT ${10:5}</sem-data-query>\n' +
        '</sem-data-visualizer>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Data visualizer',
        fields: [
          { name: 'dv-id', label: 'Visualizer id', type: 'text', required: true, placeholder: 'dv-tokens' },
          { name: 'data-name', label: 'First bucket name', type: 'text', required: true, placeholder: 'Token lifetimes' },
          {
            name: 'data-format',
            label: 'Payload format',
            type: 'select',
            options: ['table', 'csv', 'yaml', 'json', 'sql'],
          },
          { name: 'payload', label: 'Inline payload', type: 'textarea', required: true, placeholder: '| Column | Column |…' },
        ],
        template: {
          id: 'sem-data-visualizer-wizard',
          label: 'Data visualizer',
          xml:
            '<sem-data-visualizer id="${1:dv-id}">\n' +
            '  <sem-data-source data-name="${2:data-name}" data-format="${3:data-format}">\n' +
            '    ${4:payload}\n' +
            '  </sem-data-source>\n' +
            '</sem-data-visualizer>',
        },
      },
    ],
  },
});
