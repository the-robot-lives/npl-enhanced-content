/**
 * shared/npl-alias — upgrade class-form authoring aliases to tag form.
 *
 * The conventions promise every element can be authored in the v0.4 class
 * form — `<div class="npl-example" data-label="…">` with `data-*`
 * parameters (spec/conventions.md Appendix A; spec/schema/npl/TEMPLATE.md,
 * "Class-form alias … same dual-form contract as the sem-* tier"). The
 * sem-* namespace keeps that promise through the full bundle's vanilla
 * handlers, which enhance classed elements in place. The NPL namespace has
 * no vanilla tier — the Lit components ARE the rendering — so this module
 * keeps the promise instead: it rewrites each alias element into its
 * canonical `<npl-*>` tag, carrying every attribute and child across, and
 * lets the custom-element machinery do the rest. No parameter mapping
 * table is needed: components already read both spellings through
 * nplParam (`data-<name>` wins), so copied `data-*` attributes resolve
 * exactly as authored.
 *
 * Contract:
 *
 *   - JS off: nothing runs; the alias element stays authored prose in the
 *     vocabulary CSS block box (`npl-x, .npl-x { display: block; }` —
 *     themes/_vocabulary.css already names both forms).
 *   - Unknown names stay authored: callers gate with `isKnown` (the full
 *     bundle passes `customElements.get`, npl-lazy passes the manifest
 *     lookup), so a `.npl-*` class this build does not ship degrades like
 *     an unknown tag — prose, no error, no rewrite.
 *   - Idempotent: an element already in tag form is never touched, even
 *     when it also carries the alias class; rewritten elements carry
 *     `data-npl-alias` (runtime state is always `data-*`, conventions
 *     §2) so the upgrade is traceable and re-runs are no-ops.
 *   - Both npl entries run the rewrite at DOMContentLoaded — the core
 *     bundle's vanilla-handler timing. With the documented script order
 *     (semtext.js, then npl.js) the sem-source snapshot pass has already
 *     captured authored markup, so fences still show the class form.
 *
 * npl-lazy additionally runs it per inserted node (src/lazy/boot.ts
 * `prepare`), so a late-added alias div is rewritten before the tag scan
 * sees it and triggers its chunk download like an authored tag. The
 * semtext-lazy loader deliberately does NOT do this for `sem-*`: that
 * namespace's alias contract stays with the full bundle (src/lazy/scan.ts).
 */

/** An npl vocabulary name — the npl half of lazy/scan's VOCABULARY_TAG.
 *  Kept local so this module stays dependency-free (importable from both
 *  the full bundle and the lazy entry without pulling the loader in). */
const NPL_NAME = /^npl-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Marker attribute set on every rewritten element (runtime state). */
export const NPL_ALIAS_MARKER = 'data-npl-alias';

export type IsKnownNplTag = (tag: string) => boolean;

/** The alias tag an element's class list declares, or null. Identity is
 *  ONE class (Appendix A); when several `npl-*` classes are present the
 *  first token in authored order wins and the rest stay layout/decoration
 *  on the rewritten element. */
export function aliasTag(el: Element): string | null {
  for (const token of Array.from(el.classList)) {
    if (NPL_NAME.test(token)) return token;
  }
  return null;
}

/** The tag `el` should be rewritten to, or null when it is not an
 *  upgradable alias: no alias class, already that tag (idempotence), a
 *  different `npl-*` element wearing an unrelated alias class (left to
 *  its own component), or a name `isKnown` rejects. */
function candidate(el: Element, isKnown?: IsKnownNplTag): string | null {
  const tag = aliasTag(el);
  if (!tag || el.localName === tag) return null;
  if (el.localName.startsWith('npl-')) return null;
  if (isKnown && !isKnown(tag)) return null;
  return tag;
}

/** Rewrite one alias element into its canonical tag: attributes copied
 *  as authored (the alias class included — it is also the theme/CSS
 *  hook), children moved, replacement takes the element's place. The
 *  custom element upgrades on insertion when its definition has run, or
 *  later when its lazy chunk arrives. */
function rewrite(el: Element, tag: string): Element {
  const doc = el.ownerDocument;
  if (!doc) return el;
  const target = doc.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    target.setAttribute(attr.name, attr.value);
  }
  target.setAttribute(NPL_ALIAS_MARKER, '');
  while (el.firstChild) target.appendChild(el.firstChild);
  el.replaceWith(target);
  return target;
}

/** Upgrade every known class-form alias under `root` — the root itself
 *  included — to tag form, outermost first so nested aliases travel with
 *  their parent's rewrite and are then upgraded in their own right.
 *  Returns the element now occupying root's place: root itself, or its
 *  tag-form replacement when root was the alias (npl-lazy's boot uses
 *  the return value as its hydration root). */
export function upgradeNplAliases(root: Element, isKnown?: IsKnownNplTag): Element {
  let effective = root;
  const rootTag = candidate(root, isKnown);
  if (rootTag) effective = rewrite(root, rootTag);
  // Static snapshot on purpose: replacements carry the same alias class,
  // so a live query would re-match them; a snapshot cannot. The
  // `[class*="npl-"]` prefilter is a cheap net — `candidate` does the
  // real token check.
  for (const el of Array.from(effective.querySelectorAll('[class*="npl-"]'))) {
    const tag = candidate(el, isKnown);
    if (tag) rewrite(el, tag);
  }
  return effective;
}
