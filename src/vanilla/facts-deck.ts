/**
 * vanilla/facts-deck — the ONE flashcard/quiz deck wiring, shared by both
 * tiers (src/vanilla/facts.ts calls it for class-alias/JS-driven markup,
 * src/lit/sem-facts.ts for the custom element). One implementation ends
 * the historical two-copy drift (this file's 0.9.0 header documented a
 * verbatim extraction that had already diverged once).
 *
 * 0.9.1 contract (SEMTEX-003 / SEMTEX-004):
 *
 *   flashcards — ONE card at a time in a SEEDED SHUFFLED order; click (or
 *   Enter/Space) flips; while flipped the card shows ✓ Got it / ✗ Wrong
 *   buttons that record and advance to the next unanswered card; the
 *   chrome meter is an INDEX of the deck (one numbered chip per card —
 *   current highlighted, answered chips tinted by their verdict) instead
 *   of a `n/N` count; prev/next walk the shuffled order; when every card
 *   carries a verdict a summary line reports the total ("You got X of N")
 *   with a Restart control.
 *
 *   quiz — options in a seeded shuffled order on thin-bordered buttons;
 *   a wrong pick marks THAT button (✗, spent) and play continues — the
 *   reader keeps picking until the correct option lands (✓); the correct
 *   pick auto-advances after 500 ms; the meter tracks `k/N · score G/A`
 *   where G counts questions answered correctly on the first pick.
 *
 * The seeded draws come from shared/rng (Fisher-Yates over `randomFor`),
 * so a fixed `data-sem-seed` yields the same card order and option order
 * in both tiers.
 */

import { randomFor, shuffle } from '../shared/rng.js';
import { sel, part } from '../shared/sel.js';

const CONCLUSION = part('conclusion');
const ADVANCE_DELAY_MS = 500;

type Verdict = 'got' | 'miss';

