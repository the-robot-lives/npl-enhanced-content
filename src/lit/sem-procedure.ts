import { SemElement } from './base.js';
import { BindableElement } from './bind.js';

/**
 * sem-procedure — ordered, status-annotated steps (spec/schema/
 * sem-procedure.md).
 *
 * Graduated from the claim stubs to carry the sem-bind payload intake:
 * `{plan, status}` — the plan markup (optional) becomes the body and the
 * per-step status dictionary (`complete|pending|error|skipped|none` +
 * comment + choice) lands on the authored / fetched `sem-step` children,
 * mapped onto the vocabulary status catalog (`done|todo|blocked`) with
 * `data-sem-bind-status` carrying the exact payload spelling. Zero-JS
 * rendering is unchanged: status is an attribute, ordinals are CSS
 * counters — everything hydration writes is attributes and bind-marked
 * chrome the record tier never sees.
 */
export class SemProcedure extends BindableElement {}
// The build's lazy-chunk scanner keys on this literal (see sem-progress.ts).
SemElement.register('sem-procedure', SemProcedure);
