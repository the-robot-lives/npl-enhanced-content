/**
 * agent-kit.js — the `agent-kit-*` component namespace as its own bundle
 * (dist/agent-kit.js, classic IIFE, global `AgentKit`).
 *
 * Core (src/index.ts → dist/semtext.js) deliberately carries no
 * agent-kit-* code: an agent-kit document loads this ON TOP of the core
 * vocabulary when it wants every agent-kit component without chunk
 * loading — the same relationship semtext-lazy.js has to semtext.js,
 * minus the loading. The barrel owns the per-component lines; this entry
 * is one re-export, so a new agent-kit component (added per the barrel's
 * recipe) ships in the next build with no change here.
 *
 * The entry also owns the class-form alias pass (conventions Appendix A):
 * at DOMContentLoaded every `.agent-kit-<tag>` element this bundle
 * defines a component for is rewritten to its tag form
 * (src/shared/npl-alias.ts, generalized as `upgradeClassAliases`),
 * mirroring the timing of the core bundle's vanilla handlers
 * (src/index.ts init). With the documented script order — semtext.js,
 * then agent-kit.js — the core's sem-source snapshot has already captured
 * the authored markup, so fences still show the class form.
 */

export * from './lit/agent-kit/index.js';
import './lit/agent-kit/index.js';
import { upgradeClassAliases } from './shared/npl-alias.js';

function initAliases(): void {
  // Predicate = "this bundle ships it": the barrel's imports have run by
  // now, so every registered component answers through customElements.get.
  // A `.agent-kit-*` class with no definition stays authored prose.
  upgradeClassAliases(document.documentElement, 'agent-kit', (tag) => customElements.get(tag) !== undefined);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAliases, { once: true });
  } else {
    initAliases();
  }
}
