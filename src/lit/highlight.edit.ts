/**
 * highlight — edit descriptor (disclosure bucket, Phase 2).
 *
 * Inline occludable prose (`<highlight>` — bare tag, no sem- prefix; the
 * quiz view of the enclosing `sem-details` occludes it). Single-line
 * inline slot: the element IS the text, so the host-is-slot form applies.
 * No wizard (one field); the reading pass owns the occlusion chrome.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'highlight',
  title: 'Highlight',
  bucket: 'disclosure',
  summary: 'Inline occludable prose — a recall target in a sem-details quiz view.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Highlight text',
      multiline: false,
      placeholder: 'Recall target…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'highlight',
      label: 'Highlight',
      group: 'Disclosure',
      xml: '<highlight>${1:Recall target}</highlight>',
    },
  ],
});
