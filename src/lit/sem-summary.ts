import { SemElement } from './base.js';

/**
 * sem-summary — summary container (spec/schema/sem-summary.md).
 *
 * Family A display stub: like sem-tldr it carries NO summary logic —
 * authored children are the summary, rendered as-is. sem-summary is the
 * heavier document-level wrap (executive summary / section digest)
 * versus sem-tldr's light skim block. The component only registers and
 * claims `data-sem-upgraded`. Ships in the core bundle via the
 * src/index.ts barrel.
 */
export class SemSummary extends SemElement {}
SemElement.register('sem-summary', SemSummary);
