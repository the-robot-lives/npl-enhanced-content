# Schema — `npl-critique`

Structured critique of one subject from one perspective, with strengths,
weaknesses, and a verdict. Source: NPL critique blocks. Display-only —
the component structures authored children; it hides nothing, fires
nothing, and owns no state (Lit `NplCritique`, `src/lit/npl/npl-critique.ts`).

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-critique id="c1">
  <subject>the launch prompt</subject>
  <perspective>security reviewer</perspective>
  <strengths><item>explicit failure modes</item><item>bounded output</item></strengths>
  <weaknesses><item>no examples</item></weaknesses>
  <verdict>ship after one revision</verdict>
</npl-critique>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-critique` on a block container, children as `.npl-subject`,
`.npl-perspective`, `.npl-strengths`, `.npl-weaknesses`, `.npl-verdict`
(same dual-form contract as the sem-* tier: `data-*` wins for parameters;
here, the bare part tag and the `.npl-` class alias are equivalent).

- `id`: per the global attribute catalog — optional, the native HTML `id`;
  the only attribute parameter. No component-specific parameters exist;
  all content rides the five authored children.

Children (all optional; missing parts are simply absent in the render):

- `subject` — the thing under critique (one block of content).
- `perspective` — the lens the critique is written from (one block).
- `strengths` — a list: repeated `item` children (or `li`, or `.npl-item`).
- `weaknesses` — a list, same item contract as `strengths`.
- `verdict` — the closing judgement (one block; rendered as the
  highlighted line).

## Rendered form

- Enhanced: `<npl-critique>` itself (Lit `NplCritique` — light DOM, no
  shadow root; content stays searchable/copyable). Once any child part
  exists (`whenChildrenReady` covers the pre-parse upgrade), the
  component:
  - adds the part classes `.npl-critique-subject`, `.npl-critique-perspective`
    and `.npl-critique-verdict` — the verdict's class is the theme hook
    for the highlighted line; the authored block is otherwise untouched;
  - rewrites each of `strengths` / `weaknesses` (classed
    `.npl-critique-strengths` / `.npl-critique-weaknesses`) into
    `<ul class="npl-critique-list">` with one
    `<li class="npl-critique-item">` per authored item — item content
    moved verbatim, so inner markup (`<em>`, links) survives. A part
    authored as a native `ul`/`ol` (class form on real markup) upgrades
    in place instead — the host becomes the list, its items become the
    `<li>`s — so a real list is never double-nested;
  - a list part authored as plain prose (no `item`/`li` children) is left
    as authored — classed, never rewritten. The same holds when a part
    mixes its items with loose content (prose or stray elements outside
    the item contract): the rewrite applies only when the part's content
    is exactly its item set, so an authored node is never discarded.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`.
  The vocabulary also styles the five part tags (and their `.npl-`
  aliases) directly — part labels, list markers, the verdict highlight —
  so the structured reading holds with the script off. Nothing hidden,
  nothing the component generates; authored text stays fully visible.

## Events

_None — display-only._
