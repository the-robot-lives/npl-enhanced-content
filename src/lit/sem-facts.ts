import { SemElement } from './base.js';
import { wireFactsDeck } from '../vanilla/facts-deck.js';
import { param } from '../shared/attr.js';
import { sel } from '../shared/sel.js';

const FACT = ':scope > ' + sel('fact');

/**
 * sem-facts — Lit upgrade of the fact collection (tag form or class alias).
 * Light DOM per PRD §4 rule 5. The deck behavior itself (chrome, card
 * index, verdict buttons, quiz retry-until-correct, scoring) lives in
 * vanilla/facts-deck — the ONE wiring both tiers share, so the tag form
 * and the class alias render identically for a fixed `data-sem-seed`
 * (they drifted twice when the logic was copied; 0.9.1 ends that).
 */
export class SemFacts extends SemElement {
  #wired = false;
  #awaitingItems = false;

  updated(): void {
    if (this.#wired) return;
    const view = param(this, 'view-as') || 'list';
    // the vocabulary's gated hide rules key on the data-* spelling
    if (view !== 'list') this.afterParse('view-as', () => this.setAttribute('data-view-as', view));
    const items = Array.from(this.querySelectorAll(FACT)) as HTMLElement[];
    if (items.length === 0) {
      // element upgraded pre-parse: children aren't there yet at first update
      this.#awaitItems();
      return;
    }
    if (view !== 'flashcards' && view !== 'quiz') return; // plain layout stays
    this.#wired = true;
    wireFactsDeck(this, items, view);
  }

  #awaitItems(): void {
    if (this.#awaitingItems) return;
    this.#awaitingItems = true;
    void this.whenChildrenReady(FACT).then(() => {
      this.#awaitingItems = false;
      this.requestUpdate();
    });
  }
}

SemElement.register('sem-facts', SemFacts);
