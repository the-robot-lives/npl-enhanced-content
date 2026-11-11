import { SemElement } from './base.js';
import { BindableElement } from './bind.js';

/**
 * sem-runbook — operational runbook container (spec/schema/sem-runbook.md).
 *
 * Family A display stub: preconditions, procedure and references are
 * authored inside via the existing elements; the runbook frame + "runbook"
 * label are vocabulary CSS. Ships in the core bundle via the src/index.ts
 * barrel.
 *
 * Bindable: `sem-bind="<url | agent-kit/{org}/proj/{project}/run-book/{id}>"`
 * or a direct `payload` property hydrates `{plan, status}` — the run-book
 * definition becomes the body and the per-step status dictionary lands on
 * the `sem-step` children (see bind.ts). Fetches once on connect; no
 * polling.
 */
export class SemRunbook extends BindableElement {}
SemElement.register('sem-runbook', SemRunbook);
