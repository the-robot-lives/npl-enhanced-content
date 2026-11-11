import { SemElement } from './base.js';

/**
 * SemCallout — shared base for the labelled-block callouts (sem-tldr,
 * sem-summary). Registers nothing (a shared chunk for the lazy scanner).
 *
 * The callout chrome (rail, box, label) is the vocabulary CSS `::before`,
 * outside textContent. After the parse the component labels the block for
 * assistive tech: `role="note"` + `aria-label` = calloutLabel(); an
 * authored role / aria-label always wins. Children are never touched.
 */
export class SemCallout extends SemElement {
  /** The accessible name; subclasses override. */
  calloutLabel(): string {
    return '';
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.afterParse('callout', () => {
      if (!this.hasAttribute('role')) this.setAttribute('role', 'note');
      if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', this.calloutLabel());
    });
  }
}
