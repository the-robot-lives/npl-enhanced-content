# Schema — `semext-styleguide-theme` / `semext-styleguide-themes`

Theme token cards from a cached snapshot (static embeds).
`semext-styleguide-theme` renders one theme's tokens — name, key color
swatches, typography sample — plus a "Preview theme CSS" link whose
target is the authored `src`; `semext-styleguide-themes` is its
collection wrapper, rendering only a summary line. Contract per
conventions.md and the namespace recipe in `src/lit/semext/index.ts`;
BDD source of truth for the styleguide cases of
`test/unit/semext-embeds.test.ts` and `test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-styleguide-themes id="theme-gallery" org="noizu" project="npl-enhanced-content" key="themes:index" status="fresh" last-refreshed="2026-10-17T09:14:00Z">
  <semext-styleguide-theme theme="minimal-tech-light" src="/themes/minimal-tech-light.css" key="themes:minimal-tech-light">
    <script type="application/json">
      { "theme": { "name": "Minimal Tech Light",
          "colors": [ { "token": "--sem-accent", "value": "#2563eb",
                        "role": "accent" },
                      { "token": "--sem-surface", "value": "#f8fafc",
                        "role": "surface" } ],
          "typography": { "body": "Inter, sans-serif", "heading": "Inter, 600" },
          "sample": "The quick brown fox." } }
    </script>
  </semext-styleguide-theme>
</semext-styleguide-themes>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-styleguide-theme[data-theme]` /
`.semext-styleguide-themes[data-key]` — same dual-form contract as the
sem-* tier, `data-<name>` wins when both spellings are present.

- `<semext-styleguide-theme>` — one or more theme cards; the wrapper is
  inert without them (summary falls back to counting children).
- `theme`: `string` — the theme slug this card presents; matches the
  snapshot's theme slug when one is authored.
- `src`: `string` — the theme CSS URL for the preview link; MUST pass
  the shared source policy (src/data/load.ts: http(s) only, rendered as
  an href — never fetched by this element). Omitting it omits the link.
- `id`, `kind`, `tags` per the global attribute catalog.

## Reference attributes

> Both elements point at upstream records; the quartet matches the
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
theme tokens — an inline `<script type="application/json">` child
(first), else an inline JSON `fixtures` value. Card shape:
`{ "theme": { "name", "slug", "colors": [ { "token", "value", "role" },
… ], "typography": { "heading", "body", "sample" } } }`. Wrapper
shape: `{ "themes": [ "<slug>", … ] }` — absent ⇒ the wrapper counts
its authored `semext-styleguide-theme` children. Swatch `value`s render
ONLY when they pass the plain-color sanitizer (hex / rgb(a) / hsl(a) /
named, ≤ 64 chars) — anything else is skipped, never styled, never
fetched.

## Refresh contract

Static: refresh is a CLI lane (re-snapshot theme tokens and rewrite the
inline JSON). The elements never fetch the `src` CSS and never discover
themes.

## Live-fetch policy

`livePolicy: 'never'` — static snapshots only. No client credentials
ever, in any lane.
