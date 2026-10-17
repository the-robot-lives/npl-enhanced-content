# Schema — `agent-kit-board`

The kanban-ish column layout over ticket refs; the authored board is the
record.

> One contract for the board renderer: a display stub over the
> cached-embed base (`src/lit/agent-kit/agent-kit-board.ts`,
> `AkitBoard`). Authored `<agent-kit-column heading="...">` parts hold
> `<agent-kit-ticket-ref>` children — the refs are the batch-1
> component and wire themselves to `#akit-ticket-<KEY>` anchors; the
> board adds only the column layout (CSS) and a chrome header chip that
> counts columns and refs. Mirrors the sem-* prose contracts in
> `spec/schema/*.md`: prose is normative — changes here precede spec
> changes precede code, and the file is the BDD source of truth for
> `test/unit/agent-kit-board.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-board org="acme" project="semtext" key="board-authoring">
  <agent-kit-column heading="In progress">
    <agent-kit-ticket-ref key="AKIT-001">the extractor issue</agent-kit-ticket-ref>
  </agent-kit-column>
  <agent-kit-column heading="Review">
    <agent-kit-ticket-ref key="AKIT-003">the vocabulary collision</agent-kit-ticket-ref>
  </agent-kit-column>
  <agent-kit-column heading="Done">
    <p>Nothing landed yet this sprint.</p>
  </agent-kit-column>
</agent-kit-board>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-board[data-attr]` — same dual-form contract as the sem-*
tier.

Board attributes, per the board contract (all strings):

- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`). The reference dataset is
  `src/lit/fixtures/agent-kit/board.json`.
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

Children — the cached body, authored part tags (unregistered custom
elements by design; the `.agent-kit-<part>` class spelling is the
alias):

- `<agent-kit-column>` — one board column; author at least one (the
  count is displayed by the chrome chip, never enforced by a
  childRule).
  - `heading` attribute — the column's label, rendered through the
    column's CSS `::before` (so it shows with styles off or on, and
    never enters any extracted record).
  - `<agent-kit-ticket-ref key="...">` — the batch-1 reference
    component; each ref scrolls its `#akit-ticket-<KEY>` anchor card
    into view. Any other inline content (prose, links) is allowed.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the board's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored columns ARE the record — extraction reads them, never the
network; JS-off renders exactly what was authored (columns stacked, ref
prose readable). A cached snapshot may enrich the card with upstream
state (an `updated_at` renders a snapshot stamp chip); enrichment
renders inside the chrome container and is never a replacement for the
authored board.

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

- Enhanced: the `<agent-kit-board>` element itself (Lit `AkitBoard` —
  light DOM, no shadow root). Under the `data-sem-upgraded` claim a
  chrome header chip reports the authored column and ref counts, and a
  cached snapshot's `updated_at` renders a snapshot stamp chip. The
  columns lay out side by side through the agent-kit section of
  `themes/_vocabulary.css` (falling back to a vertical stack in narrow
  viewports). Chrome lives inside the ONE `agent-kit-chrome` container;
  extraction skips it whole, so the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css`; columns stack vertically with their
  `heading` labels rendered by the same `::before` rule, refs inert.
