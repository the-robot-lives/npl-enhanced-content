// @vitest-environment happy-dom
// Unit spec — src/lit/sem-facts.ts · the flashcard deck is keyboard-operable
//
// Feature: the sem-facts upgrade gives the deck one tab stop and a
//          keyboard flip; quiz decks shuffle seeded and score one answer
//   Scenario: flashcards — the current card is the only tab stop (tabindex 0, others −1)
//   Scenario: flashcards — Enter flips the current card; aria-expanded tracks the flip
//   Scenario: flashcards — Space flips too and must not scroll (preventDefault)
//   Scenario: flashcards — navigation resets the flip and moves the single tab stop
//   Scenario: flashcards — the chrome meter reports position; prev wraps to the last card
//   Scenario: quiz — options are generated with exactly one correct pick, in seed order
//   Scenario: quiz — a correct pick scores; the meter reports the running score
//   Scenario: list (default) — no chrome, no deck behaviour claimed

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// the named import evaluates the module, which registers <sem-facts>
import { SemFacts } from '../../src/lit/sem-facts.js';

const FACTS = `
  <sem-fact id="f-rotate">
    <statement>JWTs rotate per session</statement>
    <conclusion>Short-lived access tokens; the refresh grant issues a new pair.</conclusion>
    <incorrect-statement>Store tokens in localStorage.</incorrect-statement>
  </sem-fact>
  <sem-fact id="f-expiry">
    <statement>Access tokens expire after 15 minutes</statement>
    <conclusion>The client mints a new pair from the refresh grant.</conclusion>
    <incorrect-statement>The user must sign in again every 15 minutes.</incorrect-statement>
  </sem-fact>
  <sem-fact id="f-secret">
    <statement>Client secrets never reach the browser</statement>
    <conclusion>The confidential client holds the secret server-side.</conclusion>
    <incorrect-statement>Embed the client secret in the SPA bundle.</incorrect-statement>
  </sem-fact>`;

