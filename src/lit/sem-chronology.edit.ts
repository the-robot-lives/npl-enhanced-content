/**
 * sem-chronology — edit descriptor (sequence bucket, Phase 2).
 *
 * Container of `sem-event` items; the +/− glyphs add events with the
 * recommended `when` spelling. The per-event date label and body slots
 * live on the sem-event descriptor. No `rerender`: the element is CSS-only
 * (pure timeline rail), so the authored children ARE the render.
 *
 * Bucket note: the reference bucket is `sequence`
 * (web/data/reference-buckets.ts); the schema service's EditBucket union
 * does not carry it yet, so this descriptor bridges to `data` until the
 * union grows (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const EVENT = ':scope > ' + sel('event');

registerDescriptor({
  tag: 'sem-chronology',
  title: 'Chronology',
  bucket: 'sequence',
  summary: 'An ordered sequence of dated events — a timeline.',
  itemList: {
    childSelector: EVENT,
    label: 'event',
    template: {
      id: 'sem-event',
      label: 'Event',
      xml: '<sem-event when="${1:2026-01-01}">${2:What happened}</sem-event>',
    },
  },
  templates: [
    {
      id: 'sem-chronology',
      label: 'Chronology',
      group: 'Sequence',
      xml:
        '<sem-chronology kind="${1:release-history}" view-as="${2|timeline,list|}">\n' +
        '  <sem-event when="${3:2026-01-01}" status="${4|done,current,todo,blocked|}">${5:What happened}</sem-event>\n' +
        '  <sem-event when="${6:2026-06-01}">${7:What happened next}</sem-event>\n' +
        '</sem-chronology>',
    },
    {
      id: 'sem-chronology-list',
      label: 'Chronology (list view)',
      group: 'Sequence',
      xml:
        '<sem-chronology view-as="list">\n' +
        '  <sem-event when="${1:2026-01-01}">${2:What happened}</sem-event>\n' +
        '</sem-chronology>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Chronology',
        fields: [
          { name: 'kind', label: 'Kind', type: 'text', placeholder: 'release-history' },
          { name: 'viewAs', label: 'View', type: 'select', options: ['timeline', 'list'] },
          { name: 'when', label: 'First event date', type: 'text', required: true, placeholder: '2026-01-01' },
          { name: 'text', label: 'First event description', type: 'textarea', required: true, placeholder: 'What happened' },
        ],
        template: {
          id: 'sem-chronology-wizard',
          label: 'Chronology',
          xml:
            '<sem-chronology kind="${1:release-history}" view-as="${2|timeline,list|}">\n' +
            '  <sem-event when="${3:2026-01-01}">${4:What happened}</sem-event>\n' +
            '</sem-chronology>',
        },
      },
    ],
  },
  containerOf: 'sem-event',
});
