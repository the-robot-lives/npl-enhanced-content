import { SemElement } from './base.js';
import { BindableElement } from './bind.js';

/**
 * sem-plan — solution/plan container (spec/schema/sem-plan.md).
 *
 * Family A display stub: reasoning steps and decision points are
 * authored inside; kind/status are display-only sugar (status drawn as
 * a ::after chip via the global status catalog). A plan RECORD, not a
 * workflow engine — sem-workflow is a different lane and is NOT
 * registered here. Ships in the core bundle via the src/index.ts
 * barrel.
 *
 * Bindable: `sem-bind="<url | agent-kit/{org}/proj/{project}/plan/{id}>"`
 * or a direct `payload` property hydrates `{plan, status}` — the plan
 * markup becomes the body and the per-step status dictionary lands on
 * the `sem-step` children (see bind.ts). Fetches once on connect; no
 * polling.
 */
export class SemPlan extends BindableElement {}
SemElement.register('sem-plan', SemPlan);
