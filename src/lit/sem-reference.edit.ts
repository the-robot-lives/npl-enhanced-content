/**
 * sem-reference — edit descriptor (definitions bucket, Phase 2).
 *
 * One citable entry inside `sem-references`: the text is the element's own
 * unwrapped content (host-is-slot form, map.ts's unwrapped-content
 * contract); `href` is the URL-ish field the link popover edits (§8
 * safety). `cite` is a prose label, NOT a URL — it deliberately stays a
 * plain property-modal field so `isSafeUrl` never rejects "RFC 6749".
 *
 * Bucket note: bridges to `data` until the EditBucket union grows
 * `definitions` (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-reference',
  title: 'Reference',
  bucket: 'data',
  summary: 'One citable entry — id is the citation anchor, href/cite the target.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Text',
      multiline: true,
      placeholder: 'Cited work, §section.',
      escape: 'entities',
    },
  ],
  linkFields: [{ attr: 'href', label: 'Target URL (href)' }],
  templates: [
    {
      id: 'sem-reference',
      label: 'Reference',
      group: 'Definitions',
      xml:
        '<sem-reference id="${1:r-1}" href="${2:https://example.com/source}" cite="${3:Source, §section.}">${4:Description of the cited work.}</sem-reference>',
    },
    {
      id: 'sem-reference-note',
      label: 'Footnote (no target)',
      group: 'Definitions',
      xml: '<sem-reference id="${1:r-1}">${2:Footnote text.}</sem-reference>',
    },
  ],
});
