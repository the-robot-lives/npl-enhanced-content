# Schema — `sem-guard-rails` / `sem-guard-rail`

A guard-rails collection and its entries. Family A — static
knowledge/doc containers; display stubs (no CSS-only elements: the Lit
components exist and claim `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A collection of guard rails. Each `sem-guard-rail` is one rule the
reader must not violate — the authored inner content IS the rule.
`severity` (per entry) selects the rail's presentation weight:
`info` (default), `warn`, `block`; `scope` (per entry) names where the
rule applies. Both are display-only sugar — machines extract the same
rule under every severity. `sem-guard-rail` mints its record inside the
collection (optionsIn: `sem-guard-rails`).

## Authoring form

```html
<sem-guard-rails id="gr-api" kind="api">
  <sem-guard-rail severity="block" scope="public endpoints">
    Never return raw provider errors; wrap them in the error envelope.
  </sem-guard-rail>
  <sem-guard-rail severity="warn">
    Pagination defaults to 50 items — page explicitly in production.
  </sem-guard-rail>
</sem-guard-rails>
```

Class-form alias (conventions Appendix A): `div.sem-guard-rails` ›
`div.sem-guard-rail` — same dual-form contract as every `sem-*` tier.

- `kind`: `string` — collection qualifier drawn into the label chrome
  (display-only sugar).
- `severity` (per entry): one of `info` (default), `warn`, `block` —
  selects the rail color; display-only sugar, extraction is identical
  under every severity.
- `scope` (per entry): `string` — free token naming where the rule
  applies; drawn into the entry's label chrome.
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: the collection is a bordered block with a "guard rails"
label drawn by CSS `::before`; each entry is a card with a left rail
colored by `severity` (`info`/`warn`/`block`) and the severity drawn by
the entry's `::before` when present. Components render nothing of
their own — no shadow roots, no generated chrome. JS-off: the identical
boxes, labels and severity rails from the vocabulary CSS; nothing
hidden — the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true` on both tags: extraction returns the collection's
authored entries. Severity/scope never enter extracted text — they are
attributes. Contract per conventions §8.