async function mount(view: string, extra = ''): Promise<SemFacts> {
  const el = document.createElement('sem-facts');
  el.id = 'auth-facts';
  if (view) el.setAttribute('view-as', view);
  if (extra) el.setAttribute('data-sem-seed', extra);
  el.innerHTML = FACTS;
  document.body.appendChild(el);
  // happy-dom races its custom-element pipeline: elements can come out of
  // append un-upgraded even with the tag already defined, and reactions do
  // not flush synchronously. Both counters are spec no-ops in a browser:
  // upgrade() only acts on un-upgraded elements, and the macrotask tick
  // merely lets the environment deliver connectedCallback.
  if (!(el instanceof SemFacts)) customElements.upgrade(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

function cards(el: SemFacts): HTMLElement[] {
  return Array.from(el.querySelectorAll('sem-fact')) as HTMLElement[];
}

function current(el: SemFacts): HTMLElement {
  return el.querySelector('sem-fact.sem-current') as HTMLElement;
}

function meter(el: SemFacts): string {
  return (el.querySelector('.sem-facts-meter') as HTMLElement).textContent || '';
}

/** A real keydown the way a keyboard sends it (cancelable, bubbling). */
function press(el: HTMLElement, key: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

describe('sem-facts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  describe('flashcards — keyboard operation', () => {
    it('the current card is the only tab stop', async () => {
      const el = await mount('flashcards');
      const deck = cards(el);
      expect(current(el).tabIndex).toBe(0);
      expect(deck.filter((f) => f.tabIndex === 0)).toHaveLength(1);
      expect(deck.filter((f) => f.tabIndex === -1)).toHaveLength(2);
    });

    it('Enter flips the current card; aria-expanded tracks the flip', async () => {
      const el = await mount('flashcards');
      const card = current(el);
      expect(card.classList.contains('sem-flipped')).toBe(false);
      expect(card.getAttribute('aria-expanded')).toBe('false');

      const ev = press(card, 'Enter');
      expect(ev.defaultPrevented).toBe(true); // Enter must not activate anything else
      expect(card.classList.contains('sem-flipped')).toBe(true);
      expect(card.getAttribute('aria-expanded')).toBe('true');

      press(card, 'Enter');
      expect(card.classList.contains('sem-flipped')).toBe(false);
      expect(card.getAttribute('aria-expanded')).toBe('false');
    });

    it('Space flips too and is prevented from scrolling', async () => {
      const el = await mount('flashcards');
      const card = current(el);

      const ev = press(card, ' ');
      expect(ev.defaultPrevented).toBe(true); // Space must flip, not scroll
      expect(card.classList.contains('sem-flipped')).toBe(true);
      expect(card.getAttribute('aria-expanded')).toBe('true');
    });

    it('navigation resets the flip and moves the single tab stop', async () => {
      const el = await mount('flashcards');
      const deck = cards(el);
      const first = current(el);
      press(first, 'Enter');
      expect(first.classList.contains('sem-flipped')).toBe(true);

      (el.querySelector('[data-act="next"]') as HTMLButtonElement).click();

      const second = current(el);
      expect(second).toBe(deck[1]);
      expect(first.classList.contains('sem-flipped')).toBe(false);
      expect(first.getAttribute('aria-expanded')).toBe('false');
      expect(second.getAttribute('aria-expanded')).toBe('false');
      expect(second.tabIndex).toBe(0);
      expect(first.tabIndex).toBe(-1);
    });

    it('the meter reports position and prev wraps to the last card', async () => {
      const el = await mount('flashcards');
      const prev = el.querySelector('[data-act="prev"]') as HTMLButtonElement;
      prev.click();
      const deck = cards(el);
      expect(current(el)).toBe(deck[2]);
      expect(meter(el)).toBe('3/3');
    });
  });

  describe('quiz', () => {
    it('options are generated with exactly one correct pick, in seed order', async () => {
      const el = await mount('quiz', '7');
      const box = el.querySelector('.sem-quiz-options') as HTMLElement;
      const buttons = Array.from(box.querySelectorAll('button'));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      const correct = buttons.filter((b) => b.getAttribute('data-correct') === 'true');
      expect(correct).toHaveLength(1);
      expect(correct[0].textContent).toMatch(/refresh grant/);
    });

    it('a correct pick scores; the meter reports the running score', async () => {
      const el = await mount('quiz', '7');
      const correct = el.querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement;
      correct.click();
      expect(el.querySelector('button.sem-answered')).toBeTruthy();
      expect(meter(el)).toBe('1/3 · score 1/1');
    });

    it('a wrong pick is marked and still counted as answered', async () => {
      const el = await mount('quiz', '7');
      const wrong = el.querySelector(
        '.sem-quiz-options button:not([data-correct="true"])',
      ) as HTMLButtonElement;
      wrong.click();
      expect(el.querySelector('button.sem-wrong-pick')).toBeTruthy();
      // a miss teaches — the correct option marks too
      expect(
        el
          .querySelector('.sem-quiz-options button[data-correct="true"]')
          ?.classList.contains('sem-answered'),
      ).toBe(true);
      expect(meter(el)).toBe('1/3 · score 0/1');
      // one answer per question — further clicks change nothing
      (el.querySelector('.sem-quiz-options button') as HTMLButtonElement).click();
      expect(meter(el)).toBe('1/3 · score 0/1');
    });
  });

  describe('list (default)', () => {
    it('no chrome, no deck behaviour — read layout stays plain', async () => {
      const el = await mount('');
      expect(el.querySelector('.sem-facts-chrome')).toBeNull();
      expect(el.hasAttribute('data-view-as')).toBe(false);
      // the upgrade claim lands at connect (base class), but a list deck
      // stays unadorned: no chrome, no cards, no quiz machinery
      expect(el.querySelectorAll('.sem-quiz-options')).toHaveLength(0);
      expect(current(el)).toBeNull();
      expect(cards(el)).toHaveLength(3);
    });
  });
});
