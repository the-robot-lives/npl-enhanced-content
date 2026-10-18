/**
 * fallback/details — `.sem-details[data-view-as="quiz"]` highlight occlusion.
 *
 * Replaces each `.sem-highlight` with a keyboard-reachable `.sem-occluded`
 * span that reveals on click or Enter/Space. Extracted verbatim from the
 * inline demo IIFE; src/lit/sem-details.ts holds the Lit-tier twin of
 * this logic (D5) and both must keep producing the same DOM.
 */

import { sel, part } from '../shared/sel.js';

export function enhanceDetails(scope: ParentNode): void {
  scope.querySelectorAll(sel('details') + '[data-view-as="quiz"]:not([data-sem-upgraded])').forEach((root) => {
    root.querySelectorAll(part('highlight')).forEach((h) => {
      const span = document.createElement('span');
      span.className = 'sem-occluded';
      span.textContent = h.textContent;
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-label', 'reveal');
      const reveal = (): void => {
        span.className = 'sem-highlight sem-revealed';
        span.removeAttribute('role');
        span.removeAttribute('tabindex');
        // same DOM as the Lit tier: revealed text is no longer a control,
        // so the reveal label must not override its accessible name
        span.removeAttribute('aria-label');
      };
      span.addEventListener('click', reveal);
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
      });
      h.replaceWith(span);
    });
    // claim the root: reveal() leaves the span carrying `.sem-highlight`,
    // which still matches this pass's own input selector — an unclaimed
    // root would let the rescan replace just-revealed spans back to
    // `.sem-occluded` on the tick after every reveal
    root.setAttribute('data-sem-upgraded', '');
  });
}
