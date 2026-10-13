# Schema — `npl-flags`

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`. Container for `npl-flag` children
(`npl-flag.md`) plus optional note text. Mirrors the sem-* prose
contracts in `spec/schema/*.md`: prose is normative — changes here
precede spec changes precede code, and this file is the BDD source of
truth for `test/unit/npl-flags.test.ts`.

## Authoring form

```html
<npl-flags preset="production">
  <npl-flag name="calm_factor" value="0.5"></npl-flag>
  tuning notes…
</npl-flags>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-flags[data-preset]` — same dual-form contract as the sem-* tier,
`data-preset` wins when both spellings are present.

- `preset`: string — no default (omit it entirely for no badge). One of
  `minimal`, `full`, `production`, `creative`, `tireless` (the NPL flag
  source spells these `preset:<name>`; the attribute accepts the bare
  word or the prefixed spelling, normalized for display). An unknown
  preset is NOT an error: it warns through the author-facing channel and
  renders with the invalid-preset warning class (see Rendered form).
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-flags>` itself (Lit `NplFlags` — light DOM, no shadow
  root; content stays searchable/copyable). One chrome element,
  `.npl-flags-preset` (the resolved preset badge, `.npl-flags-preset-invalid`
  when the preset is unknown), renders the `preset:<name>` badge *first*;
  the authored `npl-flag` children and note text are left untouched beneath
  it — chrome leads the element, and `updated()` enforces the order on light
  DOM (npl-agent's rule). The vocabulary base (`themes/_vocabulary.css`)
  frames the block as a card and styles the badge, so the box and its chrome
  appear together.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-flags, .npl-flags { display: block; }`), framed as a card by the
  vocabulary. Nothing hidden, nothing generated — the badge exists only
  after the upgrade, so the authored `npl-flag` children and note text read
  as plain prose.
