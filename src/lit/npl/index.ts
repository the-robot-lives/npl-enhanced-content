/**
 * NPL components — the `npl-*` namespace barrel (src/lit/npl/).
 *
 * ADDING A COMPONENT — the whole recipe, designed so parallel authors
 * never edit the same line:
 *
 *   1. `npl-<name>.ts` (this directory): `export class Npl<Name> extends
 *      SemElement` — light DOM via the base (no shadow root, no `static
 *      styles`), parameters as `static properties` mirrored to `data-*`
 *      in `updated()` through afterParse — ending in
 *      `defineNpl('npl-<name>', Npl<Name>);`
 *   2. Below, in alphabetical order, the two-line pair (export keeps the
 *      name on the SemText global; the import keeps the side effect under
 *      tree-shaking) — your lines only, nothing shared:
 *          export { Npl<Name> } from './npl-<name>.js';
 *          import './npl-<name>.js';
 *   3. themes/_vocabulary.css — in the marked npl section, add ONE line
 *          npl-<name>, .npl-<name> { display: block; }
 *      alphabetically among the per-tag lines (insert, never rewrite).
 *   4. spec/schema/npl/<name>.md — copy TEMPLATE.md; one file per
 *      component, never edit a shared schema file.
 *   5. test/unit/npl-<name>.test.ts — same harness as
 *      test/unit/npl-foundation.test.ts (happy-dom pragma).
 *
 * src/index.ts imports this barrel ONCE (`export * from './lit/npl/index.js'`);
 * no component ever touches it.
 *
 * SCHEMA ENTRY FORMAT (spec/schema/npl/TEMPLATE.md, mirroring the sem-*
 * prose contracts in spec/schema/*.md — prose is normative: changes there
 * precede spec changes precede code):
 *
 *   # Schema — `npl-<name>`            H1, the tag
 *   ## Authoring form                  HTML snippet + attribute catalog:
 *                                      one `-` bullet per parameter —
 *                                      `<name>`: `<type>` — `<default>`;
 *                                      `id`, `kind`, `tags` ride the global
 *                                      catalog and need no bullet
 *   ## Rendered form                   enhanced vs JS-off (JS-off is always:
 *                                      block box from the vocabulary npl
 *                                      section, nothing hidden or generated)
 *   ## Events                          optional — delete if none; one bullet
 *                                      per `npl-<event>` with its `detail`
 */

/* Components — alphabetical; one two-line pair each, nothing shared. */

/* Namespace helpers (src/lit/npl/shared.ts). */

export { NplAgent } from './npl-agent.js';
import './npl-agent.js';
export { NplArtifact } from './npl-artifact.js';
import './npl-artifact.js';
export { NplCot } from './npl-cot.js';
import './npl-cot.js';
export { NplCritique } from './npl-critique.js';
import './npl-critique.js';
export { NplDeclaration } from './npl-declaration.js';
import './npl-declaration.js';
export { NplDirective } from './npl-directive.js';
import './npl-directive.js';
export { NplExample } from './npl-example.js';
import './npl-example.js';
export { NplFlag } from './npl-flag.js';
import './npl-flag.js';
export { NplFlags } from './npl-flags.js';
import './npl-flags.js';
export { NplHormones } from './npl-hormones.js';
import './npl-hormones.js';
export { NplIntent } from './npl-intent.js';
import './npl-intent.js';
export { NplMindread } from './npl-mindread.js';
import './npl-mindread.js';
export { NplMode } from './npl-mode.js';
import './npl-mode.js';
export { NplMood } from './npl-mood.js';
import './npl-mood.js';
export { NplPoa } from './npl-poa.js';
import './npl-poa.js';
export { NplRef } from './npl-ref.js';
import './npl-ref.js';
export { NplRubric } from './npl-rubric.js';
import './npl-rubric.js';
export { NplSection } from './npl-section.js';
import './npl-section.js';
export { NplThought } from './npl-thought.js';
import './npl-thought.js';
export { NplVos } from './npl-vos.js';
import './npl-vos.js';

export { defineNpl, nplParam, nplEmit } from './shared.js';
