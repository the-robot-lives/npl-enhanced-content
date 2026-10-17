# Schema — `agent-kit-acceptance-criteria`

The structured given/when/then list renderer; the authored criteria are
the record.

> One contract for the acceptance-criteria renderer: a display stub over
> the cached-embed base (`src/lit/agent-kit/agent-kit-acceptance-criteria.ts`,
> `AkitAcceptanceCriteria`). The authored `<agent-kit-criterion>` parts —
> each a given/when/then triple — are the record; the renderer adds only
> a chrome header chip that counts them. Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-acceptance.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-acceptance-criteria org="acme" project="semtext" key="crit-extract">
  <agent-kit-criterion>
    <agent-kit-given>a hand-authored XHTML document</agent-kit-given>
    <agent-kit-when>the extractor runs with JavaScript on or off</agent-kit-when>
    <agent-kit-then>the two record sets deep-equal</agent-kit-then>
  </agent-kit-criterion>
</agent-kit-acceptance-criteria>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-acceptance-criteria[data-attr]` — same dual-form contract as
the sem-* tier.

Structured-list attributes, per the criteria contract (all strings):

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
alias):

- `<agent-kit-criterion>` — one acceptance criterion; author at least
  one (the count is displayed by the chrome chip, never enforced by a
  childRule).
  - `<agent-kit-given>` — the precondition; exactly one per criterion.
  - `<agent-kit-when>` — the action; exactly one per criterion.
  - `<agent-kit-then>` — the observable outcome; exactly one per
    criterion.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the criteria set's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored criteria ARE the record — extraction reads them, never the
network; JS-off renders exactly what was authored. A cached snapshot may
enrich the card with upstream verification status; enrichment renders
inside the chrome container and is never a replacement for the authored
criteria.

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

- Enhanced: the `<agent-kit-acceptance-criteria>` element itself (Lit
  `AkitAcceptanceCriteria` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim a chrome header chip reports the authored
  criteria count (`data-criteria-count`); the criterion rows themselves
  are styled by the agent-kit section of `themes/_vocabulary.css`
  (given/when/then as labelled rows). Chrome lives inside the ONE
  `agent-kit-chrome` container; extraction skips it whole, so the §8
  invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css`; the criteria read as plain labelled prose.
