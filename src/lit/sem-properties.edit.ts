/**
 * sem-properties — edit descriptor (definitions bucket, Phase 2).
 *
 * Container of `sem-property` pairs; the item template mirrors the spec's
 * accessible authoring form (`role="definition"` + `aria-label` = key) via
 * a repeated `${1}` stop, so a +/− insert announces the pair without
 * hand-typing the key twice. `rerender` re-runs the glossary enhance —
 * its `#wired` one-shot upgrade would otherwise never re-wire citing
 * anchors after the model replaces children (EDITOR.md §3.3 seam).
 *
 * Bucket note: the reference bucket is `definitions`
 * (web/data/reference-buckets.ts); the schema service's EditBucket union
 * does not carry it yet, so this descriptor bridges to `data` until the
 * union grows (desc-seqdef lane report, cross-lane request 1).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { enhanceGlossaryElement } from '../reading/glossary.js';
import { sel } from '../shared/sel.js';

const PROPERTY = ':scope > ' + sel('property');

registerDescriptor({
  tag: 'sem-properties',
  title: 'Properties',
  bucket: 'data',
  summary: 'A closed set of key/value assertions — a definition grid.',
  itemList: {
    childSelector: PROPERTY,
    label: 'property',
    template: {
      id: 'sem-property',
      label: 'Property',
      xml: '<sem-property key="${1:Key}" role="definition" aria-label="${1:Key}">${2:Value}</sem-property>',
    },
  },
  templates: [
    {
      id: 'sem-properties',
      label: 'Properties',
      group: 'Definitions',
      xml:
        '<sem-properties kind="${1:config}">\n' +
        '  <sem-property key="${2:Key}" role="definition" aria-label="${2:Key}">${3:Value}</sem-property>\n' +
        '</sem-properties>',
    },
    {
      id: 'sem-properties-glossary',
      label: 'Glossary',
      group: 'Definitions',
      xml:
        '<sem-properties view-as="glossary">\n' +
        '  <sem-property id="${1:g-term}" key="${2:Term}" role="definition" aria-label="${2:Term}">${3:Definition}</sem-property>\n' +
        '</sem-properties>',
    },
  ],
  rerender(el) {
    enhanceGlossaryElement(el);
  },
  containerOf: 'sem-property',
});
