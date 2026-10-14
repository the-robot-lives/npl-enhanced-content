import { SemElement } from './base.js';
import { param } from '../shared/attr.js';
import { part } from '../shared/sel.js';

const HIGHLIGHT = part('highlight');

/**
 * sem-details — Lit upgrade of the prose-with-cloze block (tag form or class alias).
 * Light DOM per PRD §4 rule 5. quiz view occludes .sem-highlight recall
 * targets (.sem-occluded spans); plain view leaves prose untouched.
 * Handoff contract comes from SemElement.
 */
export class SemDetails extends SemElement {
  #wired = false;
  #awaitingHighlights = false;

  updated(): void {
    if (this.#wired) return;
    const view = param(this, 'view-as') || 'plain';
    if (view === 'quiz') this.afterParse('view-as', () => this.setAttribute('data-view-as', view));
    const highlights = Array.from(this.querySelectorAll(HIGHLIGHT));
    if (view !== 'quiz' || highlights.length === 0) {
      if (view === 'quiz' && highlights.length === 0) {
        // element upgraded pre-parse: children aren't there yet at first update
        this.#awaitHighlights();
      }
      return;
    }
    this.#wired = true;

    highlights.forEach((h) => {
      const span = document.createElement('span');
      span.className = 'sem-occluded';
      span.textContent = h.textContent;
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-label', 'reveal');
      const reveal = () => {
        span.className = 'sem-highlight sem-revealed';
        span.removeAttribute('role');
        span.removeAttribute('tabindex');
        // revealed text is no longer a control: the reveal label must not
        // override its accessible name (schema A11y contract)
        span.removeAttribute('aria-label');
      };
      span.addEventListener('click', reveal);
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
      });
      h.replaceWith(span);
    });
  }

  #awaitHighlights(): void {
    if (this.#awaitingHighlights) return;
    this.#awaitingHighlights = true;
    void this.whenChildrenReady(HIGHLIGHT).then(() => {
      this.#awaitingHighlights = false;
      this.requestUpdate();
    });
  }
}

SemElement.register('sem-details', SemDetails);
