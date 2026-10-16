#!/usr/bin/env node
/**
 * scripts/stamp-version.mjs — publish the just-built artifact set under an
 * immutable, version-addressed path: `dist/v<package-version>/…`.
 *
 *   node scripts/stamp-version.mjs          (run after build.mjs +
 *                                           build-standalone.mjs; the npm
 *                                           `build` scripts chain it last)
 *
 * Why: consumers that serve the bundles over HTTP (semtext.dev today) want
 * URLs they can cache forever. A versioned directory is that URL: its
 * contents are the artifacts of exactly one released state and are never
 * rewritten in place — a new release writes a NEW directory. This is what
 * lets the site ship `Cache-Control: immutable` for the version-prefixed
 * `/semtext/v<semver>/` paths while the unversioned alias (`/semtext/…`)
 * keeps short caches.
 *
 * What lands in dist/v<version>/:
 *   - the five full IIFE bundles (semtext.js, -fallback, -reading,
 *     -extract, -md) — each only if the build emitted it
 *   - semtext-lazy.js + semtext-manifest.json + chunks/
 *   - npl-lazy.js + npl-manifest.json + npl-chunks/
 *   - semtext-js-shell.js + semtext-js-shell-manifest.json
 *   - semtext.css + themes/
 * Bundle BYTES are copied verbatim — this script never rebuilds, strips or
 * rewrites an artifact ("don't change bundle contents" is the whole point:
 * a byte in dist/semtext.js is the same byte in dist/v0.1.0/semtext.js).
 *
 * It also writes dist/version.json — the machine-readable record of what
 * was just stamped:
 *   { "version", "specVersion", "generatedBy", "epoch", "files": [...] }
 * The site's sync (semtext.dev web/scripts/sync-bundles.mjs) reads it to
 * learn which version directory to publish.
 *
 * The unversioned dist/ root is untouched: package.json `exports`, the
 * Dockerfile, cypress and the docs all point at dist/semtext.js etc., and
 * those paths keep working exactly as before.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error(`stamp-version: package.json version "${version}" is not semver — refusing to stamp`);
  process.exit(1);
}
if (!existsSync(resolve(distDir, 'semtext.js'))) {
  console.error('stamp-version: dist/semtext.js not found — run the build first (npm run build)');
  process.exit(1);
}

const vDir = resolve(distDir, `v${version}`);
rmSync(vDir, { recursive: true, force: true });
mkdirSync(vDir, { recursive: true });

/** Top-level artifacts, copied only when present (semtext-fallback.js is
 *  retired upstream; a build that no longer emits it just doesn't ship it). */
const FILES = [
  'semtext.js',
  'semtext-fallback.js',
  'semtext-reading.js',
  'semtext-extract.js',
  'semtext-md.js',
  'semtext.css',
  'semtext-lazy.js',
  'semtext-manifest.json',
  'npl.js',
  'npl-lazy.js',
  'npl-manifest.json',
  'semtext-js-shell.js',
  'semtext-js-shell-manifest.json',
];
const DIRS = ['chunks', 'npl-chunks', 'themes'];

const stamped = [];
for (const f of FILES) {
  const src = resolve(distDir, f);
  if (!existsSync(src)) continue;
  cpSync(src, join(vDir, f));
  stamped.push(f);
}
for (const d of DIRS) {
  const src = resolve(distDir, d);
  if (!existsSync(src)) continue;
  cpSync(src, join(vDir, d), { recursive: true });
  stamped.push(`${d}/ (${readdirSync(src).length} files)`);
}

const manifest = {
  version,
  specVersion: pkg.specVersion ?? null,
  generatedBy: 'scripts/stamp-version.mjs',
  epoch: Math.floor(Date.now() / 1000),
  files: stamped,
};
writeFileSync(resolve(distDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`stamp-version: dist/v${version}/ ← ${stamped.length} artifact groups; index in dist/version.json`);
