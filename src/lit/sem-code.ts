import { SemElement } from './base.js';
import { enhanceCodeElement } from '../reading/code.js';

/**
 * sem-code — thin Lit wrapper over the reading bundle's enhance function.
 *
 * One behaviour implementation (src/reading/code.ts) serves both tiers:
 * this element only owns the lifecycle. SemElement claims
 * `data-sem-upgraded` on connect; once its children are parsed the same
 * idempotent enhance runs, so a document that also loaded the reading
 * bundle still renders exactly one chrome. The enhance adopts the flat
 * authoring form (the listing as the element's own text, no `<pre>`
 * authored — spec/schema/sem-code.md) before building chrome, so authors
 * never nest `<pre><code>` by hand; the nested form keeps working as-is.
 */
export class SemCode extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    // Custom elements upgrade before their children parse, so neither the
    // subtree nor the text is necessarily complete yet. Two ways to wait
    // out the parse: an element child → whenChildrenReady (its
    // DOMContentLoaded gate applies); text only, or empty → DOMContentLoaded
    // directly (whenChildrenReady would wait on a selector that never
    // matches — the flat form has no element child to find).
    const settle = this.firstElementChild
      ? this.whenChildrenReady(':scope > *')
      : new Promise<Element[]>((resolve) => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => resolve([]), {
              once: true,
            });
          } else {
            resolve([]);
          }
        });
    void settle.then(() => {
      enhanceCodeElement(this);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-code', SemCode);
