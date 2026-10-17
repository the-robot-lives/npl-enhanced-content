# Schema — `sem-summary`

A summary container. Family A — static knowledge/doc containers; a
no-logic display stub (no CSS-only elements: the Lit component exists
and claims `data-sem-upgraded`; everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-summary` frames a summary block with label chrome ("summary").
Like `sem-tldr` it carries NO summary logic: authored children are the
summary, rendered as-is. Distinct placement: `sem-tldr` is a light
inline-adjacent skim block, `sem-summary` is the heavier document-level
wrap (executive summary, section digest). Machines read the authored
inner content byte-identically with the script on or off.

## Authoring form

```html
<sem-summary id="sum-auth" kind="executive">
  <p>Tokens rotate per session; secrets never reach the browser; the
  client mints fresh pairs from the refresh grant.</p>
</sem-summary>
```

Class-form alias (Appendix A): `<div class="sem-summary">…</div>` —
same dual-form contract as every `sem-*` element.

- `kind`: `string` — optional qualifier drawn into the label chrome
  (display-only sugar).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "summary" label drawn by CSS
`::before` (`summary · <kind>` when present). Authored children render
as-is — no shadow root, no generated chrome. JS-off: the identical box
and label from the vocabulary CSS; nothing hidden — the §8 extraction
invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content. Label
chrome never enters extracted text. Contract per conventions §8.
