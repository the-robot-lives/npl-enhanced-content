# Schema — `npl-vos`

Display-only bracket for an NPL vector-of-self block
(`src/lit/npl/npl-vos.ts`): the psychodynamic state an NPL persona
brackets each substantive response with — id, ego, mood, super-ego,
optional collective (source: NPL `vos` blocks, npl-full.md
"Psychodynamic State"). One component renders one bracket; `phase`
marks which half of the bracket it is. When vector-of-self is active it
subsumes standalone `<npl-mood>` — do not author both.

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-vos phase="entry">
  <p data-vos="id">raw impulse — what the first instinct wants to do</p>
  <p data-vos="ego">reality-tested approach — what is actually done and why</p>
  <p data-vos="mood">🔥 — energized by the profiling work</p>
  <p data-vos="super-ego">internalized standards — what should be upheld here</p>
  <p data-vos="collective">system-level observation from outside the persona</p>
</npl-vos>
```

Each direct child element carries its part name — `data-vos="<part>"`,
with the bare `vos="<part>"` spelling also read (`data-` wins when both
are present, the shared dual-form rule). Parts mirror the NPL `vos`
child tags: `id`, `ego`, `mood`, `super-ego`, `collective` (collective
optional — include it only when the system-level perspective has
something the persona cannot see).

Class-form alias (conventions Appendix A, npl namespace):
`.npl-vos[data-phase]` — same dual-form contract as the sem-* tier.

- `phase`: string — default none. One of `entry`, `exit`; rendered as
  the bracket label and mirrored to data-phase (dual-form contract; the
  mirror is deferred past parse via afterParse so a sem-source snapshot
  never sees runtime writes).
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-vos>` itself (Lit `NplVos` — light DOM, no shadow
  root): the phase label when a phase is authored, then one
  `.npl-vos-row` per authored part — `.npl-vos-row-label` (the part
  name) and `.npl-vos-row-body` (the authored element, moved in whole).
  Rows render in the canonical order id, ego, mood, super-ego,
  collective regardless of authored order; parts outside that catalog
  still display, trailing the known five. No events.
- JS-off: block box from the npl section of `themes/_vocabulary.css`
  (`npl-vos, .npl-vos { display: block; }`). Nothing hidden, nothing
  generated — the authored parts read as plain prose.
