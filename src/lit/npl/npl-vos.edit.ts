/**
 * npl-vos — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * Parts are authored as direct children carrying `data-vos` (bare `vos`
 * also read; `data-` wins). The item list uses the element's own dual-form
 * selector. The element moves each part into a generated
 * `.npl-vos-row > .npl-vos-row-body` and reorders rows canonically once
 * upgraded, after which the `:scope >` selector no longer matches: `+`
 * then appends the new part at the end of the element's model children —
 * the correct position, re-bracketed by the next update — while `−` is a
 * no-op (no items resolved). The rows are generated runtime chrome the
 * mapping cannot see past; that fix is the cross-lane request in the lane
 * report. No text slots: part text would commit into a moved node, which
 * mapping cannot resolve yet.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-vos',
  title: 'Vector of self',
  bucket: 'npl-b',
  summary: 'The psychodynamic state bracket an NPL persona responds with.',
  itemList: {
    childSelector: ':scope > :is([data-vos], [vos])',
    label: 'vos part',
    template: {
      id: 'npl-vos-part',
      label: 'Vos part',
      xml: '<p data-vos="${1:id}">${2:Part text}</p>',
    },
  },
  templates: [
    {
      id: 'npl-vos',
      label: 'Vector of self',
      group: 'NPL',
      xml:
        '<npl-vos phase="${1:entry}">\n' +
        '  <p data-vos="id">${2:Raw impulse}</p>\n' +
        '  <p data-vos="ego">${3:Reality-tested approach}</p>\n' +
        '  <p data-vos="mood">${4:Mood}</p>\n' +
        '  <p data-vos="super-ego">${5:Internalized standard}</p>\n' +
        '</npl-vos>',
    },
  ],
});
