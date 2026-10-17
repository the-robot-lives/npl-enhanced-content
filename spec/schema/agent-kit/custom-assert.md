# Schema — `agent-kit-custom-assert`

The structured expr/expect list renderer; the authored asserts are the
record.

> One contract for the custom-assert renderer: a display stub over the
> cached-embed base (`src/lit/agent-kit/agent-kit-custom-assert.ts`,
> `AkitCustomAssert`). The authored `<agent-kit-assert-expr>` /
> `<agent-kit-assert-expect>` pairs are the record; the renderer adds
> only a chrome header chip that counts them. Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-acceptance.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-custom-assert org="acme" project="semtext" key="assert-extract">
  <agent-kit-assert-expr>extractRecords(doc)</agent-kit-assert-expr>
  <agent-kit-assert-expect>deep-equals the JS-off set</agent-kit-assert-expect>
  <agent-kit-assert-expr>norm(text)</agent-kit-assert-expr>
  <agent-kit-assert-expect>collapses authored whitespace only</agent-kit-assert-expect>
</agent-kit-custom-assert>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-custom-assert[data-attr]` — same dual-form contract as the
sem-* tier.

Structured-list attributes, per the assert contract (all strings):

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

Children — the cached body, authored part tags (unregistered custom
elements by design; the `.agent-kit-<part>` class spelling is the
alias). Expr/expect pairs are positional: each `<agent-kit-assert-expr>`
is the expression whose expectation is the NEXT
`<agent-kit-assert-expect>` at the same nesting level:

- `<agent-kit-assert-expr>` — the expression under test; at least one.
- `<agent-kit-assert-expect>` — the expectation for the preceding
  expression; at least one.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the assert set's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored pairs ARE the record — extraction reads them, never the
network; JS-off renders exactly what was authored. A cached snapshot may
enrich the card with upstream verification status; enrichment renders
inside the chrome container and is never a replacement for the authored
pairs.

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

- Enhanced: the `<agent-kit-custom-assert>` element itself (Lit
  `AkitCustomAssert` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim a chrome header chip reports the authored
  assert count (`data-assert-count`); the expr/expect rows themselves
  are styled by the agent-kit section of `themes/_vocabulary.css`.
  Chrome lives inside the ONE `agent-kit-chrome` container; extraction
  skips it whole, so the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css`; the pairs read as plain labelled prose.
