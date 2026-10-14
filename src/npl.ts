/**
 * npl.js — the `npl-*` component namespace as its own bundle (dist/npl.js,
 * classic IIFE, global `NPL`).
 *
 * Core (src/index.ts → dist/semtext.js) deliberately carries no npl-* code:
 * an NPL document loads this ON TOP of the core vocabulary when it wants
 * every npl component without chunk loading — the same relationship
 * semtext-lazy.js has to semtext.js, minus the loading. The barrel owns
 * the per-component lines; this entry is one re-export, so a new npl
 * component (added per the barrel's recipe) ships in the next build with
 * no change here.
 *
 * The entry also owns the class-form alias pass (conventions Appendix A):
 * at DOMContentLoaded every `.npl-<tag>` element this bundle defines a
 * component for is rewritten to its tag form (src/shared/npl-alias.ts),
 * mirroring the timing of the core bundle's vanilla handlers (src/index.ts
 * init). With the documented script order — semtext.js, then npl.js — the
 * core's sem-source snapshot has already captured the authored markup, so
 * fences still show the class form.
 */

export * from './lit/npl/index.js';
import './lit/npl/index.js';
import { upgradeNplAliases } from './shared/npl-alias.js';

function initAliases(): void {
  // Predicate = "this bundle ships it": the barrel's imports have run by
  // now, so every registered component answers through customElements.get.
  // A `.npl-*` class with no definition stays authored prose.
  upgradeNplAliases(document.documentElement, (tag) => customElements.get(tag) !== undefined);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAliases, { once: true });
  } else {
    initAliases();
  }
}
