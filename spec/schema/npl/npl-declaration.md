# Schema — `npl-declaration`

Display-only banner for an NPL declaration block: the version/extension
header of a rules document (`src/lit/npl/npl-declaration.ts`). The source
forms are the NPL fences `⌜NPL@<version>⌝ … ⌞NPL@⌟` (definition) and
`⌜extend:NPL@<version>⌝ … ⌞NPL@⌟` (extension); the component renders the
banner text the source spells, with the rules content as authored children.

## Authoring form

```html
<npl-declaration version="0.6">Every response states its assumptions before its answer.</npl-declaration>
<npl-declaration version="0.6" type="extension" extend-target="npl-core">This extension adds the session-ledger contract on top of npl-core.</npl-declaration>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-declaration[data-version]`.

- `version`: string — required; a missing version warns and the banner
  still renders, with the bare mark (`⌜NPL@⌝`). Rendered in the banner
  mark (`⌜NPL@<version>⌝`) and mirrored to `data-version` (dual-form
  contract; the mirror is deferred past parse via afterParse so a
  sem-source snapshot never sees runtime writes).
- `type`: string — default `definition`; one of `definition` |
  `extension`. Selects the banner mark (`⌜NPL@…⌝` vs `⌜extend:NPL@…⌝`)
  and mirrors the resolved kind to `data-type`. Any other value falls
  back to `definition`.
- `extend-target`: string — optional; the vocabulary an extension
  extends, authored on `type="extension"` declarations. Rendered by
  `.npl-declaration-target` beside the mark whenever authored and
  mirrored to `data-extend-target` (absent when unauthored).
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-declaration>` itself (Lit `NplDeclaration` — light
  DOM, no shadow root): one `.npl-declaration-banner` header — a
  `.npl-declaration-mark` span with the banner text, plus a
  `.npl-declaration-target` span when an extend-target is authored —
  hoisted above the authored rules content, which stays untouched as
  the body.
- JS-off: block box from the npl section of `themes/_vocabulary.css`
  (`npl-declaration, .npl-declaration { display: block; }`). Nothing
  hidden, nothing generated — the authored rules read as plain prose.
