import { SemElement } from './base.js';
import { enhanceGlossaryElement } from '../reading/glossary.js';

/**
 * sem-properties — thin Lit wrapper. The definition list is CSS-only in
 * every tier; the only behaviour is glossary mode (view-as="glossary"),
 * which wires term anchors to a preview via src/reading/glossary.ts. The
 * duplicate-key diagnostic stays with the fallback core.
 */
export class SemProperties extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.#wired = true;
    void this.whenChildrenReady(':scope > :is(sem-property, .sem-property)').then(() => {
      enhanceGlossaryElement(this);
      this.setAttribute('data-sem-upgraded', '');
    });
  }
}

SemElement.register('sem-properties', SemProperties);
