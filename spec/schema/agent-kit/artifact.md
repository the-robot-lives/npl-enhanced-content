# Schema — `agent-kit-artifact`

The cached typed-artifact card; the authored content is the record.

> One contract for the artifact renderer: a cached-embed card
> (`src/lit/agent-kit/agent-kit-artifact.ts`, `AkitArtifact`) promoting
> the sem-artifact-card shape — a `type` chip plus the authored
> `<agent-kit-artifact-content>` part; a cached snapshot's version list
> renders as inert chips (no slider, no buttons). Mirrors the sem-* prose
> contracts in `spec/schema/*.md`: prose is normative — changes here
> precede spec changes precede code, and the file is the BDD source of
> truth for `test/unit/agent-kit-media.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-artifact org="acme" project="semtext" key="artifact-spec" type="markdown">
  <agent-kit-artifact-content>
    # Extraction spec

    The record is the authored body…
  </agent-kit-artifact-content>
</agent-kit-artifact>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-artifact[data-attr]` — same dual-form contract as the sem-*
tier.

Artifact attributes, per the artifact contract (all strings):

- `type`: `string` — one of `markdown`, `json`, `diff`, `code`; the
  chrome's type chip. Optional.
- `language`: `string` — optional language chip for the `code` type
  (informational; declared, never fetched on).
- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`). A snapshot `versions` list
  (`[{id, label, createdAt}]`) renders as inert version chips.
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

- `<agent-kit-artifact-content>` — the current version's content,
  authored (markdown source, JSON text, diff text, or code as
  authored); exactly one. The document's own escaping governs — the
  element never parses, re-renders, or executes it.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the artifact's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The authored content IS the record — extraction reads it, never the
network; JS-off renders exactly what was authored. A cached snapshot's
`versions` list enriches the card with inert version chips; enrichment
renders inside the chrome container and is never a replacement for the
authored content.

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

- Enhanced: the `<agent-kit-artifact>` element itself (Lit
  `AkitArtifact` — light DOM, no shadow root). Under the
  `data-sem-upgraded` claim the element renders chrome inside ONE
  `agent-kit-chrome` container: the `type` chip and, when the snapshot
  carries one, the inert version list. The authored content part
  renders below as monospace preformatted text through the agent-kit
  section of `themes/_vocabulary.css`. Chrome is appended after the
  authored record, never replaces it; extraction skips chrome subtrees
  whole, so the §8 invariant holds by construction.
- JS-off: the block box from the agent-kit section of
  `themes/_vocabulary.css` — the content reads as monospace prose; no
  chip, no version list.
