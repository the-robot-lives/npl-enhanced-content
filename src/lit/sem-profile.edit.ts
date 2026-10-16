/**
 * sem-profile — edit descriptor (document bucket, Phase 2).
 *
 * One reading profile inside the sem-audiences block: `id` (required,
 * document-unique — the token `audience` specs and the hash parameter
 * refer to), `label` (human; the id renders when absent) and `implies`
 * (comma list — profiles this one satisfies as well). The declaration
 * unit is EMPTY: content authored inside a sem-profile has no effect, so
 * there are deliberately no text slots — everything a profile carries is
 * attribute editing through the property modal, plus the insert template.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-profile',
  title: 'Profile',
  bucket: 'document',
  summary:
    'One reading profile: an id token, a human label, and the profiles it implies.',
  templates: [
    {
      id: 'sem-profile',
      label: 'Profile',
      group: 'Document',
      xml:
        '<sem-profile id="${1:profile-id}" label="${2:Label}" implies="${3:other-profile}"></sem-profile>',
    },
  ],
});
