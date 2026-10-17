/**
 * scripts/build-standalone.mjs — assemble portable single-file documents.
 *
 * Reads every `web/demo/*.html` source and substitutes marker comments with real
 * content, emitting two artifacts per source into `dist/demo/`. Pages under
 * `web/site/` are copied to `dist/site/` by the same marker expansion, and
 * the HTML specs under `spec/` are copied to `dist/spec/` with their linked
 * asset paths rewritten (see the last section).
 *
 * Per demo source:
 *
 *   <name>.html        everything inlined — opens from file:// with no network
 *   <name>.nojs.html   the same page with every <script> element removed
 *
 * The `.nojs.html` variant is the genuine JS-off artifact. The older
 * `window.__semJsOff` kill switch only proves the handler no-ops; it leaves
 * the script in the page, so it can never show that the CSS alone degrades
 * readably. Stripping the elements is the real test.
 *
 * Markers (HTML comments, so a source page stays valid HTML on its own):
 *
 *   <!-- sem:inline bundle -->                     dist/semtext.js
 *   <!-- sem:inline shell -->                      dist/semtext-js-shell.js (the
 *                                                   sem-shell demo pages — the
 *                                                   reader bundle has no
 *                                                   <sem-shell> in it)
 *   <!-- sem:inline theme <name> -->               themes/<name>.css
 *   <!-- sem:inline vocabulary -->                 dist/semtext.css (the built
 *                                                   vocabulary — identical to
 *                                                   themes/_vocabulary.css;
 *                                                   inlining the artifact
 *                                                   keeps "what ships is what
 *                                                   demos show" true)
 *   <!-- sem:inline size <script> -->              "N.N KB (N.N KB gzipped)"
 *   <!-- sem:inline size-mg <script> -->            "N.N KB minified, N.N KB gzipped"
 *   <!-- sem:inline size-kb <script> -->            "N.N"  (bare minified KB)
 *   <!-- sem:inline size-gzkb <script> -->          "N.N"  (bare gzipped KB)
 *                                                   all measured from
 *                                                   dist/semtext.js — never
 *                                                   hardcode a size in copy.
 *   <!-- sem:inline spec-version -->                "v0.6" — the draft spec
 *                                                   revision, from package.json
 *                                                   `specVersion`. Demo titles
 *                                                   and copy self-label from
 *                                                   here; never hardcode the
 *                                                   spec revision in a page.
 *   <!-- sem:inline pkg-version -->                 "0.7.1" — package.json
 *                                                   `version`.
 *   <!-- sem:inline build-sha -->                   short SHA of the checkout
 *                                                   the build ran in ("unknown"
 *                                                   when git is unavailable,
 *                                                   e.g. an exported tarball).
 *                                                   Landing footer only —
 *                                                   provenance, not identity.
 *
 * A marker whose source file is missing is a hard error: silently emitting a
 * page with no behavior in it is exactly the failure this script exists to
 * prevent.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { stripScripts, specAssetRefs, rewriteSpecPage } from './standalone-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist', 'demo');

const MARKER = /<!--\s*sem:inline\s+([a-z-]+)(?:\s+([A-Za-z0-9._-]+))?\s*-->/g;

/** package.json, read once. `specVersion` labels the draft spec revision the
 *  pages advertise; `version` is the npm package version. They move on
 *  different schedules and are deliberately separate fields. */
let pkgJson;
function pkg() {
  if (!pkgJson) pkgJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (!pkgJson.specVersion) {
    throw new Error('package.json has no specVersion — demo/copy markers `spec-version` need it; bump it with the spec');
  }
  return pkgJson;
}

/** Short SHA of the current checkout, for the landing footer's build
 *  provenance line. Falls back to a visible placeholder rather than failing
 *  the build: a tarball export has no git, and a missing SHA is worth seeing
 *  in the footer, not worth a red CI run. */
function buildSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function readOrDie(path, marker) {
  if (!existsSync(path)) {
    throw new Error(`marker "${marker}" needs ${path}, which does not exist — run scripts/build.mjs first`);
  }
  return readFileSync(path, 'utf8');
}

