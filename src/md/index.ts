/**
 * SemText — Markdown renderer (one-bundle surface, spec v0.6).
 *
 * Renders `sem-md` blocks (spec/schema/sem-md.md). No longer ships alone:
 * `src/index.ts` imports it into `dist/semtext.js` — the former standalone
 * `semtext-md.js` is retired, so every document carries the renderer
 * whether or not it has Markdown (the cost is inside the one bundle
 * budget). The handler marks what it wired with `data-sem-upgraded` and
 * skips elements that already carry it: the Lit component
 * (src/lit/sem-md.ts) imports the same enhance function and calls it
 * itself. The function is idempotent on DOM state (the chrome's
 * presence), so either caller may run first. HISTORY: the former
 * bundle's 8/8.5 KB budgets are recorded in ROADMAP.md.
 */

import { MD, enhanceMdElement } from './element.js';

export function enhanceMd(scope: ParentNode): void {
  scope.querySelectorAll(MD).forEach((el) => {
    if (el.hasAttribute('data-sem-upgraded')) return;
    enhanceMdElement(el);
    if (el.querySelector(':scope > .sem-md-chrome')) el.setAttribute('data-sem-upgraded', '');
  });
}

/** Run the Markdown handler over a scope. Only the element marker is
 *  stamped: a root stamp is the bundle-level enhance's job
 *  (src/index.ts), not this handler's. */
export function enhance(scope: ParentNode = document): void {
  enhanceMd(scope);
}

export { enhanceMdElement };
export { normalizeMd } from '../shared/mdsource.js';
export { parseBlocks, safeUrl } from './parse.js';
