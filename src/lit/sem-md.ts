import { SemElement } from './base.js';
import { enhanceMdElement } from '../md/element.js';
import { enhanceCodeElement } from '../reading/code.js';

/**
 * sem-md — thin Lit wrapper over the Markdown bundle's enhance function.
 *
 * One behaviour implementation (src/md/element.ts) serves both tiers: this
 * element only owns the lifecycle. SemElement claims `data-sem-upgraded`
 * on connect, so the bundle's document scan skips the element; once the
 * document has finished parsing (the content is text, so there is no child
 * element to wait for) the same idempotent enhance runs here.
 */
export class SemMd extends SemElement {
  /** Runs after every connect (Lit updates on reconnect too); the enhance
   *  is idempotent on DOM state, so no latch — a reconnect re-arms it. */
  updated(): void {
    // afterParse: the content is text, so there is no child element to
    // wait for, but writes must not land mid-parse (sem-source snapshots).
    this.afterParse('enhance', () => {
      enhanceMdElement(this, enhanceCodeElement);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-md', SemMd);
