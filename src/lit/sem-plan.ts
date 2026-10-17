import { SemElement } from './base.js';

/**
 * sem-plan — solution/plan container (spec/schema/sem-plan.md).
 *
 * Family A display stub: reasoning steps and decision points are
 * authored inside; kind/status are display-only sugar (status drawn as
 * a ::after chip via the global status catalog). A plan RECORD, not a
 * workflow engine — sem-workflow is a different lane and is NOT
 * registered here. The component only registers and claims
 * `data-sem-upgraded`. Ships in the core bundle via the src/index.ts
 * barrel.
 */
export class SemPlan extends SemElement {}
SemElement.register('sem-plan', SemPlan);
