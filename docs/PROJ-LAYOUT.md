# Project Layout

Top-level directories are domains: `spec/` says what the format is, `src/`
implements it, `themes/` styles it, `web/` publishes it, `test/` proves it.

```
semtext/
├── spec/                          # Canonical SemText format specifications (normative)
│   ├── conventions.md               # Authoring conventions — source of truth (draft v0.7)
│   ├── conventions.html             # The same spec rendered in the format it specifies
│   ├── extraction.md                # DOM → records → annotated text contract
│   ├── data-visualizer.md           # sem-data-* visualizer family spec
│   └── schema/                      # Per-element machine contracts (BDD source of truth)
│       ├── semtext.schema.json        # JSON schema the validator READS (no parallel rules)
│       ├── sem-*.md (43)              # sem-* element contracts
│       ├── npl/ (21)                  # npl-* element contracts
│       ├── agent-kit/ (15)            # agent-kit-* element contracts
│       └── semext/ (9)                # semext-* element contracts
├── src/                           # Implementation → dist/ → [layout/src.md](layout/src.md)
│   ├── index.ts                     # Core bundle entry (dist/semtext.js, global SemText)
│   ├── npl.ts · semext.ts · agent-kit.ts · js-shell.ts   # namespace/standalone bundle entries
│   └── (13 subdomains: lit, terminal, editor, vanilla, reading, md, extract, shared, data, lazy, tools, validate, shell, agent, browser)
├── themes/                          # Theme CSS — top-level on purpose (subpath export + CDN asset)
│   ├── _vocabulary.css                # base vocabulary styles (→ dist/semtext.css)
│   └── minimal-tech-light.css         # one shipped theme (--sem-* tokens)
├── bin/                             # Node CLIs (package.json bin)
│   ├── semtext.mjs                   # user CLI: pipes first, terminal browser second
│   ├── semtext-validate.mjs          # schema-driven document validator
│   ├── semtext-agent.mjs             # agent toolkit CLI (also importable: semtext/agent)
│   └── semtext-refresh.mjs           # spec/element refresh helper (npm run refresh)
├── web/
│   ├── demo/                        # Showcase + reference documents (marker sources; cypress fixtures)
│   │   ├── index.html                 # v0.4 class-based baseline
│   │   ├── reading.html · reading-lit.html · md-only.html · standalone-lit.html
│   │   ├── sem-bind.html · semext.html · agent-kit.html · editor.html
│   │   ├── shell.html · shell-storage.html · containers.html · workflows-trees.html · …
│   │   └── data/                      # bind/live-data fixtures (JSON/YAML/CSV)
│   └── site/
│       └── index.html                 # semtext.dev marketing page (PLACEHOLDER)
├── test/                            # Cypress e2e (46 specs) + vitest unit tier
│   ├── e2e/*.cy.js                   # per-element BDD, runs against BUILT dist/demo/
│   └── support/e2e.js
├── scripts/                         # The real build (vite.config.ts is dev/preview only)
│   ├── build.mjs                      # bundles + size budgets (strict fails CI)
│   ├── build-standalone.mjs           # marker expansion → dist/demo/, dist/site/
│   ├── build-extension.mjs            # browser-extension assets
│   ├── build-elements-index.mjs       # → elements.json (generated element index)
│   ├── build-prompts.mjs              # agent prompt artifacts
│   ├── gen-conventions-html.mjs       # conventions.md → conventions.html (checked in CI)
│   └── stamp-version.mjs · cypress-shard.mjs · standalone-lib.mjs
├── extension/                       # Browser extension (manifest v3: background, content, viewer jail)
├── viewer/                          # Jail-viewer harness (iframe jail boot/strip + samples)
├── poc/wasm/                        # WASM evaluator proof-of-concept (terminal shell path)
├── helm/semtext/                    # Helm chart (deployment/service/ingress/tls) — CI bumps tags
├── docker/ · Dockerfile · nginx.conf # Image build + static serving config
├── project-management/              # Personas, user stories, PM artifacts
├── docs/                            # Maintained docs (+ .summary.md pairs)
│   ├── PROJ-ARCH.md · PROJ-LAYOUT.md · PROJ-SCHEMA.md · THREAT-MODEL.md
│   ├── arch/ · layout/ · threats/     # per-doc section files
│   ├── authoring-guide.md · integration-quickstart.md · TEST-HEALTH.md
│   ├── editor/EDITOR.md · terminal/   # component sub-docs
├── elements.json                    # GENERATED element index (build:elements-index)
├── .github/workflows/               # ci.yml (unit→test→build-push→bump-chart→publish-cdn) · nightly.yml
├── cypress.config.js                # Spec pattern test/e2e/, support test/support/
├── vite.config.ts                   # Dev/preview only — the build lives in scripts/
├── tsconfig.json
├── package.json                     # Subpath exports + bin entries; no `.` export (ROADMAP D9)
├── PRD.md · ROADMAP.md · CHANGELOG.md · CONTRIBUTING.md
├── CLAUDE.md · AGENTS.md · AGENT.md
└── README.md                        # Repo entry point
```

