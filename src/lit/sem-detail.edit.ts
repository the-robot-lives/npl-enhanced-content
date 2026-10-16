/**
 * sem-detail — edit descriptor (disclosure bucket, Phase 2).
 *
 * One occludable prose block inside `sem-details`. The body is the
 * element's own unwrapped content: the host-is-slot form (`:scope`, the
 * controller's unwrapped-content contract, map.ts resolveSlotEl). Rich
 * bodies (inline markup) refuse the inline slot per §4.5 and go through
 * the code view; plain prose edits inline.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-detail',
  title: 'Detail',
  bucket: 'disclosure',
  summary: 'One occludable prose block inside sem-details.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Detail prose',
      multiline: true,
      placeholder: 'Detail prose…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-detail',
      label: 'Detail',
      group: 'Disclosure',
      xml: '<sem-detail>\n  ${1:Detail prose}\n</sem-detail>',
    },
  ],
});
