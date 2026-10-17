# Schema — `sem-eval`

An evaluation-spec container: inputs, expected outputs and criteria are
authored inside as sections or prose. Family A — static knowledge/doc
containers; a no-logic display stub (no CSS-only elements: the Lit
component exists and claims `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-eval` frames one evaluation spec. The inputs, the expected
behavior and the scoring criteria are authored inside (inner
authored `<section>`s, `sem-md` tables or prose — the container does not
constrain the decomposition). `kind` names the eval family, `status`
its lifecycle token — both display-only sugar. The container owns no
behavior and no scoring logic; machines read the authored inner content
byte-identically with the script on or off.

## Authoring form

```html
<sem-eval id="ev-rotate" kind="recall" status="draft">
  <section>
    <h2>Inputs</h2>
    <p>A refreshed token pair and a 20-minute-old access token.</p>
  </section>
  <section>
    <h2>Expected</h2>
    <p>The client mints a fresh pair without a re-sign-in.</p>
  </section>
</sem-eval>
```

Class-form alias (Appendix A): `<div class="sem-eval">…</div>` — same
dual-form contract as every `sem-*` element.

- `kind`: `string` — optional qualifier drawn into the label chrome
  (display-only sugar).
- `status`: one of `draft`, `approved`, `implemented` — lifecycle
  token, drawn as a status chip (display-only).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with an "evaluation" label drawn by CSS
`::before` (`evaluation · <kind>`) and a status chip drawn by CSS
`::after` — both outside textContent. Authored children render as-is.
JS-off: the identical box, label and chip from the vocabulary CSS;
nothing hidden — the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored spec content;
`kind`/`status` are attributes, never extracted text. Contract per
conventions §8.
