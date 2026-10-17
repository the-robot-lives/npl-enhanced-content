# Schema — `agent-kit-review`

The cached review card; the authored comments and verdict are the
record.

> One contract for the review renderer: a cached-embed card
> (`src/lit/agent-kit/agent-kit-review.ts`, `AkitReview`) promoting the
> sem-review-canvas shape — authored `<agent-kit-comment author at>`
> entries plus the `verdict` attribute. No pins, no radio group, no
> click-to-comment: a static document records a review, it does not
> conduct one. Mirrors the sem-* prose contracts in `spec/schema/*.md`:
> prose is normative — changes here precede spec changes precede code,
> and the file is the BDD source of truth for
> `test/unit/agent-kit-media.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-review org="acme" project="semtext" key="review-board"
                  verdict="approve">
  <agent-kit-comment author="Ada" at="2026-10-17T10:00:00Z">
    Columns and refs line up; shipping it.
  </agent-kit-comment>
  <agent-kit-comment author="Loom" at="2026-10-17T10:05:00Z">
    Agreed — the anchors hold.
  </agent-kit-comment>
</agent-kit-review>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-review[data-attr]` — same dual-form contract as the sem-*
tier.

Review attributes, per the review contract (all strings):

- `verdict`: `string` — one of `approve`, `request-changes`,
  `comment`, `pending` (default); the chrome's verdict chip, coloured
  by value.
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

- `<agent-kit-comment>` — one review comment; author at least one (the
  count is displayed by the chrome chip, never enforced by a
  childRule). Comment attributes, all strings:
  - `author` — the reviewer label, rendered through the comment's CSS
    `::before` (visible with styles on or off, never part of any
    extracted record).
  - `at` — authored ISO-8601 stamp of the comment (machine format).

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the review's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored comments ARE the record — extraction reads them, never the
network; JS-off renders exactly what was authored (reviewer labels
still rendered by the `::before` rule). A cached snapshot may enrich
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
invariant and the file:// offline contract.

## Rendered form

- Enhanced: the `<agent-kit-review>` element itself (Lit `AkitReview`
  — light DOM, no shadow root). Under the `data-sem-upgraded` claim the
  element renders chrome inside ONE `agent-kit-chrome` container: the
  verdict chip (`data-verdict`, coloured approve=correct /
  request-changes=wrong / else muted) and the comment count, and — when
  the snapshot is dated — the snapshot stamp. Comments lay out as
  labelled entries through the agent-kit section of
  `themes/_vocabulary.css`. Chrome is appended after the authored
  record, never replaces it; extraction skips chrome subtrees whole, so
  the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — the comments read as labelled prose; no
  verdict chip, no count.
