import { SemElement } from './base.js';
import { BindableElement } from './bind.js';
import { param } from '../shared/attr.js';

/**
 * sem-procedure — ordered, status-annotated steps (spec/schema/
 * sem-procedure.md).
 *
 * Graduated from the claim stubs to carry the sem-bind payload intake:
 * `{plan, status}` — the plan markup (optional) becomes the body and the
 * per-step status dictionary (`complete|pending|error|skipped|none` +
 * comment + choice) lands on the authored / fetched `sem-step` children,
 * mapped onto the vocabulary status catalog (`done|todo|blocked`) with
 * `data-sem-bind-status` carrying the exact payload spelling.
 *
 * Render (enhanced tier): a `.sem-procedure-meta` progress line prepended
 * as chrome — "2 of 4 done · 1 blocked" — plus `data-blocked` on the
 * container when any step is blocked (spec: a procedure with a blocked
 * step is itself blocked — derivable, never authored). Recomputed when a
 * step's status changes or steps arrive. Zero-JS rendering is unchanged:
 * status is an attribute, ordinals are CSS counters; the meta line is
 * extraction chrome (spec/extraction.md §3 rule 4).
 */
export class SemProcedure extends BindableElement {
  #mo?: MutationObserver;

  connectedCallback(): void {
    super.connectedCallback();
    void this.whenChildrenReady(':scope > :is(sem-step, .sem-step)').then(() => {
      this.#tally();
      this.#mo = new MutationObserver(() => this.#tally());
      this.#mo.observe(this, { subtree: true, childList: true, attributeFilter: ['status', 'data-status'] });
    });
  }

  disconnectedCallback(): void {
    this.#mo?.disconnect();
    super.disconnectedCallback();
  }

  #tally(): void {
    const steps = Array.from(this.querySelectorAll(':scope > :is(sem-step, .sem-step)'));
    if (!steps.length) return;
    const n = (s: string) => steps.filter((el) => param(el, 'status') === s).length;
    const blocked = n('blocked');
    const text = `${n('done')} of ${steps.length} done${blocked ? ` · ${blocked} blocked` : ''}`;
    this.toggleAttribute('data-blocked', blocked > 0);
    let meta = this.querySelector(':scope > .sem-procedure-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'sem-procedure-meta';
      meta.setAttribute('aria-live', 'polite');
      this.prepend(meta);
    }
    if (meta.textContent !== text) meta.textContent = text;
  }
}
// The build's lazy-chunk scanner keys on this literal (see sem-progress.ts).
SemElement.register('sem-procedure', SemProcedure);
