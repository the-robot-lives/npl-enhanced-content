import { SemElement } from './base.js';
import { randomFor, shuffle } from '../shared/rng.js';
import { sel } from '../shared/sel.js';

const OPTION = ':scope > ' + sel('option');

/**
 * sem-question — the quiz block (SEMTEX-009: shipped 0.9.1; before this
 * module the glossary element rendered as plain HTML — no component, no
 * interactivity, the site's bundle map reported `shipped: false`).
 *
 * Light DOM per PRD §4 rule 5: the authored prompt (any child carrying
 * `data-kind="prompt"`, else the first element child) stays in place; each
 * direct `sem-option` (class alias `.sem-option`) becomes a thin-bordered
 * button in a generated `.sem-question-options` row — options in a seeded
 * shuffled order (shared/rng, same draw family as the decks), the authored
 * elements hidden by a marker-gated vocabulary rule (D12) so JS-off keeps
 * them readable.
 *
 * Interaction: a wrong pick marks THAT button (✗, spent, disabled) and the
 * question stays open — the reader keeps picking until the correct option
 * lands (✓), matching the 0.9.1 deck contract (SEMTEX-004). A `retry`
 * attribute adds a Retry control that resets and redraws (same seed, same
 * order). `type` (mc | tf | …) is accepted and currently renders as
 * single-pick multiple choice for every value; the other quiz families are
 * future work (glossary: sem-question).
 *
 * sem-option itself registers here as a claim stub — it has no behaviour
 * of its own; the parent question consumes it.
 */
export class SemQuestion extends SemElement {
  #wired = false;
  #awaiting = false;

  updated(): void {
    if (this.#wired) return;
    const options = Array.from(this.querySelectorAll<HTMLElement>(OPTION));
    if (options.length === 0) {
      this.#awaitOptions();
      return;
    }
    this.#wired = true;
    this.setAttribute('data-quiz', this.getAttribute('type') || 'mc');
    this.setAttribute('data-sem-upgraded', '');

    const rand = randomFor(this);
    const correct = options.find((o) => o.hasAttribute('correct') || o.hasAttribute('data-correct'));

    // a host that copies wired DOM (clone/innerHTML round-trip) may carry a
    // stale generated row — purge it so exactly one options row exists
    this.querySelectorAll(':scope > .sem-question-options').forEach((stale) => stale.remove());
    const row = document.createElement('div');
    row.className = 'sem-question-options';
    this.appendChild(row);

    let answered = false;
    const buttons: HTMLButtonElement[] = [];
    const finish = (): void => {
      answered = true;
      buttons.forEach((b) => (b.disabled = true));
      if (this.hasAttribute('retry')) {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'sem-question-retry';
        again.textContent = 'Retry';
        again.addEventListener('click', () => reset());
        row.appendChild(again);
      }
    };
    const reset = (): void => {
      answered = false;
      row.innerHTML = '';
      build();
    };
    const build = (): void => {
      shuffle(options, rand).forEach((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sem-question-option';
        b.textContent = (o.textContent || '').trim();
        b.setAttribute('data-correct', String(o === correct));
        b.addEventListener('click', () => {
          if (answered) return;
          if (o === correct) {
            b.classList.add('sem-answered');
            finish();
          } else {
            b.classList.add('sem-wrong-pick');
            b.disabled = true;
          }
        });
        buttons.push(b);
        row.appendChild(b);
      });
    };
    build();
  }

  #awaitOptions(): void {
    if (this.#awaiting) return;
    this.#awaiting = true;
    void this.whenChildrenReady(OPTION).then(() => {
      this.#awaiting = false;
      this.requestUpdate();
    });
  }
}

SemElement.register('sem-question', SemQuestion);

// sem-option: consumed by the parent question; the registration exists so
// the vocabulary answers customElements.get() for every sem tag and the
// option never upgrades to anything on its own.
export class SemOption extends SemElement {}
SemElement.register('sem-option', SemOption);
