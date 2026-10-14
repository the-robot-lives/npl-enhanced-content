import { SemElement } from './base.js';
import { enhanceCodeElement } from '../reading/code.js';

/**
 * sem-code — thin Lit wrapper over the reading bundle's enhance function.
 *
 * One behaviour implementation (src/reading/code.ts) serves both tiers:
 * this element only owns the lifecycle. SemElement claims
 * `data-sem-upgraded` on connect; once the `<pre>` child exists the same
 * idempotent enhance runs, so a document that also loaded the reading
 * bundle still renders exactly one chrome.
 */
export class SemCode extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    void this.whenChildrenReady(':scope > pre').then(() => {
      enhanceCodeElement(this);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-code', SemCode);
