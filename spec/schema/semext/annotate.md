# Schema — `semext-annotate`

Visitor comment threads, service-backed. `semext-annotate` is the ONE
element of the `semext-*` embed family with a client live read
(`livePolicy: 'anonymous-read'`): every other embed renders authored
snapshots only. Contract per conventions.md and the namespace recipe in
`src/lit/semext/index.ts`; BDD source of truth for
`test/unit/semext-annotate.test.ts` and the annotate cases of
`test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-annotate
  id="page-comments"
  site="semtext-demo"
  page="/demo/semext.html"
  org="noizu"
  project="annotate"
  key="semtext-demo:/demo/semext.html"
  endpoint="https://annotate-srv.therobotlives.com/api/v1"
  last-refreshed="2026-10-17T09:14:00Z"
  status="fresh"
>
  <article class="semext-annotate-thread" data-status="open">
    <strong>Anchor moved?</strong> — tyna, 2026-10-17
    <p>tyna — the §3 anchor jumped after the last push.</p>
  </article>
  <script type="application/json">
    { "site": "semtext-demo", "page": "/demo/semext.html", "threads": [] }
  </script>
</semext-annotate>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-annotate[data-site]` — same dual-form contract as the sem-* tier,
`data-<name>` wins when both spellings are present.

- `site`: `string` — the annotate site slug; query parameter on the live
  read; optional for a snapshot-only embed.
- `page`: `string` — the page path the threads belong to; query
  parameter on the live read (the snapshot's `page` field should match);
  optional for a snapshot-only embed.
- `endpoint`: `string` — the annotate API **base** (e.g.
  `https://annotate-srv.therobotlives.com/api/v1`); the element resolves
  the threads collection `<endpoint>/threads?site=<site>&page=<page>` —
  the path + query shape THIS contract defines, the annotate service
  owns the canonical shape. Optional in snapshot mode.
- `id`, `kind`, `tags` per the global attribute catalog.

## Reference attributes

> The element points at an upstream record; the quartet matches the
> schema's `reference` defPreset and rides the `cachedEmbed` preset.

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the record key within the project (site + page by
  convention).
- `id`: `string` — the specific record id (rides the global catalog).
- `fixtures`: `string` — optional fixture source (inline JSON or
  same-origin path). A fixture source in any form vetoes the endpoint.
- `last-refreshed`: `string` — ISO-8601 stamp of the last sync.
- `status`: `string` — authored freshness token (`fresh` | `stale` |
  `error`); runtime rewrites it (`cached` | `stale` | `error` | `live`).

## Cached content

The authored inner content IS the record: the authored thread rendering
(plain markup, readable JS-off) plus the snapshot — an inline
`<script type="application/json">` child (first), else an inline JSON
`fixtures` value. JS-off renders exactly what was authored; the snapshot
child is invisible. The snapshot and the live body share ONE canonical
shape: `{ site, page, threads: [{ id, status, title, author, createdAt,
anchor: { text }, comments: [{ id, author, body, createdAt }] }] }`.

## Live-fetch policy

`livePolicy: 'anonymous-read'` — the family's one exception, in both
directions:

- ONE GET of the resolved threads URL, `credentials: 'omit'` — no
  ambient credentials, no auth headers, no cookies. The URL must pass
  the shared source policy (src/data/load.ts): no file:// documents, no
  javascript:/data:/blob: schemes; cross-origin http(s) is allowed and
  CORS governs.
- Fail soft: a failed or non-JSON reply sets status `error`, keeps the
  authored view standing, and never throws. A live read NEVER mutates
  the authored record — it renders as chrome only.
- UNTRUSTED DATA renders AS TEXT ONLY. Comment bodies, author names,
  titles and anchors come from visitors; this element never uses
  `unsafeHTML`, never renders thread-supplied markup, and never turns
  thread-supplied strings into links. The unit tier pins a
  `<script>`-bearing comment body staying escaped text.
