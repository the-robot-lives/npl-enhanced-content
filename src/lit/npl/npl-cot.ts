import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-cot — chain-of-thought steps from an NPL `cot` block.
 *
 * Children contract (spec/schema/npl/cot.md): thought_process steps —
 * any element child not marked as the outcome (conventionally `sem-step`)
 * — plus at most one outcome element, marked with the `outcome` (or
 * `data-outcome`) attribute. `collapsed` (boolean, default false) sets
 * the initial open state.
 *
 * Rendered chrome is a native `<details>` (+ `<summary>`): once upgraded
 * the open/close toggle is browser behavior, no JS behind it — and with
 * JS off nothing is generated or hidden, the authored steps/outcome read
 * as plain blocks (the vocabulary npl section gives the host its box).
 * Authored children are light DOM and are MOVED into the generated hosts
 * (`.npl-cot-steps` inside the details, `.npl-cot-outcome-slot` after it,
 * so the outcome stays visible while the steps are collapsed).
 */

const DETAILS = 'npl-cot-details';
const STEPS = 'npl-cot-steps';
const OUTCOME_SLOT = 'npl-cot-outcome-slot';

/** The outcome element carries `outcome` / `data-outcome` (dual form). */
const isOutcome = (el: Element): boolean => nplParam(el, 'outcome') !== null;

export class NplCot extends SemElement {
  static properties = {
    collapsed: { type: Boolean, reflect: true },
  };

  declare collapsed: boolean;

  #wired = false;
  #awaitingChildren = false;
  #stepCount = 0;

  constructor() {
    super();
    this.collapsed = false;
  }

  updated(): void {
    // dual-form contract: mirror the boolean to the data-* spelling once
    // past parse, same deferral as the label mirror in npl-example.
    this.afterParse('collapsed', () => this.setAttribute('data-collapsed', String(this.collapsed)));
    if (this.#wired) return;
    const authored = this.#authored();
    if (authored.length === 0) {
      // upgraded pre-parse: wait for the real children, then move them.
      this.#awaitChildren();
      return;
    }
    this.#move(authored);
  }

  render() {
    const steps = this.#count();
    return html`<details class="${DETAILS}" ?open=${!this.collapsed}>
      <summary class="npl-cot-summary">Chain of thought (${steps} step${steps === 1 ? '' : 's'})</summary>
      <div class="${STEPS}"></div>
    </details>
    <div class="${OUTCOME_SLOT}"></div>`;
  }

  /** Authored children: every element child except this class's chrome. */
  #authored(): Element[] {
    return Array.from(this.children).filter(
      (el) => !el.classList.contains(DETAILS) && !el.classList.contains(OUTCOME_SLOT),
    );
  }

  /** Live step count — before the move (first render) and after. */
  #count(): number {
    if (this.#wired) return this.#stepCount;
    return this.#authored().filter((el) => !isOutcome(el)).length;
  }

  /** Editor rerender seam (EDITOR.md §4.4): re-home authored children into
   *  the step/outcome chrome after a controller re-projection. */
  rehome(): void {
    this.#move(this.#authored());
  }

  #move(authored: Element[]): void {
    const steps = authored.filter((el) => !isOutcome(el));
    const outcome = authored.find(isOutcome) ?? null;
    this.#stepCount = steps.length;
    const stepsHost = this.querySelector('.' + STEPS);
    const slot = this.querySelector('.' + OUTCOME_SLOT);
    if (!stepsHost || !slot) return;
    steps.forEach((el) => stepsHost.appendChild(el));
    if (outcome) slot.appendChild(outcome);
    this.#wired = true;
    // the streamed-in path renders its chrome before the move; refresh the
    // summary count (a no-op diff on the synchronous path).
    this.requestUpdate();
  }

  #awaitChildren(): void {
    if (this.#awaitingChildren) return;
    this.#awaitingChildren = true;
    void this.whenChildrenReady(
      `:scope > :not(.${DETAILS}):not(.${OUTCOME_SLOT})`,
    ).then(() => {
      this.#awaitingChildren = false;
      const authored = this.#authored();
      if (authored.length > 0) this.#move(authored);
    });
  }
}

defineNpl('npl-cot', NplCot);

/** Editor seam — see NplCot.rehome. */
export function enhanceCotElement(el: Element): void {
  if (el instanceof NplCot) el.rehome();
}
