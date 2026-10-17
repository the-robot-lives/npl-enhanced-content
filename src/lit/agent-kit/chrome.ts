/**
 * agent-kit/chrome — the authored-derived chrome helpers shared by the
 * `agent-kit-*` components.
 *
 * Every node a component fabricates lives inside ONE container marked
 * `data-sem-chrome` and classed `agent-kit-chrome`:
 *
 *   - the extraction walker skips chrome subtrees whole (src/extract/
 *     records.ts lists `agent-kit-chrome` in CHROME_CLASSES), so the §8
 *     invariant — JS-off extraction deep-equals JS-on extraction — holds
 *     by construction, whatever the chrome renders;
 *   - the base CachedEmbedElement runs the same contract for its
 *     snapshot-derived container (`sem-cached-embed-chrome`, also
 *     listed), so a component's two chrome layers never disagree.
 *
 * `akitChrome` renders INTO the container with Lit's `render` (the light
 * DOM contract: no shadow root, theme CSS reaches everything), gated on
 * the element's `data-sem-upgraded` claim — with JavaScript off nothing
 * here runs and the view is exactly what was authored.
 */

import { render, type TemplateResult } from 'lit';
import type { SemElement } from '../base.js';

/** The one chrome-marker class every fabricated agent-kit node inherits. */
export const AKIT_CHROME = 'agent-kit-chrome';

/**
 * Render (or re-render) the element's authored-derived chrome container.
 * `cls` is the family-specific class alongside `agent-kit-chrome`
 * (`.agent-kit-ticket-chrome` etc. — theme CSS keys on it). Renders only
 * under the upgrade claim; a later call replaces the container's content,
 * never the authored children.
 */
export function akitChrome(
  el: SemElement,
  cls: string,
  body: () => TemplateResult,
): void {
  if (!el.hasAttribute('data-sem-upgraded')) return;
  let box = el.querySelector<HTMLDivElement>(
    `:scope > .${AKIT_CHROME}.${cls}`,
  );
  if (!box) {
    box = el.ownerDocument.createElement('div');
    box.className = `${AKIT_CHROME} ${cls}`;
    box.setAttribute('data-sem-chrome', '');
    el.append(box);
  }
  try {
    render(body(), box);
  } catch (err) {
    // A chrome bug must never take the authored record down with it.
    el.warn(`agent-kit: chrome render failed (${err instanceof Error ? err.message : String(err)}) — the authored children remain`);
    box.remove();
  }
}

/**
 * First authored part element, in either spelling: the `<agent-kit-x>`
 * tag form or the `.agent-kit-x` class form (conventions Appendix A).
 * `local` is the full local part name (`agent-kit-title`).
 */
export function akitPart(el: Element, local: string): Element | null {
  return el.querySelector(local + ', .' + local);
}

/** Normalized text of an authored part, or '' when absent. */
export function akitPartText(el: Element, local: string): string {
  const part = akitPart(el, local);
  return (part?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** All authored part elements of one kind, in document order. */
export function akitParts(el: Element, local: string): Element[] {
  return Array.from(el.querySelectorAll(local + ', .' + local));
}
