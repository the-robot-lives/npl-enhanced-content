# Schema — `npl-mode`

> Cognitive lens declaration (display-only): the authored `mode` children
> enumerate the cognitive lenses of an NPL agent; the component renders one
> chip per lens, marked when the declaration is primary.

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-mode>
  <mode type="planner"></mode>
  <mode type="executing"></mode>
</npl-mode>
```

With the primary mark:

```html
<npl-mode primary>
  <mode type="reasoning"></mode>
  <mode type="critic"></mode>
</npl-mode>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-mode[data-primary]` — same dual-form contract as the sem-* tier,
`data-primary` wins when both spellings are present.

- `primary`: `boolean` — default `false`. Resolved in either authoring
  spelling (`data-primary` wins, conventions §2). Declares this the
  primary lens; marks the rendered chips (`npl-mode-chip-primary`) and
  mirrors to `data-primary` after parse — an authored `data-primary` is
  never clobbered by the default.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

Child elements — one or more `mode`, each with:

- `type`: `string` — required. The lens name; the chip's label. A `mode`
  without `type` is skipped.

## Rendered form

- Enhanced: `<npl-mode>` itself (Lit `NplMode` — light DOM, no shadow
  root; the generated chips lead and the authored `mode` children survive
  behind them; generated chrome: one `span.npl-mode-chip[data-type]` per
  typed child, carrying `npl-mode-chip-primary` when `primary`).
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-mode, .npl-mode { display: block; }`). Nothing hidden, nothing
  generated — authored text reads as plain prose.
