# Schema — `agent-kit-user-persona` / `agent-kit-agent-persona`

The two persona tags — one generic renderer parameterized by kind; the
authored inner content is the record.

> One contract for the two persona tags: a single generic renderer
> (`src/lit/agent-kit/persona-shared.ts`, `AkitPersona`) shaped like the
> tobor Persona record — name, role, bio, avatar, metadata. The primary
> tag is `agent-kit-user-persona`; `agent-kit-agent-persona` differs
> only in the rendered kind chip (`optionsIn`). Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-personas.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-user-persona org="acme" project="semtext" key="persona-ada"
                        avatar="/fixtures/agent-kit/avatars/ada.png">
  <agent-kit-persona-name>Ada Lovelace</agent-kit-persona-name>
  <agent-kit-persona-role>Product manager</agent-kit-persona-role>
  <agent-kit-persona-bio>
    Owns the SemText roadmap; reviews authoring ergonomics.
  </agent-kit-persona-bio>
  <agent-kit-persona-metadata>team: authoring
timezone: UTC+0</agent-kit-persona-metadata>
</agent-kit-user-persona>
```

The two tags differ ONLY in the tag name — the record shape, cached
body, and chrome are identical (one renderer, one CSS section, one
fixture file). Pick the tag that names the persona's kind; the rendered
kind chip derives from the tag, not an attribute.

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-user-persona[data-attr]` — same dual-form contract as the
sem-* tier, `data-user-persona` wins when both spellings are present.

Persona attributes, per the persona contract (all strings):

- `avatar`: `string` — the CACHED avatar URL. The chrome header renders
  an `<img>` from it verbatim; the element never fetches, resolves, or
  substitutes anything (no placeholder services), and with JavaScript
  off no image element exists.
- `uuid`: `string` — the upstream persona UUID (informational; the
  reference quartet identifies the record).
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
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

Children — the cached body, each an authored part tag (unregistered
custom elements by design, like sem-fact's `<statement>`; the
`.agent-kit-<part>` class spelling is the alias):

- `<agent-kit-persona-name>` — the display name; exactly one.
- `<agent-kit-persona-role>` — the role line; optional, one.
- `<agent-kit-persona-bio>` — the bio prose; optional, one.
- `<agent-kit-persona-metadata>` — prose metadata lines (`key: value`);
  optional, one.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the persona's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored inner content IS the record — extraction reads it, never
the network; JS-off renders exactly what was authored (name, role, bio,
metadata as plain text). A cached snapshot (inline
`script[type="application/json"]` child, or the `fixtures` path) may
enrich the card with upstream fields the authored record omits (a
`metadata` object renders as chrome chips); enrichment renders inside
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
backend-proxy lane). A document that wants live data embeds the fetched
result as authored content and stamps it (see Refresh contract); a
runtime fetch would break the §8 extraction invariant and the file://
offline contract. The `avatar` URL is rendered verbatim into an
`<img>` — the browser's own image load, never an element fetch.

## Rendered form

- Enhanced: the `<agent-kit-user-persona>` element itself (Lit
  `AkitUserPersona` — light DOM, no shadow root; content stays
  searchable/copyable). Under the `data-sem-upgraded` claim the element
  renders chrome inside ONE `agent-kit-chrome` container: the header
  row (avatar `<img>` from the cached `avatar` URL, when authored, and
  the kind chip) and — when the snapshot carries a `metadata` object —
  the metadata chip strip. Chrome is appended after the authored
  record, never replaces it; extraction skips chrome subtrees whole, so
  the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` (`agent-kit-user-persona,
  .agent-kit-user-persona { display: block; }`, one line per tag).
  Nothing hidden, nothing generated — the authored record reads as
  plain prose with no image.
