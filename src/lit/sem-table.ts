import { SemElement } from './base.js';
import { enhanceTableElement } from '../reading/table.js';

/**
 * sem-table — thin Lit wrapper over src/reading/table.ts. Lifecycle only:
 * waits for its <table>, then runs the same idempotent enhance the bundle
 * uses (rows stamped once, chrome once).
 */
export class SemTable extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    void this.whenChildrenReady(':scope > table').then(() => {
      enhanceTableElement(this);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-table', SemTable);
