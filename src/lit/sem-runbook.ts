import { SemElement } from './base.js';

/**
 * sem-runbook — operational runbook container (spec/schema/sem-runbook.md).
 *
 * Family A display stub: preconditions, procedure and references are
 * authored inside via the existing elements; the component claims
 * `data-sem-upgraded` and renders nothing of its own (light DOM, no
 * shadow root). The runbook frame + "runbook" label are vocabulary CSS.
 * Ships in the core bundle via the src/index.ts barrel.
 */
export class SemRunbook extends SemElement {}
SemElement.register('sem-runbook', SemRunbook);
