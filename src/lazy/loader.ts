/**
 * lazy/loader — import only the chunks a document needs, and fail softly.
 *
 * Three guarantees, per the surface contract:
 *
 *   1. One chunk, one download. A page with forty `<sem-note>`s imports
 *      chunks/sem-note.js once; the in-flight promise is the cache, so a
 *      scan racing an import dedupes instead of double-fetching.
 *   2. One failure, one note. A chunk that fails to load (offline, deploy
 *      skew, a bad path) never rejects out of `hydrate`: each element that
 *      wanted it gets a role="alert" note, and the other chunks still load.
 *      The failed promise stays cached — elements added later fail fast
 *      with the same note rather than hammering a URL that already failed.
 *   3. Unknown tags are not errors. A `sem-*`/`npl-*` element with no
 *      manifest entry is vocabulary the page knows and this build does not;
 *      it stays authored prose — the same degrade path as JavaScript off.
 *
 * Chunk resolution is the caller's job (the entry resolves against its own
 * `import.meta.url`), which keeps this module pure DOM + promises and unit
 * testable with a fake importer.
 */

import { collectVocabularyElements, VOCABULARY_TAG } from './scan.js';

/** tag → chunk path, relative to the built script's directory (dist/). */
export type Manifest = Record<string, string>;
export type ImportChunk = (chunkPath: string) => Promise<unknown>;

export interface LazyLoader {
  /** Load every manifest-mapped tag under `root` (root included). Never
   *  rejects: per-tag failures are reported on their elements. */
  hydrate(root: Element): Promise<void>;
}

/** Manifest lookup. An own-property guard, not bare indexing: a manifest
 *  object must not answer for inherited names like `constructor`. */
export function chunkFor(tag: string, manifest: Manifest): string | null {
  return Object.prototype.hasOwnProperty.call(manifest, tag) ? manifest[tag] : null;
}

/** `pattern` narrows the scan to one namespace prefix — semtext-lazy runs
 *  `/^sem-/`, npl-lazy runs `/^npl-/` — so two loaders on one page never
 *  reach for the same element. The manifest is the second, authoritative
 *  filter: a scanned tag with no manifest entry is left as authored prose. */
export function createLoader(manifest: Manifest, importChunk: ImportChunk, pattern: RegExp = VOCABULARY_TAG): LazyLoader {
  /** chunk path → in-flight or settled import. The rejected promise stays
   *  cached on purpose: see guarantee 2. */
  const loaded = new Map<string, Promise<unknown>>();

  function ensure(chunkPath: string): Promise<unknown> {
    let pending = loaded.get(chunkPath);
    if (!pending) {
      // One task tick, so a caller that hydrates twice in the same tick
      // still dedupes onto a single import call.
      pending = Promise.resolve().then(() => importChunk(chunkPath));
      loaded.set(chunkPath, pending);
    }
    return pending;
  }

  async function hydrate(root: Element): Promise<void> {
    const groups = new Map<string, { chunk: string; els: Element[] }>();
    for (const el of collectVocabularyElements(root, pattern)) {
      const chunk = chunkFor(el.localName, manifest);
      if (!chunk) continue; // unknown vocabulary
      const group = groups.get(el.localName);
      if (group) group.els.push(el);
      else groups.set(el.localName, { chunk, els: [el] });
    }
    // allSettled-shaped on purpose: one rejected tag must not stop the rest
    await Promise.all(
      [...groups].map(async ([tag, { chunk, els }]) => {
        try {
          await ensure(chunk);
        } catch {
          for (const el of els) reportFailure(el, tag);
        }
      }),
    );
  }

  return { hydrate };
}

/** The failure surface: an accessibility-correct note on the element itself,
 *  never a thrown error. A failed chunk means the element will not upgrade,
 *  so it keeps reading as authored prose with a note explaining why — the
 *  same contract the vocabulary promises with JavaScript off. Idempotent:
 *  a re-hydration of an already-marked element adds nothing. */
export function reportFailure(el: Element, tag: string): void {
  if (el.hasAttribute('data-sem-lazy-error')) return;
  el.setAttribute('data-sem-lazy-error', tag);
  const doc = el.ownerDocument;
  if (!doc) return;
  const note = doc.createElement('div');
  note.className = 'sem-lazy-error';
  note.setAttribute('role', 'alert');
  note.textContent = `SemText: the "${tag}" component failed to load; this block stays plain text.`;
  el.appendChild(note);
}
