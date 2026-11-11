import { SemElement } from './base.js';
import { SemCallout } from './callout.js';

/**
 * sem-tldr — light skim callout (spec/schema/sem-tldr.md).
 *
 * The callout chrome (accent rail, tinted box, "TL;DR" label) is the
 * vocabulary CSS — `::before`, outside textContent, so the extraction
 * invariant holds byte-for-byte and the .nojs artifact draws the same box.
 * The enhanced render adds what CSS cannot give assistive tech: after
 * the parse the block becomes a labelled callout — `role="note"` and an
 * `aria-label` naming it (an authored role / aria-label always wins).
 * Children are never touched (src/lit/callout.ts, shared with sem-summary).
 */
export class SemTldr extends SemCallout {
  calloutLabel(): string {
    return 'TL;DR';
  }
}
SemElement.register('sem-tldr', SemTldr);
