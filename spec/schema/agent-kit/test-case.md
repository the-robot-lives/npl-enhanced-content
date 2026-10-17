# Schema — `agent-kit-test-case`

The cached test-case card; the authored steps and expectation are the
record.

> One contract for the case renderer: a cached-embed card
> (`src/lit/agent-kit/agent-kit-test-case.ts`, `AkitTestCase`) —
> authored `<agent-kit-step>` entries in document order plus the
> `<agent-kit-expected>` part stated once. Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-testing.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-test-case kind="case" tags="authoring"
                     org="acme" project="semtext" key="case-board-refs">
  <agent-kit-step>Open the board demo.</agent-kit-step>
  <agent-kit-step>Extract without JavaScript.</agent-kit-step>
  <agent-kit-expected>The records equal the JS-on set.</agent-kit-expected>
</agent-kit-test-case>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-test-case[data-attr]` — same dual-form contract as the
sem-* tier.

Case attributes, per the case contract (all strings):

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

- `<agent-kit-step>` — one step; author at least one (the count drives
  the chrome chip, never a childRule). No attributes.
- `<agent-kit-expected>` — the expectation, stated once (exactly one).

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the case's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored steps and expectation ARE the record — extraction reads
them in document order, never the network; JS-off renders exactly what
was authored (step ordinals rendered by the `::before` rule). A cached
snapshot may enrich the card; enrichment renders inside the chrome
container and is never a replacement for the authored record. (The
base class renders no stamp here — the case carries no snapshot shape
today; the schema preset stays for symmetry with the family.)

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
invariant and the file:// offline contract.

## Rendered form

- Enhanced: the `<agent-kit-test-case>` element itself (Lit
  `AkitTestCase` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim the element renders chrome inside ONE
  `agent-kit-chrome` container: the step-count chip
  (`data-step-count`). Steps render as an ordered list through the
  agent-kit section of `themes/_vocabulary.css` (ordinals via
  `::before`), the expectation as a highlighted line. Chrome is
  appended after the authored record, never replaces it; extraction
  skips chrome subtrees whole, so the §8 invariant holds by
  construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — steps read as an ordered list, the
  expectation as a highlighted line; no chip.
