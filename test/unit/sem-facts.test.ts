// @vitest-environment happy-dom
// Unit spec — src/vanilla/facts-deck.ts (the one deck wiring both tiers share)
//
// Feature: the 0.9.1 deck contract (SEMTEX-003 / SEMTEX-004)
//   Scenario: flashcards — ONE card at a time, in seeded shuffled order
//   Scenario: flashcards — the chrome meter is an INDEX (one chip per card, current marked)
//   Scenario: flashcards — click flips; Enter/Space flip too (Space prevented from scrolling)
//   Scenario: flashcards — a verdict records and advances to the next unanswered card
//   Scenario: flashcards — answering every card shows the total score; Restart resets
//   Scenario: quiz — options generated in seed order with exactly one correct pick
//   Scenario: quiz — a wrong pick marks the pick and play continues (retry until correct)
//   Scenario: quiz — the correct pick auto-advances after 500 ms
//   Scenario: quiz — finishing every question reports the final score
//   Scenario: list (default) — no chrome, no deck behaviour claimed

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// the named import evaluates the module, which registers <sem-facts>
import { SemFacts } from '../../src/lit/sem-facts.js';
import { mulberry32, shuffle } from '../../src/shared/rng.js';

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

function current(el: SemFacts): HTMLElement | null {
  return el.querySelector('sem-fact.sem-current');
}

/** The deck order wireFactsDeck draws for `data-sem-seed="7"`: one
 *  Fisher-Yates over the card indexes with the same PRNG the wiring uses. */
function expectedOrder(): number[] {
  return shuffle([0, 1, 2], mulberry32(7));
}

function chipIndex(el: SemFacts): number {
  const chips = Array.from(el.querySelectorAll('.sem-facts-meter button'));
  return chips.findIndex((c) => c.getAttribute('aria-current') === 'true');
}

