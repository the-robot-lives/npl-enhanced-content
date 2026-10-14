/**
 * lazy/boot — the document-wide wiring both lazy loaders share.
 *
 * One routine, parameterized by manifest and tag prefix: hydrate the whole
 * document at boot (the trigger rule is document-wide — wrappers optional),
 * then watch the document for insertions. semtext-lazy installs it with
 * the `sem-*` manifest and `/^sem-/`; npl-lazy with the `npl-*` manifest
 * and `/^npl-/`. Chunk resolution stays the caller's (each entry resolves
 * against its own `import.meta.url`), so the same relative manifest paths
 * work from any host page depth or CDN layout.
 */

import { createLoader, type ImportChunk, type LazyLoader, type Manifest } from './loader.js';

export interface LazyBootOptions {
  /** Namespace prefix this loader owns, e.g. `/^sem-/`. */
  pattern: RegExp;
  /** Chunk importer override (tests); the built entries dynamic-import. */
  importChunk?: ImportChunk;
  /** Optional pre-hydration pass, run once on the document root at boot
   *  and on every element node the observer sees inserted; returns the
   *  element to hydrate in its place (identity when nothing changed).
   *  npl-lazy passes the class-form alias upgrade (shared/npl-alias.ts),
   *  so a `.npl-*` div is rewritten to tag form before the scan and
   *  triggers its chunk like an authored tag. semtext-lazy leaves it
   *  unset: sem-* aliases belong to the full bundle's vanilla handlers
   *  and never trigger a download (see scan.ts). */
  prepare?: (node: Element) => Element;
}

export function bootLazyLoader(manifest: Manifest, options: LazyBootOptions): LazyLoader {
  const loader = createLoader(manifest, options.importChunk ?? defaultImportChunk, options.pattern);
  const prepare = options.prepare;

  const watcher = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // A prepare rewrite inserts a new element, which the observer sees
        // as its own insertion — harmless: the upgrade is idempotent and
        // the loader dedupes chunk imports.
        const el = prepare ? prepare(node as Element) : (node as Element);
        void loader.hydrate(el);
      }
    }
  });

  // The whole document, wrapper or not: `html` is not vocabulary and
  // hydrate includes the root, so one call covers every authored element.
  const root = prepare ? prepare(document.documentElement) : document.documentElement;
  void loader.hydrate(root);
  watcher.observe(document.documentElement, { childList: true, subtree: true });

  return loader;
}

/** Chunks resolve relative to the built script that imports this module —
 *  `import.meta.url` is each bundle's own URL at runtime. `@vite-ignore`
 *  keeps Rollup from trying to bundle the dynamic specifier: these chunks
 *  are already built, next to the script. Exported so an entry that skips
 *  the document-wide boot (window.__semLazyOff) can still build a loader
 *  whose dynamic imports resolve exactly like the booted one's. */
export function defaultImportChunk(chunkPath: string): Promise<unknown> {
  return import(/* @vite-ignore */ new URL(chunkPath, import.meta.url).href);
}

/** Boot at DOMContentLoaded, matching the full bundle's init pattern
 *  (src/index.ts): scripts can load with `defer` or at the end of body. */
export function installOnDocumentReady(install: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}
