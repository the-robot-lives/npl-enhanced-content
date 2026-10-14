import { SemElement } from './base.js';
import { enhanceReferencesElement } from '../reading/references.js';

/**
 * sem-references — thin Lit wrapper over src/reading/references.ts.
 * Lifecycle only: claims the upgrade marker, waits for its reference
 * children, then runs the same idempotent enhance the bundle uses.
 */
export class SemReferences extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    void this.whenChildrenReady(':scope > :is(sem-reference, .sem-reference)').then(() => {
      enhanceReferencesElement(this);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-references', SemReferences);
