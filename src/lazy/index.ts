/**
 * semtext-lazy — the core on-demand surface (src entry; built to
 * dist/semtext-lazy.js).
 *
 * SURFACE CONTRACT (the built artifact carries the same text as a banner —
 * minification strips this comment): pair semtext-lazy.js with semtext.css
 * and the script scans the whole document — the `<sem-text>` wrapper is
 * optional — for `sem-*` tags, then imports only the component chunks the
 * build-time manifest maps those tags to. Components not on the page never
 * download; elements sit in the `:not(:defined)` base box until their chunk
 * arrives. A failed chunk leaves a role="alert" note on its elements and
 * never blocks the other chunks. Class-form aliases (`.sem-note` etc.) are
 * not tags: they never trigger a load.
 *
 * This loader owns the `sem-*` namespace only; `npl-*` documents load
 * npl-lazy.js (dist/npl-chunks/), which runs the same contract against the
 * npl manifest.
 *
 * Dynamic import needs a server: this script does not work from file://.
 * Embed with <script type="module"> — chunks resolve against
 * import.meta.url, which only exists in a module context (a classic
 * script fails to parse). For saved single-file documents use semtext.js
 * — the full bundle, which has no runtime imports.
 *
 * OPT-OUT: a page that sets `window.__semLazyOff` before this script runs
 * gets no document-wide boot — the loader is exposed as
 * `window.SemTextLazy` for per-subtree `hydrate(root)` calls instead (the
 * counterpart of the full bundle's `window.__semJsOff`). Either way the
 * instance lands on `window.SemTextLazy`.
 */

import { bootLazyLoader, defaultImportChunk, installOnDocumentReady } from './boot.js';
import { createLoader, type LazyLoader } from './loader.js';
import manifest from 'virtual:semtext-manifest';

declare global {
  interface Window {
    /**
     * Set before semtext-lazy.js loads: skips the document-wide boot scan.
     * The host page then drives hydration itself through window.SemTextLazy
     * — `SemTextLazy.hydrate(root)` loads only the chunks the `sem-*` tags
     * under `root` map to. The counterpart of the full bundle's
     * `window.__semJsOff`.
     */
    __semLazyOff?: boolean;
    /** The `sem-*` loader instance (set at DOMContentLoaded, both modes). */
    SemTextLazy?: LazyLoader;
  }
}

installOnDocumentReady(() => {
  // window.__semLazyOff is for pages that embed SemText among OTHER sem-*
  // markup they do not want upgraded — a reference page's authored
  // examples, say. It trades the document-wide trigger for targeted
  // hydration: no boot scan runs, and the page calls
  // `window.SemTextLazy.hydrate(element)` per subtree, loading only the
  // chunks those subtrees map to. Without the flag the loader boots
  // document-wide, exactly as the surface contract above promises; the
  // instance is exposed on window either way, so pages can hydrate
  // subtrees inserted after boot without a second script.
  window.SemTextLazy = window.__semLazyOff
    ? createLoader(manifest, defaultImportChunk, /^sem-/)
    : bootLazyLoader(manifest, { pattern: /^sem-/ });
});
