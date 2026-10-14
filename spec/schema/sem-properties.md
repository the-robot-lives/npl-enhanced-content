# Schema — `sem-properties` / `sem-property`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-properties.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A definition/properties block: a closed set of key/value assertions.
Each `sem-property` is one pair — `key` is the term (required, free
text), the property text is the value. Renders a `<dl>`-equivalent grid,
zero-JS: the key column renders via CSS `attr(key)`, and each property
authored as `role="definition"` + `aria-label` = the key lets AT
announce the pair without JS. Compact `term :: value` sugar is
display-only — `key` is canonical. Pure definition list, no
copy/search chrome; `view-as="glossary"` turns the block into a
glossary (term anchors get hover/focus preview popovers).

## Authoring form

```html
<sem-properties kind="config">
  <sem-property key="token ttl" role="definition" aria-label="token ttl">15m</sem-property>
  <sem-property key="refresh rotation" role="definition" aria-label="refresh rotation">per use</sem-property>
  <sem-property key="storage" role="definition" aria-label="storage">httpOnly cookie</sem-property>
</sem-properties>
```

Class-form alias (conventions Appendix A): `div.sem-properties[data-kind][data-view-as]` › `div.sem-property[data-key]`.

- `key` (on each `sem-property`): required, free text (the term). The
  property text is the value.
- Compact sugar (conventions §3): `<sem-property>token ttl ::
  15m</sem-property>` is legal; **`key` wins** when both present.
  The fallback does NOT parse `::` — sugar authors must write `key`
  for correct rendering until a parser ships.
- `kind` (optional): free token (`config`, `spec`, `env` …).
- `id`, `tags` per the global attribute catalog (conventions.md §2).
- ❓ Q2 resolved for v1: pure definition list, **no copy/search chrome**;
  revisit only if a consumer demands it.
- `view-as="glossary"` (optional; R/W1): the block is a glossary. Each property
  should carry an `id`; prose elsewhere links a term with a plain anchor
  (`<a href="#g-jwt">JWT</a>`), optionally wrapping it in `<dfn>` at its
  defining use.

## View contracts

### default

The definition list described below. No JS behaviour.

### `glossary`

- CSS: properties stack term-over-definition; a `<dfn>` inside the
  document renders as a term (upright, emphasised).
- Script (reading handler, `src/reading/glossary.ts`; the Lit component
  `SemProperties` claims `data-sem-upgraded` and runs the same enhance
  function, idempotent per anchor): every anchor whose `href`
  targets a property `id` inside a glossary block gets the runtime class
  `.sem-properties-ref` and a hover / focus **preview popover**
  (`src/shared/popover.ts`) showing the key and the value; `Esc` closes
  it; the anchor still navigates. The container carries
  `data-sem-upgraded` once wired.
- JS-off: definition list, `:target` highlight on the linked property, no
  popover. Nothing hidden.
- Extraction unchanged: a glossary property is a `sem-property` record;
  `view-as` never changes extraction.

## Rendered form

- **Zero-JS element.** Pure CSS: two-column grid — key column renders
  `attr(key)` (either spelling; muted, small-caps), value is the element text.
  Semantically a `<dl>` equivalent: each property authored as
  `role="definition"` + `aria-label` = the key — the label carries the
  term, the content the value.
- Alternating row surface tint; keys wrap, values keep whitespace.

## Events

None.

## A11y contract

- Each property authored as `role="definition"` with `aria-label` =
  the key — AT announces the pair without JS.
- `key` doubles as the machine-facing term.
- Glossary preview is `role="tooltip"`; the anchor carries
  `aria-describedby` while it is shown; opens on focus, closes on `Esc`.

## Machine contract

- Container = a closed set of key/value assertions; each property is one
  assertion (`key` = subject qualifier, text = value).
- Duplicate `key` values in one container = authoring error;
  the script logs a console warning (non-fatal).
