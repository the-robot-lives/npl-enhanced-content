/**
 * reference-id — the sem-reference AUTO-ID rule (spec/schema/sem-references.md
 * § Auto-id; digest sem-text.v0.8 `sem-reference`).
 *
 *   id = <block-id> + "-" + referenceSlug(cite)
 *
 * block-id is the enclosing `sem-references` id (default `refs`); the slug
 * source is `cite`, else the pre-v0.6 compat alias `href`. A PURE function
 * of authored attributes: machine consumers (extraction, the validator, the
 * semtext.dev reference) compose the same anchor without running the
 * document. An authored `id` always wins and is never overwritten.
 */

import { param } from './attr.js';

/**
 * Lowercase; every run of characters outside `[a-z0-9]` becomes one `-`;
 * leading/trailing `-` stripped. URL schemes are NOT special-cased.
 *   `RFC 6749` → `rfc-6749`
 *   `Projects/github-tools/docs/gh-wait.md` → `projects-github-tools-docs-gh-wait-md`
 */
export function referenceSlug(cite: string): string {
  return cite.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** `<blockId || "refs">-<slug(cite)>`; null when the slug is empty. */
export function referenceId(blockId: string | null | undefined, cite: string): string | null {
  const s = referenceSlug(cite);
  return s ? (blockId || 'refs') + '-' + s : null;
}

/** The id a reference element answers to: authored, else derived (or null). */
export function deriveReferenceId(ref: Element): string | null {
  const minted = ref.hasAttribute('data-sem-minted-id');
  if (ref.id && !minted) return ref.id;
  const block = ref.parentElement?.closest(':is(sem-references, .sem-references)');
  return referenceId(block?.id, param(ref, 'cite') || param(ref, 'href') || '');
}

/**
 * Materialize the derived id on the element (idempotent). The id is marked
 * `data-sem-minted-id` so record extraction treats it as derived identity,
 * not authored markup. Returns the id the reference now carries ('' = none).
 */
export function ensureReferenceId(ref: Element): string {
  if (ref.id) return ref.id;
  const id = deriveReferenceId(ref);
  if (id) {
    ref.id = id;
    ref.setAttribute('data-sem-minted-id', '');
  }
  return ref.id;
}
