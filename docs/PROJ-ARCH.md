# Project Architecture — SemText

## Overview

SemText (draft spec **v0.7**) is an XHTML-first semantic markup vocabulary
for NPL (Noizu Prompt Lingua): **one document, three readings** — a styled
interactive page in the browser, a structural record for LLM agents, and
plain text via DOM extraction. The document itself is the data; there is no
preprocessing layer. Zero React: Lit 3 web components act as thin
enhancement wrappers over vanilla handlers that also drive everything no
component defines; with JavaScript off the document degrades to plain prose
— that degradation is the architectural contract.

The repo is **spec-first**: tier-0 specs in `spec/` precede implementation
(`spec/` → `spec/schema/` → `src/` → cypress e2e).

→ *Repo tree: [PROJ-LAYOUT.md](PROJ-LAYOUT.md) · data contract: [PROJ-SCHEMA.md](PROJ-SCHEMA.md)*

## System Diagram

```mermaid
graph LR
    A[Author] -->|writes tag-form XHTML| D["SemText document<br/>(spec v0.7, one source of truth)"]
    D -->|"JS-off"| F["Theme + vocabulary CSS<br/>(plain prose, nothing hidden)"]
    D -->|"one bundle"| S["semtext.js<br/>(Lit 3 elements + vanilla handlers<br/>+ extraction; global SemText)"]
    S --> X["SemText.extractRecords / extractText<br/>E(D)=E(R(D))=E(I(R(D)))"]
    X --> AG["LLM/agent: structural records"]
    X --> TX["Terminal: annotated text"]
    B["scripts/build.mjs + build-standalone.mjs"] -->|"dist/ + .nojs.html"| H["Image → CI-bot helm bump → ArgoCD"]
```

## The One Bundle

One IIFE script, built by `scripts/build.mjs`: `semtext.js` (global
`SemText`) carries the Lit custom elements, the vanilla handlers (core
snapshot pass first, prose reading last, Markdown between), and extraction.
It carries a minified size budget enforced in CI via `build:strict`
(96 KB; per-artifact history in ROADMAP.md). Stylesheets ship unbuilt:
`dist/semtext.css` (the vocabulary) and `dist/themes/semtext-theme-<name>.css`.

→ *See [arch/bundles.md](arch/bundles.md) for the artifact table and budgets*

## Companion Artifacts & CLIs

Namespace bundles load **on top of** the core only when a document uses
them: `dist/npl.js` (global `NPL`), `dist/semext.js` (`SemTextExt`),
`dist/agent-kit.js` (`AgentKit`) — plus `dist/*-lazy.js` loaders that fetch
just the chunks a document's tags use. Tools ship separately, never in the
reader path: the interactive terminal (`dist/semtext-js-shell.js`), the
editor surface, and the agent browser core (`dist/semtext-agent.js`). Node
CLIs live in `bin/`: `semtext` (pipes-first reader), `semtext-validate`
(schema-driven gate reading `spec/schema/semtext.schema.json`),
`semtext-agent` (agent toolkit), `semtext-refresh`. The live-data bind
runtime (`src/data/`) fetches and hydrates `sem-progress`/`sem-procedure`
payloads at runtime.

→ *See [arch/bundles.md](arch/bundles.md) for artifacts · [PROJ-LAYOUT.md](PROJ-LAYOUT.md) for `src/` domains*

## Extraction Invariant

`E(D) = E(R(D)) = E(I(R(D)))` — extraction of the authored document equals
extraction of the reading-enhanced and Lit-upgraded versions. Every
interactive layer is chrome and mints nothing. It is an architectural
guarantee: defined over the authored projection, enforced by
`test/e2e/extraction*.cy.js`. Normative contract: `spec/extraction.md` §5
(implements conventions §8).

→ *See [arch/extraction.md](arch/extraction.md) for the guarantee and enforcement*

## Element Vocabulary Model

Tag form canonical (v0.5 re-baseline; class form = Appendix A alias), 88
per-element schemas under `spec/schema/` (43 `sem-*` + 21 `npl-*` +
15 `agent-kit-*` + 9 `semext-*`), all backed by the machine-readable
`spec/schema/semtext.schema.json` the validator reads. Styling is
script-gated: selectors use the dual spelling `:is(sem-x, .sem-x)`, and the
script stamps one `data-sem-upgraded` marker (element and `<html>`); every
hide rule keys on it, so with no script nothing is hidden and the document
reads as plain prose.

→ *See [arch/vocabulary.md](arch/vocabulary.md) for gating and the degradation ladder*

## Build & Distribution

`scripts/build.mjs` compiles the one bundle and copies the stylesheets;
`scripts/build-standalone.mjs`
produces the distributable pages — genuine `.nojs.html` variants and
`sem:inline` markers that inject the bundle, themes, measured sizes, and version
labels from `package.json` (`specVersion` v0.7) plus the checkout SHA. Two
portable forms: folder (relative assets) and single-file (all inlined).

→ *See [arch/build-deploy.md](arch/build-deploy.md) for forms and hard rules*

## Deployment

CI is a ladder — `unit` (vitest) → `test` (cypress e2e + `build:strict`
budget gate) → `build-push` (image, `main` only) → `bump-chart` (CI-bot
commit) → ArgoCD auto-sync — plus a `publish-cdn` job gated on the
`CDN_PUBLISH` repo variable, a `ci-timing` job on PRs, and a nightly
workflow. The Docker image serves `dist/{site,demo,spec,themes}` and the
`semtext*.js` bundles from nginx. Nobody hand-edits chart tags.

→ *See [arch/build-deploy.md](arch/build-deploy.md) for the pipeline*

## Key Decisions

Brief; rationale in the linked file.

- **Three tiers, bottom tier is the contract** — zero-JS pages force semantics
  into the document itself. → [arch/decisions.md](arch/decisions.md)
- **Tag form canonical** — bare attributes, no `data-*`; XML-consumer-clean. → [arch/decisions.md](arch/decisions.md)
- **One runtime, one marker** — Lit components and the vanilla handlers agree
  on `data-sem-upgraded`; light-DOM content, chrome mints nothing. →
  [arch/decisions.md](arch/decisions.md)
- **XHTML over Markdown** — the document is the data; no preprocessing layer. → [arch/decisions.md](arch/decisions.md)
- **Extraction as test-enforced contract** — chrome leakage fails CI, not consumers. → [arch/extraction.md](arch/extraction.md)

## Document Map

- `ROADMAP.md` — waves, strategy, budget history
- `CHANGELOG.md` — dated work log (newest first)
- `project-management/` — personas and user stories
- `CONTRIBUTING.md` — release policy (develop → main via CI only)
- `spec/` — normative contracts (conventions.md, extraction.md, schema/)
- `docs/authoring-guide.md` · `docs/integration-quickstart.md` — consumer entry points
- `docs/TEST-HEALTH.md` — suite health record
- `docs/PROJ-LAYOUT.md` — components ↔ directories mapping
- `docs/PROJ-SCHEMA.md` — data contract summary
- `docs/THREAT-MODEL.md` — attack surface and mitigations

Do not restate their content here.

## Monorepo Role

NPL-ecosystem spec + JS product submodule; couples to the NPL framework
(`Portfolio/Apps/AI/NoizuPromptLingo`) — the vocabulary is the XML variant
of NPL (conventions §9).
