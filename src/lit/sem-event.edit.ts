/**
 * sem-event — edit descriptor (sequence bucket, Phase 2).
 *
 * One dated assertion inside `sem-chronology`. Two slot forms: the
 * `<time datetime>` date label when present, and the host-is-slot form
 * (`:scope`, map.ts's unwrapped-content contract) for the event body.
 * A time-bearing event's body is MIXED content (`<time>` + text), so its
 * host slot refuses the inline edit per §4.5 — the body then edits through
 * the code view; the date label stays inline-editable either way.
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `sequence` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-event',
  title: 'Event',
  bucket: 'sequence',
  summary: 'One dated assertion on a chronology — at when (until until), this happened.',
  textSlots: [
    {
      selector: ':scope > time',
      label: 'Date label',
      placeholder: '2 Mar 2026',
      escape: 'entities',
    },
    {
      selector: ':scope',
      label: 'Description',
      multiline: true,
      placeholder: 'What happened',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-event',
      label: 'Event',
      group: 'Sequence',
      xml:
        '<sem-event when="${1:2026-01-01}" status="${2|done,current,todo,blocked|}">${3:What happened}</sem-event>',
    },
    {
      id: 'sem-event-period',
      label: 'Event (period)',
      group: 'Sequence',
      xml:
        '<sem-event when="${1:2026-06}" until="${2:2026-08}">\n' +
        '  <time datetime="${3:2026-06}">${4:Jun–Aug 2026}</time> ${5:What happened}\n' +
        '</sem-event>',
    },
  ],
});
