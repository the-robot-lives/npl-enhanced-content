# Schema — `npl-poa`

The NPL plan-of-action block: a decision tree with weighted reasoning.
Source is the NPL `poa` block — a ```mermaid fence for the decision
tree, a `<reasoning>` element with the weighted paths, and a
`<selected>` element naming the chosen option. Display-only: the
component never loads mermaid or any runtime library, so the tree
degrades to its own source, which reads as a plain code block.

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-poa direction="lr">
  <pre><code class="language-mermaid">graph LR
  A{Decision} -->|"90%"| B[Path B]
  A -->|"40%"| C[Path C]</code></pre>
  <reasoning>
    A --[90%]--> B: why this path is weighted high
    A --[40%]--> C: why this is less preferred
  </reasoning>
  <selected>Path B — 90% weight; lowest migration cost.</selected>
</npl-poa>
```

The fence is authored in the markdown-output shape
(`pre > code.language-mermaid`); `<reasoning>` and `<selected>` are the
NPL block's own child tags — `.npl-poa-reasoning` / `.npl-poa-selected`
are accepted as class-form spellings.

Class-form alias (conventions §2, the `data-*` alias spelling — Appendix A
maps only the sem-* tier): `.npl-poa[data-direction]` — same dual-form
contract as the bare attribute, `data-direction` winning when both are
authored.

- `direction`: `string` — default `lr`. One of `lr` | `td`; declares the
  intended flow and mirrors to `data-direction` (dual-form contract,
  `data-` wins, mirror deferred past parse via afterParse). The fence's
  own `graph LR`/`graph TD` line remains the renderer's source of truth
  — authored source is never rewritten. Anything other than `lr`/`td`
  falls back to `lr` with an author-facing warning.
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

- Enhanced: `<npl-poa>` itself (Lit `NplPoa` — light DOM, no shadow
  root); authored children survive untouched beside the generated
  chrome. The tree's code block is stamped `data-npl-poa-tree` +
  `data-direction` — the no-renderer degrade: the mermaid source stays
  human-readable, no diagram runtime is loaded, and a host that wants a
  rendered diagram may attach one later keyed on the attribute. The
  selected option is re-presented prominently as a generated
  `.npl-poa-choice` (`-label` / `-text` spans, inserted after the
  authored element) and the authored element is stamped
  `data-npl-poa-selected`; it remains the source of record, so a theme
  wanting a single presentation may hide it under `data-sem-upgraded`
  in its own CSS. `<reasoning>` is left exactly as authored.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-poa, .npl-poa { display: block; }`). Nothing hidden, nothing
  generated — the fence reads as a code block, the reasoning and the
  selected path read as prose.
