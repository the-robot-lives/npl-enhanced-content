/**
 * npl-thought — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * The typed `npl-thought` children stay in authored position (the element
 * only applies classes and mirrors `data-type` in place), so the children
 * are a working item list AND their text is an inline slot (plain-text
 * thoughts commit; typed sub-containers are refused with the standard
 * announcement). The eleven known types ride the template choice stop;
 * unknown types degrade in the element, never in the editor.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-thought',
  title: 'Thought',
  bucket: 'npl-b',
  summary: 'A typed associative thought bubble.',
  textSlots: [
    {
      selector: ':scope > npl-thought',
      label: 'Thought',
      multiline: true,
      placeholder: 'The thought…',
      escape: 'entities',
    },
  ],
  itemList: {
    childSelector: ':scope > npl-thought',
    label: 'thought',
    template: {
      id: 'npl-thought-item',
      label: 'Thought',
      xml: '<npl-thought type="${1:observation}">${2:The thought}</npl-thought>',
    },
  },
  templates: [
    {
      id: 'npl-thought',
      label: 'Thought bubble',
      group: 'NPL',
      xml:
        '<npl-thought id="${1:thought-id}">\n' +
        `  <npl-thought type="observation">\${2:Observation}</npl-thought>\n` +
        `  <npl-thought type="tangent">\${3:Tangent}</npl-thought>\n` +
        '</npl-thought>',
    },
  ],
});
