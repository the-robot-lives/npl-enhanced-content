# layout/src — implementation domains

`src/` implements the `spec/` contracts. Bundle entries are top-level; the
subdirectories are load-bearing domains. Lit-free domains (`vanilla`,
`reading`, `md`, `shared`, `extract`, `data`) must never import `src/lit/` —
they run in documents that never load Lit.

```
src/
├── index.ts                  # Core bundle entry → dist/semtext.js (global SemText):
│                             #   sem-* elements + vanilla/reading/md + extraction
├── npl.ts                    # npl-* namespace bundle → dist/npl.js (global NPL)
├── semext.ts                 # semext-* namespace bundle → dist/semext.js (global SemTextExt)
├── agent-kit.ts              # agent-kit-* namespace bundle → dist/agent-kit.js (global AgentKit)
├── js-shell.ts               # Interactive terminal bundle → dist/semtext-js-shell.js
├── vite-env.d.ts
├── lit/          (190 files) # Lit 3 light-DOM elements + SemElement base; per-element
│                             #   sem-*.ts modules + npl/ + agent-kit/ element trees
├── terminal/     (138 files) # js-shell: evaluator, WASM path, POSIX plugin surface,
│                             #   flashcard TUI, playback (see docs/terminal/CORE-V2.md)
├── editor/        (73 files) # SemText editor surface (see docs/editor/EDITOR.md)
├── shared/        (16 files) # Lit-free helpers: attr, audience, clipboard, marks,
│                             #   mdsource, popover, rng, state, summary, tokens, modal
├── vanilla/       (13 files) # Core handlers: enhance() registry, note/facts/details/
│                             #   progress/properties/reveal/source/audience/views/target
├── reading/       (13 files) # Prose reading: reader chrome, code, table, references,
│                             #   glossary, source
├── data/          (10 files) # Live data: bind parse/fetch/hydrate runtime, deeplinks
├── lazy/           (8 files) # On-demand loaders (dist/*-lazy.js): import only the
│                             #   chunks a document's tags use (http(s) only)
├── tools/          (3 files) # Shared tooling helpers
├── md/             (3 files) # sem-md renderer: hand-written GFM subset → DOM
│                             #   (createElement/textContent only)
├── validate/       (2 files) # validate.js (schema-driven rules) + cli.js front end
├── shell/          (2 files) # Shell glue between terminal and documents
├── extract/        (2 files) # Extraction entry + records (SemText.extractRecords/Text)
├── agent/          (2 files) # Agent-toolkit shared core (browser build of the CLI)
└── browser/        (1 file)  # Browser-environment detection
```

Bundle map (built by `scripts/build.mjs`): the four namespace/standalone
entries above each produce one IIFE; `lazy/` produces the on-demand loaders.
Reader bundles carry hard size budgets enforced by `build:strict`; the shell
and editor bundles are deliberately uncapped (report-only, user decision
2026-10-17).
