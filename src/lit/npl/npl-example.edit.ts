/**
 * npl-example — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The placeholder element of the npl namespace: an optional `label`
 * attribute and unwrapped authored children (the generated
 * `.npl-example-label` is display chrome, order-enforced in `updated()`).
 * Nothing beyond the host-content slot and the insert template.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-example',
  title: 'Example',
  bucket: 'npl-a',
  summary: 'Placeholder block proving the npl-* component pattern end to end.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Body',
      multiline: true,
      placeholder: 'Authored children…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-example',
      label: 'Example',
      group: 'NPL',
      xml: '<npl-example label="${1:hello}">${2:Authored children}</npl-example>',
    },
  ],
});
