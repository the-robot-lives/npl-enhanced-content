# arch/build-deploy — build, distribution, and CI/CD

## Build pipeline

Two scripts, one command each:

- **`scripts/build.mjs`** — compiles the one Lit IIFE bundle (`dist/semtext.js`)
  and copies the vocabulary base + themes (`dist/semtext.css`,
  `dist/themes/semtext-theme-<name>.css`); entries and budgets:
  see [bundles.md](bundles.md).
- **`scripts/build-standalone.mjs`** — turns the page sources in `web/` into
  the distributable site: copies each page, emits a genuine **`.nojs.html`**
  variant of every page (all `<script>` elements stripped), and expands
  `<!-- sem:inline … -->` markers — the bundle, theme/vocabulary CSS, measured
  size labels, and version labels sourced from `package.json`
  (`specVersion` → "v0.7", `version` → "0.7.1") plus the short checkout SHA.
  Pages self-label; no size or version is hardcoded in copy.

`npm run build` before `npm test`: Cypress runs against the built pages in
`dist/`, not the marker sources in `web/`.

## Distribution forms

**Folder** (page + relative `semtext/` assets) and **single-file** (all CSS +
JS inlined in `<head>` via the `sem:inline` markers). Neither form carries
page-local CSS/JS beyond a small layout layer. Hard rules: no ES-module
scripts in portable docs, no runtime fetch; `semtext.js` is always linked or
embedded in full — there is no smaller script to fall back to.

## Shipping (CI single workflow, `.github/workflows/ci.yml`)

1. `test` — `npm run build:strict` (budget gate) + Cypress e2e, on every push/PR.
2. `build-push` — on `main`: builds and pushes the `sha-*` image.
3. `bump-chart` — CI-bot commits the image tag into `helm/semtext/values.yaml`
   (`[skip ci]`); **nobody hand-edits chart tags**.
4. ArgoCD auto-syncs from the chart repo.
5. `publish-cdn` — publishes bundles to the `cdn-semtext-dev` bucket under
   immutable `<version>/` prefixes; **gated off** on the repo variable
   `CDN_PUBLISH` until the CDN infrastructure exists.

The Docker image (`Dockerfile`) serves `dist/site/`, `dist/demo/`,
`dist/spec/`, `dist/themes/`, and `dist/semtext*.js` from nginx.
