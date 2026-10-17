# Data Schema — SemText

No relational persistence, KV store, or runtime config layer exists in this
repo. The repo is **spec-first**: its primary "schema" is the markup/data
interface contract for NPL-enhanced XHTML documents. Repo layout:
[PROJ-LAYOUT.md](PROJ-LAYOUT.md).

| Data kind | Source | Documented here |
|-----------|--------|-----------------|
| Data interface schema (markup contract) | `spec/conventions.md`, `spec/schema/sem-note.md` | §1, §2 |
| Data files (canonical spec HTML) | `spec/conventions.html`, `web/demo/index.html` | §3 |
| Config file schemas | `package.json`, `vite.config.ts`, `tsconfig.json`, `cypress.config.js` | §4 |
| Persistence / KV | — (none) | — |

## 1. Document interface schema (conventions.md v0.5)

NPL-enhanced documents are XHTML readable by three consumers: browser (styled/
interactive), LLM (structural), terminal. Canonical form: **custom elements
with bare attributes** (`<sem-facts view-as="quiz">`, `<sem-fact>` ›
`<statement>`/`<conclusion>`, `<sem-step status="done">`). The v0.4
**class-form alias** (`div.sem-*` with `data-*` parameters) is accepted by
every tier and documented once, in conventions Appendix A; `data-<name>`
wins over a bare `<name>` when both are present, and runtime state the tiers
write (`data-active`, `data-view-as` after a toggle, tier markers) is always
`data-*`.

### Canonical tag form → class-form alias

| Canonical tag form | Class-form alias |
| :-- | :-- |
| `<sem-enhanced-document>` | `div.sem-enhanced-document` (required root wrapper) |
| `<agent>` + name/bio/instructions | `div.sem-agent` › `.sem-agent-name` / `-bio` / `-instructions` |
| `<sem-note variant="warning">` | `div.sem-note[data-variant="warning"]` › `.sem-note-body` |
| `<sem-facts view-as="quiz">` | `div.sem-facts[data-view-as="quiz"]` |
| `<sem-fact>` statement/conclusion | `div.sem-fact` › `.sem-statement` / `.sem-conclusion` |
| `<incorrect-statement>` | `div.incorrect-statement` (unprefixed — matches the tag name) |
| `<sem-details>` / `<sem-detail>` | `div.sem-details` › `div.sem-detail` |
| `<highlight>` | `span.sem-highlight` (occluded form `.sem-occluded`) |
| `<sem-chronology view-as>` › `<sem-event when until status>` | `div.sem-chronology[data-view-as]` › `div.sem-event[data-when][data-until][data-status]` |
| `<sem-code lang filename mark controls>` › `<pre><code>` | `div.sem-code[data-lang][data-filename][data-mark][data-controls]` |
| `<sem-references kind>` › `<sem-reference id href cite>` | `div.sem-references[data-kind]` › `div.sem-reference[id][data-href][data-cite]` |
| `<sem-properties view-as="glossary">` | `div.sem-properties[data-view-as="glossary"]` › `div.sem-property[id][data-key]` |
| `<sem-reader controls outline-depth>` › optional `<nav aria-label="Contents">` | `div.sem-reader[data-controls][data-outline-depth]` (chrome; mints nothing) |
| `<sem-table controls sticky>` › `<table>` | `div.sem-table[data-controls][data-sticky]` › authored `<table>`, `td[data-value]` sort keys |
| `<sem-source label view-as>` › any content | `div.sem-source[data-label][data-view-as="html\|source"]` (transparent; mints nothing; children extract as if unwrapped) |
| `<sem-md label view-as controls>` › Markdown text | `div.sem-md[data-label][data-view-as][data-controls]` › Markdown text (`data-view-as` runtime-mutable) |
| `<sem-procedure kind>` › `<sem-step status>` | `div.sem-procedure[data-kind]` › `div.sem-step[data-status]` |
| `<sem-views id>` › `<sem-view name active>` | `div.sem-views[id]` › `div.sem-view[data-name][data-active]` (`id` is the global HTML attribute, spelled the same in both forms) |
| `<sem-reveal summary open>` | `div.sem-reveal[data-summary][open]` (hidden until the reader acts; `open` starts revealed — `collapsed` accepted, no-op; conventions §2) |
| `<sem-tag-def tag name group children>` › `<sem-tag-attr name type required default allowed>` | `div.sem-tag-def[data-tag][data-name][data-group][data-children]` › `div.sem-tag-attr[data-name][data-type][data-required][data-default][data-allowed]` (reference card: native-table render, one structured record) |
| `<sem-api-call name method endpoint status>` › `<sem-api-param name in type required default allowed>` | `div.sem-api-call[data-name][data-method][data-endpoint][data-status]` › `div.sem-api-param[data-name][data-in][data-type][data-required][data-default][data-allowed]` (`in` = query\|header\|body\|response) |
| `<sem-progress value label>` | `div.sem-progress[data-value][data-label]` |
| `<sem-audiences>` › `<sem-profile id label implies>`; `audience="…"` | `div.sem-audiences` › `div.sem-profile[id][data-label][data-implies]`; `data-audience` |