function press(el: HTMLElement, key: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

describe('sem-facts (0.9.1 deck contract)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('flashcards', () => {
    it('shows ONE card at a time, in the seeded shuffled order', async () => {
      const el = await mount('flashcards', '7');
      const deck = cards(el);
      expect(deck.filter((f) => f.classList.contains('sem-current'))).toHaveLength(1);
      // current = first position of the seeded draw, not authored order
      expect(current(el)).toBe(deck[expectedOrder()[0]]);
    });

    it('the meter is an index: one chip per card, current marked', async () => {
      const el = await mount('flashcards', '7');
      const chips = Array.from(
        el.querySelectorAll('.sem-facts-meter button'),
      ) as HTMLButtonElement[];
      expect(chips).toHaveLength(3);
      expect(chips.map((c) => c.textContent)).toEqual(['1', '2', '3']);
      expect(chipIndex(el)).toBe(0);
      // a chip jumps straight to that card
      chips[2].click();
      expect(chipIndex(el)).toBe(2);
    });

    it('click flips; Enter/Space flip too and Space cannot scroll', async () => {
      const el = await mount('flashcards', '7');
      const card = current(el) as HTMLElement;
      expect(card.classList.contains('sem-flipped')).toBe(false);
      card.click();
      expect(card.classList.contains('sem-flipped')).toBe(true);
      expect(card.getAttribute('aria-expanded')).toBe('true');

      const deck = cards(el);
      const second = deck[expectedOrder()[1]];
      (el.querySelector('[data-act="next"]') as HTMLButtonElement).click();
      expect(current(el)).toBe(second);

      const ev = press(second, ' ');
      expect(ev.defaultPrevented).toBe(true);
      expect(second.classList.contains('sem-flipped')).toBe(true);
    });

    it('a verdict records on the card and advances to the next unanswered card', async () => {
      const el = await mount('flashcards', '7');
      const deck = cards(el);
      const first = deck[expectedOrder()[0]];
      first.click();
      expect(first.classList.contains('sem-flipped')).toBe(true);

      const got = first.querySelector('.sem-facts-verdict button[data-verdict="got"]') as HTMLButtonElement;
      got.click();
      // first chip carries the verdict; the deck moved on
      const chips = Array.from(el.querySelectorAll('.sem-facts-meter button')) as HTMLButtonElement[];
      expect(chips[0].getAttribute('data-verdict')).toBe('got');
      expect(chipIndex(el)).toBe(1);
      expect(current(el)).toBe(deck[expectedOrder()[1]]);
      // prev still reaches the answered card and a new verdict overwrites
      (el.querySelector('[data-act="prev"]') as HTMLButtonElement).click();
      const miss = current(el)!.querySelector('.sem-facts-verdict button[data-verdict="miss"]') as HTMLButtonElement;
      miss.click();
      expect(chips[0].getAttribute('data-verdict')).toBe('miss');
    });

    it('answering every card shows the total score; Restart resets the deck', async () => {
      const el = await mount('flashcards', '7');
      // answer all three: got, wrong, got
      for (let k = 0; k < 3; k++) {
        const card = current(el) as HTMLElement;
        card.click();
        const verdict = card.querySelector(
          k === 1 ? '.sem-facts-verdict button[data-verdict="miss"]' : '.sem-facts-verdict button[data-verdict="got"]',
        ) as HTMLButtonElement;
        verdict.click();
      }
      const summary = el.querySelector('.sem-facts-summary') as HTMLElement;
      expect(summary.hidden).toBe(false);
      expect(summary.textContent).toContain('You got 2 of 3');
      expect(current(el)).toBeNull(); // one-at-a-time ends; the score is the state
      // restart: clean slate, same deck order
      (summary.querySelector('[data-act="restart"]') as HTMLButtonElement).click();
      expect(summary.hidden).toBe(true);
      const deck = cards(el);
      expect(current(el)).toBe(deck[expectedOrder()[0]]);
      expect(el.querySelectorAll('.sem-facts-meter button[data-verdict]')).toHaveLength(0);
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

    it('a wrong pick marks the pick and play CONTINUES until the correct pick', async () => {
      const el = await mount('quiz', '7');
      const box = el.querySelector('.sem-quiz-options') as HTMLElement;
      const wrong = el.querySelector(
        '.sem-quiz-options button:not([data-correct="true"])',
      ) as HTMLButtonElement;
      wrong.click();
      expect(wrong.classList.contains('sem-wrong-pick')).toBe(true);
      expect(wrong.disabled).toBe(true); // the spent pick is inert
      expect(box.hasAttribute('data-answered')).toBe(false); // the question stays open
      // a second wrong pick marks too
      const wrong2 = el.querySelector(
        '.sem-quiz-options button:not([data-correct="true"]):not(.sem-wrong-pick)',
      ) as HTMLButtonElement | null;
      if (wrong2) {
        wrong2.click();
        expect(wrong2.classList.contains('sem-wrong-pick')).toBe(true);
      }
      // the correct pick is still pickable and lands
      const correct = el.querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement;
      correct.click();
      expect(correct.classList.contains('sem-answered')).toBe(true);
      expect(box.hasAttribute('data-answered')).toBe(true);
    });

    it('the correct pick auto-advances after 500 ms; the meter tracks score', async () => {
      const el = await mount('quiz', '7');
      expect(el.querySelector('.sem-facts-meter')!.textContent).toBe('1/3 · score 0/0');
      vi.useFakeTimers();
      (el.querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement).click();
      expect(el.querySelector('.sem-facts-meter')!.textContent).toBe('1/3 · score 1/1');
      // before the delay the same question is still on screen
      expect(el.querySelectorAll('.sem-quiz-options button[data-correct="true"]')[0]).toBeTruthy();
      vi.advanceTimersByTime(500);
      // question 2 of the authored order now carries the options
      const deck = cards(el);
      expect(deck[1].querySelector('.sem-quiz-options button')).toBeTruthy();
      vi.useRealTimers();
    });

    it('first-try misses score as misses; the final question shows the total', async () => {
      const el = await mount('quiz', '7');
      vi.useFakeTimers();
      // Q1: wrong first, then correct -> a miss
      (el.querySelector(
        '.sem-quiz-options button:not([data-correct="true"])',
      ) as HTMLButtonElement).click();
      (el.querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement).click();
      vi.advanceTimersByTime(500);
      expect(el.querySelector('.sem-facts-meter')!.textContent).toBe('2/3 · score 0/1');
      // Q2: correct first try
      (cards(el)[1].querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement).click();
      vi.advanceTimersByTime(500);
      // Q3: correct first try -> deck complete
      (cards(el)[2].querySelector('.sem-quiz-options button[data-correct="true"]') as HTMLButtonElement).click();
      vi.advanceTimersByTime(500);
      const summary = el.querySelector('.sem-facts-summary') as HTMLElement;
      expect(summary.hidden).toBe(false);
      expect(summary.textContent).toContain('You got 2 of 3');
      vi.useRealTimers();
    });
  });

  describe('list (default)', () => {
    it('no chrome, no deck behaviour — read layout stays plain', async () => {
      const el = await mount('');
      expect(el.querySelector('.sem-facts-chrome')).toBeNull();
      expect(el.hasAttribute('data-view-as')).toBe(false);
      expect(el.querySelectorAll('.sem-quiz-options')).toHaveLength(0);
      expect(current(el)).toBeNull();
      expect(cards(el)).toHaveLength(3);
    });
  });
});
