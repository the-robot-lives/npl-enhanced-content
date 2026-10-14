# Project Layout — Summary

```
semtext/
├── spec/                # Normative specs: conventions.md/.html, extraction.md, schema/sem-*.md (20) + schema/npl/*.md (21)
├── src/
│   ├── lit/               # Lit 3 light-DOM elements + SemElement base  → dist/semtext.js
│   ├── fallback/          # Vanilla core handlers, no Lit dependency    → into dist/semtext.js
│   ├── reading/           # Prose reading (code, refs, glossary, reader, table, source) → into dist/semtext.js
│   ├── md/                # sem-md Markdown renderer                    → into dist/semtext.js
│   ├── extract/           # Record extraction                           → into dist/semtext.js
│   └── shared/            # tokens, rng, audience, state, clipboard, mdsource (Lit-free)
├── themes/              # Theme CSS — top-level: subpath export + CDN asset, not site-owned
├── web/
│   ├── demo/              # Showcase pages AND cypress fixture source (index, standalone-lit)
│   └── site/              # semtext.dev marketing page (placeholder)
├── test/                # Cypress e2e: e2e/*.cy.js (23 specs), support/e2e.js
├── scripts/             # build.mjs (the one IIFE bundle + budgets), build-standalone.mjs (markers)
├── docs/                # PROJ-ARCH / PROJ-LAYOUT / PROJ-SCHEMA (+ .summary.md pairs)
├── cypress.config.js · vite.config.ts · tsconfig.json · package.json
└── PRD.md · ROADMAP.md · CLAUDE.md · AGENTS.md · AGENT.md
```

Top-level directories are domains. Spec-first: `spec/` governs `src/`, and the
change order is schema → conventions → code → e2e.

Two tiers ship as separate bundles on purpose — the fallback must run in a
document that never loads Lit, so `src/fallback/` may not import `src/lit/`.

Cypress runs against the BUILT pages in `dist/demo/`, not the marker sources in
`web/demo/`, so a green suite proves the shipped file works.

Package exports are subpaths only: `semtext/lit`, `semtext/fallback`,
`semtext/reading`, `semtext/extract`, `semtext/md`, `semtext/themes/*`. There is no `.` export.
