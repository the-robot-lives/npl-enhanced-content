/**
 * lazy/scan — find the SemText vocabulary in a DOM subtree.
 *
 * The loader scans the WHOLE document: any element whose tag starts with
 * `sem-` or `npl-` may be a component, wherever it sits — the `<sem-text>`
 * wrapper is an authoring convenience, not the scan boundary. Which of
 * those tags actually have a component is the manifest's job (generated at
 * build time from the component list, see scripts/build.mjs) — the scan
 * stays tag-shaped so it needs no component knowledge: an `npl-*` element
 * from a sibling package is picked up here and simply matches nothing
 * until its chunk ships.
 *
 * Class-form aliases (`.sem-note` etc.) are deliberately out of scope:
 * they are not tags, so this scan cannot see them. For `sem-*` that is the
 * contract — documents authored in the alias form need the full bundle
 * (semtext.js), whose vanilla handlers own them. The `npl-*` namespace
 * keeps the alias contract one level up instead: npl-lazy's boot `prepare`
 * pass rewrites `.npl-*` elements to tag form (src/shared/npl-alias.ts)
 * before hydration, so this scan stays tag-shaped and it is the rewrite
 * that triggers the chunk download.
 */

export const VOCABULARY_TAG = /^(?:sem|npl)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A vocabulary tag name under `pattern`. Each shipped loader narrows the
 *  default (both namespaces) to its own prefix — semtext-lazy scans
 *  `sem-*`, npl-lazy scans `npl-*` — so a page running both never has the
 *  two loaders reaching for the same element. `localName` is always
 *  lowercase in HTML documents, so author casing cannot split one tag
 *  across two manifest lookups. */
export function isVocabularyTag(name: string, pattern: RegExp = VOCABULARY_TAG): boolean {
  return pattern.test(name);
}

/** The vocabulary elements in `root` — the root itself included — in
 *  document order. Including the root is harmless (a non-component root
 *  such as `html` or `sem-text` matches no chunk) and lets one routine
 *  serve the boot scan of a document and the hydration of a single
 *  inserted element. */
export function collectVocabularyElements(root: Element, pattern: RegExp = VOCABULARY_TAG): Element[] {
  const found: Element[] = [];
  if (isVocabularyTag(root.localName, pattern)) found.push(root);
  for (const el of root.querySelectorAll('*')) {
    if (isVocabularyTag(el.localName, pattern)) found.push(el);
  }
  return found;
}

/** Distinct vocabulary tag names under `root` (root included). */
export function collectTags(root: Element, pattern: RegExp = VOCABULARY_TAG): Set<string> {
  return new Set(collectVocabularyElements(root, pattern).map((el) => el.localName));
}
