/**
 * packages/manifest — the package registry (packages round, LANE=pkg-infra).
 *
 * THE registration point for every command package. A lane lands its
 * package by appending exactly two lines here (never editing or reordering
 * anyone else's): one import of its stub in the block below, one entry in
 * PACKAGES. `packagesPlugin` assembles the stub commands into one
 * PluginManifest the shell mounts per session core (sem-shell.ts), and
 * `applyPackageMan` wraps whichever mounting manifest carries `man` so
 * `man <cmd>` answers from the packages (chunk page once resident, else
 * the stub's short page — lazy.ts).
 *
 * Chunk loading is not this file's concern: every stub kicks its own
 * `importPackageChunk` at module-eval (= shell boot), and the build globs
 * `src/terminal/packages/<pkg>/index.ts` into sibling `semtext-pkg-<pkg>.js`
 * chunks (scripts/build.mjs). Full contract: ./README.md.
 */

import type { PluginManifest } from '../terminal-core.js';
import { withPackageMan, type LazyPackage } from './lazy.js';

/* ── package registrations — append-only; one import + one entry per lane ── */
import { textPackage } from './text/stub.js';
import { gitPackage } from './git/stub.js';
import {netPackage} from './net/stub.js';
/* (empty at the contract commit — the sample lands with the build glob)     */

/** Every registered package, in registration order. */
export const PACKAGES: LazyPackage[] = [textPackage, gitPackage, netPackage];

/** One PluginManifest carrying every package's stub commands. */
export const packagesPlugin: PluginManifest = {
  name: 'packages',
  version: '0.1.0',
  description: 'Lazy command packages — bodies load as semtext-pkg-*.js chunks next to the shell bundle',
  commands: PACKAGES.flatMap((pkg) => pkg.commands),
  files: [],
};

/**
 * Wrap a manifest's `man` with the packages' pages. Mounting code applies
 * this to EVERY manifest before mount; manifests without `man` pass
 * through unchanged (lazy.ts guarantees identity).
 */
export function applyPackageMan(manifest: PluginManifest): PluginManifest {
  return withPackageMan(manifest, PACKAGES);
}
