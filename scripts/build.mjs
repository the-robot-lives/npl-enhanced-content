/**
 * scripts/build.mjs — the one bundle, one command (spec v0.6).
 *
 * `vite build` with `build.lib.formats: ['iife']` supports exactly one entry,
 * and the package ships exactly one script:
 *
 *   dist/semtext.js   Lit custom elements + the vanilla handlers (core,
 *                     reading, Markdown) + extraction   (global SemText)
 *
 * plus its stylesheets, copied verbatim from themes/ (no build step — the
 * theme files are the shipped artifacts):
 *
 *   dist/semtext.css                    from themes/_vocabulary.css
 *   dist/themes/semtext-theme-<n>.css   from themes/<n>.css
 *
 * The former per-tier scripts (semtext-fallback.js, semtext-reading.js,
 * semtext-extract.js, semtext-md.js) are retired: everything lives in the
 * one IIFE, and the handlers run for elements no component defines.
 *
 * Beside the full bundles (and never instead of them — see the surface
 * contract in each lazy banner), the LAZY phase below emits two loaders,
 * one per namespace, from the same shared boot wiring (src/lazy/boot.ts):
 *
 *   dist/semtext-lazy.js        scans the document for sem-* tags (the
 *                               <sem-text> wrapper is optional) and imports
 *                               only the component chunks those tags need
 *                               (ES modules; needs a server)
 *   dist/chunks/<tag>.js        one entry chunk per sem-* component (from
 *                               the register calls in src/lit/sem-*.ts) plus
 *                               the shared chunks rollup factors out
 *   dist/npl-lazy.js            the same contract for the npl-* namespace
 *                               (src/lit/npl/npl-*.ts, defineNpl calls)
 *   dist/npl-chunks/<tag>.js    one entry chunk per npl-* component plus
 *                               its shared chunks
 *   dist/semtext-manifest.json  the generated tag → chunk manifests
 *   dist/npl-manifest.json      (one per loader)
 *
 * Both manifests are generated from the component lists, never
 * hand-maintained: a new component — src/lit/sem-*.ts calling
 * `SemElement.register('<tag>', …)`, or src/lit/npl/npl-*.ts calling
 * `defineNpl('<tag>', …)` — is picked up on the next build and inlined
 * into its loader through a virtual module. The chunk split changes no
 * bytes of dist/semtext.js — the IIFE phase runs first, untouched. Core
 * (semtext.js, semtext-lazy.js, chunks/) carries only sem-* code; the npl
 * namespace ships whole in npl.js or per-document in npl-lazy.js.
 *
 * The target declares a size budget; the build prints measured size against
 * it and fails only if `--strict-budget` is passed, so a budget overrun is
 * always visible but never silently blocks local work. Targets flagged
 * `budgetReportOnly: true` (the shell and editor bundles — opt-in tools,
 * deliberately uncapped per user decision 2026-10-17) print their budget
 * row but never set the failure flag; every reader bundle's budget stays a
 * hard fail. The budget history is
 * recorded in ROADMAP.md ("R — Reading experience"); change both together.
 *
 * `--out <dir>` writes every artifact into <dir> instead of dist/ and never
 * touches dist/ (parallel/private builds, snap previews). Relative paths
 * resolve against the repo root; the filesystem root, the repo root and
 * anything above the repo are refused, since the build wipes its target.
 */

import { existsSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, relative } from 'node:path';

// Pin NODE_ENV before vite is even imported: ambient NODE_ENV=test (a vitest
// run that self-builds via dockerfile.test.mjs) otherwise selects Lit's
// "development" export condition and inflates the artifact ~12 KB — the
// budget would then measure a bundle we never ship.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict-budget');

/* --out <dir> builds into <dir> instead of dist/ — a private output that
 * never touches the shared default (parallel builds, snap previews).
 * Relative paths resolve against the repo root. Refused: the filesystem
 * root, the repo root itself, and any directory ABOVE the repo — the
 * clean step rm's the target, so an --out containing root would be
 * destroyed. Anything strictly inside the repo that isn't root is
 * allowed (the caller owns that path). */
