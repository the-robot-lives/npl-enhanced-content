import { SemElement } from './base.js';

/**
 * sem-kb — knowledge-base article container (spec/schema/sem-kb.md).
 *
 * Family A (static knowledge/doc containers): a no-logic display stub
 * per the no-CSS-only-elements rule — the component exists so the tag
 * registers and claims `data-sem-upgraded` at connect; authored children
 * (sem-section, sem-references, sem-code, prose, links) render as-is.
 * The block box and the "knowledge base" label are vocabulary CSS
 * (::before, outside textContent — extraction is byte-identical with the
 * script on or off). Registers through the CORE barrel (src/index.ts),
 * so it ships in dist/semtext.js.
 */
export class SemKb extends SemElement {}
SemElement.register('sem-kb', SemKb);
