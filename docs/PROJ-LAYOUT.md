# Project Layout

Top-level directories are domains: `spec/` says what the format is, `src/`
implements it, `themes/` styles it, `web/` publishes it, `test/` proves it.

```
semtext/
├── spec/                          # Canonical SemText format specifications (normative)
│   ├── conventions.md               # Authoring conventions — source of truth
│   ├── conventions.html             # The same spec rendered in the format it specifies
│   ├── extraction.md                # DOM → records → annotated text contract
│   └── schema/                      # Per-element semantic contracts (BDD source of truth)
│       ├── sem-audiences.md
│       ├── sem-chronology.md
│       ├── sem-code.md
│       ├── sem-details.md
│       ├── sem-facts.md
│       ├── sem-md.md
│       ├── sem-note.md
│       ├── sem-procedure.md
│       ├── sem-progress.md
│       ├── sem-properties.md
│       ├── sem-reader.md
│       ├── sem-references.md
│       ├── sem-reveal.md
│       ├── sem-source.md
│       ├── sem-table.md
│       └── sem-views.md
├── src/
│   ├── index.ts                     # Lit-tier entry → dist/semtext.js
│   ├── lit/                         # Lit 3 light-DOM elements + SemElement base
│   │   ├── base.ts
│   │   ├── sem-code.ts                # thin wrappers over src/reading/* (R/W1)
│   │   ├── sem-details.ts
│   │   ├── sem-facts.ts
│   │   ├── sem-md.ts                  # thin wrapper over src/md/* (R/W2.2)
│   │   ├── sem-note.ts
│   │   ├── sem-properties.ts
│   │   ├── sem-reader.ts              # thin wrappers over src/reading/* (R/W2)
│   │   ├── sem-references.ts
│   │   ├── sem-source.ts              # rendered/source wrapper (W2.1)
│   │   └── sem-table.ts
│   ├── fallback/                    # Vanilla core handlers — NO Lit dependency → bundled into dist/semtext.js
│   │   ├── index.ts                   # handler registry + enhance() (core runs FIRST in the bundle)
│   │   ├── audience.ts                # profile-gated visibility (native `hidden`)
│   │   ├── details.ts
│   │   ├── facts.ts
│   │   ├── note.ts
│   │   ├── progress.ts
│   │   ├── properties.ts
│   │   ├── reveal.ts
│   │   ├── source.ts                  # sem-source markup snapshot (runs FIRST)
│   │   ├── target.ts                  # deep-link resolver + print disclosure (runs last)
│   │   └── views.ts
│   ├── reading/                     # Prose-reading handlers — NO Lit → bundled into dist/semtext.js (R/W1+W2)
│   │   ├── index.ts                   # document scan; skips [data-sem-upgraded]; reader runs last
│   │   ├── code.ts                    # sem-code chrome, marks, copy, wrap
│   │   ├── glossary.ts                # sem-properties view-as=glossary previews
│   │   ├── reader.ts                  # sem-reader outline/progress/focus/type/colour/print/audience (R/W2)
│   │   ├── references.ts              # citation previews, backlinks
│   │   ├── source.ts                  # sem-source chrome + sem-code fence (W2.1)
│   │   └── table.ts                   # sem-table sort/filter, source-index stamp (R/W2)
│   ├── md/                          # Markdown renderer — NO Lit → bundled into dist/semtext.js (R/W2.2)
│   │   ├── index.ts                   # document scan; shares sem-code's fence chrome
│   │   ├── element.ts                 # sem-md chrome, rendered body, raw fence, toggle, copy
│   │   └── parse.ts                   # hand-written GFM subset → DOM (createElement/textContent only)
│   ├── extract/                     # Record extraction → exported from dist/semtext.js
│   │   ├── index.ts
│   │   └── records.ts
│   └── shared/                      # Tier-agnostic helpers used by both tiers
│       ├── audience.ts
│       ├── attr.ts                    # param(): data-<name> then bare <name>
│       ├── clipboard.ts               # copyText()/canCopy() shared by sem-code and sem-md
│       ├── marks.ts                   # sem-code `mark` grammar (render + extraction)
│       ├── mdsource.ts                # the one sem-md normalisation rule (render + extraction)
│       ├── popover.ts                 # one preview surface per document
│       ├── rng.ts
│       ├── state.ts
│       ├── summary.ts                 # the one derived-summary rule (render + extraction)
│       └── tokens.ts
├── themes/                          # Theme CSS — top-level on purpose (see note below)
│   ├── _vocabulary.css
│   └── minimal-tech-light.css
├── web/
│   ├── demo/                        # Showcase + reference documents (marker sources)
│   │   ├── index.html                 # v0.4 class-based baseline, fallback tier
│   │   ├── reading.html               # R/W1+W2(+W2.2 sem-md) reading elements, class form (fallback + reading + md)
│   │   ├── reading-lit.html           # same document, element form (+ Lit bundle)
│   │   ├── md-only.html               # sem-md with ONLY the Markdown bundle (no core, no reading) — root stays unmarked
│   │   └── standalone-lit.html        # Lit-tier upgrade page
│   └── site/
│       └── index.html                 # semtext.dev marketing page (PLACEHOLDER)
├── test/                            # Cypress e2e — 23 specs
│   ├── e2e/
│   │   ├── deep-links.cy.js
│   │   ├── extraction-reading.cy.js
│   │   ├── extraction.cy.js
│   │   ├── nojs-artifact.cy.js
│   │   ├── print-and-motion.cy.js
│   │   ├── sem-audiences.cy.js
│   │   ├── sem-chronology.cy.js
│   │   ├── sem-code.cy.js
│   │   ├── sem-details.cy.js
│   │   ├── sem-facts.cy.js
│   │   ├── sem-glossary.cy.js
│   │   ├── sem-md.cy.js
│   │   ├── sem-note.cy.js
│   │   ├── sem-procedure.cy.js
│   │   ├── sem-progress.cy.js
│   │   ├── sem-properties.cy.js
│   │   ├── sem-reader.cy.js
│   │   ├── sem-references.cy.js
│   │   ├── sem-reveal.cy.js
│   │   ├── sem-source.cy.js
│   │   ├── sem-table.cy.js
│   │   ├── sem-views.cy.js
│   │   └── standalone-lit.cy.js
│   └── support/e2e.js
├── scripts/
│   ├── build.mjs                    # Five IIFE artifacts + size budgets
│   └── build-standalone.mjs         # Marker expansion → dist/demo/ and dist/site/
├── docs/                            # Maintained project docs (+ .summary.md pairs)
│   ├── PROJ-ARCH.md
│   ├── PROJ-LAYOUT.md               # This file
│   └── PROJ-SCHEMA.md
├── cypress.config.js                # Spec pattern test/e2e/, support test/support/
├── vite.config.ts                   # Dev/preview only — the build lives in scripts/
├── tsconfig.json
├── package.json                     # Subpath exports: ./lit ./fallback ./reading ./extract ./md ./themes/*
├── PRD.md
├── ROADMAP.md
├── CLAUDE.md · AGENTS.md · AGENT.md
└── README.md                        # (absent — PRD.md serves as entry point)
```