function expand(kind, arg) {
  switch (kind) {
    case 'bundle':
      return `<script>\n${readOrDie(resolve(root, 'dist/semtext.js'), 'bundle')}\n</script>`;
    case 'shell':
      return `<script>\n${readOrDie(resolve(root, 'dist/semtext-js-shell.js'), 'shell')}\n</script>`;
    case 'agent-kit':
      // The agent-kit namespace bundle (dist/agent-kit.js) — one inline
      // script, same contract as `bundle`; `agent-kit-lazy` is NOT inlined
      // (the demo authoring pattern registers every tag up front via the
      // full bundle; the lazy loader serves multi-page sites).
      return `<script>\n${readOrDie(resolve(root, 'dist/agent-kit.js'), 'agent-kit')}\n</script>`;
    case 'theme': {
      if (!arg) throw new Error('marker "theme" requires a theme name');
      return `<style data-sem-theme-source="${arg}">\n${readOrDie(resolve(root, 'themes', `${arg}.css`), 'theme')}\n</style>`;
    }
    case 'vocabulary':
      return `<style data-sem-vocabulary>\n${readOrDie(resolve(root, 'dist/semtext.css'), 'vocabulary')}\n</style>`;
    case 'size':
      return sizeParts(arg, 'size').text;
    case 'size-mg':
      return sizeParts(arg, 'size-mg').textMinGzip;
    case 'size-kb':
      return sizeParts(arg, 'size-kb').rawKb;
    case 'size-gzkb':
      return sizeParts(arg, 'size-gzkb').gzipKb;
    case 'spec-version':
      return `v${pkg().specVersion}`;
    case 'pkg-version':
      return pkg().version;
    case 'build-sha':
      return buildSha();
    default:
      throw new Error(`unknown inline marker "${kind}"`);
  }
}

/** Path (relative to repo root) of the built script a `sem:inline size` /
 *  `sem:inline size-mg` marker's argument names. One bundle since v0.6:
 *  every size marker measures `bundle`. Keep in sync with the `expand()`
 *  cases above — this is the single source of truth other copy should
 *  measure against instead of hardcoding a number. */
const SIZE_SOURCES = {
  bundle: 'dist/semtext.js',
  shell: 'dist/semtext-js-shell.js',
};

/** Measure a built script's real size (and gzip size) so page copy states
 *  the truth instead of a number that silently goes stale when the script
 *  changes. `size` marker text reads "9.2 KB (3.3 KB gzipped)"; `size-mg`
 *  reads "9.2 KB minified, 3.3 KB gzipped" for the artifacts table. */
function sizeParts(arg, marker) {
  if (!arg || !SIZE_SOURCES[arg]) {
    throw new Error(`marker "${marker}" needs a known script name (${Object.keys(SIZE_SOURCES).join(', ')}), got "${arg}"`);
  }
  const path = resolve(root, SIZE_SOURCES[arg]);
  if (!existsSync(path)) {
    throw new Error(`marker "${marker} ${arg}" needs ${path}, which does not exist — run scripts/build.mjs first`);
  }
  const buf = readFileSync(path);
  const rawKb = (buf.length / 1024).toFixed(1);
  // gzipSync defaults to zlib level 6. That's an assumption pinned here on
  // purpose: it approximates typical gzip-negotiated transfer, not whatever
  // level (or brotli) the production server actually negotiates, so the
  // advertised "gzipped" figure is a representative estimate, not a promise.
  const gzipKb = (gzipSync(buf).length / 1024).toFixed(1);
  return {
    rawKb,
    gzipKb,
    text: `${rawKb} KB (${gzipKb} KB gzipped)`,
    textMinGzip: `${rawKb} KB minified, ${gzipKb} KB gzipped`
  };
}

mkdirSync(outDir, { recursive: true });

const sources = readdirSync(resolve(root, 'web', 'demo'))
  .filter((f) => f.endsWith('.html'))
  .sort();

if (sources.length === 0) {
  console.error('✗ no web/demo/*.html sources found');
  process.exit(1);
}

console.log('\n  page                          inlined   size     nojs');
console.log('  ---------------------------------------------------------');

for (const file of sources) {
  const src = readFileSync(resolve(root, 'web', 'demo', file), 'utf8');
  let count = 0;
  const built = src.replace(MARKER, (_m, kind, arg) => {
    count++;
    return expand(kind, arg);
  });

  const name = basename(file, '.html');
  const page = resolve(outDir, `${name}.html`);
  const nojs = resolve(outDir, `${name}.nojs.html`);
  writeFileSync(page, built);
  writeFileSync(nojs, stripScripts(built, `web/demo/${basename(file)}`));

  const kb = (p) => (statSync(p).size / 1024).toFixed(1).padStart(6) + ' KB';
  console.log(`  ${file.padEnd(30)}${String(count).padStart(5)}  ${kb(page)}${kb(nojs)}`);
}

// Static demo assets: the data-visualizer showcase fetches files relative to
// the page (web/demo/data/**), so dist/demo needs them copied verbatim.
const dataSrc = resolve(root, 'web', 'demo', 'data');
if (existsSync(dataSrc)) {
  const dataOut = resolve(outDir, 'data');
  mkdirSync(dataOut, { recursive: true });
  for (const f of readdirSync(dataSrc)) copyFileSync(resolve(dataSrc, f), resolve(dataOut, f));
  console.log(`\n  copied web/demo/data/** → dist/demo/data/ (${readdirSync(dataSrc).length} files)`);
}

