# Project Layout — Summary

```
semtext/
├── spec/                # Normative specs: conventions.md/.html (draft v0.7), extraction.md,
│                        #   data-visualizer.md, schema/ (43 sem-*.md + npl/21 + agent-kit/15
│                        #   + semext/9 + semtext.schema.json)
├── src/                 # Bundle entries (index, npl, semext, agent-kit, js-shell) + domains
│                        #   lit · terminal · editor · vanilla · reading · md · extract ·
│                        #   shared · data · lazy · tools · validate · shell · agent · browser
│                        #   → [layout/src.md](layout/src.md)
├── themes/              # Theme CSS — top-level: subpath export + CDN asset, not site-owned
├── bin/                 # CLIs: semtext · semtext-validate · semtext-agent · semtext-refresh
├── web/
│   ├── demo/            # Showcase pages AND cypress fixture source (+ data/ bind fixtures)
│   └── site/            # semtext.dev marketing page (placeholder)
├── test/                # Cypress e2e (46 specs, run against BUILT dist/demo/) + vitest unit
├── scripts/             # build.mjs (bundles + budgets), build-standalone, build-extension,
│                        #   gen-conventions-html, build-elements-index, stamp-version
├── extension/           # Browser extension (manifest v3 + viewer jail)
├── viewer/              # Jail-viewer harness
├── poc/wasm/            # WASM evaluator proof-of-concept
├── helm/semtext/        # Helm chart (CI bumps tags; ArgoCD syncs)
├── docker/ · Dockerfile · nginx.conf   # Image + static serving
├── project-management/  # Personas, user stories, PM artifacts
├── docs/                # PROJ-ARCH / LAYOUT / SCHEMA / THREAT-MODEL (+ .summary.md),
│                        #   arch/ layout/ threats/, authoring + editor + terminal sub-docs
├── elements.json        # GENERATED element index (build:elements-index)
├── .github/workflows/   # ci.yml (unit → test → build-push → bump-chart → publish-cdn), nightly
├── cypress.config.js · vite.config.ts · tsconfig.json · package.json
└── README.md · PRD.md · ROADMAP.md · CHANGELOG.md · CONTRIBUTING.md · CLAUDE.md · AGENTS.md · AGENT.md
```

Top-level directories are domains. Spec-first: `spec/` governs `src/`, and the
change order is schema → conventions → code → e2e.

One core bundle ships everything reader-facing; `src/vanilla/` (the former
fallback tier's handlers, renamed 0.9.0) must run in a document that never
loads Lit, so it may not import `src/lit/`. Namespace bundles (`npl`,
`semext`, `agent-kit`) and the terminal/editor tools ship as separate opt-in
artifacts plus `lazy/` on-demand loaders.

Cypress runs against the BUILT pages in `dist/demo/`, not the marker sources
in `web/demo/`, so a green suite proves the shipped file works.

Package exports are subpaths only: `./lit` `./npl` `./semext` `./agent-kit`
`./lazy` `./npl-lazy` `./semext-lazy` `./agent-kit-lazy` `./agent`
`./themes/*`. There is no `.` export.
