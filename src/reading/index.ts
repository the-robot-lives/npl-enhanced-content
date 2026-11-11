/**
 * SemText — prose-reading handlers (one-bundle surface, spec v0.6).
 *
 * sem-code chrome, sem-references previews and backlinks, glossary-mode
 * sem-properties previews, and (R/W2) the sem-reader chrome and sem-table
 * sort/filter. The handlers no longer ship alone: `src/index.ts` imports
 * them into `dist/semtext.js` — the former standalone
 * `semtext-reading.js` is retired. Each handler marks what it wired with
 * `data-sem-upgraded` and skips elements that already carry it: the Lit
 * component (src/lit/sem-code.ts etc.) imports the same per-element
 * enhance function and calls it itself. The per-element functions are
 * idempotent on DOM state, not on a marker, so either caller may run
 * first. HISTORY: the former bundle's 14/19.5 KB budgets are recorded in
 * ROADMAP.md; the handlers share the single bundle budget now.
 */

import { CODE, enhanceCodeElement } from './code.js';
import { REFERENCES, enhanceReferencesElement } from './references.js';
import { PROPERTIES, enhanceGlossaryElement } from './glossary.js';
import { READER, enhanceReaderElement, disposeReaderElement } from './reader.js';
import { TABLE, enhanceTableElement } from './table.js';
import { SOURCE, enhanceSourceElement } from './source.js';
import { DATA_SOURCE, DATA_VISUALIZER, enhanceDataVisualizerElement } from './data.js';
import { SEE_ALSO, applySeeAlsoDeepLink, enhanceSeeAlsoElement } from './see-also.js';

const upgraded = (el: Element): boolean => el.hasAttribute('data-sem-upgraded');

export function enhanceCode(scope: ParentNode): void {
  scope.querySelectorAll(CODE).forEach((el) => {
    if (upgraded(el)) return;
    enhanceCodeElement(el);
    if (el.querySelector(':scope > .sem-code-chrome')) el.setAttribute('data-sem-upgraded', '');
  });
}

export function enhanceReferences(scope: ParentNode): void {
  scope.querySelectorAll(REFERENCES).forEach((el) => {
    if (upgraded(el)) return;
    enhanceReferencesElement(el);
    el.setAttribute('data-sem-upgraded', '');
  });
}

export function enhanceGlossary(scope: ParentNode): void {
  scope.querySelectorAll(PROPERTIES).forEach((el) => {
    if (upgraded(el)) return;
    if (enhanceGlossaryElement(el)) el.setAttribute('data-sem-upgraded', '');
  });
}

export function enhanceTable(scope: ParentNode): void {
  scope.querySelectorAll(TABLE).forEach((el) => {
    if (upgraded(el)) return;
    enhanceTableElement(el);
    if (el.querySelector(':scope > .sem-table-chrome')) el.setAttribute('data-sem-upgraded', '');
  });
}

export function enhanceSource(scope: ParentNode): void {
  scope.querySelectorAll(SOURCE).forEach((el) => {
    if (upgraded(el)) return;
    enhanceSourceElement(el);
    if (el.querySelector(':scope > .sem-source-chrome')) el.setAttribute('data-sem-upgraded', '');
  });
}

export function enhanceData(scope: ParentNode): void {
  scope.querySelectorAll(DATA_VISUALIZER).forEach((el) => {
    if (upgraded(el)) return;
    enhanceDataVisualizerElement(el);
    if (el.querySelector(':scope > ' + DATA_SOURCE + ' > :is(.sem-data-body, .sem-data-error, .sem-data-pending)')) {
      el.setAttribute('data-sem-upgraded', '');
    }
  });
}

/** see-also — previews/modal/deep-link wiring (runs before the reader). */
export function enhanceSeeAlso(scope: ParentNode): void {
  scope.querySelectorAll(SEE_ALSO).forEach((el) => {
    if (upgraded(el)) return;
    enhanceSeeAlsoElement(el);
    el.setAttribute('data-sem-upgraded', '');
  });
  if (scope === document) applySeeAlsoDeepLink();
}

/** The reader runs LAST: its outline reads the headings other handlers leave alone. */
export function enhanceReader(scope: ParentNode): void {
  scope.querySelectorAll(READER).forEach((el) => {
    if (upgraded(el)) return;
    enhanceReaderElement(el);
    if (el.querySelector(':scope > .sem-reader-chrome')) el.setAttribute('data-sem-upgraded', '');
  });
}

export const handlers = [enhanceCode, enhanceReferences, enhanceGlossary, enhanceTable, enhanceData, enhanceSeeAlso, enhanceSource, enhanceReader];

/** Run every reading handler over a scope. */
export function enhance(scope: ParentNode = document): void {
  if (scope === document) document.documentElement.setAttribute('data-sem-upgraded', '');
  for (const handler of handlers) handler(scope);
}

export { enhanceCodeElement, enhanceReferencesElement, enhanceGlossaryElement, enhanceTableElement, enhanceDataVisualizerElement, enhanceSeeAlsoElement, enhanceSourceElement, enhanceReaderElement, disposeReaderElement };
