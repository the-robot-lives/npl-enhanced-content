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
    if (this.querySelector(':scope > *')) {
      void this.whenChildrenReady(':scope > *').then(() => this.#enhance());
    } else {
      this.#enhance();
    }
  }

  #enhance(): void {
    if (this.#wired) return;
    this.#wired = true;
    enhanceSeeAlsoElement(this);
    this.setAttribute('data-sem-upgraded', '');
  }
}

SemElement.register('sem-see-also', SemSeeAlso);
