/**
 * npl-mode — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * `primary` is the bare-boolean authoring spelling (the property modal
 * renders it as a checkbox); the template carries the two-lens minimal
 * form. The `mode` children would be the natural item list, but the
 * element's `updated()` moves the generated `.npl-mode-chip`s to the front,
 * which shifts every authored child's index — mapping (and therefore the
 * +/− verbs) would resolve the wrong node. Withheld until the controller
 * skips generated chrome in authored counting (cross-lane request in the
 * lane report); then `itemList` is `{ childSelector: ':scope > mode', … }`.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-mode',
  title: 'Mode',
  bucket: 'npl-b',
  summary: 'A cognitive-lens declaration rendered as chips.',
  templates: [
    {
      id: 'npl-mode',
      label: 'Mode declaration',
      group: 'NPL',
      xml:
        '<npl-mode>\n' +
        '  <mode type="${1:planner}"></mode>\n' +
        '  <mode type="${2:executing}"></mode>\n' +
        '</npl-mode>',
    },
    {
      id: 'npl-mode-primary',
      label: 'Primary mode declaration',
      group: 'NPL',
      xml:
        '<npl-mode primary>\n' +
        '  <mode type="${1:planner}"></mode>\n' +
        '  <mode type="${2:executing}"></mode>\n' +
        '</npl-mode>',
    },
  ],
});