const outIndex = process.argv.indexOf('--out');
let distDir = resolve(root, 'dist');
let distLabel = 'dist';
if (outIndex !== -1) {
  const value = process.argv[outIndex + 1];
  if (!value || value.startsWith('-')) {
    console.error('✗ --out requires a directory argument (e.g. --out /tmp/semtext-build)');
    process.exit(1);
  }
  const outDir = resolve(root, value);
  if (outDir === '/' || outDir === root || root.startsWith(outDir + '/')) {
    console.error(`✗ refusing --out ${value}: it would wipe the repo or above it`);
    process.exit(1);
  }
  distDir = outDir;
  // Prefer a root-relative label for readability, but never a long ../
  // chain — outside-the-repo targets print as absolute paths.
  const rel = relative(root, outDir);
  distLabel = rel && !rel.startsWith('..') ? rel : outDir;
}

const targets = [
  {
    name: 'semtext.js',
    entry: 'src/index.ts',
    global: 'SemText',
    // Raised from the five-artifact total (fallback 14 + reading 19.5 +
    // semtext.js 56 + extract 12 + md 8.5): the single bundle pays shared
    // module overhead once. History per retired artifact in ROADMAP.md.
    // 96 → 126 KB (2026-10-13, data-visualizer phases 1–6 join the single
    // bundle with the reading merge: payload parsers, sql/query engine,
    // source loader, modal viewer + deep links — measured 124.1). Recorded
    // in ROADMAP "Size budgets".
    // 126 → 144 KB (2026-10-14, user decision): docs-overhaul content landed
    // at 132.3 raw. Recorded in ROADMAP "Size budgets".
    budgetKb: 144,
    required: true,
  },
  {
    // The npl-* namespace, whole, for NPL documents that skip chunk
    // loading. Core never carries this code: src/index.ts imports nothing
    // from src/lit/npl/, and the npl barrel is src/npl.ts's only input.
    name: 'npl.js',
    entry: 'src/npl.ts',
    global: 'NPL',
    // 48 → 52 KB (2026-10-14, docs-overhaul landing; spec r4-1 budget
    // note — ROADMAP "Size budgets" carries the history).
    budgetKb: 52,
    required: true,
  },
  {
    // Agent toolkit (filter/search/outline/expand/write/edit). Consumed by
    // bin/semtext-agent.mjs and `semtext/agent`; required: false so the
    // CLI-only dependency never blocks the browser artifacts' budget.
    // Budget 24 KB = the extractor bundle (12) plus the toolkit itself
    // (measured 20.2 at introduction, 2026-10).
    name: 'semtext-agent.js',
    entry: 'src/agent/index.ts',
    global: 'SemTextAgent',
    budgetKb: 24,
    required: false,
  },
  {
    // The interactive terminal (sem-shell + sem-terminal: POSIX plugin,
    // semtext CLI, scripted playback, flashcard TUI) as its own standalone
    // bundle. Kept OUT of the core entry on purpose — demo/agent tooling,
    // not document vocabulary; semtext.js must not grow for it.
    name: 'semtext-js-shell.js',
    entry: 'src/js-shell.ts',
    global: 'SemTextShell',
    // 96 → 256 KB: the canvas-everywhere terminal renderer raise (commit
    // 6b34053 updated ROADMAP "Size budgets" but not this constant — the
    // build table has disagreed with the recorded budget since).
    // Advisory since the packages round (user decision, 2026-10-17): the
    // shell is demo/agent tooling, not a main package — its size is
    // reported, never blocking. Reader bundles (semtext.js / npl.js / the
    // lazy loaders) keep hard budgets.
    budgetKb: 256,
    // Opt-in tool bundle, uncapped by user decision 2026-10-17: the budget
    // row reports, `--strict-budget` never fails on it.
    budgetReportOnly: true,
    required: true,
    advisory: true,
    // The nano editor body stays out of the shell: the LazyNano stub's
    // dynamic `import('./nano-app.js')` must survive the IIFE build, so the
    // specifier is marked external and the chunk below ships it separately
    // (shell-v3 r3, r3-nano cross-lane patch — measured −~18 KB gross).
    rollupExternal: [/nano-app\.js$/],
  },
  {
    // The nano editor body as its own IIFE chunk, loaded on first `nano`
    // invocation (see the shell target's rollupExternal note). The file
    // name MUST stay `nano-app.js` — the stub's relative specifier resolves
    // against it with zero runtime changes.
    name: 'nano-app.js',
    entry: 'src/terminal/apps/nano/nano-app.ts',
    global: 'SemTextNano',
    budgetKb: 24,
    required: true,
  },
  {
    // The editor (shell + controller + insert/dnd/io + descriptors, §9).
    // Loaded on demand by the core hook (src/lit/edit-hook.ts); core pays
    // only the queue + one dynamic import. `editorSchema` swaps the bundled
    // elements.json import for a slim build-time projection (examples and
    // prose descriptions dropped — ~14 KB of example text + prose the editor
    // never reads; insert templates come from the descriptor registry, not
    // the schema).
    //
    // 128 → 256 KB (2026-10-14, integrate): the §9.1 estimate assumed the
    // schema dominated the payload. The integrated editor measures 245.1 raw
    // / 69.8 gzipped with the slim schema in place — 12.8 K lines across
    // model/shell/controller/insert/dnd/io/code/descriptors, of which ~34 KB
    // is injected CSS that minification cannot shrink. A lazy descriptor
    // split was evaluated and rejected for now: side-effect registration
    // needs one registry instance, so a second IIFE would have to re-plumb
    // all 55 descriptor modules through a global shim. History in ROADMAP
    // "Size budgets".
    name: 'semtext-editor.js',
    entry: 'src/editor/index.ts',
    global: 'SemTextEditor',
    budgetKb: 256,
    // Opt-in tool bundle, uncapped by user decision 2026-10-17: the budget
    // row reports, `--strict-budget` never fails on it.
    budgetReportOnly: true,
    required: true,
    editorSchema: true,
  },
];

