# Schema — `agent-kit-chatroom`

The cached chatroom transcript card; the authored messages are the
record.

> One contract for the chatroom renderer: a cached-embed display stub
> (`src/lit/agent-kit/agent-kit-chatroom.ts`, `AkitChatroom`) that
> reuses sem-chat's rendering approach — authored message markup is the
> record, the enhancer annotates without fabricating — against a CACHED
> transcript only. It has NO composer and NO endpoint mode; live chat
> stays with `sem-chat`. Mirrors the sem-* prose contracts in
> `spec/schema/*.md`: prose is normative — changes here precede spec
> changes precede code, and the file is the BDD source of truth for
> `test/unit/agent-kit-reference.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-chatroom org="acme" project="semtext" key="room-authoring">
  <agent-kit-chatroom-name>Authoring stand-up</agent-kit-chatroom-name>
  <agent-kit-chat-msg author="Ada" role="user" at="2026-10-17T09:00:00Z">
    Board's wired — three columns land today.
  </agent-kit-chat-msg>
  <agent-kit-chat-msg author="Loom" role="assistant" at="2026-10-17T09:01:00Z">
    Watched. The refs scroll their cards into view.
  </agent-kit-chat-msg>
</agent-kit-chatroom>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-chatroom[data-attr]` — same dual-form contract as the sem-*
tier.

Chatroom attributes, per the chatroom contract (all strings):

- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`).
- `endpoint`: `string` — optional same-origin API path; NEVER fetched
  by this element (Live-fetch policy below) — declared for the
  authoring pipeline only. There is no send path: unlike `sem-chat`,
  this element has no composer at all.
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

- `<agent-kit-chatroom-name>` — the room's display name; optional, one
  (renders as a heading in both modes).
- `<agent-kit-chat-msg>` — one transcript message; author at least one
  (the count is displayed by the chrome chip, never enforced by a
  childRule). Content is free-form authored markup (plain text, links,
  inline sem-* markup — the prose is the message). Message attributes,
  all strings:
  - `author` — the speaker label, rendered through the message's CSS
    `::before` (visible with styles on or off, never part of any
    extracted record).
  - `role` — `user` or `assistant`; drives the side accent in CSS.
  - `at` — authored ISO-8601 stamp of the message (machine format).

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the room's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored messages ARE the record — extraction reads them, never the
network; JS-off renders exactly what was authored (the room name as a
heading, messages as labelled prose). A cached snapshot may enrich the
card (an `updated_at` renders a snapshot stamp chip); enrichment
renders inside the chrome container and is never a replacement for the
authored transcript.

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
invariant and the file:// offline contract. Live chat — fetching and
sending — remains `sem-chat`'s contract; this element is its cached
snapshot twin.

## Rendered form

- Enhanced: the `<agent-kit-chatroom>` element itself (Lit
  `AkitChatroom` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim a chrome header chip reports the authored
  message count, and a cached snapshot's `updated_at` renders a
  snapshot stamp chip. Messages lay out as a transcript through the
  agent-kit section of `themes/_vocabulary.css` (user messages left,
  assistant messages accented, author labels from the attribute).
  Chrome lives inside the ONE `agent-kit-chrome` container; extraction
  skips it whole, so the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — the room name heading and the messages
  (author labels still rendered by the `::before` rule) read as plain
  prose; no chip, no stamp.
