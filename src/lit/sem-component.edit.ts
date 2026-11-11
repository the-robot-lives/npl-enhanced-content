/**
 * sem-component — edit descriptor (definitions bucket).
 *
 * A component-inventory card: the manifest vocabulary as attributes
 * (tag/name/source/type/status/labels — edited through the property modal,
 * which computes its fields from the schema contract) and the description
 * as the card's authored body (host-is-slot text, map.ts's
 * unwrapped-content contract).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-component',
  title: 'Component card',
  bucket: 'definitions',
  summary: 'One component-registry entry as a card — tag, name, source, status, labels.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Description',
      multiline: true,
      placeholder: 'One-paragraph description of the component.',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-component',
      label: 'Component card',
      group: 'Definitions',
      xml:
        '<sem-component tag="${1:tag}" name="${2:Name}" source="${3:src/components/…/file.ts}" type="${4:web-component}" status="${5|live,wip,deprecated,planned|}" labels="${6:label}">\n' +
        '  ${7:One-paragraph description of the component.}\n' +
        '</sem-component>',
    },
  ],
});
