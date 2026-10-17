# Schema — `sem-howto`

A how-to guide container: a `<name>` heading child, free contents, and
an optional `<tags>` child. Family A — static knowledge/doc containers;
a no-logic display stub (no CSS-only elements: the Lit component exists
and claims `data-sem-upgraded`; everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-howto` frames one how-to guide. The `<name>` child is the guide's
title (rendered as the block's heading), the free contents are the
guide body, and the `<tags>` child lists the topics the guide covers
(a comma/space list, styled as chips — display-only). The container
owns no behavior; machines read the authored inner content
byte-identically with the script on or off.

## Authoring form

```html
<sem-howto id="how-rotate">
  <name>Rotate a JWT pair</name>
  <p>Exchange the refresh grant for a fresh access/refresh pair.</p>
  <tags>auth, tokens</tags>
</sem-howto>
```

Class-form alias (Appendix A): `<div class="sem-howto">…</div>` — same
dual-form contract as every `sem-*` element (children as
`.sem-name`/`.sem-tags`).

- `id`, `kind`, `tags` per the global attribute catalog — no
  component-specific parameters.

## Rendered form

Enhanced: a bordered block box with a "how-to" label drawn by CSS
`::before`; the authored `<name>` child is styled as the heading and
the `<tags>` child as a muted chip row — both stay authored text in
textContent (the heading is a real child, not generated chrome).
JS-off: the identical box and label from the vocabulary CSS; nothing
hidden — the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content
(including the name/tags children — they ARE the record). Label chrome
never enters extracted text. Contract per conventions §8.
