/**
 * SemText extension components — the `semext-*` namespace barrel
 * (src/lit/semext/).
 *
 * ADDING A COMPONENT — the whole recipe, designed so parallel authors
 * never edit the same line:
 *
 *   1. `semext-<name>.ts` (this directory): `export class Semext<Name>
 *      extends SemElement` — light DOM via the base (no shadow root, no
 *      `static styles`), parameters as `static properties` mirrored to
 *      `data-*` in `updated()` through afterParse — ending in
 *      `defineSemext('semext-<name>', Semext<Name>);`
 *   2. Below, in alphabetical order, the two-line pair (export keeps the
 *      name on the SemTextExt global; the import keeps the side effect
 *      under tree-shaking) — your lines, nothing shared:
 *          export { Semext<Name> } from './semext-<name>.js';
 *          import './semext-<name>.js';
 *   3. themes/_vocabulary.css — in the marked semext section, add ONE line
 *          semext-<name>, .semext-<name> { display: block; }
 *      alphabetically among the per-tag lines (insert, never rewrite).
 *   4. spec/schema/semext/<name>.md — copy TEMPLATE.md; one file per
 *      component, never edit a shared schema file.
 *   5. test/unit/semext-<name>.test.ts — same harness as
 *      test/unit/npl-foundation.test.ts (happy-dom pragma).
 *
 * src/semext.ts imports this barrel ONCE (`export * from
 * './lit/semext/index.js'`); no component ever touches it.
 *
 * SCHEMA ENTRY FORMAT (spec/schema/semext/TEMPLATE.md, mirroring the
 * sem-* prose contracts in spec/schema/*.md — prose is normative: changes
 * there precede spec changes precede code):
 *
 *   # Schema — `semext-<name>`         H1, the tag
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
 *                                      block box from the vocabulary semext
 *                                      section, nothing hidden or generated)
 *   ## Events                          optional — delete if none; one bullet
 *                                      per `semext:<event>` with its `detail`
 */

/* Components — alphabetical; one two-line pair each, nothing shared.
 * Family B (feat/semext-embeds): the nine service-backed embeds over the
 * cached-embed base (src/lit/shared/cached-embed.ts). All snapshot-backed
 * embeds keep `livePolicy: 'never'`; semext-annotate is the one element
 * with a client live read ('anonymous-read', text-only rendering). */

export { SemextAnnotate } from './semext-annotate.js';
import './semext-annotate.js';
export { SemextDocptr } from './semext-docptr.js';
import './semext-docptr.js';
export { SemextMediaPrompt } from './semext-media-prompt.js';
import './semext-media-prompt.js';
export { SemextSigLogs } from './semext-sig-logs.js';
import './semext-sig-logs.js';
export { SemextSigMetrics } from './semext-sig-metrics.js';
import './semext-sig-metrics.js';
export { SemextSigSyntheticMonitor } from './semext-sig-synthetic-monitor.js';
import './semext-sig-synthetic-monitor.js';
export { SemextSigTraces } from './semext-sig-traces.js';
import './semext-sig-traces.js';
export { SemextStyleguideTheme } from './semext-styleguide-theme.js';
import './semext-styleguide-theme.js';
export { SemextStyleguideThemes } from './semext-styleguide-themes.js';
import './semext-styleguide-themes.js';

/* Namespace helpers (src/lit/semext/shared.ts). */

export { defineSemext, semextParam, semextEmit } from './shared.js';
