# Schema — `semext-docptr`

A doc-pointer card from a cached snapshot (static embed; refresh is the
CLI lane). The snapshot mirrors `.meta/pointers.yaml` entries so an
authored page can cite a source location durably — the pointer survives
line drift until a CLI refresh re-snapshots it. Contract per
conventions.md and the namespace recipe in `src/lit/semext/index.ts`;
BDD source of truth for the docptr cases of
`test/unit/semext-embeds.test.ts` and `test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-docptr
  id="ptr-shared-load"
  org="noizu"
  project="npl-enhanced-content"
  key="npl-enhanced-content:src/data/load.ts#resolveSource"
  uuid="1f0dc4bd-6b29-591d-b8e7-c8c55dd95a54"
  token="𓋹𓄿𓇳𓏏"
  last-refreshed="2026-10-17T09:14:00Z"
  status="fresh"
>
  <script type="application/json">
    { "pointers": { "1f0dc4bd-6b29-591d-b8e7-c8c55dd95a54": {
        "uuid": "1f0dc4bd-6b29-591d-b8e7-c8c55dd95a54",
        "marker": "〚🔧:𓋹𓄿𓇳𓏏〛",
        "file_path": "src/data/load.ts",
        "line": 42,
        "kind": "function",
        "function_name": "resolveSource",
        "description": "Resolve an embed source with the shared source policy." } } }
  </script>
</semext-docptr>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-docptr[data-uuid]` — same dual-form contract as the sem-* tier,
`data-<name>` wins when both spellings are present.

- `marker`: `string` — full marker string (e.g. `〚🔧:uuid〛`); selects
  the entry whose marker matches.
- `uuid`: `string` — the pointer's full UUID; the strongest selector.
- `token`: `string` — the pointer's 4-glyph token; selects by token
  match against the entry's marker.
- `file`: `string` — narrows selection to entries whose `file_path`
  equals this path (filter, applied after the identifier selectors).
- `id`, `kind`, `tags` per the global attribute catalog.

No identifier authored (no `marker`/`uuid`/`token`) and no `file`
filter ⇒ the card renders the whole snapshot (every entry). Nothing
matches ⇒ the chrome renders a "Pointer not in the cached snapshot."
note; the authored content stands untouched.

## Reference attributes

> The element points at an upstream record (the pointers file); the
> quartet matches the schema's `reference` defPreset and rides the
> `cachedEmbed` preset.

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).
- `fixtures`: `string` — optional fixture source (inline JSON or
  same-origin path). A fixture source in any form is the ONLY source for
  a static embed.
- `last-refreshed`: `string` — ISO-8601 stamp of the last sync.
- `status`: `string` — authored freshness token (`fresh` | `stale` |
  `error`); runtime rewrites it (`cached` | `stale` | `error` | `live`).

## Cached content

The authored inner content IS the record; the snapshot mirrors the
pointers file — an inline `<script type="application/json">` child
(first), else an inline JSON `fixtures` value. Entry shape mirrors
`.meta/pointers.yaml`: `{ uuid, marker, file_path, line, kind, class?,
function_name?, description?, snippet? }`; a snapshot may carry the
entries as an object map (`{ "pointers": { "<uuid>": {…} } }`) or a
flat array (`{ "pointers": [ … ] }`).

## Refresh contract

Static: refresh is a CLI lane (re-snapshot from `.meta/pointers.yaml`
and rewrite the inline JSON). The element never fetches and never
discovers: no `endpoint` authored, no fixture path resolution beyond the
shared inline rules.

## Live-fetch policy

`livePolicy: 'never'` — static snapshot only. No client credentials
ever, in any lane.