/* Command packages (packages round, LANE=pkg-infra): every
 * `src/terminal/packages/<pkg>/index.ts` auto-chunks to
 * `semtext-pkg-<pkg>.js` next to the shell bundle — no per-lane build
 * edit, registration is just the manifest.ts lines. ES-module format: a
 * package stub loads its chunk with a runtime dynamic `import()` (the
 * @vite-ignore pattern, src/terminal/packages/lazy.ts), which needs real
 * exports; the IIFE shell cannot carry them. Chunks are self-contained by
 * contract (index.ts imports only types from outside its directory), so
 * one lib build per package, no shared-chunk factoring. `required: false`
 * — a half-landed package (no index.ts yet) is skipped, never fatal; a
 * worker referenced as `new Worker(new URL('./x.js', import.meta.url))`
 * inside the chunk's graph is emitted as its own file next to it. */
const packagesDir = resolve(root, 'src/terminal/packages');
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryRel = `src/terminal/packages/${entry.name}/index.ts`;
    if (!existsSync(resolve(root, entryRel))) continue;
    const pascal = entry.name.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
    targets.push({
      name: `semtext-pkg-${entry.name}.js`,
      entry: entryRel,
      global: `SemTextPkg${pascal}`,
      formats: ['es'],
      budgetKb: 64,
      required: false,
      // Package chunks are report-only too (same user decision): the
      // contract keeps LOAD lazy, and bytes never block the build.
      advisory: true,
    });
  }
}

/** Vite plugin: resolve elements.json to the editor's slim projection. Test
 *  runs (vitest) import the real file; only the built bundle is slimmed. */
function editorSchemaSlim() {
  return {
    name: 'editor-slim-schema',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('elements.json')) return '\0semtext-editor-elements-slim';
      return null;
    },
    load(id) {
      if (id !== '\0semtext-editor-elements-slim') return null;
      const raw = JSON.parse(readFileSync(resolve(root, 'elements.json'), 'utf8'));
      const slim = {
        specVersion: raw.specVersion,
        tagCount: raw.tagCount,
        tags: (raw.tags ?? []).map((t) => ({
          name: t.name,
          family: t.family,
          summary: t.summary,
          attributes: (t.attributes ?? []).map((a) => ({
            name: a.name,
            required: a.required === true ? true : null,
            type: a.type,
            allowedValues: a.allowedValues,
            default: a.default,
            description: a.description,
          })),
          children: (t.children ?? []).map((c) => ({ name: c.name })),
          optionsIn: t.optionsIn,
        })),
      };
      return `export default ${JSON.stringify(slim)};`;
    },
  };
}

