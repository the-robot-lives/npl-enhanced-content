# Schema — `npl-directive`

Inline directive chip: the element form of an NPL inline directive
`⟪glyph: instruction | elaboration⟫` or prefix chip `emoji➤ instruction`.
Display-only (Lit `NplDirective`, `src/lit/npl/npl-directive.ts`).

## Authoring form

```html
<npl-directive glyph="🔮" kind="directive" qualifier="style">
  be terse | because the reader is skimming
</npl-directive>
```

The prefix form of the source grammar sets `kind="prefix"` — the `➤`
arrow renders between glyph and instruction:

```html
<npl-directive glyph="⚡" kind="prefix">cite sources</npl-directive>
```

Class-form alias (conventions §2, the `data-*` alias spelling — Appendix A
maps only the sem-* tier): `.npl-directive[data-glyph]` — same dual-form
contract, `data-<name>` wins when both spellings are present.

- `glyph`: string — required; the emoji or symbol leading the chip. Rendered
  by `.npl-directive-glyph` (dropped, gracefully, when absent) and mirrored
  to `data-glyph` when non-empty.
- `kind`: string — default `directive`; one of `directive` | `prefix`. A
  `prefix` chip renders the `➤` arrow between glyph and instruction, the
  prefix form's source grammar. Mirrored to `data-kind` (resolved value).
- `qualifier`: string — optional; a trailing label beside the instruction,
  rendered by `.npl-directive-qualifier` and mirrored to `data-qualifier`
  when non-empty.
- `id`, `tags` per the global attribute catalog — no bullet needed. `kind`
  is globally a free token; on this tag it is constrained to the two values
  above.
- Children: the instruction text; an optional `|` separates the elaboration
  after it (mirroring the `⟪… | …⟫` source grammar). The authored text is
  never rewritten — the elaboration rides the `title` tooltip (an authored
  `title` attribute wins).

## Rendered form

- Enhanced: `<npl-directive>` itself (Lit `NplDirective` — light DOM, no
  shadow root; content stays searchable/copyable): authored children are
  wrapped once into `.npl-directive-body` (sem-note's wrapping pattern,
  guarded against double-wrap), with generated chrome `.npl-directive-glyph`
  before it and `.npl-directive-qualifier` after it. `|`-separated
  elaboration becomes the host's `title`.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-directive, .npl-directive { display: block; }`). Nothing hidden,
  nothing generated — authored text reads as plain prose, pipe included.
