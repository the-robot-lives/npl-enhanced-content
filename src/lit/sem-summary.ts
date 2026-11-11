import { SemElement } from './base.js';
import { SemCallout } from './callout.js';
import { param } from '../shared/attr.js';

/**
 * sem-summary — document-level summary callout (spec/schema/sem-summary.md).
 *
 * The heavier wrap (executive summary / section digest) versus sem-tldr's
 * light skim. Box + "summary · <kind>" label are vocabulary CSS (JS-off
 * identical); the enhanced render labels the callout for assistive tech —
 * `role="note"`, `aria-label="Summary"` / `"Summary · <kind>"` — exactly
 * as sem-tldr does (SemCallout). Authored children render as-is.
 */
export class SemSummary extends SemCallout {
  calloutLabel(): string {
    const kind = param(this, 'kind');
    return kind ? 'Summary · ' + kind : 'Summary';
  }
}
SemElement.register('sem-summary', SemSummary);
