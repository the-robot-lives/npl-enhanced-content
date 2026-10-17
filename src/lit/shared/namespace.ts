/**
 * lit/shared/namespace — registration guard shared by the non-core
 * namespaces (`npl-*`, `semext-*`, `agent-kit-*`).
 *
 * Each namespace bundles its own entry (npl.js / semext.js / agent-kit.js)
 * and registers its components under a family prefix. The guard mirrors
 * the core `SemElement.register` semantics exactly (src/lit/base.ts):
 *
 *   - idempotent: a tag that already has a definition is left alone, so
 *     loading the namespace bundle after the core bundle (or after the
 *     lazy loader upgraded a subset) never throws and never re-binds a
 *     component the page already uses;
 *   - no `customElements` (SSR / pre-DOM import): a silent no-op — the
 *     registration happens when a real document loads the bundle;
 *   - prefix enforcement: a namespace entry only registers its own tags,
 *     so a typo'd tag (`semext-note` registered via defineAkit) fails
 *     loudly at boot instead of quietly squatting on another family.
 *
 * The `data-sem-upgraded` claim contract is NOT set here — components
 * claim it themselves in `SemElement.connectedCallback` (src/lit/base.ts),
 * which every namespace component extends. Registering through this guard
 * therefore carries the same claim contract as the `sem-*` family.
 */

/** Define `tag` under namespace `prefix`, once, or no-op when a
 *  definition already exists. Throws when `tag` does not start with
 *  `<prefix>-`. */
export function defineInNamespace(
  prefix: string,
  tag: string,
  ctor: CustomElementConstructor,
): void {
  if (!tag.startsWith(prefix + '-')) {
    throw new TypeError(
      `defineInNamespace: ${prefix}-* components register ${prefix}-* tags; got "${tag}"`,
    );
  }
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, ctor);
}
