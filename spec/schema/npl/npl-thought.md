# Schema — `npl-thought`

Typed associative thought bubble (source: NPL thought blocks). A
display-only container whose typed children are `npl-thought` elements
that carry a `type` attribute, one per NPL thought-block type
(`src/lit/npl/npl-thought.ts`). Contract per conventions.md v0.6 and
the namespace recipe in `src/lit/npl/index.ts`.

## Authoring form

```html
<npl-thought id="t1">
  <npl-thought type="observation">The cache misses cluster on Mondays.</npl-thought>
  <npl-thought type="tangent">Mondays are also the fleet redeploy window…</npl-thought>
  <npl-thought type="balloon">unknown — degrades to plain text</npl-thought>
  <npl-thought>no type — a sub-container; its children survive untouched</npl-thought>
</npl-thought>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-thought[data-type]` — same dual-form contract as the sem-* tier,
`data-type` wins when both spellings are present.

- `type`: string — optional; default none. One of the eleven NPL
  thought-block types (case-insensitive): `observation`, `tangent`,
  `question`, `relation`, `concern`, `affirmation`, `reflection`,
  `opportunity`, `aversion`, `interest`, `eval`.
- `id` per the global attribute catalog — optional, no bullet needed.

## Rendered form

- Enhanced: `<npl-thought>` itself (Lit `NplThought` — light DOM, no
  shadow root; display-only, no generated chrome and no events). The
  container's authored children stand untouched. Each typed child applies
  its own class `npl-thought-<type>` and mirrors the resolved type to
  `data-type` (deferred past parse via afterParse, like sem-note — a
  parse-time write would leak into a sem-source snapshot), so themes can
  style each thought type from plain CSS and the vocabulary names the type
  with `attr(data-type)`. An unknown `type` applies the warning class
  `npl-thought-unknown` and the child's content degrades to plain text —
  unknown markup is never rendered as structure. A child with no `type` is
  a sub-container: nothing applied, children survive. Content stays
  searchable/copyable throughout.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-thought, .npl-thought { display: block; }`). Nothing hidden,
  nothing generated — typed children read as plain prose with their text.
