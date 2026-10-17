/**
 * semext-lazy — the `semext-*` namespace's on-demand surface (src entry;
 * built to dist/semext-lazy.js).
 *
 * The same contract as npl-lazy (see that entry; src/lazy/boot.ts is the
 * shared wiring), pointed at the semext manifest and the `semext-*`
 * prefix: scan the whole document — wrappers optional — and import only
 * the component chunks under semext-chunks/ that the document's
 * `semext-*` tags map to. The trigger rule is unchanged: any `semext-*`
 * element anywhere loads its chunk, with or without a wrapper.
 *
 * Class-form aliases ARE this loader's business, unlike the sem namespace
 * (where aliases belong to the full bundle's vanilla handlers): the boot
 * `prepare` pass rewrites every `.semext-<tag>` element the manifest
 * knows into its tag form (src/shared/npl-alias.ts,
 * `upgradeClassAliases`) before the scan sees it, at boot and on every
 * later insertion — so an alias div triggers its chunk download exactly
 * like an authored tag, and a failed chunk degrades only its own elements
 * to authored prose with the role="alert" note.
 *
 * Dynamic import needs a server: this script does not work from file://.
 * A semext document that must survive offline loads semext.js — the full
 * semext bundle — on top of semtext.js instead.
 */

import { bootLazyLoader, installOnDocumentReady } from './boot.js';
import { chunkFor } from './loader.js';
import { upgradeClassAliases } from '../shared/npl-alias.js';
import manifest from 'virtual:semext-manifest';

/** Alias upgrade gated on the manifest: only names this build ships a
 *  chunk for are rewritten; unknown `.semext-*` classes stay authored
 *  prose (the loader's unknown-tag contract). The return value is the
 *  element to hydrate — the tag-form replacement when the node itself was
 *  an alias. */
const prepare = (el: Element): Element =>
  upgradeClassAliases(el, 'semext', (tag) => chunkFor(tag, manifest) !== null);

installOnDocumentReady(() => bootLazyLoader(manifest, { pattern: /^semext-/, prepare }));
