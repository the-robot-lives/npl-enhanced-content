import { SemElement } from './base.js';

/**
 * sem-eval — evaluation-spec container (spec/schema/sem-eval.md).
 *
 * Family A display stub: inputs/expected/criteria are authored inside
 * as sections, tables or prose; kind/status are display-only sugar
 * (status drawn as a ::after chip, outside textContent). The component
 * only registers and claims `data-sem-upgraded`. Ships in the core
 * bundle via the src/index.ts barrel.
 */
export class SemEval extends SemElement {}
SemElement.register('sem-eval', SemEval);
