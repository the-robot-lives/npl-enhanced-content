/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Shared dev/preview config. The BUILD does not go through this file.
 *
 * This package emits three independent IIFE artifacts (semtext.js,
 * semtext-fallback.js, semtext-extract.js) and `build.lib` with `formats: ['iife']`
 * accepts a single entry, so `npm run build` drives the Vite JS API from
 * scripts/build.mjs instead. Build options live there, next to the size
 * budgets they are checked against.
 *
 * `vite preview` serves `dist/` as the web root, which is why the cypress
 * baseUrl resolves `/demo/index.html` to `dist/demo/index.html` — the BUILT
 * page, not the marker source in `web/demo/`.
 */
export default defineConfig({
  build: { outDir: 'dist', target: 'es2022' },
  server: { port: 5173 },
  preview: { port: 4173 },
  // Unit tier (vitest). Coverage is measured over the whole shipped source
  // tree, not just the files the unit specs happen to import, so the number
  // is honest: most of src/ is exercised only by the cypress e2e suite, which
  // is not instrumented. The threshold is a ratchet (unit line % minus 5,
  // floored) — raise it as unit coverage grows; see docs/TEST-HEALTH.md.
  test: {
    include: ['test/unit/**/*.test.{ts,mjs,js}'],
    // Every spec fails fast instead of hanging the shared fork worker —
    // a sync loop cannot be interrupted by timers inside the test, but a
    // 5s ceiling keeps any wedge to one red spec, not a stuck run
    // (shell-v3 integration; see test/unit/shell-find-sed.test.ts).
    testTimeout: 5_000,
    alias: {
      // The lazy loaders' tag→chunk manifests are injected virtually by the
      // build (scripts/build.mjs, one plugin per namespace). The build
      // never reads these files; under vitest the entry specs get stubs
      // (test/unit/fixtures/*.stub.ts) whose chunks 404, so the entries'
      // wiring specs exercise the failure-reporting path.
      'virtual:semtext-manifest': fileURLToPath(
        new URL('./test/unit/fixtures/lazy-manifest.stub.ts', import.meta.url),
      ),
      'virtual:npl-manifest': fileURLToPath(
        new URL('./test/unit/fixtures/npl-manifest.stub.ts', import.meta.url),
      ),
    },
    coverage: {
      provider: 'v8',
      include: ['src/**', 'scripts/**', 'bin/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 16 }
    }
  }
});
