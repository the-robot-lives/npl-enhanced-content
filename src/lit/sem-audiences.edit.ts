/**
 * sem-audiences — edit descriptor (document bucket, Phase 2).
 *
 * The audience declaration block (spec/schema/sem-audiences.md): a
 * container of `sem-profile` definitions the `audience` qualifier refers
 * to. The declaration unit is machine-facing metadata — no text slots;
 * profiles are the item list (the +/− glyphs), and each profile's human
 * text (`label`, `implies`) is attribute editing. The class-form alias
 * (`div.sem-audiences` › `div.sem-profile[data-label]`) is covered by
 * sel(): the editor edits the authoring spelling, the `data-*` mirror is
 * the element's own afterParse write (EDITOR.md §0).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const PROFILE = ':scope > ' + sel('profile');

registerDescriptor({
  tag: 'sem-audiences',
  title: 'Audiences',
  bucket: 'document',
  summary:
    'Names the reading profiles a document knows about — the declaration block the audience qualifier refers to.',
  itemList: {
    childSelector: PROFILE,
    label: 'profile',
    template: {
      id: 'sem-profile',
      label: 'Profile',
      xml: '<sem-profile id="${1:profile-id}" label="${2:Label}"></sem-profile>',
    },
  },
  containerOf: 'sem-profile',
  templates: [
    {
      id: 'sem-audiences',
      label: 'Audience declarations',
      group: 'Document',
      xml:
        '<sem-audiences>\n' +
        '  <sem-profile id="${1:reader}" label="${2:Reader}"></sem-profile>\n' +
        '  <sem-profile id="${3:operator}" label="${4:Operator}" implies="${5:reader}"></sem-profile>\n' +
        '</sem-audiences>',
    },
  ],
});
