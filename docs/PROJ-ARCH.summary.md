# Project Architecture — Summary

SemText (spec draft v0.7): XHTML-first semantic markup vocabulary — one
document, three readings (styled interactive page / structural record for
LLM agents / extracted plain text). Zero React; one Lit bundle over vanilla
handlers; JS-off degrades to plain prose. Spec-first repo.

## Architecture

- **The one bundle** — `dist/semtext.js` (global `SemText`): Lit elements +
  vanilla handlers + extraction, one CI-enforced size budget via
  `build:strict`; stylesheets ship unbuilt (`semtext.css`, `themes/`).
- **Companion artifacts** — namespace bundles (`npl`, `semext`,
  `agent-kit`) + `lazy` loaders load on top of the core; terminal, editor,
  and agent-browser tools ship separately; node CLIs in `bin/` (`semtext`,
  `semtext-validate`, `semtext-agent`, `semtext-refresh`); live-data bind
  runtime in `src/data/`.
- **Extraction invariant** — `E(D) = E(R(D)) = E(I(R(D)))`; every interactive
  layer is chrome and mints nothing; enforced by e2e, contract in
  `spec/extraction.md` §5.
- **Vocabulary model** — tag form canonical (class form = Appendix A alias);
  88 per-element schemas (43 sem + 21 npl + 15 agent-kit + 9 semext) backed
  by `spec/schema/semtext.schema.json`; dual-spelling selectors and the
  single `data-sem-upgraded` marker gate styling; with no script nothing is
  hidden (plain prose).
- **Build & distribution** — `build.mjs` (bundles) + `build-standalone.mjs`
  (pages, `.nojs.html` variants, `sem:inline` version/size markers); folder
  and single-file portable forms.
- **Deployment** — CI ladder: unit (vitest) → test (cypress + budget) →
  build-push (image on `main`) → CI-bot helm tag bump → ArgoCD auto-sync;
  CDN publish gated on a repo variable; nightly + ci-timing jobs.

## Key decisions

- Bottom tier is the contract: zero-JS support forces semantics into the
  document itself.
- Tag form canonical: bare attributes, no `data-*`; XML-consumer-clean.
- Lit upgrades in place; light-DOM content; chrome mints nothing.
- XHTML over Markdown: the document is the data, no preprocessing layer.

Details: docs/arch/bundles.md · extraction.md · vocabulary.md ·
build-deploy.md · decisions.md
