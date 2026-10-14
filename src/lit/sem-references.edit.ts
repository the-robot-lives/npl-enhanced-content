/**
 * sem-references — edit descriptor (definitions bucket, Phase 2).
 *
 * Container of `sem-reference` entries. `rerender` re-runs the references
 * enhance: it appends per-entry link/backlink chrome INSIDE the entries,
 * which the §4.4 re-render removes as authored leftovers — the one-shot
 * `#wired` upgrade would never restore it (EDITOR.md §3.3 seam).
 *
 * Bucket note: the reference bucket is `definitions`
 * (web/data/reference-buckets.ts); the schema service's EditBucket union
 * does not carry it yet, so this descriptor bridges to `data` until the
 * union grows (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { enhanceReferencesElement } from '../reading/references.js';
import { sel } from '../shared/sel.js';

const REFERENCE = ':scope > ' + sel('reference');

registerDescriptor({
  tag: 'sem-references',
  title: 'References',
  bucket: 'data',
  summary: 'A numbered list of works or notes the prose cites.',
  itemList: {
    childSelector: REFERENCE,
    label: 'reference',
    template: {
      id: 'sem-reference',
      label: 'Reference',
      xml: '<sem-reference>${1:Reference text}</sem-reference>',
    },
  },
  templates: [
    {
      id: 'sem-references',
      label: 'References',
      group: 'Definitions',
      xml:
        '<sem-references id="${1:refs}" kind="${2|footnotes,bibliography|}">\n' +
        '  <sem-reference id="${3:r-1}">${4:Cited work, §section.}</sem-reference>\n' +
        '</sem-references>',
    },
  ],
  rerender(el) {
    enhanceReferencesElement(el);
  },
  containerOf: 'sem-reference',
});
