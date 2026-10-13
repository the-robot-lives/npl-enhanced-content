/**
 * npl-lazy — the `npl-*` namespace's on-demand surface (src entry; built to
 * dist/npl-lazy.js).
 *
 * The same contract as semtext-lazy (see that entry; src/lazy/boot.ts is
 * the shared wiring), pointed at the npl manifest and the `npl-*` prefix:
 * scan the whole document — wrappers optional — and import only the
 * component chunks under npl-chunks/ that the document's `npl-*` tags map
 * to. The trigger rule is unchanged: any `npl-*` element anywhere loads
 * its chunk, with or without a wrapper; class aliases never do.
 *
 * Dynamic import needs a server: this script does not work from file://.
 * An NPL document that must survive offline loads npl.js — the full npl
 * bundle — on top of semtext.js instead.
 */

import { bootLazyLoader, installOnDocumentReady } from './boot.js';
import manifest, { BUILD_VERSION } from 'virtual:npl-manifest';

installOnDocumentReady(() => bootLazyLoader(manifest, { pattern: /^npl-/, version: BUILD_VERSION }));
