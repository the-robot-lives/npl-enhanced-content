# Schema — `agent-kit-asset`

The cached media asset card; the authored caption is the record.

> One contract for the asset renderer: a cached-embed card
> (`src/lit/agent-kit/agent-kit-asset.ts`, `AkitAsset`) promoting the
> sem-media-gallery item shape — one `src` (the CACHED URL), a `mime`
> chip, one `<agent-kit-caption>` part. Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-media.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-asset org="acme" project="semtext" key="asset-cover"
                 src="/fixtures/agent-kit/cover.png" mime="image/png">
  <agent-kit-caption>The authoring flow, end to end.</agent-kit-caption>
</agent-kit-asset>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-asset[data-attr]` — same dual-form contract as the sem-*
tier.

Asset attributes, per the asset contract (all strings):

- `src`: `string` — the CACHED media URL. The chrome renders an
  `<img>` from it verbatim; the element never fetches, resolves, or
  substitutes anything, and with JavaScript off no image element
  exists.
- `mime`: `string` — the media type chip (`image/png`, `text/plain`,
  …); optional.
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

- `<agent-kit-caption>` — the caption; exactly one.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the asset's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored caption IS the record — extraction reads it, never the
network; JS-off renders exactly what was authored (no image). A cached
snapshot may enrich the card (an `updated_at` renders a snapshot stamp
chip); enrichment renders inside the chrome container and is never a
replacement for the authored record.

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
backend-proxy lane). The `src` URL is rendered verbatim into an
`<img>` — the browser's own image load, never an element fetch. A
runtime fetch would break the §8 extraction invariant and the file://
offline contract.

## Rendered form

- Enhanced: the `<agent-kit-asset>` element itself (Lit `AkitAsset` —
  light DOM, no shadow root). Under the `data-sem-upgraded` claim the
  element renders chrome inside ONE `agent-kit-chrome` container: the
  image (from the cached `src`), the `mime` chip, and — when the
  snapshot is dated — the snapshot stamp. Chrome is appended after the
  authored record, never replaces it; extraction skips chrome subtrees
  whole, so the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — the caption reads as plain prose; no
  image, no chip.
