# Schema — `semext-sig-synthetic-monitor`

A SigNoz synthetic-monitor DEFINITION card + link chrome (definition +
link). The authored inner content IS the record — the monitor's
expected definition as authored; the JSON snapshot mirrors it and the
chrome adds the "Open in SigNoz" anchor. Synthetic monitor EXECUTION is
an enterprise-tier service surface this spec deliberately does not
touch: no endpoint discovery, no run trigger, no client credential, and
live execution is a DEFERRED LANE. Contract per conventions.md and the
namespace recipe in `src/lit/semext/index.ts`; BDD source of truth for
the sig cases of `test/unit/semext-embeds.test.ts` and
`test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-sig-synthetic-monitor
  id="threads-probe"
  monitor="annotate-srv-threads"
  env="prod"
  org="noizu"
  project="annotate"
  key="annotate:probe-threads"
  status="fresh"
  last-refreshed="2026-10-17T09:14:00Z"
>
  <script type="application/json">
    { "monitor": { "name": "annotate-srv threads",
        "interval": "5m",
        "assertions": [ "GET /api/v1/threads → 200",
                        "latency p95 < 2s" ] } }
  </script>
</semext-sig-synthetic-monitor>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-sig-synthetic-monitor[data-monitor]` — same dual-form contract
as the sem-* tier, `data-<name>` wins when both spellings are present.

- `monitor`: `string` — the monitor's identity (deep-link parameter;
  echoed verbatim, never parsed).
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
definition — an inline `<script type="application/json">` child
(first), else an inline JSON `fixtures` value. Shape:
`{ "monitor": { "name", "interval", "assertions": [ … ] } }` — every
field optional; assertions render as a plain list, one bullet each.

## Refresh contract

Definition + link: refresh is a CLI lane (re-pull the monitor
definition and rewrite the inline JSON). The element never fetches
SigNoz and holds NO client credentials — the deep link carries only the
authored parameters (`https://apm.noizu.com/?monitor=…&env=…`, plain
builder in `src/lit/semext/sig-link.ts`).

## Live-fetch policy

`livePolicy: 'never'` — the authored definition + link only. Live
monitor EXECUTION is an EE surface owned by the SigNoz deployment, not
by SemText: no endpoint discovery, no run trigger, no credentials —
deferred to a later, explicitly scoped lane. No client credentials
ever, in any lane.
