import { SemElement } from './base.js';

/**
 * sem-rubric — scoring rubric container (spec/schema/sem-rubric.md).
 *
 * Family A display stub: the criteria × levels grid is authored inside
 * (typically a sem-md table child); max-score is display-only sugar the
 * CSS draws as a ::after chip. The component only registers and claims
 * `data-sem-upgraded`; authored children render as-is. Ships in the
 * core bundle via the src/index.ts barrel.
 */
export class SemRubric extends SemElement {}
SemElement.register('sem-rubric', SemRubric);