// Demo start scripts: a `start-script="<path>"` shell fetches its demo-format
// file at runtime (the landing page's contract), so dist/demo needs the
// scripts served verbatim (web/demo/scripts/**).
const scriptsSrc = resolve(root, 'web', 'demo', 'scripts');
if (existsSync(scriptsSrc)) {
  const scriptsOut = resolve(outDir, 'scripts');
  mkdirSync(scriptsOut, { recursive: true });
  for (const f of readdirSync(scriptsSrc)) copyFileSync(resolve(scriptsSrc, f), resolve(scriptsOut, f));
  console.log(`  copied web/demo/scripts/** → dist/demo/scripts/ (${readdirSync(scriptsSrc).length} files)`);
}
console.log('');

/* ---------------------------------------------------------------------------
 * Marketing site — web/site/ → dist/site/
 *
 * Marker expansion applies (the landing page labels artifact sizes and the
 * build SHA through `sem:inline` markers), and each page also emits a
 * `.nojs.html` variant — scripts stripped — for the JS-off assertions in
 * test/e2e/site.cy.js. Absent web/site/, this section is a no-op.
 * ------------------------------------------------------------------------ */

const siteSrcDir = resolve(root, 'web', 'site');
if (existsSync(siteSrcDir)) {
  const siteOutDir = resolve(root, 'dist', 'site');
  mkdirSync(siteOutDir, { recursive: true });

  const sitePages = readdirSync(siteSrcDir).filter((f) => f.endsWith('.html')).sort();

  console.log('  site page                     inlined   size     nojs');
  console.log('  -------------------------------------------------------------------');
  for (const file of sitePages) {
    const src = readFileSync(resolve(siteSrcDir, file), 'utf8');
    let count = 0;
    const built = src.replace(MARKER, (_m, kind, arg) => {
      count++;
      return expand(kind, arg);
    });
    const page = resolve(siteOutDir, file);
    const nojs = resolve(siteOutDir, file.replace(/\.html$/, '.nojs.html'));
    writeFileSync(page, built);
    writeFileSync(nojs, stripScripts(built, `web/site/${file}`));
    const kb = (p) => (statSync(p).size / 1024).toFixed(1).padStart(6) + ' KB';
    console.log(`  ${file.padEnd(30)}${String(count).padStart(5)}  ${kb(page)}${kb(nojs)}`);
  }
  console.log('');
}

/* ---------------------------------------------------------------------------
 * Spec pages — spec/*.html → dist/spec/
 *
 * The HTML specs are SemText documents that LINK their assets rather than
 * inlining them (spec/conventions.html carries no <style> or inline
 * <script> at all). Served from the repo root they reach ../themes/ and
 * ../dist/; shipped from dist/ the same page sits one level down, so the
 * copy rewrites `../dist/` to `../` and the theme files are copied to
 * dist/themes/ so `../themes/` keeps resolving. spec/spec.css (the document
 * layout layer) travels next to the page. A `<name>.nojs.html` variant is
 * emitted like the demos, for the JS-off assertions in
 * test/e2e/spec-pages.cy.js.
 * ------------------------------------------------------------------------ */