rmSync(distDir, { recursive: true, force: true });

const results = [];
let overBudget = false;

for (const target of targets) {
  const entry = resolve(root, target.entry);
  if (!existsSync(entry)) {
    if (target.required) {
      console.error(`✗ ${target.name}: entry ${target.entry} is missing — cannot build`);
      process.exit(1);
    }
    console.warn(`• ${target.name}: skipped — entry ${target.entry} does not exist yet`);
    continue;
  }

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    // Package targets are ES modules: the stubs' runtime dynamic `import()`
    // reads the chunks' named exports (`commands`, `manPages`) — an IIFE
    // chunk has none and would fail to load in every browser.
    ...(target.formats ? { base: './' } : {}),
    // The editor bundle swaps elements.json for its slim projection.
    ...(target.editorSchema ? { plugins: [editorSchemaSlim()] } : {}),
    // Module workers (the wasm chunk's runner) keep their own build; pin
    // the emitted file FLAT and stable so it sits next to the chunk —
    // `worker-main.js`, no hash, no /assets/ subdir.
    ...(target.formats
      ? {
          worker: {
            format: 'es',
            rollupOptions: { output: { entryFileNames: 'worker-main.js', chunkFileNames: 'worker-[name].js' } },
          },
        }
      : {}),
    build: {
      target: 'es2022',
      outDir: distDir,
      emptyOutDir: false,
      lib: { entry, formats: target.formats ?? ['iife'], name: target.global, fileName: () => target.name },
      // Per-target external specifiers (shell keeps `nano-app.js` lazy).
      ...(target.rollupExternal ? { rollupOptions: { external: target.rollupExternal } } : {}),
      // Package chunks: assets (the wasm worker) land FLAT and relative —
      // `worker-main.js` next to the chunk, no hash, no /assets/ absolute
      // path (the no-fetch-outside-bundle-dir rule).
      ...(target.formats ? { rollupOptions: { output: { assetFileNames: '[name][extname]' } } } : {}),
    },
  });

  const file = resolve(distDir, target.name);
  const bytes = statSync(file).size;
  const gzip = gzipSync(readFileSync(file)).length;
  const budget = target.budgetKb * 1024;
  const over = bytes > budget;
  // Report-only budgets (shell + editor + package chunks — uncapped opt-in
  // tools per the user decision 2026-10-17) print ✗ OVER but never trip
  // the --strict-budget exit; reader budgets always do. `advisory` is the
  // packages-round spelling of the same flag.
  const reportOnly = target.budgetReportOnly === true || target.advisory === true;
  if (over && !reportOnly) overBudget = true;
  results.push({ name: target.name, bytes, gzip, budget, over, ok: !over, reportOnly });
}

/* js-shell manifest — both terminal tags ship in the one standalone bundle
 * (self-contained: the demo plugin's documents are `?raw`-inlined, so there
 * are no runtime fetches and no chunks). Emitted next to the other
 * manifests so a consumer can resolve either tag without hardcoding. */
writeFileSync(
  resolve(distDir, 'semtext-js-shell-manifest.json'),
  JSON.stringify(
    {
      'sem-terminal': 'semtext-js-shell.js',
      'sem-shell': 'semtext-js-shell.js',
      // the lazy nano editor chunk (loaded by the shell's LazyNano stub)
      'nano-app': 'nano-app.js',
    },
    null,
    2,
  ) + '\n',
);

/* ---------------------------------------------------------------------------
 * Lazy phase — semtext-lazy.js + chunks/, npl-lazy.js + npl-chunks/ (see
 * the header comment). One loop, one config per namespace.
 *
 * The surface contract ships as a banner prepended AFTER the build, because
 * minification strips source comments and each artifact must state its own
 * terms (server required; the full bundle is the saved-single-file surface).
 * ------------------------------------------------------------------------ */

/** One lazy loader per tag namespace: which source dir feeds the manifest
 *  scan, which register call names its components, where its entry lives
 *  and where its chunks land. The two builds are independent rollup runs —
 *  shared helpers (the Lit runtime, SemElement) are factored per loader,
 *  and double registration is impossible: SemElement.register and
 *  defineNpl are both idempotent, and the manifests are disjoint. */
