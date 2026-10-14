# Schema — `npl-example`

Placeholder component proving the `npl-*` pattern end to end
(`src/lit/npl/npl-example.ts`). Delete this file together with the
component once real components exist; keep the recipe it demonstrates
(`src/lit/npl/index.ts` header, `spec/schema/npl/TEMPLATE.md`).

## Authoring form

```html
<npl-example label="hello">authored children survive beside the label</npl-example>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-example[data-label]`.

- `label`: string — default `npl-example`. Displayed by
  `.npl-example-label` and mirrored to `data-label` (dual-form contract:
  `data-label` wins when both spellings are present, so the mirror writes
  the resolved value and never clobbers an authored `data-label`; deferred
  past parse via afterParse so a sem-source snapshot never sees runtime
  writes).
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-example>` itself (Lit `NplExample` — light DOM, no
  shadow root): one block `.npl-example-label` element (like
  `npl-agent-header` / `npl-section-header`) rendering the resolved label
  *first*, with the authored children untouched beneath it — chrome leads
  the element, and `updated()` enforces the order on light DOM. It is a
  block-level element rather than an inline span so the label reads on its
  own line, not fused with the authored body; the vocabulary CSS box-models
  the host only.
- JS-off: block box from the npl section of `themes/_vocabulary.css`
  (`npl-example, .npl-example { display: block; }`). Nothing hidden,
  nothing generated.

## Events

- `npl-example-seen`: bubbles + composed; `detail`: `{ label: string }`
  (fired by `announce()`).
