# Schema — `sem-plan`

A solution/chain-of-thought plan container. Family A — static
knowledge/doc containers; a no-logic display stub (no CSS-only
elements: the Lit component exists and claims `data-sem-upgraded`;
everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-plan` frames one solution plan: the reasoning steps and the
decision points are authored inside (prose, ordered lists,
`sem-procedure` — the container does not constrain the shape). `kind`
names the plan's lens, `status` rides the global status catalog
(`todo`/`current`/`done`/…); both are display-only sugar. NOT a
workflow engine: `sem-plan` records a plan, it does not execute or
transition one (the `sem-workflow` lane is a different family). Machines
read the authored inner content byte-identically with the script on or
off.

## Authoring form

```html
<sem-plan id="plan-rotate" kind="solution" status="current">
  <p>1. Snapshot the current chart tag.</p>
  <p>2. Land the rotation fix behind the release train.</p>
  <p>3. Confirm the pod image, not just ArgoCD sync.</p>
</sem-plan>
```

Class-form alias (Appendix A): `<div class="sem-plan">…</div>` — same
dual-form contract as every `sem-*` element.

- `kind`: `string` — optional qualifier drawn into the label chrome
  (display-only sugar).
- `status`: per the global catalog (`done`, `current`, `todo`,
  `blocked`, `pass`, `fail`) — drawn as a status chip (display-only).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "plan" label drawn by CSS
`::before` (`plan · <kind>`) and a status chip drawn by CSS `::after`
when `status` is present — both outside textContent. Authored children
render as-is. JS-off: the identical box, label and chip from the
vocabulary CSS; nothing hidden — the §8 extraction invariant holds in
both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored plan content;
`kind`/`status` are attributes, never extracted text. Contract per
conventions §8.
