import { SemElement } from './base.js';
import { enhanceSeeAlsoElement } from '../reading/see-also.js';

/**
 * sem-see-also — thin Lit wrapper over src/reading/see-also.ts.
 * Lifecycle only: waits for authored children (the label), then runs the
 * same idempotent enhance the bundle scan uses — popover preview, shared
 * modal, View-all affordance, `#ref=` deep link. Spec:
 * spec/schema/sem-see-also.md.
 */
export class SemSeeAlso extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    // Defer to after-parse (the sem-component pattern). The element
    // upgrades mid-parse — before the authored label (usually a bare TEXT
    // node) exists — and enhancing then minted an empty label clone
    // (0-width link, dead hover/click). whenChildrenReady is wrong here:
    // its `:scope > *` matches only ELEMENT children, so a text-only label
    // never resolves it. afterParse waits for DOMContentLoaded while the
    // document is loading and runs immediately once parsed.
    this.afterParse('sem-see-also-wire', () => this.#enhance());
  }

  #enhance(): void {
    if (this.#wired) return;
    this.#wired = true;
    enhanceSeeAlsoElement(this);
    this.setAttribute('data-sem-upgraded', '');
  }
}

SemElement.register('sem-see-also', SemSeeAlso);
