/**
 * npl-declaration — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The authored content is the element's own unwrapped body — the rules
 * statement. The `.npl-declaration-banner` header is generated display
 * chrome (lit render, hoisted in `updated()`); never authored content.
 * `version` is the only required attribute — one field + body, so the
 * plain templates carry the insert (no wizard, per brief §6).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-declaration',
  title: 'Declaration',
  bucket: 'npl-a',
  summary: 'Display-only banner for a rules document version/extension header.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Rules',
      multiline: true,
      placeholder: 'The declaration statement…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-declaration',
      label: 'Declaration',
      group: 'NPL',
      xml: '<npl-declaration version="${1:0.6}">${2:Rule statement}</npl-declaration>',
    },
    {
      id: 'npl-declaration-extension',
      label: 'Extension declaration',
      group: 'NPL',
      xml:
        '<npl-declaration version="${1:0.6}" type="extension" extend-target="${2:npl-core}">' +
        '${3:What the extension adds}</npl-declaration>',
    },
  ],
});
