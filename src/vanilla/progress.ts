/**
 * fallback/progress — `.sem-progress[data-value]` meter render.
 *
 * The value is clamped into [0,1] and a non-numeric value reads as 0, so an
 * authoring typo degrades to an empty bar rather than a broken layout. The
 * `label :: NN%` text and the clamp are asserted by
 * test/e2e/sem-progress.cy.js.
 */

import { sel } from '../shared/sel.js';

export function enhanceProgress(scope: ParentNode): void {
  scope.querySelectorAll(sel('progress') + '[data-value]').forEach((p) => {
    // Idempotent re-scan guard (0.9.1): skip a meter already built. This
    // handler must NOT guard on the element marker — the tag form's claim
    // stub (sem-stubs SemProgress) stamps `data-sem-upgraded` at connect,
    // before the handler ever ran (the doc in sem-stubs.ts is explicit).
    if (p.querySelector('.sem-progress-track')) return;
    const raw = parseFloat(p.getAttribute('data-value') as string);
    const v = Math.min(1, Math.max(0, isNaN(raw) ? 0 : raw));
    const label = p.getAttribute('data-label') || 'progress';
    const pct = Math.round(v * 100);
    p.textContent = label + ' :: ' + pct + '%';
    // Mark what was wired (tier handoff): the JS-off attr() caption in the
    // vocabulary is gated on the element marker, so without it the meter
    // would read twice — caption + fallback text.
    p.setAttribute('data-sem-upgraded', '');
    const track = document.createElement('span');
    track.className = 'sem-progress-track';
    const fill = document.createElement('span');
    fill.className = 'sem-progress-fill';
    fill.style.width = pct + '%';
    track.appendChild(fill);
    p.appendChild(track);
  });
}