Full per-element contracts (fields, rendered forms, a11y, machine contract):
`spec/schema/*.md`; extraction payloads per type: `spec/extraction.md` §4.
R/W1 additions: `sem-event {when, until, ordinal, status?}`, `sem-code
{lang, filename, marks[], source (verbatim)}`, `sem-reference {href, cite,
ordinal}`. R/W2: `sem-table {caption, columns[], rows[][]}` in authored
order via `data-sem-source-index` (extraction §5 recorded exception);
`sem-reader` mints nothing (extraction §3 rule 7); `sem-source` is
transparent (§3 rule 8) and its `data-view-as` is presentation (§5c).
R/W2.2: `sem-md {source}` — the normalised (dedented) Markdown, read from
the raw fence once enhanced and from the element's text otherwise; the
rendered body is never extracted. Reader state on
`<html>`: `data-sem-mode="focus"`, `data-sem-type="s|m|l"`,
`data-sem-font="serif"`, `data-color-mode="light|dark"` — session facts.

### Global attribute catalog (any sem-* element)

| Attribute | Values | Machine meaning |
| :-- | :-- | :-- |
| `kind` | free token (`concept`, `anti-pattern`, `caveat`, …) | what the data IS |
| `tags` | comma list | classification |
| `view-as` | element-defined modes (`quiz`, `flashcards`, `list`, …) | presentation parameter; unknown ⇒ fallback to list + warning |
| `status` | `done`, `current`, `todo`, `blocked`, `pass`, `fail` | lifecycle/verdict |
| `controls` | comma flags: `shuffle`, `filter`, `retry`, `picker` | which controls render |
| `collapsed` | boolean | pre-collapse state |
| `id` | doc-unique token | stable anchor, cite target |
| `data-*` | free | extension point; alias spelling of every parameter above |

Rule: **attributes are canonical; inline `[hint | reveal]` NPL notation is
sugar** and legal only where the element schema allows.

## 2. `sem-note` element schema (spec/schema/sem-note.md, contract v0.3)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `variant` | `info` \| `warning` \| `tip` \| `danger` | `info` | accent border + `data-variant` |
| `collapsed` | boolean attr | unset | body wraps in native `<details>`; summary = first text line, max 60 chars |
| `id`, `kind`, `tags` | global catalog | — | see §1 |
| `role` | `note` | set on upgrade by Lit component; authored pre-set for JS-off machine readers | a11y contract |
| Events | — | none | |

Rendered forms: upgraded (Lit `SemNote`, light DOM — no shadow root, content
searchable); pre-upgrade/JS-off (`sem-note:not(:defined)` base styles via
attribute selectors). BDD source of truth for `test/e2e/sem-note.cy.js`.
Change order: schema → spec → code.

## 3. Data files

| Path | Purpose | Shape |
|------|---------|-------|
| `spec/conventions.md` | Authoring spec source of truth (v0.5 draft, tag form canonical) | Markdown, 10 sections + open questions + Appendix A (class-form alias) |
| `spec/conventions.html` | The spec as a SemText document in the canonical tag form (dogfood) | Folder-form XHTML: linked theme + vocabulary CSS, shipped bundles by `src`, no inline CSS/JS |
| `web/demo/reading-lit.html` | Reference tag-form document, both tiers | Single-file XHTML, `sem:inline` markers |
| `web/demo/index.html` | Reference class-form alias document (v0.4 baseline) | Single-file XHTML: inlined vocabulary CSS + vanilla JS |

## 4. Config file schemas

### package.json

| Field | Value |
|-------|-------|
| `type` | `module` |
| `exports` | `./lit` → `dist/semtext.js`, `./lazy` → `dist/semtext-lazy.js`, `./npl` → `dist/npl.js`, `./npl-lazy` → `dist/npl-lazy.js`, `./agent` → `dist/semtext-agent.js`, `./themes/*` → `themes/*`. No `.` export — each artifact is a classic IIFE script that installs a global and exports nothing (D9). The retired per-tier exports (`./fallback`, `./reading`, `./extract`, `./md`) are gone as of 0.9.0. |
| `files` | `dist`, `themes` |
| `dependencies` | `lit ^3.3.3` |
| `devDependencies` | `cypress ^15`, `typescript ^5.6`, `vite ^6`, `vitest ^5`, `happy-dom ^20` |
| scripts | `build` (`scripts/build.mjs` + `scripts/build-standalone.mjs`), `build:strict` (same, budget-enforcing), `test` / `test:open` (cypress e2e), `serve` (vite preview :4173) |

### Tool configs

| File | Key settings |
|------|--------------|
| `vite.config.ts` | Dev/preview only — the five-artifact build lives in `scripts/build.mjs` |
| `tsconfig.json` | TypeScript compile options for vite build |
| `cypress.config.js` | E2E spec path `test/e2e`, baseUrl pointed at the vite preview server |

## Maintenance

- Updates here must follow changes to `spec/` specs (spec precedes code).
- If a persistence layer, KV store, or server API is added, add the
  corresponding section per PROJ-SCHEMA conventions (ERD / key-pattern /
  interface tables).
