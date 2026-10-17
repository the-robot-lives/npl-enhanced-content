# Schema — `agent-kit-test-suite`

The cached test-suite card; the authored per-branch rows are the
record.

> One contract for the suite renderer: a cached-embed card
> (`src/lit/agent-kit/agent-kit-test-suite.ts`, `AkitTestSuite`) —
> authored `<agent-kit-branch passed failed>` rows, one per branch, the
> branch name as text and the stats as attributes. The chrome chip
> totals the rows (real arithmetic over the authored attributes).
> Mirrors the sem-* prose contracts in `spec/schema/*.md`: prose is
> normative — changes here precede spec changes precede code, and the
> file is the BDD source of truth for
> `test/unit/agent-kit-testing.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-test-suite kind="suite" tags="authoring"
                      org="acme" project="semtext" key="suite-authoring">
  <agent-kit-branch passed="14" failed="0">main</agent-kit-branch>
  <agent-kit-branch passed="13" failed="1">develop</agent-kit-branch>
</agent-kit-test-suite>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-test-suite[data-attr]` — same dual-form contract as the
sem-* tier.

Suite attributes, per the suite contract (all strings):

- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`).
- `endpoint`: `string` — optional same-origin API path; NEVER fetched
  by this element (Live-fetch policy below) — declared for the
  authoring pipeline only.
- `last-refreshed`: authored ISO-8601 stamp of the most recent sync
  (cached-embed preset).
- `status`: `string` — one of `fresh`, `stale`, `error` (cached-embed
  preset).
- `org`, `project`, `key`: `string` — the reference quartet (schema
  `reference` preset) — see Reference attributes below.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

Children — the cached body, an authored part tag (unregistered custom
element by design; the `.agent-kit-<part>` class spelling is the
alias):

- `<agent-kit-branch>` — one per-branch stats row; author at least one
  (the count drives the totals chip, never a childRule). Branch
  attributes, all strings:
  - `passed` — non-negative integer (authored); totalled by the chrome
    chip. Non-numeric or missing totals as 0.
  - `failed` — non-negative integer (authored); totalled by the chrome
    chip. Non-numeric or missing totals as 0.
  The branch NAME is the row's text content — the record, extracted;
  the stats ride attributes (visible through the row's CSS `::after`,
  never part of any extracted record).

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the suite's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored branch rows ARE the record — extraction reads the branch
names, never the network; JS-off renders exactly what was authored
(stats rendered by the `::after` rule). A cached snapshot may enrich
the card (an `updated_at` renders a snapshot stamp chip); enrichment
renders inside the chrome container and is never a replacement for the
authored record.

## Refresh contract

- `last-refreshed`: authored stamp of the most recent sync (machine
  format: ISO-8601).
- `semtext:cache` markers: a cache entry names its source and age with
  `data-semtext-cache` metadata in the host document — never a runtime
  fetch. The element itself performs NO fetching; refresh is the
  authoring pipeline's job.

## Live-fetch policy

`agent-kit-*` elements never fetch at render time (`livePolicy:
'never'` — no client credentials; live enrichment is a separate
backend-proxy lane). A runtime fetch would break the §8 extraction
invariant and the file:// offline contract. (A live results lane is
exactly what the backend-proxy work will add, as a separate element —
never a fetch inside this one.)

## Rendered form

- Enhanced: the `<agent-kit-test-suite>` element itself (Lit
  `AkitTestSuite` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim the element renders chrome inside ONE
  `agent-kit-chrome` container: the totals chip
  (`data-branch-count` / `data-passed-total` / `data-failed-total`) —
  sums over the authored attributes — and, when the snapshot is dated,
  the snapshot stamp. Branch rows lay out as labelled entries through
  the agent-kit section of `themes/_vocabulary.css` (the stats via
  `::after`). Chrome is appended after the authored record, never
  replaces it; extraction skips chrome subtrees whole, so the §8
  invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — branch names read as labelled prose with
  their stats; no totals chip, no stamp.
