/**
 * Agent-kit components — the `agent-kit-*` namespace barrel
 * (src/lit/agent-kit/).
 *
 * ADDING A COMPONENT — the whole recipe, designed so parallel authors
 * never edit the same line:
 *
 *   1. `agent-kit-<name>.ts` (this directory): `export class Akit<Name>
 *      extends SemElement` — light DOM via the base (no shadow root, no
 *      `static styles`), parameters as `static properties` mirrored to
 *      `data-*` in `updated()` through afterParse — ending in
 *      `defineAkit('agent-kit-<name>', Akit<Name>);`
 *   2. Below, in alphabetical order, the two-line pair (export keeps the
 *      name on the AgentKit global; the import keeps the side effect
 *      under tree-shaking) — your lines, nothing shared:
 *          export { Akit<Name> } from './agent-kit-<name>.js';
 *          import './agent-kit-<name>.js';
 *   3. themes/_vocabulary.css — in the marked agent-kit section, add ONE
 *      line
 *          agent-kit-<name>, .agent-kit-<name> { display: block; }
 *      alphabetically among the per-tag lines (insert, never rewrite).
 *   4. spec/schema/agent-kit/<name>.md — copy TEMPLATE.md; one file per
 *      component, never edit a shared schema file.
 *   5. test/unit/agent-kit-<name>.test.ts — same harness as
 *      test/unit/npl-foundation.test.ts (happy-dom pragma).
 *
 * src/agent-kit.ts imports this barrel ONCE (`export * from
 * './lit/agent-kit/index.js'`); no component ever touches it.
 *
 * SCHEMA ENTRY FORMAT (spec/schema/agent-kit/TEMPLATE.md, mirroring the
 * sem-* prose contracts in spec/schema/*.md — prose is normative: changes
 * there precede spec changes precede code):
 *
 *   # Schema — `agent-kit-<name>`      H1, the tag
 *   ## Authoring form                  HTML snippet + attribute catalog:
 *                                      one `-` bullet per parameter —
 *                                      `<name>`: `<type>` — `<default>`;
 *                                      `id`, `kind`, `tags` ride the global
 *                                      catalog and need no bullet
 *   ## Reference attributes            the org/project/key/id quartet when
 *                                      the element references an upstream
 *                                      record (see TEMPLATE.md)
 *   ## Cached content                  authored inner content IS the record;
 *                                      refresh markers per TEMPLATE.md
 *   ## Rendered form                   enhanced vs JS-off (JS-off is always:
 *                                      block box from the vocabulary
 *                                      agent-kit section, nothing hidden
 *                                      or generated)
 *   ## Events                          optional — delete if none; one bullet
 *                                      per `agent-kit:<event>` with its
 *                                      `detail`
 */

/* Components — alphabetical; one two-line pair each, nothing shared.
 * The generic ticket renderer (ticket-shared.ts) and the chrome helpers
 * (chrome.ts) carry no registrations of their own — only the per-tag
 * files below do. */

export { AkitAcceptanceCriteria } from './agent-kit-acceptance-criteria.js';
import './agent-kit-acceptance-criteria.js';
export { AkitAgentPersona } from './agent-kit-agent-persona.js';
import './agent-kit-agent-persona.js';
export { AkitArtifact } from './agent-kit-artifact.js';
import './agent-kit-artifact.js';
export { AkitAsset } from './agent-kit-asset.js';
import './agent-kit-asset.js';
export { AkitBoard } from './agent-kit-board.js';
import './agent-kit-board.js';
export { AkitBug } from './agent-kit-bug.js';
import './agent-kit-bug.js';
export { AkitChatroom } from './agent-kit-chatroom.js';
import './agent-kit-chatroom.js';
export { AkitCustomAssert } from './agent-kit-custom-assert.js';
import './agent-kit-custom-assert.js';
export { AkitEpic } from './agent-kit-epic.js';
import './agent-kit-epic.js';
export { AkitIssue } from './agent-kit-issue.js';
import './agent-kit-issue.js';
export { AkitOrganization } from './agent-kit-organization.js';
import './agent-kit-organization.js';
export { AkitProject } from './agent-kit-project.js';
import './agent-kit-project.js';
export { AkitReview } from './agent-kit-review.js';
import './agent-kit-review.js';
export { AkitSubTask } from './agent-kit-sub-task.js';
import './agent-kit-sub-task.js';
export { AkitTask } from './agent-kit-task.js';
import './agent-kit-task.js';
export { AkitTicketRef } from './agent-kit-ticket-ref.js';
import './agent-kit-ticket-ref.js';
export { AkitUserPersona } from './agent-kit-user-persona.js';
import './agent-kit-user-persona.js';
export { AkitUserStory } from './agent-kit-user-story.js';
import './agent-kit-user-story.js';

/* Namespace helpers (src/lit/agent-kit/shared.ts). */

export { defineAkit, akitParam, akitEmit } from './shared.js';
