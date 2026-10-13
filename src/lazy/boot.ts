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
  /** Cache-bust token appended as `?v=` to every chunk URL. The built
   *  entries pass the inlined BUILD_VERSION; a host page that loads the
   *  loader itself with `?v=` overrides it (see defaultImportChunk). */
  version?: string;
}

export function bootLazyLoader(manifest: Manifest, options: LazyBootOptions): LazyLoader {
  const importChunk = options.importChunk ?? ((chunkPath: string) => defaultImportChunk(chunkPath, options.version));
  const loader = createLoader(manifest, importChunk, options.pattern);

  const watcher = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) void loader.hydrate(node as Element);
      }
    }
  });

  // The whole document, wrapper or not: `html` is not vocabulary and
  // hydrate includes the root, so one call covers every authored element.
  void loader.hydrate(document.documentElement);
  watcher.observe(document.documentElement, { childList: true, subtree: true });

  return loader;
}

/** Chunks resolve relative to the built script that imports this module —
 *  `import.meta.url` is each bundle's own URL at runtime. `@vite-ignore`
 *  keeps Rollup from trying to bundle the dynamic specifier: these chunks
 *  are already built, next to the script. Exported so an entry that skips
 *  the document-wide boot (window.__semLazyOff) can still build a loader
 *  whose dynamic imports resolve exactly like the booted one's.
 *
 *  Cache-bust: the chunk URL carries `?v=`. The host page's own query wins
 *  (a page that loads semtext-lazy.js?v=X gets chunks at ?v=X — the version
 *  is passed on), else the `version` the entry inlined from the build — so
 *  a rebuilt bundle never resolves to a stale cached chunk. */
export function defaultImportChunk(chunkPath: string, version?: string): Promise<unknown> {
  const own = new URL(import.meta.url);
  const url = new URL(chunkPath, import.meta.url);
  const v = own.searchParams.get('v') ?? version ?? null;
  if (v) url.searchParams.set('v', v);
  return import(/* @vite-ignore */ url.href);
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
