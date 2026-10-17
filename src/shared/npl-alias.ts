/**
 * shared/npl-alias — upgrade class-form authoring aliases to tag form.
 *
 * The conventions promise every element can be authored in the v0.4 class
 * form — `<div class="npl-example" data-label="…">` with `data-*`
 * parameters (spec/conventions.md Appendix A; spec/schema/npl/TEMPLATE.md,
 * "Class-form alias … same dual-form contract as the sem-* tier"). The
 * sem-* namespace keeps that promise through the full bundle's vanilla
 * handlers, which enhance classed elements in place. Namespaces without a
 * vanilla tier (`npl-*` today, `semext-*` and `agent-kit-*` as they land
 * Lit components) have the Lit components ARE the rendering — this module
 * keeps the promise instead: it rewrites each alias element into its
 * canonical `<prefix-*>` tag, carrying every attribute and child across,
 * and lets the custom-element machinery do the rest. No parameter mapping
 * table is needed: components already read both spellings through their
 * namespace param helper (`data-<name>` wins), so copied `data-*`
 * attributes resolve exactly as authored.
 *
 * The engine is prefix-parameterized (`upgradeClassAliases`); the `npl`
 * wrappers below (`upgradeNplAliases`, `aliasTag`, `NPL_ALIAS_MARKER`)
 * are the historical spelling every npl call site already imports.
 *
 * Contract:
 *
 *   - JS off: nothing runs; the alias element stays authored prose in the
 *     vocabulary CSS block box (`prefix-x, .prefix-x { display: block; }`
 *     — themes/_vocabulary.css names both forms per namespace).
 *   - Unknown names stay authored: callers gate with `isKnown` (the full
 *     bundle passes `customElements.get`, the lazy entry passes the
 *     manifest lookup), so a `.prefix-*` class this build does not ship
 *     degrades like an unknown tag — prose, no error, no rewrite.
 *   - Idempotent: an element already in tag form is never touched, even
 *     when it also carries the alias class; rewritten elements carry
 *     `data-<prefix>-alias` (runtime state is always `data-*`,
 *     conventions §2) so the upgrade is traceable and re-runs are no-ops.
 *   - Each namespace's entries run the rewrite at DOMContentLoaded — the
 *     core bundle's vanilla-handler timing. With the documented script
 *     order (semtext.js, then the namespace bundle) the sem-source
 *     snapshot pass has already captured authored markup, so fences still
 *     show the class form.
 *
 * The lazy entries additionally run it per inserted node
 * (src/lazy/boot.ts `prepare`), so a late-added alias div is rewritten
 * before the tag scan sees it and triggers its chunk download like an
 * authored tag. The semtext-lazy loader deliberately does NOT do this for
 * `sem-*`: that namespace's alias contract stays with the full bundle
 * (src/lazy/scan.ts).
 */

/** A vocabulary name under `prefix` — the prefix-scoped slice of
 *  lazy/scan's VOCABULARY_TAG. Built per call so this module stays
 *  dependency-free (importable from any bundle entry without pulling the
 *  loader in). */
export function aliasNameFor(prefix: string): RegExp {
  const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${p}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
}

/** Marker attribute for a namespace's rewritten elements (runtime state
 *  is always `data-*`, conventions §2). */
export function aliasMarkerFor(prefix: string): string {
  return `data-${prefix}-alias`;
}

export type IsKnownVocabularyTag = (tag: string) => boolean;

/** The alias tag an element's class list declares for `prefix`, or null.
 *  Identity is ONE class (Appendix A); when several `prefix-*` classes
 *  are present the first token in authored order wins and the rest stay
 *  layout/decoration on the rewritten element. */
export function aliasTagIn(el: Element, prefix: string): string | null {
  const name = aliasNameFor(prefix);
  for (const token of Array.from(el.classList)) {
    if (name.test(token)) return token;
  }
  return null;
}

/** The tag `el` should be rewritten to, or null when it is not an
 *  upgradable alias: no alias class, already that tag (idempotence), a
 *  different `prefix-*` element wearing an unrelated alias class (left to
 *  its own component), or a name `isKnown` rejects. */
function candidate(el: Element, prefix: string, isKnown?: IsKnownVocabularyTag): string | null {
  const tag = aliasTagIn(el, prefix);
  if (!tag || el.localName === tag) return null;
  if (el.localName.startsWith(prefix + '-')) return null;
  if (isKnown && !isKnown(tag)) return null;
  return tag;
}

/** Rewrite one alias element into its canonical tag: attributes copied
 *  as authored (the alias class included — it is also the theme/CSS
 *  hook), children moved, replacement takes the element's place. The
 *  custom element upgrades on insertion when its definition has run, or
 *  later when its lazy chunk arrives. */
function rewrite(el: Element, tag: string, marker: string): Element {
  const doc = el.ownerDocument;
  if (!doc) return el;
  const target = doc.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    target.setAttribute(attr.name, attr.value);
  }
  target.setAttribute(marker, '');
  while (el.firstChild) target.appendChild(el.firstChild);
  el.replaceWith(target);
  return target;
}

/** Upgrade every known class-form alias under `root` — the root itself
 *  included — to tag form, outermost first so nested aliases travel with
 *  their parent's rewrite and are then upgraded in their own right.
 *  Returns the element now occupying root's place: root itself, or its
 *  tag-form replacement when root was the alias (the lazy boot uses the
 *  return value as its hydration root). */
export function upgradeClassAliases(root: Element, prefix: string, isKnown?: IsKnownVocabularyTag): Element {
  const marker = aliasMarkerFor(prefix);
  let effective = root;
  const rootTag = candidate(root, prefix, isKnown);
  if (rootTag) effective = rewrite(root, rootTag, marker);
  // Static snapshot on purpose: replacements carry the same alias class,
  // so a live query would re-match them; a snapshot cannot. The
  // `[class*="<prefix>-"]` prefilter is a cheap net — `candidate` does the
  // real token check.
  for (const el of Array.from(effective.querySelectorAll(`[class*="${prefix}-"]`))) {
    const tag = candidate(el, prefix, isKnown);
    if (tag) rewrite(el, tag, marker);
  }
  return effective;
}

/* ── npl wrappers — the historical spelling ─────────────────────────── */

/** Marker attribute set on every rewritten `npl-*` element. */
export const NPL_ALIAS_MARKER = aliasMarkerFor('npl');

export type IsKnownNplTag = IsKnownVocabularyTag;

/** The npl alias tag an element's class list declares, or null. */
export function aliasTag(el: Element): string | null {
  return aliasTagIn(el, 'npl');
}

/** The npl pass of the generalized engine — every existing npl call site
 *  (src/npl.ts boot, src/lazy/npl.ts prepare) goes through here. */
export function upgradeNplAliases(root: Element, isKnown?: IsKnownNplTag): Element {
  return upgradeClassAliases(root, 'npl', isKnown);
}
