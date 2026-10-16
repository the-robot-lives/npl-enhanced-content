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
import { helloPackage } from './hello/stub.js';
import { wasmPackage } from './wasm/stub.js';
import { awkPackage } from './awk/stub.js';
import { textPackage } from './text/stub.js';
import { jqPackage } from './jq/stub.js';
import { netPackage } from './net/stub.js';
import { fsPackage } from './fs/stub.js';
import { archivePackage } from './archive/stub.js';
import { gitPackage } from './git/stub.js';

/** Every registered package, in registration order. */
export const PACKAGES: LazyPackage[] = [helloPackage, wasmPackage, awkPackage, textPackage, jqPackage, netPackage, fsPackage, archivePackage, gitPackage];

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

/** Per-package mount outcome, for the shell to surface (or ignore). */
export interface PackageMount {
  pkg: string;
  ok: boolean;
  error: string | null;
  /** Commands that replaced an existing registration. */
  superseded: string[];
  /** Collisions resolved last-wins WITHOUT a stub `supersedes` declaration
   *  — the mount succeeded, but the stub should declare these. */
  undeclared: string[];
}

/**
 * Mount every registered package as its OWN manifest, after the base
 * plugins. A package may supersede a base built-in: a name the stub
 * declares (`supersedes`, types.ts) replaces the earlier registration
 * silently; an UNDECLARED collision still resolves last-wins — the
 * package wins, the mount never fails on a name clash — with a console
 * warning naming the command so the stub can declare it. One package
 * failing to mount never stops the others. Called once per session core
 * (sem-shell.ts), after the posix/demo/cards loop.
 */
export function mountPackages(core: { mountPlugin: (m: PluginManifest, o?: { supersede?: readonly string[] }) => unknown; hasCommand: (n: string) => boolean }): PackageMount[] {
  const out: PackageMount[] = [];
  for (const pkg of PACKAGES) {
    const names = pkg.commands.map((c) => c.name);
    const collisions = names.filter((n) => core.hasCommand(n));
    const undeclared = collisions.filter((n) => !pkg.supersedes.has(n));
    for (const n of undeclared) {
      console.warn(`[packages] ${pkg.name} replaces the existing '${n}' — declare it in the stub's supersedes to silence this`);
    }
    const manifest: PluginManifest = {
      name: `pkg-${pkg.name}`,
      version: '0.1.0',
      description: pkgCommandsDescription(pkg.name),
      commands: pkg.commands,
      files: [],
    };
    let ok = true;
    let error: string | null = null;
    try {
      const r = core.mountPlugin(manifest, { supersede: collisions }) as { ok: boolean; error: string | null };
      ok = r.ok;
      error = r.error;
    } catch (cause) {
      ok = false;
      error = cause instanceof Error ? cause.message : String(cause);
    }
    out.push({ pkg: pkg.name, ok, error, superseded: collisions, undeclared });
  }
  return out;
}

function pkgCommandsDescription(pkg: string): string {
  return `command package '${pkg}' (lazy chunk semtext-pkg-${pkg}.js)`;
}
