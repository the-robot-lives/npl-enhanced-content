/**
 * agent — edit descriptor (document bucket, Phase 2).
 *
 * Document-level agent metadata (conventions §1, §4): the bare semantic
 * tag `<agent>` with `<name>` / `<bio>` / `<instructions>` children —
 * machine-facing, unstyled; extraction reads it as the `sem-agent` record
 * (`fields: { name, bio, instructions }`, `text` = name). The class-form
 * alias nests `.sem-agent-name/-bio/-instructions` (Appendix A), so the
 * slots match BOTH spellings per part. The child set is fixed — three
 * named fields, not a repeatable list — so there is no item list.
 *
 * OUT-OF-SCHEMA note: the tag is not in elements.json (like sem-chat).
 * getDescriptor() resolves it only once load-schema.ts seeds a
 * SchemaTagSpec under 'agent' (the authoring spelling — NOT 'npl-agent',
 * which is the NPL agent-definition card) — requested from the schema
 * lane with an exact patch (reports/desc-document.md).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'agent',
  title: 'Agent',
  bucket: 'document',
  summary:
    'Document-level agent metadata (machine-facing, unstyled): name, bio, instructions.',
  textSlots: [
    {
      selector: ':scope > :is(name, .sem-agent-name)',
      label: 'Name',
      placeholder: 'Agent name',
      escape: 'entities',
    },
    {
      selector: ':scope > :is(bio, .sem-agent-bio)',
      label: 'Bio',
      multiline: true,
      placeholder: 'What this agent is',
      escape: 'entities',
    },
    {
      selector: ':scope > :is(instructions, .sem-agent-instructions)',
      label: 'Instructions',
      multiline: true,
      placeholder: 'How the agent should answer',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'agent',
      label: 'Agent metadata',
      group: 'Document',
      xml:
        '<agent>\n' +
        '  <name>${1:Agent name}</name>\n' +
        '  <bio>${2:What this agent is}</bio>\n' +
        '  <instructions>${3:How it should answer}</instructions>\n' +
        '</agent>',
    },
  ],
});