const specSrcDir = resolve(root, 'spec');
const specPages = readdirSync(specSrcDir).filter((f) => f.endsWith('.html')).sort();
if (specPages.length) {
  const specOutDir = resolve(root, 'dist', 'spec');
  const themesOutDir = resolve(root, 'dist', 'themes');
  mkdirSync(specOutDir, { recursive: true });
  mkdirSync(themesOutDir, { recursive: true });
  // Named themes ship under their `semtext-theme-` prefix (dist/themes/, as
  // built by scripts/build.mjs); the vocabulary is dist/semtext.css, already
  // emitted, and is not duplicated here.
  for (const css of readdirSync(resolve(root, 'themes')).filter((f) => f.endsWith('.css'))) {
    if (css === '_vocabulary.css') continue;
    copyFileSync(resolve(root, 'themes', css), resolve(themesOutDir, `semtext-theme-${css}`));
  }
  for (const css of readdirSync(specSrcDir).filter((f) => f.endsWith('.css'))) {
    copyFileSync(resolve(specSrcDir, css), resolve(specOutDir, css));
  }
  // The normative Markdown ships next to the HTML pages, and the per-element
  // schemas with them: llms.txt (below) links both, and a link that 404s in
  // the shipped image is the same failure as a missing marker source.
  const schemaSrcDir = resolve(specSrcDir, 'schema');
  const schemaOutDir = resolve(specOutDir, 'schema');
  mkdirSync(schemaOutDir, { recursive: true });
  for (const md of readdirSync(specSrcDir).filter((f) => f.endsWith('.md'))) {
    copyFileSync(resolve(specSrcDir, md), resolve(specOutDir, md));
  }
  for (const md of readdirSync(schemaSrcDir).filter((f) => f.endsWith('.md'))) {
    copyFileSync(resolve(schemaSrcDir, md), resolve(schemaOutDir, md));
  }

  console.log('  spec page                     size     nojs');
  console.log('  ---------------------------------------------------------');
  for (const file of specPages) {
    const src = readFileSync(resolve(specSrcDir, file), 'utf8');
    // Every relative linked asset must exist (scripts/standalone-lib.mjs
    // decides what counts), for the same reason a missing marker source is
    // a hard error above: a spec page that loads no behaviour would
    // silently stop proving anything. Pages reference themes by their
    // shipped `semtext-theme-` name; the source file carries no prefix.
    for (const { ref, rel } of specAssetRefs(src)) {
      const check = rel.replace(/^(themes\/)semtext-theme-(.+\.css)$/, 'themes/$2');
      if (!existsSync(resolve(root, check))) throw new Error(`spec/${file} links ${ref}, which does not exist`);
    }
    const built = rewriteSpecPage(src);
    const name = basename(file, '.html');
    const page = resolve(specOutDir, `${name}.html`);
    const nojs = resolve(specOutDir, `${name}.nojs.html`);
    writeFileSync(page, built);
    writeFileSync(nojs, stripScripts(built, `spec/${file}`));
    const kb = (p) => (statSync(p).size / 1024).toFixed(1).padStart(6) + ' KB';
    console.log(`  ${file.padEnd(30)}${kb(page)}${kb(nojs)}`);
  }
  console.log('');
}

/* ---------------------------------------------------------------------------
 * llms.txt — the agent-facing index, generated into dist/site/ (the image's
 * site root: Dockerfile COPYs dist/site/ to /usr/share/nginx/html/).
 *
 * Generated, never hand-written, for the same reason page copy measures sizes
 * instead of hardcoding them: a listed link that 404s is the exact failure
 * this build exists to prevent. Every link is checked to exist before it is
 * written. Paths are relative to the file itself (`../spec/…`), so the same
 * text resolves from the image root (/llms.txt) and from the local preview
 * (/site/llms.txt) without a rebuild.
 * ------------------------------------------------------------------------ */

const invariantAnchor = '8-machine-readability-contract';
const conventionsHtml = readOrDie(resolve(root, 'dist', 'spec', 'conventions.html'), 'llms.txt conventions.html');
if (!conventionsHtml.includes(`id="${invariantAnchor}"`)) {
  throw new Error(`llms.txt links spec/conventions.html#${invariantAnchor}, but that anchor is missing from the built page`);
}

const schemaMds = readdirSync(resolve(root, 'spec', 'schema')).filter((f) => f.endsWith('.md')).sort();

const llms = [
  '# SemText',
  '',
  '> SemText is a custom-element vocabulary — the document-shaped XML variant of NPL — that enriches valid HTML5 with machine-readable semantics while staying readable with JavaScript off. Extraction projects any SemText document to a stable, ordered record array or to annotated plain text. The extraction invariant E(D) = E(R(D)) = E(I(R(D))) is normative: the machine consumer never gets a degraded reading of what the human consumer saw.',
  '',
  `Spec v${pkg().specVersion} (draft) · package v${pkg().version}.`,
  '',
  '## Docs',
  '',
  '- [Specification (HTML)](../spec/conventions.html): the vocabulary, document skeleton, attribute catalog, fallback and degradation rules, element entries, themes, distribution forms',
  '- [Specification (Markdown)](../spec/conventions.md): the same document, normative Markdown source',
  `- [Machine-readability contract (§8)](../spec/conventions.html#${invariantAnchor}): the extraction invariant, what a consumer may rely on, and what is best-effort only`,
  '- [Extraction schema (Markdown)](../spec/extraction.md): record shape, emission rules, the central invariant and its recorded exception, annotated plain text',
  '',
  '## Element schemas',
  '',
  ...schemaMds.map((f) => `- [${basename(f, '.md')}](../spec/schema/${f})`),
  '',
  '## Demo',
  '',
  '- [Live demo](../demo/index.html): the vocabulary running on all three tiers',
  '- [JavaScript-off artifact](../demo/index.nojs.html): the same page with every script stripped — readable, and extraction-identical',
  '',
].join('\n');

const llmsPath = resolve(root, 'dist', 'site', 'llms.txt');
writeFileSync(llmsPath, llms);
console.log(`  llms.txt                       ${(statSync(llmsPath).size / 1024).toFixed(1).padStart(6)} KB  (${schemaMds.length} schema links)`);
