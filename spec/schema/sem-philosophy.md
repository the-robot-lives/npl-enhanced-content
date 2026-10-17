# Schema — `sem-philosophy`

A principles/philosophy container (spelled with the h). Family A —
static knowledge/doc containers; a no-logic display stub (no CSS-only
elements: the Lit component exists and claims `data-sem-upgraded`;
everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-philosophy` frames one statement of principles: the authored inner
content IS the philosophy. Principles may be authored as prose or as
list children; the container does not constrain the decomposition. The
container adds the block chrome and its label; it owns no behavior.
Machines read the authored inner content byte-identically with the
script on or off.

## Authoring form

```html
<sem-philosophy id="phil-velocity" kind="engineering">
  <p>Velocity-first, integrity-absolute: ship aggressively, never
  gamble data.</p>
</sem-philosophy>
```

Class-form alias (Appendix A): `<div class="sem-philosophy">…</div>` —
same dual-form contract as every `sem-*` element.

- `kind`: `string` — optional qualifier drawn into the label chrome
  (display-only sugar).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "philosophy" label drawn by CSS
`::before` (`philosophy · <kind>` when present). Authored children
render as-is — no shadow root, no generated chrome. JS-off: the
identical box and label from the vocabulary CSS; nothing hidden — the
§8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content. Label
chrome never enters extracted text. Contract per conventions §8.
