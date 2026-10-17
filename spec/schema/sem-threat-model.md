# Schema — `sem-threat-model`

A threat-model container: assets, threats and mitigations are authored
inside as authored `<section>`s or `sem-list`-style prose; the container adds
chrome + label. Family A — static knowledge/doc containers; a no-logic
display stub (no CSS-only elements: the Lit component exists and claims
`data-sem-upgraded`; everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-threat-model` frames one threat model. The assets, the threats and
the mitigations are authored inside (authored `<section>`s, tables or
prose — the container does not constrain the decomposition). `kind`
names the model's methodology or lens, `scope` its boundary; both are
display-only sugar. The container owns no behavior; machines read the
authored inner content byte-identically with the script on or off.

## Authoring form

```html
<sem-threat-model id="tm-portal" kind="stride" scope="infra portal">
  <section>
    <h2>Assets</h2>
    <p>Session tokens; the Infisical-backed secret store.</p>
  </section>
  <section>
    <h2>Mitigations</h2>
    <p>Tokens rotate per session; secrets never reach the browser.</p>
  </section>
</sem-threat-model>
```

Class-form alias (Appendix A): `<div class="sem-threat-model">…</div>`
— same dual-form contract as every `sem-*` element.

- `kind`: `string` — optional methodology qualifier drawn into the
  label chrome (display-only sugar).
- `scope`: `string` — free token naming the modelled boundary; drawn
  into the label chrome when present.
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "threat model" label drawn by CSS
`::before` (`threat model · <kind>`; `· <scope>` appended when
present). Authored children render as-is. JS-off: the identical box and
label from the vocabulary CSS; nothing hidden — the §8 extraction
invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content. Label
chrome never enters extracted text. Contract per conventions §8.
