# Schema — `npl-agent`

Agent definition card: the element form of the NPL agent convention's
`⌜name|type|NPL@version⌝ … ⌞name⌟` header. The three header fields become
attributes; the authored prose (the description and behavioural spec)
stays the body and is never rewritten. Display-only (Lit `NplAgent`,
`src/lit/npl/npl-agent.ts`).

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-agent name="scout" type="scout" version="0.3" extends="base-agent">
Read-only scout: search, read, and summarise; never edit files or run
writes. Report findings with file paths and line numbers.
</npl-agent>
```

The generated header renders the identifier, the archetype and the NPL
contract version above the body; the body prose is never rewritten.

```html
<npl-agent name="coder" type="coder" version="1.0">
Implements the assigned task in the named worktree and reports the diff.
</npl-agent>
```

Without `extends` the header omits the parent part — the source form's
header carries no parent field either.

Class-form alias (conventions Appendix A, npl namespace):
`.npl-agent[data-name]` — same dual-form contract as the sem-* tier,
`data-<name>` wins when both spellings are present.

- `name`: `string` — required. The agent's identifier, the `⌜<agent-name>`
  field of the source form. Mirrored to `data-name` after upgrade (the
  resolved value — an authored `data-name` is never overwritten).
- `type`: `string` — required. The agent's archetype (e.g. `scout`,
  `coder`). Mirrored to `data-type` after upgrade (the resolved value).
- `version`: `string` — required. The NPL contract version, the
  `NPL@{version}` field of the source form. Mirrored to `data-version`
  after upgrade (the resolved value).
- `extends`: `string` — optional. The parent agent this definition
  extends; the header omits it when not authored. Mirrored to
  `data-extends` after upgrade (the resolved value).
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-agent>` itself (Lit `NplAgent` — light DOM, no shadow
  root; content stays searchable/copyable). Generates one chrome element,
  `.npl-agent-header` (parts `.npl-agent-name`, `.npl-agent-type`,
  `.npl-agent-version`, `.npl-agent-extends`), before the body; the
  `.npl-agent-extends` part is absent when no parent is authored. The body
  is the authored children — description and behavioural spec prose —
  left as plain light DOM, never wrapped or moved. The vocabulary base
  (`themes/_vocabulary.css`) styles the card and the header parts —
  small-caps field labels over a divider, body prose beneath — gated on
  the upgrade marker, so the box appears with the header it frames.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-agent, .npl-agent { display: block; }`). Nothing hidden, nothing
  generated — authored text reads as plain prose.

## Events

_None — display-only._