const LAZY_TARGETS = [
  {
    id: 'semtext-lazy',
    entry: 'src/lazy/index.ts',
    litDir: resolve(root, 'src/lit'),
    fileFilter: (f) => f.startsWith('sem-') && f.endsWith('.ts'),
    // customElements.define alternative: media-gallery/upload-drop register that way
    registerRe: /(?:SemElement\.register|^\s*customElements\.define)\(\s*'([a-z][a-z0-9-]*)'/gm,
    virtualId: 'virtual:semtext-manifest',
    chunkDir: 'chunks',
    budgetKb: 8,
    fullBundle: 'semtext.js',
    tags: 'sem-*',
  },
  {
    id: 'npl-lazy',
    entry: 'src/lazy/npl.ts',
    litDir: resolve(root, 'src/lit/npl'),
    fileFilter: (f) => f.startsWith('npl-') && f.endsWith('.ts'),
    // anchored: doc-comment bullets also spell `defineNpl('npl-x', ...)` — only real top-level calls register
    registerRe: /^\s*defineNpl\(\s*'([a-z][a-z0-9-]*)'/gm,
    virtualId: 'virtual:npl-manifest',
    chunkDir: 'npl-chunks',
    budgetKb: 8,
    fullBundle: 'npl.js',
    tags: 'npl-*',
  },
];

for (const lazy of LAZY_TARGETS) {
  if (!existsSync(resolve(root, lazy.entry))) {
    console.error(`✗ ${lazy.id}.js: entry ${lazy.entry} is missing — cannot build`);
    process.exit(1);
  }

  /** tag → chunk path (relative to dist/), and chunk-stem → entry file.
   *  Both derived from the same register calls the full bundle is built
   *  from — the manifest can never name a component the bundle lacks. */
  const lazyManifest = {};
  const componentEntries = {};
  for (const file of readdirSync(lazy.litDir).filter(lazy.fileFilter).sort()) {
    const source = readFileSync(resolve(lazy.litDir, file), 'utf8');
    const stem = basename(file, '.ts');
    for (const m of source.matchAll(lazy.registerRe)) {
      const tag = m[1];
      if (lazyManifest[tag]) {
        console.error(`✗ ${lazy.id} build: tag "${tag}" is registered by both ${lazyManifest[tag]} and ${lazy.chunkDir}/${stem}.js — one component per tag`);
        process.exit(1);
      }
      lazyManifest[tag] = `${lazy.chunkDir}/${stem}.js`;
      componentEntries[stem] = resolve(lazy.litDir, file);
    }
  }

  if (Object.keys(lazyManifest).length === 0) {
    console.error(`✗ ${lazy.id} build: no register calls found in ${lazy.litDir}`);
    process.exit(1);
  }

  /** Serves the generated manifest to the bundle at build time, so the
   *  artifact inlines it (no runtime fetch of a JSON file) while the
   *  source never hardcodes a component list. */
  const manifestPlugin = {
    name: `${lazy.id}-manifest`,
    resolveId(id) {
      return id === lazy.virtualId ? `\0${lazy.virtualId}` : null;
    },
    load(id) {
      return id === `\0${lazy.virtualId}` ? `export default ${JSON.stringify(lazyManifest)};` : null;
    },
  };

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    plugins: [manifestPlugin],
    build: {
      target: 'es2022',
      outDir: distDir,
      emptyOutDir: false,
      // No preload helper: the loader's dynamic imports are @vite-ignore'd
      // (they resolve at runtime, next to the built script) and the entry
      // ships alone, not wrapped in vite's module-preload runtime.
      modulePreload: false,
      rollupOptions: {
        input: { ...componentEntries, [lazy.id]: resolve(root, lazy.entry) },
        output: {
          entryFileNames: (chunk) => (chunk.name === lazy.id ? `${lazy.id}.js` : `${lazy.chunkDir}/${chunk.name}.js`),
          chunkFileNames: `${lazy.chunkDir}/[name]-[hash].js`,
        },
      },
    },
  });

  const banner = `/*
 * ${lazy.id}.js — ${lazy.tags} components, on demand (spec v0.6).
 *
 * Pair with semtext.css: this script scans the whole document for ${lazy.tags}
 * tags (a wrapper is welcome but not required) and imports only the
 * component chunks the build-time manifest maps those tags to — components
 * not on the page never download. Elements sit in the :not(:defined) base
 * box until their chunk arrives; a failed chunk leaves a role="alert" note
 * on its elements and never blocks the other chunks. Class-form aliases
 * are not tags and never trigger a load.
 *
 * Surface contract: embed with <script type="module" src="…"> — the
 * loader resolves its chunks against import.meta.url, which only exists
 * in a module context; a classic script fails to parse. Dynamic import
 * also needs a server — this script does not work from file://. For
 * saved single-file documents use ${lazy.fullBundle},
 * the full bundle, which has no runtime imports.
 */
`;
  const lazyPath = resolve(distDir, `${lazy.id}.js`);
  writeFileSync(lazyPath, banner + readFileSync(lazyPath, 'utf8'));
  writeFileSync(
    resolve(distDir, `${lazy.id.replace(/-lazy$/, '')}-manifest.json`),
    JSON.stringify(lazyManifest, null, 2) + '\n',
  );

  const bytes = statSync(lazyPath).size;
  const gzip = gzipSync(readFileSync(lazyPath)).length;
  const budget = lazy.budgetKb * 1024;
  if (bytes > budget) overBudget = true;
  results.push({ name: `${lazy.id}.js`, bytes, gzip, budget, over: bytes > budget, ok: bytes <= budget, reportOnly: false });
  const shared = readdirSync(resolve(distDir, lazy.chunkDir)).filter(
    (f) => !Object.values(lazyManifest).includes(`${lazy.chunkDir}/${f}`),
  );
  console.log(
    `  ${lazy.id}: ${Object.keys(lazyManifest).length} component chunks ` +
      `+ ${shared.length} shared chunk(s), manifest inlined`,
  );
}

