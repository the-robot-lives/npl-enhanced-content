#!/usr/bin/env node
/**
 * Browser canary — M2 extension raw path (design §9: "Render banner on raw
 * .html → viewer tab → public raw fetch → jail render").
 *
 * Loads the unpacked extension/ package into headless Chrome for Testing
 * against a REAL raw.githubusercontent.com .html view and asserts the
 * content-script banner is in the DOM (and absent on non-HTML raw files).
 * Real browser, real extension, real page URL; nothing mocked.
 *
 * Why not a Cypress spec (design §9's canary home): branded Chrome ≥ 137
 * refuses --load-extension outright, and Cypress's launcher did not carry
 * the flag to Chrome for Testing either (measured 2026-10-13) — the banner
 * never appeared under Cypress, while a direct CfT launch injects it. This
 * script drives CfT directly, which is the mechanism that actually tests
 * the extension. No server is started; nothing to stop afterwards.
 *
 * Usage:
 *   node test/e2e/extension-raw-banner.mjs [path-to-cft-binary]
 * Env:
 *   CFT_BIN — Chrome for Testing binary (default: playwright cache, then $PATH)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..'); // test/e2e -> repo root
const extensionDir = join(repoRoot, 'extension');
if (!existsSync(join(extensionDir, 'manifest.json'))) {
  console.error(`extension-raw-banner: no manifest at ${extensionDir} — run scripts/build-extension.mjs first?`);
  process.exit(2);
}

const CFT_FALLBACKS = [
  process.env.CFT_BIN,
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  'google-chrome-for-testing',
  'chrome-for-testing',
].filter(Boolean);

const cftBin = CFT_FALLBACKS.find((p) => {
  if (p.includes('/')) return existsSync(p);
  try {
    execFileSync('which', [p], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});
if (!cftBin) {
  console.error(
    'extension-raw-banner: no Chrome for Testing binary found. ' +
      'Set CFT_BIN or install one (npx @puppeteer/browsers install chrome@stable).',
  );
  process.exit(2);
}

const URL_HTML =
  'https://raw.githubusercontent.com/h5bp/html5-boilerplate/master/dist/index.html';
const URL_MD =
  'https://raw.githubusercontent.com/h5bp/html5-boilerplate/master/README.md';
const MARKERS = ['data-semtext-raw-banner', 'data-semtext-render-button'];

/** One headless CfT run: DOM dump of `url` with the extension loaded. */
function dumpDom(url) {
  const profile = mkdtempSync(join(tmpdir(), 'semtext-ext-canary-'));
  try {
    return execFileSync(
      cftBin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        `--load-extension=${extensionDir}`,
        '--virtual-time-budget=10000',
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, encoding: 'utf8' },
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

let failures = 0;

const htmlDom = dumpDom(URL_HTML);
for (const marker of MARKERS) {
  if (htmlDom.includes(marker)) {
    console.log(`PASS  banner on raw .html view: ${marker} present`);
  } else {
    console.error(`FAIL  banner on raw .html view: ${marker} MISSING`);
    failures += 1;
  }
}

const mdDom = dumpDom(URL_MD);
const leaked = MARKERS.filter((m) => mdDom.includes(m));
if (leaked.length === 0) {
  console.log('PASS  no banner on raw .md view (heuristic stays quiet)');
} else {
  console.error(`FAIL  banner leaked onto non-HTML raw view: ${leaked.join(', ')}`);
  failures += 1;
}

console.log(failures === 0 ? 'extension canary: OK' : `extension canary: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
