/**
 * npl/shared — the shared helpers for the `npl-*` component namespace.
 *
 * Deliberately tiny: SemElement (../base.ts) already owns the heavy shared
 * behavior (light-DOM render root, `data-sem-upgraded` claim, afterParse,
 * whenChildrenReady, token parsing, audience). What NPL components add on
 * top is three small things, none of which warrant a new dependency:
 *
 *   - nplParam      read a parameter in either authoring spelling
 *                   (`data-<name>` wins over bare `<name>`, the same rule
 *                   the vocabulary CSS and extraction follow — shared/attr.ts).
 *   - nplEmit       dispatch the bubbling, composed `npl-<name>` CustomEvent
 *                   (same event contract SemElement.emit gives the sem-* tier).
 *   - defineNpl     idempotent customElements.define that refuses tags
 *                   outside the `npl-` namespace (SemElement.register with
 *                   a prefix guard, so a typo cannot squat the sem- space).
 *
 * The light-DOM render pattern is not a helper — it is inherited: extend
 * SemElement, which returns `this` from createRenderRoot. No shadow DOM and
 * no `static styles`, ever: content must stay searchable, copyable and
 * styleable by plain theme CSS (PRD §4 rule 5, conventions.md §4 rule 3).
 */

import { param } from '../../shared/attr.js';

/**
 * Read parameter `name` on `el` in either authoring form; `data-<name>`
 * wins when both are present (spec/conventions.md §2). With `fallback`,
 * returns it instead of null when neither spelling is authored.
 */
export function nplParam(el: Element, name: string): string | null;
export function nplParam(el: Element, name: string, fallback: string): string;
export function nplParam(el: Element, name: string, fallback?: string): string | null {
  const value = param(el, name);
  return value ?? fallback ?? null;
}

/**
 * Dispatch `npl-<name>` as a bubbling, composed CustomEvent — the same
 * reach a sem-* event has (crosses shadow boundaries, host apps hear it).
 * Returns dispatchEvent's result (false when a listener cancelled it).
 */
export function nplEmit<T>(el: Element, name: string, detail?: T): boolean {
  return el.dispatchEvent(
    new CustomEvent<T>(`npl-${name}`, { bubbles: true, composed: true, detail: detail as T }),
  );
}

/**
 * Idempotent registration for an NPL component. Same semantics as
 * SemElement.register (standalone documents may inline the bundle twice)
 * plus the namespace guard: the tag must start with `npl-`.
 */
export function defineNpl(tag: string, ctor: CustomElementConstructor): void {
  if (!tag.startsWith('npl-')) {
    throw new TypeError(`defineNpl: NPL components register npl-* tags; got "${tag}"`);
  }
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, ctor);
}
