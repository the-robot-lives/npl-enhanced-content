/**
 * fallback/reveal — wraps `.sem-reveal` content in native `<details>`.
 *
 * Native disclosure rather than a hand-rolled toggle: it is keyboard- and
 * screen-reader-correct for free, and find-in-page still reaches closed
 * content in browsers that support it. Round-2 contract: the reveal is
 * HIDDEN until the reader acts — the default is closed; `open` on the
 * source element opts into starting revealed; `collapsed` is accepted
 * for back-compat and is a no-op (closed is the default either way).
 *
 * Skips anything the Lit component already claimed (`data-sem-upgraded`
 * — the base class sets it at connect, before this scan runs).
 *
 * The derived `<summary>` (no `data-summary`) is `shared/summary`'s rule —
 * the same function extraction uses — so the label a reader sees is the
 * `summary` field a machine receives.
 */

import { deriveSummary, normalize } from '../shared/summary.js';
import { sel } from '../shared/sel.js';

export function enhanceReveal(scope: ParentNode): void {
  scope.querySelectorAll(sel('reveal') + ':not([data-sem-upgraded])').forEach((r) => {
    const d = document.createElement('details');
    if (r.hasAttribute('open')) d.setAttribute('open', '');
    const s = document.createElement('summary');
    s.textContent = r.getAttribute('data-summary') || deriveSummary(normalize(r.textContent));
    d.appendChild(s);
    const body = document.createElement('div');
    body.className = 'sem-reveal-body';
    while (r.firstChild) body.appendChild(r.firstChild);
    d.appendChild(body);
    r.appendChild(d);
    // Mark what was wired (tier handoff): the vocabulary suppresses the
    // JS-off `data-summary` ::before caption once a script built the
    // <details>, whose <summary> carries the same string.
    r.setAttribute('data-sem-upgraded', '');
  });
}