export function wireFactsDeck(
  root: HTMLElement,
  items: HTMLElement[],
  view: 'flashcards' | 'quiz',
): void {
  const rand = randomFor(root);
  const n = items.length;

  // Flashcards walk a shuffled deck; the quiz keeps authored question order
  // (only its OPTIONS are randomized) — that reading of the two tickets keeps
  // deep links (`#deck/fact-id`) landing where the author put them.
  const positions: number[] = view === 'flashcards' ? shuffle(items.map((_, k) => k), rand) : items.map((_, k) => k);
  const posOf = new Map<number, number>(); // original index -> position
  positions.forEach((cardIdx, pos) => posOf.set(cardIdx, pos));

  let pos = 0;
  // .fill materializes the slots: `new Array(n)` is SPARSE, and every()
  // skips holes — an untouched deck would read "all answered" (the 0.9.1
  // test suite caught exactly that).
  const results: (Verdict | undefined)[] = new Array(n).fill(undefined);
  let timer = 0;

  const chrome = document.createElement('div');
  chrome.className = 'sem-facts-chrome';
  chrome.innerHTML =
    '<button type="button" data-act="prev" aria-label="previous">←</button>' +
    '<span class="sem-facts-meter" role="list"></span>' +
    '<button type="button" data-act="next" aria-label="next">→</button>';
  root.insertBefore(chrome, root.firstChild);
  const meter = chrome.querySelector<HTMLElement>('.sem-facts-meter') as HTMLElement;

  const score = (): { got: number; answered: number } => {
    let got = 0;
    let answered = 0;
    results.forEach((r) => {
      if (r) {
        answered++;
        if (r === 'got') got++;
      }
    });
    return { got, answered };
  };

  const answeredAll = (): boolean => results.every(Boolean);

  /* ── flashcard index chips ── */
  const chips: HTMLButtonElement[] = [];
  if (view === 'flashcards') {
    for (let k = 0; k < n; k++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.setAttribute('role', 'listitem');
      chip.textContent = String(k + 1);
      chip.setAttribute('aria-label', 'Card ' + (k + 1));
      chip.addEventListener('click', () => {
        if (answeredAll()) return;
        pos = k;
        render();
      });
      chips.push(chip);
      meter.appendChild(chip);
    }
  }

  /* ── summary (flashcards end state) ── */
  const summary = document.createElement('div');
  summary.className = 'sem-facts-summary';
  summary.hidden = true;
  const summaryText = document.createElement('span');
  summaryText.className = 'sem-facts-score-text';
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.textContent = 'Restart';
  restart.setAttribute('data-act', 'restart');
  summary.appendChild(summaryText);
  summary.appendChild(restart);
  root.insertBefore(summary, chrome.nextSibling);

  /* ── flashcard verdict buttons ── */
  if (view === 'flashcards') {
    items.forEach((f) => {
      const verdict = document.createElement('div');
      verdict.className = 'sem-facts-verdict';
      (['got', 'miss'] as const).forEach((kind) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-verdict', kind);
        b.textContent = kind === 'got' ? '✓ Got it' : '✗ Wrong';
        b.addEventListener('click', (e) => {
          e.stopPropagation(); // a verdict click is not a flip
          const cardIdx = items.indexOf(f);
          results[cardIdx] = kind;
          advance();
        });
        verdict.appendChild(b);
      });
      f.appendChild(verdict);
    });
  }

  /* ── quiz options ── */
  const optionsFor = (item: HTMLElement): { text: string; correct: boolean }[] => {
    const correct = item.querySelector(CONCLUSION);
    const distractors = Array.from(item.querySelectorAll(part('incorrect-statement')));
    const others = items
      .filter((f) => f !== item)
      .map((f) => f.querySelector(CONCLUSION))
      .filter(Boolean) as Element[];
    const opts = distractors.concat(others).slice(0, 3).concat([correct as Element]);
    return shuffle(opts, rand).map((el) => ({
      text: (el.textContent || '').trim(),
      correct: el === correct,
    }));
  };

  const advance = (): void => {
    // next unanswered position from pos+1, wrapping
    for (let step = 1; step <= n; step++) {
      const p = (pos + step) % n;
      if (!results[positions[p]]) {
        pos = p;
        render();
        return;
      }
    }
    render(); // everything answered -> summary
  };

  const renderQuiz = (item: HTMLElement): void => {
    let box = item.querySelector('.sem-quiz-options') as HTMLElement | null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'sem-quiz-options';
      item.appendChild(box);
    }
    const target = box;
    target.innerHTML = '';
    target.removeAttribute('data-answered');
    let misses = 0;
    optionsFor(item).forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.text;
      b.setAttribute('data-correct', String(o.correct));
      b.addEventListener('click', () => {
        if (o.correct) {
          b.classList.add('sem-answered');
          target.setAttribute('data-answered', '');
          const cardIdx = items.indexOf(item);
          results[cardIdx] = misses === 0 ? 'got' : 'miss';
          timer = window.setTimeout(advance, ADVANCE_DELAY_MS);
        } else {
          // keep going: the spent option marks and dims, the box stays open
          misses++;
          b.classList.add('sem-wrong-pick');
          b.disabled = true;
        }
        const s = score();
        meter.textContent = (pos + 1) + '/' + n + ' · score ' + s.got + '/' + s.answered;
      });
      target.appendChild(b);
    });
  };

  function render(): void {
    window.clearTimeout(timer);
    const done = answeredAll();
    summary.hidden = !done;
    if (done) {
      const s = score();
      summaryText.textContent = 'You got ' + s.got + ' of ' + n + '. ';
      items.forEach((f) => f.classList.remove('sem-current', 'sem-flipped'));
    } else {
      const cardIdx = positions[pos];
      items.forEach((f, k) => {
        const current = view === 'flashcards' ? k === cardIdx : k === positions[pos];
        f.classList.toggle('sem-current', current);
        f.classList.remove('sem-flipped');
        if (view === 'flashcards') {
          f.tabIndex = current ? 0 : -1;
          f.setAttribute('aria-expanded', 'false');
        }
      });
      if (view === 'quiz') renderQuiz(items[positions[pos]]);
    }
    if (view === 'flashcards') {
      chips.forEach((chip, k) => {
        const cardIdx = positions[k];
        chip.setAttribute('aria-current', String(!done && k === pos));
        const r = results[cardIdx];
        chip.classList.toggle('sem-facts-done', Boolean(r));
        if (r) chip.setAttribute('data-verdict', r);
        else chip.removeAttribute('data-verdict');
      });
    } else {
      const s = score();
      meter.textContent = (pos + 1) + '/' + n + ' · score ' + s.got + '/' + s.answered;
    }
  }

  chrome.addEventListener('click', (e) => {
    const t = e.target as Element;
    const act = t.getAttribute && t.getAttribute('data-act');
    if (!act || answeredAll()) return;
    if (act === 'prev') { pos = (pos - 1 + n) % n; render(); }
    if (act === 'next') { pos = (pos + 1) % n; render(); }
  });

  // Restart lives in the summary line (outside the chrome row), so it gets
  // its own listener — a deck in the summary state ignores prev/next.
  restart.addEventListener('click', () => {
    results.fill(undefined);
    pos = 0;
    render();
  });

  // flip: click anywhere on the card (verdict buttons stopPropagation above)
  if (view === 'flashcards') {
    items.forEach((f) => {
      const flip = () => {
        if (answeredAll()) return;
        f.setAttribute('aria-expanded', String(f.classList.toggle('sem-flipped')));
      };
      f.addEventListener('click', flip);
      f.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        if (k.key === 'Enter' || k.key === ' ') {
          k.preventDefault(); // Space must flip, not scroll
          flip();
        }
      });
    });
  }

  // Deep link into a card (target handler): make it the current one.
  root.addEventListener('sem-activate', (e) => {
    if (answeredAll()) return;
    const k = items.indexOf(e.target as HTMLElement);
    const p = posOf.get(k);
    if (p !== undefined && p !== pos) { pos = p; render(); }
  });

  render();
}
