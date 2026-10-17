# Schema — `agent-kit-organization` / `agent-kit-project`

The two reference-card tags — one generic renderer parameterized by
kind; the authored inner content is the record.

> One contract for the reference cards: a single generic renderer
> (`src/lit/agent-kit/reference-shared.ts`, `AkitReferenceCard`) — the
> authored `<agent-kit-name>` / `<agent-kit-description>` parts (the
> shared part defs) are the record. The primary tag is
> `agent-kit-organization`; `agent-kit-project` differs in the rendered
> kind chip and the footer link shape (`optionsIn`). Mirrors the sem-*
> prose contracts in `spec/schema/*.md`: prose is normative — changes
> here precede spec changes precede code, and the file is the BDD
> source of truth for `test/unit/agent-kit-reference.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-project org="acme" key="semtext">
  <agent-kit-name>SemText</agent-kit-name>
  <agent-kit-description>
    The XHTML-first rich-content spec and component kit.
  </agent-kit-description>
</agent-kit-project>
```

The two tags differ ONLY in the tag name — the record shape and chrome
are identical (one renderer, one CSS section). Pick the tag that names
the card's kind; the rendered kind chip and footer link derive from the
tag.

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-organization[data-attr]` — same dual-form contract as the
sem-* tier.

Reference attributes, per the reference contract (all strings):

- `uuid`: `string` — the upstream record UUID (informational).
- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`).
- `endpoint`: `string` — optional same-origin API path; NEVER fetched
  by these elements (Live-fetch policy below) — declared for the
  authoring pipeline only.
- `last-refreshed`: authored ISO-8601 stamp of the most recent sync
  (cached-embed preset).
- `status`: `string` — one of `fresh`, `stale`, `error` (cached-embed
  preset).
- `org`, `project`, `key`: `string` — the reference quartet (schema
  `reference` preset): for the organization card the `org` attribute IS
  the record's slug; for the project card `org` + `key` name the owning
  organization and the project slug.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

Children — the cached body, each an authored part tag (unregistered
custom elements by design; the `.agent-kit-<part>` class spelling is
the alias):

- `<agent-kit-name>` — the display name; exactly one.
- `<agent-kit-description>` — the description prose; optional, one.

## Reference attributes

- `org`: `string` — the owning organization slug (the organization
  card's own slug).
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the record key within the project (the project
  card's own slug).
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored inner content IS the record — extraction reads it, never
the network; JS-off renders exactly what was authored (name and
description as plain text). A cached snapshot may enrich the card (an
`updated_at` renders a snapshot stamp chip); enrichment renders inside
the chrome container and is never a replacement for the authored
record.

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

- Enhanced: the `<agent-kit-organization>` element itself (Lit
  `AkitOrganization` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim the element renders chrome inside ONE
  `agent-kit-chrome` container: the header row (kind chip) and — when
  the card is slug-addressable — the "Open in agent-kit" footer
  (organization: `/app/<org>`; project: `/app/<org>/projects/<key>`).
  A cached snapshot's `updated_at` renders a snapshot stamp chip.
  Chrome is appended after the authored record, never replaces it;
  extraction skips chrome subtrees whole, so the §8 invariant holds by
  construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — the authored name and description read as
  plain prose; no chip, no footer.
