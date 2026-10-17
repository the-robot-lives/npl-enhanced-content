# Schema — `semext-sig-metrics`

A SigNoz metrics snapshot + deep-link chrome (cached + link). The
authored inner content IS the record — the metrics table as authored;
the JSON snapshot mirrors it for the chrome, and the chrome adds an
"Open in SigNoz" anchor built from the authored query parameters.
Contract per conventions.md and the namespace recipe in
`src/lit/semext/index.ts`; BDD source of truth for the sig cases of
`test/unit/semext-embeds.test.ts` and `test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-sig-metrics
  id="latency-table"
  query="service=annotate-srv"
  range="1h"
  env="prod"
  org="noizu"
  project="annotate"
  key="annotate:latency-1h"
  status="fresh"
  last-refreshed="2026-10-17T09:14:00Z"
>
  <script type="application/json">
    { "title": "p95 latency", "columns": ["service", "p50", "p95"],
      "rows": [["annotate-srv", "120ms", "1.8s"]] }
  </script>
</semext-sig-metrics>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-sig-metrics[data-query]` — same dual-form contract as the
sem-* tier, `data-<name>` wins when both spellings are present.

- `query`: `string` — the SigNoz query expression (deep-link parameter;
  echoed verbatim, never parsed).
- `range`: `string` — the time range token (deep-link parameter).
- `env`: `string` — the environment token (deep-link parameter).
- `id`, `kind`, `tags` per the global attribute catalog.

## Reference attributes

> The element points at an upstream record; the quartet matches the
> schema's `reference` defPreset and rides the `cachedEmbed` preset.

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
table — an inline `<script type="application/json">` child (first),
else an inline JSON `fixtures` value. Shape:
`{ "title"?, "columns": [ … ], "rows": [ [ … ], … ] }` — `columns`
and `rows` MUST both be arrays for the table chrome to render.

## Refresh contract

Cached + link: refresh is a CLI lane (re-pull the query and rewrite the
inline JSON). The element never fetches SigNoz, never discovers
endpoints, and holds NO client credentials — the deep link carries only
the authored query parameters (`https://apm.noizu.com/?query=…&range=…&env=…`,
plain builder in `src/lit/semext/sig-link.ts`; the link TARGET is a
later lane's concern, this contract pins the builder's plainness).

## Live-fetch policy

`livePolicy: 'never'` — cached snapshot + link only. No client
credentials ever, in any lane.
