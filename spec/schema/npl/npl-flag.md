# Schema — `npl-flag`

Contract per conventions.md v0.6, the namespace recipe in
`src/lit/npl/index.ts`, and the sem-* prose-contract mirror in
`spec/schema/*.md`: prose is normative — changes here precede spec
changes precede code, and this file is the BDD source of truth for
`test/unit/npl-flag.test.ts`.

One runtime flag row: a `name`/`value` pair rendered as one labelled
row the reader can click to apply. Authored inside the `npl-flags`
container; usable standalone. Values render verbatim; when the name
implies a numeric range the value is checked against it, and an
out-of-range or non-numeric value is not an error — the flag renders
with the `npl-flag-invalid` warning class on its value span. Clicking
the flag toggles `data-applied` on it and dispatches `npl-flags-change`
to the host app.

## Authoring form

```html
<npl-flag name="calm_factor" value="0.5"></npl-flag>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-flag[data-name]` — same dual-form contract as the sem-* tier,
`data-name` / `data-value` win when both spellings are present.

- `name`: string — required, no default. Flag identifier; its wording
  implies the numeric range checked on `value` (below).
- `value`: string — no default. Rendered verbatim; validated only when
  the name implies a numeric range (case-insensitive substring of the
  name): `freq` checks [0.0, 1.0] (frequency flags), `factor` checks
  [-10, 10] (hormone factors), `threshold` must be numeric and
  unbounded. Any other name (pump switches, meta, …) is free-form —
  never validated. An out-of-range or non-numeric value is NOT an
  error: the flag renders with the `npl-flag-invalid` warning class on
  its value span.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-flag>` itself (Lit `NplFlag` — light DOM, no shadow
  root; content stays searchable/copyable; generated chrome uses the
  `.npl-flag-name` / `.npl-flag-value` classes; `.npl-flag-invalid` marks
  an out-of-range value; `npl-flag[data-applied]` marks a clicked-applied
  flag, with `.npl-flag-applied` on its value span). The row is the apply
  control itself: focusable (`tabindex="0"` unless the host authors one),
  exposed as `role="button"` with `aria-pressed` mirroring the applied
  state, and applied with `Enter` or `Space` as well as a pointer click.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-flag, .npl-flag { display: block; }`). Nothing hidden, nothing
  generated — authored text reads as plain prose.

## Events

- `npl-flags-change`: bubbles + composed; `detail`:
  `{ name: string, value: string, applied: boolean }`. Dispatched by the
  flag itself when applied (pointer click, `Enter`, or `Space`), after
  toggling `data-applied` on it; a host app listens on the `npl-flags`
  container or anywhere upstream.
