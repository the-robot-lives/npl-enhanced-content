# Schema — `agent-kit-issue` / `agent-kit-epic` / `agent-kit-bug` / `agent-kit-user-story` / `agent-kit-task` / `agent-kit-sub-task`

The six agent-kit ticket tags — one generic renderer parameterized by
type; the authored inner content is the record.

> One contract for the six ticket tags: a single generic renderer
> (`src/lit/agent-kit/ticket-shared.ts`, `AkitTicket`) parameterized by
> type — every clause below applies to all six names. The primary tag is
> `agent-kit-issue`; the schema carries its attribute catalog and the
> companions reference it (`optionsIn`). Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-tickets.test.ts`.
>
> `agent-kit-ticket-ref` — the inline reference affordance — is its own
> component with its own contract (`ticket-ref.md`).

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-issue org="acme" project="semtext" key="AKIT-001"
                 uuid="7c1e..." state="open" labels="auth,extract">
  <agent-kit-title>Extractor drops class-form parts</agent-kit-title>
  <agent-kit-description>
    `extractRecords` misses `.agent-kit-title` aliases when the class
    appears on a wrapper element.
  </agent-kit-description>
  <agent-kit-last-updated>2026-10-17T09:24:00Z</agent-kit-last-updated>
</agent-kit-issue>
```

The six tags differ ONLY in the tag name — the record shape, cached
body, and chrome are identical (one renderer, one CSS section, one
fixture file). Pick the tag that names the record's type; the rendered
type chip derives from the tag, not an attribute.

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-issue[data-attr]` — same dual-form contract as the sem-*
tier, `data-issue` wins when both spellings are present.

Ticket attributes, per the ticket contract (all strings):

- `org`: `string` — the owning organization slug (reference quartet).
- `project`: `string` — the project slug within the organization
  (reference quartet).
- `key`: `string` — the ticket key: a project prefix of 1–6
  `A-Z0-9`, a dash, then at least three digits
  (`/^[A-Z0-9]{1,6}-\d{3,}$/` — `AKIT-001`, `R2D2-0417`). A malformed
  key is warned once (`agent-kit:ticket-key-invalid`) and the card's
  key chip and `#akit-ticket-<KEY>` anchor are omitted — the uuid share
  footer is independent of the local key shape.
- `uuid`: `string` — the upstream ticket UUID; when authored together
  with `org`, the chrome footer renders the share link
  `/app/<org>/tickets/<uuid>` ("Open in agent-kit").
- `state`: `string` — one of `open`, `in-progress`, `review`, `done`,
  `cancelled` (validator-checked). Alternative spelling: authored as
  the `<agent-kit-state>` element — the attribute wins when both
  spellings are present.
- `labels`: `string` — comma-separated label list (`auth,extract`).
  Alternative spelling: authored as the `<agent-kit-labels>` element —
  the attribute wins when both spellings are present.
- `last-refreshed`: authored ISO-8601 stamp of the most recent sync
  (cached-embed preset; shown in the chrome stamp when no
  `<agent-kit-last-updated>` element is authored).
- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`).
- `endpoint`: `string` — optional same-origin API path; NEVER fetched
  by these elements (Live-fetch policy below) — declared for the
  authoring pipeline only.
- `status`: `string` — one of `fresh`, `stale`, `error` (cached-embed
  preset).
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

Children — the cached body, each an authored part tag (unregistered
custom elements by design, like sem-fact's `<statement>`; the
`.agent-kit-<part>` class spelling is the alias):

- `<agent-kit-last-updated>` — ISO-8601 sync stamp of the record;
  optional, one.
- `<agent-kit-title>` — the one-line title; exactly one.
- `<agent-kit-description>` — the body prose (inline Markdown is
  rendered by the host document, not the element); exactly one.
- `<agent-kit-state>` — the state when authored as a child instead of
  the attribute; optional, one.
- `<agent-kit-labels>` — comma-separated labels when authored as a
  child instead of the attribute; optional, one.

## Reference attributes

The `org` / `project` / `key` / `id` quartet above matches the schema's
`reference` defPreset; `key` additionally carries the ticket-key shape
and is the join key for `agent-kit-board` columns and
`agent-kit-ticket-ref` links.

## Cached content

The authored inner content IS the record — extraction reads it, never
the network; JS-off renders exactly what was authored (title,
description, stamps, state/labels as plain text children). A cached
snapshot (inline `script[type="application/json"]` child, or the
`fixtures` path) may enrich the card with upstream fields the authored
record omits; enrichment renders inside the chrome container and is
never a replacement for the authored record.

## Refresh contract

- `last-refreshed`: authored stamp of the most recent sync (machine
  format: ISO-8601); the `<agent-kit-last-updated>` child is the
  equivalent child spelling.
- `semtext:cache` markers: a cache entry names its source and age with
  `data-semtext-cache` metadata in the host document — never a runtime
  fetch. The element itself performs NO fetching; refresh is the
  authoring pipeline's job.

## Live-fetch policy

`agent-kit-*` elements never fetch at render time (`livePolicy:
'never'` — no client credentials; live enrichment is a separate
backend-proxy lane). A document that wants live data embeds the fetched
result as authored content and stamps it (see Refresh contract); a
runtime fetch would break the §8 extraction invariant and the file://
offline contract.

## Rendered form

- Enhanced: the `<agent-kit-issue>` element itself (Lit `AkitIssue` —
  light DOM, no shadow root; content stays searchable/copyable). Under
  the `data-sem-upgraded` claim the element renders chrome inside ONE
  `agent-kit-chrome` container: the meta row (type chip derived from
  the tag, key chip, state badge, label chips, refresh stamp) and —
  when `uuid` + `org` are authored — the "Open in agent-kit" footer
  carrying the share link. A key-anchor span (`#akit-ticket-<KEY>`) is
  placed before the authored children for `agent-kit-ticket-ref` and
  board links. Chrome is appended after the authored record, never
  replaces it; extraction skips chrome subtrees whole, so the §8
  invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` (`agent-kit-issue, .agent-kit-issue {
  display: block; }`, one line per tag). Nothing hidden, nothing
  generated — the authored record reads as plain prose.

## Events

- `agent-kit:ticket-key-invalid`: bubbles + composed; `detail`:
  `{ key: string }` — warned once per element when `key` fails the
  ticket-key shape.
