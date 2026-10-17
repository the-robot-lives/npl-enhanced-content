# Schema — `sem-mockup`

A text-or-HTML mockup container (draftamo-style). Family A — static
knowledge/doc containers; a no-logic display stub (no CSS-only
elements: the Lit component exists and claims `data-sem-upgraded`;
everything visible is vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-mockup` frames a UI/flow mockup. `mode` selects the presentation
of the SAME authored content: `text` (default) renders the block
preformatted (monospace, preserved whitespace) — an ASCII wireframe; 
`html` renders the authored inline HTML children as-is — a lightweight
layout sketch. `mode` is display-only sugar: the mockup *is* its
authored content under every mode, and machines extract it identically
either way. Authored content is trusted document content (the same
trust model as the rest of the vocabulary — nothing is fetched, nothing
is injected at runtime).

## Authoring form

Text mode (default):

```html
<sem-mockup id="mock-shell" kind="wireframe">
  +-------+---------------------------+
  | nav   |  hero                     |
  |       |  [ call to action ]       |
  +-------+---------------------------+
</sem-mockup>
```

HTML mode:

```html
<sem-mockup id="mock-card" mode="html" kind="card">
  <strong>Card title</strong>
  <p>One-line supporting copy.</p>
</sem-mockup>
```

Class-form alias (Appendix A): `<div class="sem-mockup">…</div>` —
same dual-form contract as every `sem-*` element.

- `mode`: one of `text` (default), `html` — presentation selector;
  display-only sugar.
- `kind`: `string` — optional qualifier drawn into the label chrome.
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "mockup" label drawn by CSS
`::before` (`mockup · <kind>` when present). `mode="text"` styles the
block preformatted (mono face, preserved whitespace, horizontal
scroll); `mode="html"` renders authored children as normal flow.
Authored content is never re-rendered by the component. JS-off: the
identical box, label and mode styling from the vocabulary CSS; nothing
hidden — the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content.
Consumers may rely on: mode never changes extraction, and the label
chrome never enters extracted text. Contract per conventions §8.
