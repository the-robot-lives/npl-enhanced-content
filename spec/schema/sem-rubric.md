# Schema — `sem-rubric`

A scoring rubric container: the criteria × levels grid is authored
inside as a plain table or row prose — the container does not constrain
the decomposition. Family A —
static knowledge/doc containers; a no-logic display stub (no CSS-only
elements: the Lit component exists and claims `data-sem-upgraded`;
everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-rubric` frames one rubric. The criteria/levels grid is authored
inside — a plain `<table>`, rows of prose, whatever fits; the
container does not constrain the decomposition. `max-score` states the
scale's ceiling (drawn into the chrome as a chip — display-only sugar).
The container owns no behavior and no scoring logic; machines read the
authored inner content byte-identically with the script on or off.

## Authoring form

```html
<sem-rubric id="rub-doc" kind="grading" max-score="10">
  <table>
    <tr><th>criterion</th><th>0</th><th>5</th><th>10</th></tr>
    <tr><td>accuracy</td><td>wrong</td><td>partial</td><td>exact</td></tr>
  </table>
</sem-rubric>
```

Class-form alias (Appendix A): `<div class="sem-rubric">…</div>` —
same dual-form contract as every `sem-*` element.

- `max-score`: `number` — the scale ceiling (minimum 0); drawn into
  the label chrome as a chip when present.
- `kind`, `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "rubric" label drawn by CSS
`::before` (`rubric · <kind>` when present) and the score chip drawn by
CSS `::after` (`max <max-score>`) — both outside textContent. Authored
children render as-is. JS-off: the identical box, label and chip from
the vocabulary CSS; nothing hidden — the §8 extraction invariant holds
in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored rubric content
(including the authored table). `max-score` is an attribute, never
extracted text. Contract per conventions §8.
