# Schema — `sem-progress`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-progress.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A completion meter — one scalar completion assertion. `value` is
required, canonical unit 0..1: out-of-range values clamp for rendering
while the raw attribute stays untouched; `label` is optional (default
`progress`). The runtime builds a meter (track + fill +
`label :: N%`); JS-off the value reads as text via CSS `attr()` — no
fake bar. `status="done"` ⇔ value 1 by convention.

## Authoring form

```html
<sem-progress value="0.62" label="coverage"
     role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.62"></sem-progress>
```

Class-form alias (conventions Appendix A): `div.sem-progress[data-value][data-label]`.

- `value`: number — required, canonical unit 0..1. Out-of-range values
  clamp for rendering; the raw attr stays untouched (machine readers
  see the author's value, the render shows the clamp).
- `label`: optional meter caption; default `progress`.
- `status="done"`: optional completion state — pairs with value 1 and
  renders the full/accent state (same catalog as `sem-step`).
- `id`, `kind`, `tags` global.

## Rendered form

- The runtime builds a meter: track bar + fill width
  `value*100%` + text `label :: 62%` (percentage, rounded).
- JS-off: **text-only via CSS** — `content: attr(label) " :: "
  attr(value)` (either spelling) rendered in the element (no fake bar,
  no lie).
- Fill transitions may animate in a later milestone; static for now.

## Events

None.

## A11y contract

- `role="meter"` authored in markup with `aria-valuemin="0"`,
  `aria-valuemax="1"`, `aria-valuenow` = value, `aria-label` = label —
  pre-set so AT works JS-off.
- Percentage text is the accessible text alternative.

## Machine contract

- One scalar completion assertion: `value ∈ [0,1]`. Embedded docs use
  it for checklist/pipeline state (pairs with `sem-procedure`
  statuses); `status="done"` ⇔ value 1 by convention.
