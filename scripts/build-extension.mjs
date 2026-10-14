#!/usr/bin/env node
/**
 * scripts/build-extension.mjs — assemble extension/vendor/ for the M2
 * extension (local unpacked load; design §6 bundle: content.js,
 * background.js, viewer.html, frame.html + bundles, manifest).
 *
 * The extension is self-contained (an unpacked package cannot reference
 * files outside its root), but its jail/boot code must stay the SAME
 * trusted sources the hosted viewer runs (design §1: "one code path to
 * audit"). So this script COPIES — never hand-edit extension/vendor/.
 *
 *   node scripts/build-extension.mjs [--bundle <path/to/semtext.js>]
 *
 * Bundle default order: the feat/lit-only-bundle worktree dist (M1's
 * trusted set), then the checkout's own dist/. Prints a sha256 manifest.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viewerDir = resolve(repoRoot, 'viewer');
const extDir = resolve(repoRoot, 'extension');
const vendorDir = resolve(extDir, 'vendor');

const flagIndex = process.argv.indexOf('--bundle');
const bundleArg = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;
const bundleCandidates = [
  bundleArg,
  resolve(repoRoot, '../lit-only-bundle/dist/semtext.js'),
  resolve(repoRoot, '../dist/semtext.js'),
  resolve(repoRoot, 'dist/semtext.js'),
].filter(Boolean);

const bundle = bundleCandidates.find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!bundle) {
  console.error(
    'build-extension: no semtext.js bundle found. Build one (npm run build) or pass --bundle <path>.',
  );
  process.exit(1);
}

/** One flat namespace: viewer/*.mjs import siblings as './name.mjs'. */
const MODULES = ['boot-url.mjs', 'boot-fetch.mjs', 'viewer-boot.mjs', 'jail-boot.mjs', 'jail-strip.mjs'];
const CSS = ['viewer.css'];

mkdirSync(vendorDir, { recursive: true });

let missing = [];
for (const name of [...MODULES, ...CSS]) {
  try {
    copyFileSync(resolve(viewerDir, name), resolve(vendorDir, name));
  } catch {
    missing.push(name);
  }
}
if (missing.length) {
  console.error(`build-extension: missing viewer sources: ${missing.join(', ')}`);
  process.exit(1);
}

copyFileSync(bundle, resolve(vendorDir, 'semtext.js'));

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const lines = [
  ...[...MODULES, ...CSS].map((n) => `  vendor/${n}  ${sha(resolve(vendorDir, n))}`),
  `  vendor/semtext.js  ${sha(resolve(vendorDir, 'semtext.js'))}  (from ${bundle})`,
];
writeFileSync(resolve(vendorDir, 'MANIFEST.txt'), `${lines.join('\n')}\n`);

console.log(`build-extension: vendored into extension/vendor/`);
console.log(lines.join('\n'));
