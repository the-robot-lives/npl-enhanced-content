/**
 * vanilla/facts — `.sem-facts` flashcard + quiz interactivity, no Lit.
 *
 * The deck wiring itself (chrome, index, verdicts, seeded draws, scoring)
 * lives in vanilla/facts-deck — the ONE implementation both tiers share
 * (the Lit component calls the same function), so the class-alias form and
 * the custom element can never drift again (they had, twice, pre-0.9.0).
 * This pass only claims unmarked decks and hands them over.
 */

import { wireFactsDeck } from './facts-deck.js';
import { sel } from '../shared/sel.js';

export function enhanceFacts(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>(sel('facts') + ':not([data-sem-upgraded])').forEach((root) => {
    const view = root.getAttribute('data-view-as');
    if (view !== 'flashcards' && view !== 'quiz') return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(sel('fact')));
    if (items.length === 0) return;
    root.setAttribute('data-sem-upgraded', '');
    wireFactsDeck(root, items, view);
  });
}
