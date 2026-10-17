# ROADMAP — SemText

Living planning doc. **Supersedes PRD.md §10 for forward planning**; PRD.md remains the
format/spec authority (§1–§9 unchanged and binding). Update this file at every milestone
exit — status drift here is a bug.

**Status as of 2026-10-07** · develop = ba069ce. v0.5 shipped 2026-09-22 (tag-form
canonical, class form = Appendix A alias). W0–W2.2 merged (PRs #10, #12, #14, #17, #19);
`sem-source`, `sem-md`, and tag-form-canonical all landed. Spec pages ship in the image
(Dockerfile fixed), CodeQL hardening r1–3 done, landing re-angled to the
XHTML-replaces-Markdown thesis. **W3 (themes) is externally gated on Track T.** The
2026-10-07 improvement day landed 7 threads on this SHA (hygiene #36, sem-progress
JS-off #37, ROADMAP v2 + PM artifacts #35/#38, agent surface, validate CLI, onboarding
#41, arch-doc refresh). Engineering is healthy; the product is plateaued — the adoption
surface (validation, onboarding, agent contract) is the bottleneck. Forward planning now
runs through the 6-epic story set below (`project-management/`).

Status glyphs used throughout: ✅ complete / repaid · 🔶 in progress · ⬜ not started
(externally gated where the row says so — W3 is the only gated row today).

## Personas & stories

Personas (`project-management/personas/`, P-001…P-008) and user stories
(`project-management/user-stories/`, US-101…US-605, 34 stories across 6 epics) are
**inferred from the codebase and its history, not from user research.** P-008 (Content
Platform Owner) is explicitly a hypothesis persona, unvalidated. Treat a11y metrics in E6
as validation questions, not projections. Dogfooding on the live site is a real document
set, and the extraction-invariant suite is real evidence for the agent persona — but
nobody outside the team has been interviewed.

## Non-negotiable invariants (guardrails — every milestone inherits these)

1. **Canonical artifact = standalone XHTML document.** file:// double-click is the
   zero-th acceptance bar; IIFE classic scripts only, no runtime fetch, no ES modules.
2. **One runtime, one marker.** The vanilla handlers and the Lit components ship in one
   bundle; Lit "upgrades in place" only in the sense that both surfaces claim the same
   `data-sem-upgraded` marker and agree on one runtime state. (The former fallback tier
   and its `data-sem-fallback` handoff marker are retired as of 0.9.0.)
3. **Light DOM for content, shadow DOM for chrome only.** Text stays searchable/copyable.
4. **Zero React. Ever.** (PRD non-goal.)
5. **BDD-before-code.** Schema `.md` + cypress spec co-authored before implementation;
   green before the next element (PRD §9, binding).
6. **JS-off documents stay readable.** Hide-rules gated on `data-sem-upgraded`; no
   content is unreachable without JS.

## Epic & wave plan

Six epics, 34 stories (must/should/could = 14/14/5). Each wave is **independently
droppable**: if a wave proves wrong or the gate never opens, drop it without disturbing
the others. Nothing in W4–W6 depends on W3 landing.

| Wave | Epic | Contents | Exit criterion | Dependency |
|---|---|---|---|---|
| **Sprint 0** | E1 Hygiene & Release Integrity | demo version label (US-101), ROADMAP truth (US-102, *this PR*), release-state verification + policy (US-103), strict-budget CI default (US-104), served-SHA footer (US-105) | no artifact on the site or in the repo states a false version/status | none — ~1 day, zero design risk |
| **W3** | E2 W3 Reader Themes | reader `theme` control (US-201), dark tokens via color-modes contract (US-202), retire `sem-themes` (US-203), per-origin persistence (US-204), preview swatches (US-205) | demo renders under light/dark/system with no inverted-alias tokens | **EXTERNALLY GATED on Track T** (theme pipeline: TRP YAML → CSS with `--sem-*` tokens). Plan only until it opens. |
| **W4** | E3 Authoring & Validation | `semtext-validate` CLI (US-301), published versioned JSON Schemas (US-302), corpus-CI Action (US-303), authoring guide (US-304), md→sem converter (US-305), editor LSP (US-306), implement `sem-query` (US-307), implement `md-aid` (US-308) | an external author can validate a document in CI and get file:line errors against the spec | none — **recommended primary while Track T stays blocked** |
| **W5** | E4 Agent Surface | extraction contract published with invariant evidence (US-401), llms.txt + plain-text docs (US-402), JSON-LD mode (US-403), `semtext extract` CLI (US-404), MCP server (US-405) | an agent can ingest a served document losslessly using only published artifacts | after W4 — reuses the published schemas |
| **W6** | E5 Onboarding & Distribution | playground (US-501), integration quickstart (US-502), spec versioning process / v0.6 (US-503), adopter gallery (US-504), npm landing docs (US-505) | a newcomer goes landing → playground → first valid document unaided | after W4 — the playground is powered by the validator; W6 only pays once W4 exists |
| **slot-any** | E6 Accessibility & Degradation | `sem-progress` JS-off fix (US-601), per-element JS-off audit (US-602), keyboard pass (US-603), print stylesheets (US-604), reduced-motion (US-605) | every vocabulary element renders meaningful text with scripts stripped; keyboard + reduced-motion pass on reader controls | none — fits any gap; enforces invariant 6 and the founding claim |

**Sequencing argument.** Hygiene is free and stops artifacts from lying about the
product. W4 is what lets an *external* document exist — without a validator, SemText is
a spec only its authors can follow. W5 expresses the agent thesis as product (the
invariant E(D) = E(R(D)) = E(I(R(D))) is already tested; it just isn't published as a
contract). W6 only pays once W4 exists: a playground without a validator is a demo of
failures. W3 stays parked behind Track T; E6 slots anywhere and keeps the founding
degradation claim honest while the bigger waves wait.

## Size budgets (raw minified, enforced by `npm run build:strict`)

Current, after the Lit-only bundle (spec v0.6): one artifact, one budget. The
per-tier budgets below it are the retired five-artifact history, kept for the
guardrail discipline they document.

| Artifact | Budget | Measured (2026-10-13) |
|---|---|---|
| `semtext.js` (one bundle) | **152 KB** (raised from 126 — user decision 2026-10-14; 144 → 145 after family A containers, 2026-10-18; 145 → 152 after the interactive containers joined the single bundle the same day) | 151.5 raw / 47.1 gzipped with both lanes merged — in budget |
| `npl.js` | **52 KB** | 49.0 raw / 15.3 gzipped (2026-10-14) |
| `semtext-agent.js` | **24 KB** | 20.4 raw / 7.3 gzipped (2026-10-14) |
| `semtext-js-shell.js` | **256 KB** | 126.5 raw / 43.4 gzipped (2026-10-14) |
| `semtext-editor.js` (editor, §9) | **256 KB** (raised from the §9.1 estimate of 128 — integrate 2026-10-14; the estimate predated the integrated build, see the budget comment in `scripts/build.mjs`) | 245.1 raw / 69.8 gzipped — in budget |
| `semtext-lazy.js` (loader) | **8 KB** | 3.3 raw / 1.6 gzipped (2026-10-14) |
| `npl-lazy.js` (loader) | **8 KB** | 4.0 raw / 1.8 gzipped (2026-10-14) |
| `semext.js` (semext-* embeds, feat/semext-embeds) | **48 KB** | 36.3 raw / 12.1 gzipped (2026-10-18) — in budget; the report-only placeholder budget from the empty-barrel lane is now enforced for real (family B's nine service-backed embeds) |
| `agent-kit.js` (agent-kit-* embeds, feat/agent-kit-bundle) | **48 KB** (set 2026-10-18, PR #63 — matches the semext embed-lane budget) | 39.9 raw / 12.5 gzipped — in budget (22 tags, family C) |
| `agent-kit-lazy.js` (loader) | **6 KB** (set 2026-10-18, PR #63) | 4.6 raw / 1.9 gzipped — in budget |

Retired artifacts (spec v0.5, tag-form canonical, PR #30) — their handlers now
share the single bundle budget:

| Artifact | Budget | Measured |
|---|---|---|
| `semtext-fallback.js` | 64 KB (raised from 14 KB — tier-2 fallback budget, user decision 2026-10-14). **Removed 0.9.0**: the handlers live in `src/vanilla/` inside the single bundle; row kept for history. | 13.0 |
| `semtext-reading.js` | 19.5 KB | 19.4 — at the line |
| `semtext.js` (Lit only) | 56 KB | 49.5 |
| `semtext-extract.js` | 12 KB | 9.7 |
| `semtext-md.js` | 8.5 KB | 8.0 |

The bundle budget is a guardrail, not an aspiration: any future bump goes through
this section and `scripts/build.mjs` together.

Data-visualizer phase 1 (2026-10-13, spec/data-visualizer.md) raised the reading budget
19.5 → 27 KB (measured 25.6) and the Lit budget 56 → 63 KB (measured 55.8): both bundles
now carry the shared data-source module (`src/data/table.ts` + `src/reading/data.ts`).

Data-visualizer phase 2 (2026-10-13) raised reading 27 → 36 KB (measured 35.3) and Lit
63 → 66 KB (measured 65.5): inline csv/yaml/json parsers + sql shape declarations
(`src/data/{csv,yaml,json,sql}.ts`).

Data-visualizer phase 3 (2026-10-13) raised reading 36 → 40 KB (measured 39.7) and Lit
66 → 70 KB (measured 69.9): declared structures — the data-columns overlay and the
OpenAPI-style yaml-schema flattener (`src/data/structure.ts`).

Data-visualizer phase 4 (2026-10-13) raised reading 40 → 43 KB (measured 42.4) and Lit
70 → 73 KB (measured 72.5): the source loader tier — URL policy, format sniffing,
fetch + cache (`src/data/load.ts`, `src/reading/data-load.ts`).

Data-visualizer phase 5 (2026-10-13) raised reading 43 → 55 KB (measured 54.1) and Lit
73 → 85 KB (measured 84.2): the query engine and chrome — the §8 SQL subset
parser/executor, sem-data-join materialization, the editable query textarea and
view buttons (`src/data/query.ts`, `src/reading/data-query.ts`,
`src/reading/data-tableview.ts`).

Data-visualizer phase 6 (2026-10-13) raised reading 55 → 61 KB (measured 59.5) and Lit
85 → 91 KB (measured 89.7): the full-page modal viewer and the deep links —
the Expand/Copy-link chrome, dialog teleport/focus trap, hash parse/apply
(`src/reading/data-modal.ts`, `src/data/deeplink.ts`, spec §10).

Shell budget (2026-10-14, docs/terminal/CORE-V2.md) raised the `semtext-js-shell.js`
budget 96 → 256 KB raw (user decision): Epoch 2 folds the screen model, line
discipline, input model, app API, and the canvas driver — the one rendering path,
bundled, no separate chunk (see CORE-V2 §8.2/§8.4) — into the single file://-safe
IIFE. Measured today: 74.8 raw / 26.2 gzipped.

Core bundle budget (2026-10-14) raised `semtext.js` 126 → 144 KB raw (user
decision): the docs-overhaul content (spec v0.7 reference/tag review, sem-shell,
sem-browser, npl class form) measured 132.3 raw / 41.9 gzipped — inside the
new line. 2026-10-18: the family A containers (19 tags, +1.2 KB on a base
grown to 143.1 by parallel lanes) measured 144.3 raw; the coordinator raised
the line to 145 KB post-measure (semext/agent-kit remain separate bundles).
Any future bump still goes through this section and
`scripts/build.mjs` together.

Core bundle budget (2026-10-18) raised `semtext.js` 145 → 152 KB raw: the
interactive containers (sem-workflow / sem-site-tree / sem-file-tree and the
shared tree engine they lazy-ship) joined the single bundle per the
no-CSS-only-tags registration contract (`lit-all-tags-registered.test.ts` —
every schema tag answers `customElements.get()` once the core loads), the same
sem-browser wiring, measured on the family A base. Measured 150.1 raw / 46.6
gzipped on that base; 151.5 raw / 47.1 gzipped once both lanes merged — inside
the new line.


## History (recorded decisions — preserved)

### Tag-form canonical (2026-09-22, PR #30)

conventions.md is re-baselined as **v0.5**: the XHTML custom-element form with bare
attributes (`<sem-facts view-as="quiz">`, `<sem-fact>` › `<statement>`) is the canonical
vocabulary; the v0.4 `div.sem-*` + `data-*` spelling is a compatibility alias
(Appendix A), still accepted by every tier and still what `web/demo/index.html` /
`reading.html` exercise. The spec page, schemas, extraction worked example, site
quick-start and README show the tag form first. Code: the fallback core's handlers and
the Lit facts/details/note wrappers select both forms (`shared/sel`), a first-pass
handler mirrors bare parameters to `data-*` after the `sem-source` snapshot, a collapsed
tag-form note wraps its own body, and the vocabulary CSS reads the bare spelling wherever
a rule must hold with no script. Recorded: the growth to 14 KB core budget is the
`:is(sem-x, .sem-x)` selectors, the bare→`data-*` mirror (`src/fallback/attrs.ts`), the
`:not([data-sem-upgraded])` guards and the note body wrap. The alias path is not
separable — the same selector string serves both forms. Precedence keeps extraction §3.6
unchanged: `data-<name>` wins over a bare `<name>` on one element; runtime state is
always `data-*`; the `sem-source` fence always shows authored markup.

### M1 — Format spec v0 + Tier-0 schemas ✅ (re-baselined)

PRD exit said "9 schemas"; main carries 6 (note, procedure, properties, views, reveal,
progress). **Re-baseline decision:** `sem-fact(s)` and `sem-detail(s)` schemas are *entry
criteria for M3*, not M1 debt — §9 requires schema+spec before code anyway, and those two
schemas exist to serve the flagship build, so they belong where they get used.

### M2 — v0.4 class-based baseline ✅ (demoted to alias, 2026-09-22)

`web/demo/index.html`: inline CSS + fallback handler, class-based vocabulary
(`div.sem-*`, `data-*`; sugar is display-only). Double-click demo works. Since
conventions v0.5 this spelling is the **class-form alias** (Appendix A); the demo stays
as the alias's reference document and regression surface.

### M3 — Flagship + Lit upgrade path ✅ complete

Strangler, not big-bang: PR#2 (Lit precedent — `SemNote` light-DOM LitElement honoring
the handoff contract, standalone inlined-bundle page, file://, zero network); then
`sem-facts` + `sem-details` schemas & BDD co-authored (full `view-as` matrix:
list / flashcards / quiz); then flagship implementation on the class baseline with
fallback handlers and the Lit upgrades. D1 naming collision repaid here
(`.sem-progress` label → `.sem-facts-meter`). Exit: demo green on all three view-as
modes, both tiers asserted, single-file variant builds.

### R — Reading experience ✅ complete through W2.2 (one PR each → `develop`)

Custom elements and cross-cutting behavior that make long-form SemText documents
readable in a browser, without breaking any invariant above. Binding decisions: split
bundles (fallback core stays small; `dist/semtext-reading.js` carries
reader/table/code/references from W1); Lit elements are thin wrappers over the fallback
`enhanceX()`; glossary is `sem-properties view-as="glossary"`, not an element; `sem-table`
sort may reorder the DOM because every row is stamped `data-sem-source-index` and
extraction restores authored order.

| Wave | Contents | Status |
|---|---|---|
| **W0 Foundations** | D10 + D12 repaid; print stylesheet; `prefers-reduced-motion`; `src/fallback/target.ts` deep-link resolver; **audience close-out** (`spec/schema/sem-audiences.md`, `src/fallback/audience.ts`, `data-audience` canonical); `sem-note view-as="margin"`; `src/shared/summary.ts`; budgets | ✅ merged (#10) |
| W1 Prose | `sem-chronology`/`sem-event` (CSS-only), `sem-code`, `sem-references`/`sem-reference`, glossary mode, `src/shared/popover.ts`, reading bundle + `<!-- sem:inline reading -->` | ✅ merged (#12) |
| W2 Chrome + data | `sem-reader` (outline, progress, focus, type, color, print, audience controls; theme deferred), `sem-table` (sort/filter, source-index ordering), site dogfoods `sem-reader` + live `sem-table`; explicit `[data-color-mode="dark"]` token block | ✅ merged (#14) |
| **W2.1 Source** | `sem-source` rendered/source section wrapper (core snapshot + reading-bundle fence over `sem-code`); every demo section wrapped; site example | ✅ merged (#17) |
| **W2.2 Markdown** | `sem-md`: Markdown block rendered in the browser (GFM subset), rendered/raw toggle, copy; own bundle `dist/semtext-md.js`; extraction `{source}`; site Reading example | ✅ merged (#19) |
| W3 Themes | reader `theme` control, dark tokens, retire planned `sem-themes` | ⬜ **gated on Track T** — see E2 above |

Recorded wave decisions (abridged, kept for precedent):

- **W1.** Glossary mode lives in the *reading* bundle, not the fallback core (the
  popover alone would have broken the core budget). The Lit wrappers import the reading
  bundle's per-element enhance functions — one behaviour implementation, idempotent on
  DOM state. `sem-chronology` mints no custom element (CSS-only, pattern `sem-procedure`).
  `sem-code.source` is extracted verbatim (second recorded exception to normalised text).
- **W2.** The reading bundle measured 16.6 KB against a planned 14, so the budget was
  set at measured + review cost rather than the plan's figure. `sem-reader` is the second
  authored element in the extraction skip set (§3 rule 7). `sem-table` is the only
  DOM-reordering runtime; extraction restores authored order (§5 recorded exception). The
  planned JSON payload for `sem-table` is dropped: the authored markup is the data.
- **W2.1.** The `sem-source` snapshot happens in the **core** fallback (registered
  first) because the fence must show the document as written and every other handler
  mutates the subtree on DOMContentLoaded. The snapshot is an inert `text/plain` script
  child, not a WeakMap — the reading bundle is a sibling IIFE and cannot share module
  state with the core. `sem-source` is the vocabulary's first **transparent** element in
  extraction (§3 rule 8), which keeps the positional record list valid after every demo
  section was wrapped.
- **W2.2.** `sem-md` ships as its **own bundle** (global `SemTextMd`, marker
  `<!-- sem:inline md -->`, export `semtext/md`) — the parser is the largest single
  behaviour and most documents carry no Markdown. Hand-written GFM-subset parser
  (`src/md/parse.ts`); no vendored library fits 8 KB with its licence header.
  `createElement`/`textContent` only; raw HTML in Markdown is text; `javascript:` URLs
  dropped. Destinations allowlisted after C0/space stripping (a blocklist was bypassable
  with `java&#9;script:`); nesting capped at 16 with per-element try/catch restore;
  offset-based linear inline scanner. `source` is the **normalised** Markdown — third
  recorded exception to normalised text. The fence enhancer is resolved lazily so load
  order does not matter; the bundle stamps only the element marker, never `<html>`.

### M5 — Tier-2 + distribution + publish prep ⬜

- Tier-2 elements: ~~chronology~~ (R/W1), ~~table~~ (R/W2), query (**→ US-307, E3/W4**),
  ~~theme-picker~~ (→ `sem-reader theme`, E2/W3), md-aid (**→ US-308, E3/W4**).
- Forms: single-file inlined (proven) and **MHTML round-trip**.
- **Distribution:** apply + seed `cdn.derobot.is` (infra committed on monorepo develop
  e8e2d35b, not yet applied — see monorepo runbook). Assets get `Cache-Control=immutable`
  for hashed names. Portfolio docs reference the CDN instead of vendoring bundles.
- **npm publish prep:** package metadata, versioning policy (additive-safe / reductive-
  breaking), deprecation story published with v0.1.
- **Exit:** zero React, MHTML round-trip verified, CDN serving `semtext.js`, npm pack clean.

## Debt register

Every row: what it costs, what it costs *per change*, and the written trigger to repay.

| ID | Item | Principal | Interest rate | Trigger to repay | Risk |
|---|---|---|---|---|---|
| D1 | `.sem-progress` class names both the progress element and a facts-chrome label | small rename | every element that renders both in one document misbehaves; grows with each new element | ✅ repaid **M3 step 3** (renamed to `.sem-facts-meter`) | correctness |
| D2 | Lit elements upgrade pre-parse — children may not exist at first `updated()`; SemNote retries via rAF | pattern, not code | every new Lit element must re-learn the children-ready problem (or copy the pattern) | document the pattern in a shared base/helper during **M3 step 3** | correctness, per-element friction |
| D3 | PRD.md §10 milestones drifted from reality before this roadmap existed | one pointer note | confusion about which doc is authoritative | PR gets a "see ROADMAP.md" note on next PRD touch | friction |
| D4 | CDN infra committed but unapplied (monorepo develop e8e2d35b) | apply + seed per runbook | assets ship without a distribution host; docs can't reference CDN URLs | **M5** distribution step | delivery |
| D5 | Vanilla fallback handler duplicated verbatim between `web/demo/index.html` and the Lit elements | copy-paste, two homes | any fallback bugfix must be applied twice or drifts | ✅ repaid (`src/fallback/**` → `dist/semtext-fallback.js`; the demo page now carries a build marker, not a hand-written IIFE) | correctness |
| D6 | Quiz option shuffle used `sort(() => Math.random() - 0.5)` — not uniform, engine-dependent | small rewrite | quiz distractor order is biased and non-portable | ✅ repaid (both tiers draw seeded Fisher-Yates from `src/shared/rng.ts`) | correctness |
| D7 | Dead `./preprocess` package export (`dist/preprocess.js` never built) | remove | `npm pack` ships a stale export a consumer could resolve | ✅ repaid | delivery |
| D8 | `themes/` declared as a package export/`files` entry with no directory on disk | create + populate | `npm pack` ships a broken export | ✅ repaid | delivery |
| D9 | `"type": "module"` vs the `.` export mapping to an IIFE bundle with no ESM/CJS exports | build-format decision | consumers hit a silent/confusing import failure | ✅ repaid — the `.` export is dropped rather than faked. The export map is subpaths that each name the artifact they map to (`semtext/lit`, `semtext/fallback`, `semtext/extract`, `semtext/themes/*`), and `package.json` documents the real format: classic IIFE scripts that install a global and export nothing, consumed via `<script src>` / CDN or as a side-effect import. A dual ESM entry stays available as a later choice, but the manifest no longer promises named imports it cannot deliver | delivery |
| D11 | `web/demo/standalone-lit.html` inlined a hand-pasted copy of `dist/semtext.js`, so Lit-tier cypress assertions green-lit a frozen artifact | build automation | a Lit regression can land fully green; the gap is invisible and unbounded in time | ✅ repaid (`scripts/build-standalone.mjs` substitutes the freshly built bundle; cypress runs against `dist/demo/`) | correctness |
| D13 | `sem-note[collapsed]` anti-flash rule gated on `:not([data-sem-upgraded])` — with the bundle absent the body stayed `display:none` with no summary | one selector (`:defined`) | every element that adds a pre-upgrade anti-flash rule inherits the bug | ✅ repaid — found by the new scripts-stripped artifact, which is the whole reason it exists | degradation |
| D12 | Ungated `display:none` in the vocabulary hides `.incorrect-statement` and inactive `.sem-view` in the script-stripped no-JS artifact | CSS gating | every new hide-rule inherits the pattern; the no-JS degradation promise stays partly unmet | ✅ repaid **R/W0** — every hide rule gated on `:is([data-sem-fallback],[data-sem-upgraded])`; `sem-views` marks its container; both tiers stamp `<html>`; `nojs-artifact.cy.js` expectations flipped | degradation |
| D10 | Theme CSS ships no `sem-*:not(:defined)` base — custom-element documents render unstyled before/without the Lit upgrade | one CSS block in `themes/_vocabulary.css` | every element added in element form inherits the defect | ✅ repaid **R/W0** — every vocabulary selector is `:is(sem-x, .sem-x)`; the site page's local `sem-note` restatement deleted | correctness, degradation |
| D14 | Audience qualifier forward-declared with no schema; `lit/base.ts` read `data-sem-audience` while extraction read `data-audience` | schema + handler + one attribute rename | two spellings in flight; a Lit element and the extractor disagree about the same document | ✅ repaid **R/W0** — `spec/schema/sem-audiences.md`, `src/fallback/audience.ts`, `data-audience` canonical everywhere | correctness |
| D15 | Fallback derived reveal summaries as "first eight words + …" while extraction used the schema's 60-char rule | share one function | reader and machine see different summaries for the same reveal | ✅ repaid **R/W0** — `src/shared/summary.ts` | correctness |

## Open decisions (must close before their dependent milestone exits)

| Decision | Gates | Notes |
|---|---|---|
| Bare `<agent>` metadata children vs `sem-`-prefixed names | M3 exit (root document shape) | flagged in PRD meta-review; still open |
| MHTML vs plain single-file as the "portable" primary | M5 | single-file already proven; MHTML round-trip untested |
| CDN single vs 2 replicas | M5 distribution | single is fine for cache-efficiency; scale if availability matters |
| Spec §10 Open Questions + v0.6 process | US-503 (E5/W6) | unresolved §10 blocks a credible spec release; the versioning process story owns the close-out |

## Review cadence

Revisit at every milestone/wave exit and whenever a PR merges that changes scope. If
this file and PRD.md §10 disagree, this file wins for planning; flag the delta in the
next PR.
