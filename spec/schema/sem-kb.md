# Schema — `sem-kb`

A knowledge-base article container: the authored inner content IS the
article. Family A — static knowledge/doc containers; a no-logic display
stub (no CSS-only elements: the Lit component exists and claims
`data-sem-upgraded`; everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-kb` groups one knowledge-base article. The container adds the block
chrome and a label; the article itself is authored with the existing
authored structure (`<section>`/`<h2>` headings, `sem-references`,
`sem-code`) plus ordinary prose and links. The container owns no
behavior and no summary logic; machines read the authored inner content
byte-identically with the script on or off (the label is CSS `::before`
chrome, outside textContent).

## Authoring form

```html
<sem-kb id="kb-jwt" kind="auth">
  <section>
    <h2>Rotation</h2>
    <p>JWTs rotate <strong>per session</strong>; refresh tokens stay
    server-side.</p>
  </section>
  <sem-references></sem-references>
</sem-kb>
```

Class-form alias (Appendix A): `<div class="sem-kb">…</div>` — same
dual-form contract as every `sem-*` element.

- `kind`: `string` — optional topical qualifier, drawn into the label
  chrome (display-only sugar; extraction is identical either way).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "knowledge base" label drawn by
CSS `::before` (outside textContent; with a `kind` present the label
reads `knowledge base · <kind>`). Authored children render as-is — the
component renders nothing of its own and keeps no shadow root. JS-off:
the identical box and label from the vocabulary CSS; nothing hidden,
nothing generated — the §8 extraction invariant holds in both tiers.

## Events

None. The component has no behaviour and emits nothing.

## Machine contract

`record: true`: extraction returns the authored inner content.
Consumers may rely on: block-level presence in both tiers, label chrome
never entering extracted text, and `data-sem-upgraded` present iff the
core bundle loaded. Contract per conventions §8.
