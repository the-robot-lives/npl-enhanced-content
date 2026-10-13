# Schema — `npl-section`

Generic typed section for NPL prompt-section blocks
(`src/lit/npl/npl-section.ts`): display-only chrome over untouched
authored content — a labelled header for known types, a warning box for
unknown ones. Light DOM per the namespace recipe; content stays
searchable/copyable.

## Authoring form

```html
<npl-section type="example">body HTML</npl-section>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-section[data-type]` — same dual-form contract as the sem-* tier,
`data-type` wins when both spellings are present.

- `type`: string — required. One of the known section types: `alg`,
  `alg-pseudo`, `diagram`, `example`, `format`, `logic`, `note`,
  `syntax`, `template`. A missing or unknown value is never fatal: the
  section renders with the `npl-section-warning` class, its content
  plain, plus one author-facing warning per offending value.
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-section>` itself (Lit `NplSection` — light DOM, no
  shadow root). Known type: one `.npl-section-header` label as the first
  child ("Algorithm", "Pseudocode", …) with the authored content
  untouched beneath it, and `npl-section-<type>` on the host. `type`
  mirrors to `data-type` (deferred past parse via afterParse, like
  sem-note). `type="note"` renders as a plain section — sem-note
  (src/lit/sem-note.ts) owns the callout behaviour (collapse, `role`,
  variant) and none of it is duplicated here. Unknown or missing type:
  no header, `npl-section-warning` on the host, authored content plain.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-section, .npl-section { display: block; }`). Nothing hidden,
  nothing generated — authored text reads as plain prose.