## Directory Notes

| Directory | Purpose |
|-----------|---------|
| `spec/` | Tier-0 normative documents. This repo is spec-first: schema change precedes conventions change precedes code precedes e2e. |
| `src/lit/` | Lit 3 elements, light DOM so content stays searchable and extractable. Bundled with Lit into `dist/semtext.js`. |
| `src/fallback/` | The vanilla tier. It must run in a document that never loads Lit, so it may not import from `src/lit/` — the separation is load-bearing, not stylistic. |
| `src/reading/` | Second vanilla tier (R/W1+W2): prose-reading behaviours and reading chrome (reader, table) that would not fit the fallback core's 12 KB budget. Same rules as `fallback/`; the Lit wrappers in `src/lit/` import its per-element enhance functions so there is one behaviour implementation. |
| `src/md/` | Third vanilla tier (R/W2.2): the `sem-md` Markdown renderer, its own bundle so a document with no Markdown never loads the parser. Same rules as `fallback/`; the Lit wrapper imports its enhance function; the raw fence's copy / wrap chrome is `sem-code`'s, borrowed from the reading bundle's global at runtime rather than bundled a second time. |
| `src/extract/` | DOM → records → annotated text, per `spec/extraction.md`. |
| `src/shared/` | Helpers imported by both tiers; must stay Lit-free for the same reason as `fallback/`. |
| `themes/` | Deliberately top-level rather than under `web/`: theme CSS is a package subpath export (`semtext/themes/*`) and a CDN asset on cdn.semtext.dev, consumed independently of the marketing site. |
| `web/demo/` | Double duty by design — showcase pages *and* the cypress fixture source. The suite runs against the BUILT copies in `dist/demo/`, which is the only arrangement where a green suite proves the shipped file works. |
| `web/site/` | Marketing page for semtext.dev. Currently a placeholder; the design pass is a separate task. |
| `test/` | Cypress e2e against `dist/demo/`, mirroring the per-element BDD in `spec/schema/`. |
| `scripts/` | The real build. `vite.config.ts` covers dev/preview only. |

## Build Outputs (gitignored, not documented above)

- `dist/semtext.js` — the one IIFE classic script (Lit elements + vanilla handlers + extraction; global `SemText`); `dist/semtext.css` — the built vocabulary; `dist/themes/semtext-theme-<name>.css` — the themes
- `dist/demo/<name>.html` and `dist/demo/<name>.nojs.html` — inlined single-file documents
- `dist/site/index.html` — the marketing page
- `test/screenshots/` · `test/videos/` — cypress artifacts, generated at test time
- `node_modules/`

## Commands

| Command | Action |
|---------|--------|
| `npm run build` | `scripts/build.mjs` then `scripts/build-standalone.mjs` → `dist/` |
| `npm run build:strict` | Same, but a size-budget overrun fails the build |
| `npm test` | Cypress e2e run (requires `npm run serve` on port 4173) |
| `npm run serve` | Vite preview of `dist/` on port 4173 |
