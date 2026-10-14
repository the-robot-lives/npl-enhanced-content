// Unit spec — Dockerfile ships every asset the standalone spec page needs
//
// Feature: dist/spec/conventions.html must not 404/fallback in the image
//   Scenario: every top-level dist/ path the built spec page references by a
//     relative link is copied into the nginx html root by a Dockerfile COPY
//
// Regression: the Dockerfile once copied only dist/site -> / and dist/demo ->
// /demo/. dist/spec/conventions.html (built by scripts/build-standalone.mjs)
// links ../semtext*.js, ../themes/*.css and ./spec.css — i.e. it expects the
// whole dist/ root to be served at /. Without a matching COPY, nginx's SPA
// `try_files ... /index.html` fallback silently serves the landing page at
// /spec/conventions.html instead of 404ing or erroring the build.
//
// This test parses the Dockerfile's COPY lines (no docker daemon needed) and
// cross-checks them against the actual built spec page's relative asset refs,
// so a future Dockerfile edit that drops one of these COPYs fails here
// instead of silently shipping a broken /spec/ route.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { specAssetRefs } from '../../scripts/standalone-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_PAGE = path.join(ROOT, 'dist/spec/conventions.html');
const DOCKERFILE = path.join(ROOT, 'Dockerfile');

// Every dist/ artifact this test cross-checks the Dockerfile against — not
// just the spec page. Checking SPEC_PAGE alone would let a partial/stale
// dist/ (e.g. an interrupted build that produced dist/spec/ but never
// refreshed dist/themes/ or dist/semtext*.js) pass silently: the test would
// read real files, just not the ones a fresh build would emit, weakening the
// cross-check without failing it.
const REQUIRED_DIST_PATHS = [
  SPEC_PAGE,
  path.join(ROOT, 'dist/semtext.css'),
  path.join(ROOT, 'dist/semtext.js'),
  path.join(ROOT, 'dist/themes/semtext-theme-minimal-tech-light.css'),
  path.join(ROOT, 'dist/site/index.html'),
  path.join(ROOT, 'dist/demo'),
];

beforeAll(() => {
  // The dist/ artifact this test inspects is a build output, not something
  // committed. Build it if a prior `npm run build` hasn't already produced
  // a complete dist/, so `vitest run` is self-sufficient on a clean checkout
  // and doesn't trust a partial dist/ left over from an interrupted build.
  if (!REQUIRED_DIST_PATHS.every(existsSync)) {
    execFileSync('node', ['scripts/build.mjs'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('node', ['scripts/build-standalone.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
}, 120_000);

/** Every dist/-relative top-level path segment (dir name, or bare filename
 *  for a root-level file) that the built spec page links to. */
function specDistTopLevelRefs() {
  const html = readFileSync(SPEC_PAGE, 'utf8');
  // specAssetRefs resolves every relative ref against the repo root
  // (../foo -> foo, /foo -> foo, bare foo -> spec/foo). The page's own
  // #anchors and the GitHub "view source" links to spec/*.md are absolute
  // or fragment-only, so specAssetRefs already excludes them.
  const refs = specAssetRefs(html).map((r) => r.rel);
  const top = new Set();
  for (const rel of refs) {
    top.add(rel.split('/')[0]);
  }
  return top;
}

/** Every path this Dockerfile's production stage COPYs into the nginx html
 *  root, as the top-level name it lands under (dir copies keep their
 *  trailing-slash dest name; file-glob copies land at the html root itself,
 *  represented here by each concrete built filename). */
function dockerfileHtmlRootEntries() {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  const entries = new Set();
  const copyRe = /^COPY\s+--from=builder\s+(\S+)\s+(\S+)\s*$/gm;
  for (const m of dockerfile.matchAll(copyRe)) {
    const [, src, dest] = m;
    if (!dest.startsWith('/usr/share/nginx/html')) continue; // not the html root (e.g. templates/)
    const srcName = src.replace(/^\/app\/dist\//, '');
    if (srcName.includes('*')) {
      // Glob copy (e.g. dist/semtext*.js) lands each matched file directly
      // at the html root — record it as a root-level entry, one per real
      // built file matching the glob, not the glob text itself.
      const dir = path.dirname(path.join(ROOT, src.replace(/^\/app\//, '')));
      const glob = path.basename(src);
      // No regex: a Dockerfile COPY glob here is only `<prefix>*<suffix>`
      // (e.g. semtext*.js), so match by literal prefix and suffix. This
      // avoids building a RegExp from the glob text at all (CodeQL
      // js/incomplete-sanitization on the escaping).
      const star = glob.indexOf('*');
      const prefix = glob.slice(0, star);
      const suffix = glob.slice(star + 1);
      if (suffix.includes('*')) throw new Error(`unsupported COPY glob: ${glob}`);
      // fall back to a direct fs read since no globbing lib is a dependency here
      for (const f of readDirSafe(dir)) {
        if (f.startsWith(prefix) && f.endsWith(suffix) && f.length >= prefix.length + suffix.length) entries.add(f);
      }
    } else {
      // Directory or single-file copy: what matters for this test is only
      // the top-level name the src maps under dist/.
      entries.add(srcName.replace(/\/$/, ''));
    }
  }
  return entries;
}

function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

describe('Dockerfile ships every dist/ asset the standalone spec page needs', () => {
  it('COPYs a matching entry for each top-level dist/ ref the built spec page links', () => {
    const needed = specDistTopLevelRefs();
    const shipped = dockerfileHtmlRootEntries();

    const missing = [...needed].filter((name) => !shipped.has(name));
    expect(missing, `Dockerfile is missing a COPY for: ${missing.join(', ')} (spec page references it, but no COPY --from=builder lands it under /usr/share/nginx/html). Shipped entries: ${[...shipped].sort().join(', ')}`).toEqual([]);
  });

  it('sanity: the spec page actually references at least the known cross-dist assets', () => {
    // Guards the guard: if build-standalone.mjs ever stops emitting these
    // refs, this test would trivially pass with an empty `needed` set above.
    const needed = specDistTopLevelRefs();
    expect(needed.has('themes')).toBe(true);
    expect(needed.has('semtext.js')).toBe(true);
  });
});