/* Stylesheets: the theme sources ARE the shipped artifacts. The vocabulary
 * ships as the bundle's stylesheet (dist/semtext.css); named themes keep
 * their `semtext-theme-` prefix so a consumer's `./themes/*` import and a
 * CDN path name the same file. */
const themesDir = resolve(root, 'themes');
const distThemesDir = resolve(distDir, 'themes');
mkdirSync(distThemesDir, { recursive: true });
const cssCopies = [];
for (const css of readdirSync(themesDir).filter((f) => f.endsWith('.css')).sort()) {
  if (css === '_vocabulary.css') {
    copyFileSync(resolve(themesDir, css), resolve(distDir, 'semtext.css'));
    cssCopies.push({ from: `themes/${css}`, to: `${distLabel}/semtext.css` });
    /* Verbatim twin under themes/: the site's example viewer fetches
     * /semtext/themes/_vocabulary.css — without this copy the request
     * falls through to whatever stale file the site ships. Both copies
     * come from the same source read, so they can never drift. */
    copyFileSync(resolve(themesDir, css), resolve(distThemesDir, css));
    cssCopies.push({ from: `themes/${css}`, to: `${distLabel}/themes/${css}` });
  } else {
    copyFileSync(resolve(themesDir, css), resolve(distThemesDir, `semtext-theme-${css}`));
    cssCopies.push({ from: `themes/${css}`, to: `${distLabel}/themes/semtext-theme-${css}` });
  }
}

console.log('\n  artifact              size     gzip    budget');
console.log('  ------------------------------------------------');
for (const r of results) {
  const kb = (n) => (n / 1024).toFixed(1).padStart(6) + ' KB';
  console.log(
    `  ${r.name.padEnd(20)}${kb(r.bytes)}${kb(r.gzip)}${kb(r.budget)}  ${r.ok ? '✓' : r.reportOnly ? '✗ OVER (report-only)' : '✗ OVER'}`,
  );
}
for (const c of cssCopies) console.log(`  ${c.from.padEnd(20)}      → ${c.to}`);
console.log('');

if (overBudget && strict) {
  console.error('✗ size budget exceeded (--strict-budget)');
  process.exit(1);
}
