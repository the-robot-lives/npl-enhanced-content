/**
 * agent-kit/shared — the `agent-kit-*` namespace's registration +
 * parameter helpers. Thin wrappers over the shared engine
 * (src/lit/shared/namespace.ts + shared/npl-alias.ts) so namespace code
 * never spells the prefix twice; `defineAkit` carries the same idempotent,
 * claim-on-connect contract as `defineNpl` (src/lit/npl/shared.ts).
 *
 * `akitParam` mirrors `nplParam`: `data-<name>` is the mirror spelling
 * and wins over the bare attribute (conventions §2, dual form).
 */

import { defineInNamespace } from '../shared/namespace.js';

/** Idempotent registration guard for `agent-kit-*` tags. */
export function defineAkit(tag: string, ctor: CustomElementConstructor): void {
  defineInNamespace('agent-kit', tag, ctor);
}

/** Resolve the `<name>` / `data-<name>` dual form: `data-<name>` wins. */
export function akitParam(el: Element, name: string): string | null {
  if (el.hasAttribute(`data-${name}`)) return el.getAttribute(`data-${name}`);
  return el.getAttribute(name);
}

/** Emit a namespace-scoped detail event (`agent-kit:<name>`). */
export function akitEmit(el: Element, name: string, detail: unknown): void {
  el.dispatchEvent(new CustomEvent(`agent-kit:${name}`, { detail, bubbles: true, composed: true }));
}
