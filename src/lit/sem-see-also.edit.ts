/**
 * sem-see-also — edit descriptor (definitions bucket).
 *
 * A related-reference affordance: reference kind + target name the thing
 * linked (property-modal fields, computed from the schema contract);
 * preview picks the hover content; insert-as picks link chrome or an
 * in-place embed. The element's text is the label (and the file-mode
 * preview body).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-see-also',
  title: 'See also',
  bucket: 'definitions',
  summary: 'A related section/component/file — hover preview, modal, View-all in a new tab.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Label',
      multiline: true,
      placeholder: 'Score-to-grade bands — the band table the total maps through.',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-see-also',
      label: 'See also',
      group: 'Definitions',
      xml:
        '<sem-see-also reference="${1|section,component,file|}" target="${2:#section-id}" preview="${3|tldr,file|}" insert-as="${4|link,inline|}">${5:Label text}</sem-see-also>',
    },
  ],
});