## Directory Notes

| Directory | Purpose |
|-----------|---------|
| `spec/` | Tier-0 normative documents. Spec-first: schema change precedes conventions change precedes code precedes e2e. |
| `src/lit/` | Lit 3 elements, light DOM so content stays searchable and extractable. Bundled into `dist/semtext.js`; also the `npl/` + `agent-kit/` namespace element trees. |
| `src/vanilla/` | Core vanilla handlers (renamed from `src/fallback/` 0.9.0). Must run in a document that never loads Lit — the no-`src/lit/`-imports rule is load-bearing. |
| `src/reading/` · `src/md/` | Prose-reading and Markdown-renderer tiers, same Lit-free rules. |
| `src/terminal/` | The interactive terminal (js-shell): evaluator, plugins, TUI — ships as its own uncapped bundle. |
| `src/editor/` | The SemText editor surface (see `docs/editor/EDITOR.md`). |
| `src/data/` | Live-data plumbing: bind declarations, deeplinks, fetch/hydrate runtime. |
| `src/validate/` | Schema-driven validator core; every rule reads `spec/schema/semtext.schema.json`. |
| `src/extract/` | DOM → records → annotated text, per `spec/extraction.md`. |
| `src/shared/` | Tier-agnostic helpers; must stay Lit-free. |
| `themes/` | Package subpath export (`semtext/themes/*`) + CDN asset on cdn.semtext.dev — not site-owned. |
| `web/demo/` | Showcase pages AND cypress fixture source; suite runs against BUILT `dist/demo/`, so green proves the shipped file works. |
| `extension/` · `viewer/` | Browser-extension packaging and the jail-viewer harness it shares. |
| `helm/` · `docker/` · `nginx.conf` | Deploy path: image serves `dist/{site,demo,spec,themes}` + bundles via nginx; ArgoCD syncs the chart CI bumps. |

## Build Outputs (gitignored, not documented above)

- `dist/semtext.js` — the one core IIFE (global `SemText`); `dist/npl.js`, `dist/semext.js`, `dist/agent-kit.js` (namespace bundles); `dist/semtext-js-shell.js`, `dist/editor` bundles; `dist/semtext-agent.js` (browser agent core); `dist/*-lazy.js` loaders + code-split chunks
- `dist/semtext.css` + `dist/themes/semtext-theme-<name>.css`
- `dist/demo/<name>.html` (and `.nojs.html`) · `dist/site/index.html` · `dist/spec/`
- `test/screenshots/` · `test/videos/` — cypress artifacts · `node_modules/`

## Commands

| Command | Action |
|---------|--------|
| `npm run build` | `build.mjs` + `build-standalone.mjs` + `build-extension.mjs` + `stamp-version.mjs` → `dist/` |
| `npm run build:strict` | Same, but a size-budget overrun fails the build |
| `npm run test:unit` | vitest unit tier |
| `npm test` | Cypress e2e (run AFTER `npm run build` — tests run against `dist/demo/`) |
| `npm run validate` | Vocabulary gate over `web/site/**` + `spec/*.html` |
| `npm run serve` | Vite preview of `dist/` on :4173 |
