# Schema — `sem-tldr`

A summary block the reader can skim or skip: whatever the author puts
inside is the whole record. sem-tldr is the namespace walking skeleton —
the first element to prove the extension machinery (four validator
families, per-namespace bundles, lazy manifests, class-alias passes) end
to end — and it stays deliberately trivial: a no-logic display stub.

Changes here precede spec changes precede code.

## Scope semantics

`sem-tldr` marks a passage as the short version of the surrounding
content. It carries NO summary logic: authored children are the summary,
rendered as-is. The component exists so every element registers a Lit
component (no CSS-only elements); everything visible is the vocabulary
CSS. Machines extract it like any other record: `record: true` — the
authored inner content is the extracted value, byte-identical with the
script on or off (the "TL;DR" label is CSS `::before` chrome, outside
textContent, so it never enters extraction).

## Authoring form

```html
<sem-tldr id="t-auth">
  Rotate JWTs per session; keep refresh tokens server-side.
</sem-tldr>
```

Class-form alias (Appendix A): `<div class="sem-tldr">…</div>` — same
dual-form contract as every `sem-*` element.

No component-specific parameters. `id`, `kind`, `tags` ride the global
attribute catalog and need no bullet.

## Rendered form

Enhanced: a block box with an accent border and a "TL;DR" label drawn by
CSS `::before` (outside textContent). JS-off: the identical box and label
from the vocabulary CSS; nothing hidden, nothing generated, children
already visible — the §8 extraction invariant holds in both tiers.

## Events

None — the component emits nothing.

## A11y contract

The block is ordinary flow content — no focus stops, nothing hidden from
assistive tech. The visual label is decorative CSS and deliberately not a
heading; authors who need a heading place one inside the block. Enhanced
tier: after the parse the component labels the callout — `role="note"`
and `aria-label="TL;DR"` (an authored `role` / `aria-label` wins) — so the
label CSS draws is also announced. JS-off: no role (plain flow content).

## Machine contract

`record: true` with no component-specific attributes: extraction returns
the authored inner content. Consumers may rely on: block-level presence
in both tiers, label chrome never entering extracted text, and
`data-sem-upgraded` present iff the core bundle loaded. Contract per
conventions §8. BDD source of truth for `test/e2e/sem-tldr.cy.js`.
