import { SemElement } from './base.js';
import { BindableElement } from './bind.js';

/**
 * sem-progress — completion meter (spec/schema/sem-progress.md).
 *
 * Graduated from the claim stubs (sem-stubs.ts round-2 contract: a stub
 * that grows real behaviour moves to its own module) to carry the
 * sem-bind payload intake: `{percent, comment}` or `{step, steps,
 * comment}` hydrate into the same meter DOM the vanilla handler builds
 * (`.sem-progress-track` / `.sem-progress-fill`), so the theme
 * vocabulary styles both renderings identically. The authored
 * `data-value`/`data-label` form is untouched — the vanilla handler
 * keeps owning it; a bound element simply has no authored value.
 *
 * `sem-bind="<url | agent-kit/{org}/proj/{project}/progress/{id}>"`
 * fetches on connect and polls every 30s (override with
 * `sem-refresh="<seconds>"`); a direct `payload` property hydrates with
 * no network (demos, tests).
 */
export class SemProgress extends BindableElement {}
// The build's lazy-chunk scanner keys on this literal — keep the receiver
// spelled `SemElement` even though register is inherited (bind.ts comment).
SemElement.register('sem-progress', SemProgress);
