# Schema — `sem-references` / `sem-reference`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-references.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A numbered list of works or notes the prose cites. Each `sem-reference` is
one citable entry with an `id`; **inline citations are plain anchors**
(`<a href="#r1">`) and mint nothing. The element exists because a
reference needs fields a `<li>` cannot carry (`href`, `cite`) and because
backlinks and hover previews are reading affordances that need JS.

## Authoring form

```html
<p>Rotate refresh tokens per use<a href="#r-rfc">[1]</a>.</p>

<sem-references id="refs" kind="bibliography" role="list">
  <sem-reference id="r-rfc" role="listitem"
       href="https://www.rfc-editor.org/rfc/rfc6749" cite="RFC 6749">
    The OAuth 2.0 Authorization Framework, §10.4.
  </sem-reference>
  <sem-reference id="r-note" role="listitem">
    A footnote with no external target.
  </sem-reference>
</sem-references>
```

Class-form alias (conventions Appendix A): `div.sem-references[data-kind]` › `div.sem-reference[id][data-href][data-cite]`.
Parameters are read as `data-<name>` first, then bare `<name>`.

- `kind`: `footnotes` | `bibliography` (free token; these two get
  distinct styling). Optional.
- `sem-reference`: the citable entry; its text is the reference's
  description.
- `id` (required; on each `sem-reference`): the citation target — the
  global `id`.
- `href` (optional; on each `sem-reference`): external location
  (`data-href` in the class form).
- `cite` (optional; on each `sem-reference`): short citation label
  (`RFC 6749`).
- Inline citation: any `<a href="#<reference-id>">` outside the references
  container. Its text is the author's (`[1]`, `¹`, a name) — the vocabulary
  does not renumber authored citation text.

## Rendered form

### All tiers (CSS)

- Entries are numbered by CSS counter (`::before`), 1-based in DOM order.
- The `:target` entry is highlighted (deep-linking from a citation works
  with no script).
- `kind="bibliography"` uses a hanging indent; `kind="footnotes"` a
  compact list.

### Enhanced (reading handler, `src/reading/references.ts`; the Lit
component `SemReferences` claims `data-sem-upgraded` at connect and runs
the same function once its `sem-reference` children exist)

- Every citing anchor gets the runtime class `.sem-references-ref` and a
  hover / focus **preview popover** (`src/shared/popover.ts`) showing the
  reference's text; `Esc` closes it; the anchor still navigates on click.
- Every cited reference gets `.sem-references-backlinks` appended: one
  `<a>` per citing anchor, `aria-label="Back to citation N"`, pointing at
  that anchor (which is given an id when it has none).
- A reference with `data-href` gets `.sem-references-link`, an external
  link to it, appended.
- The container carries `data-sem-upgraded` once wired (idempotent per
  anchor and per reference).

### JS-off

- Numbered list, `:target` highlight, no backlinks, no popover.
- Print: each reference with an `href` shows `(href)` after its text —
  inside the references block only, never at the citation.

## Events

None.

## A11y contract

- `role="list"` / `role="listitem"` authored in markup.
- Backlinks carry `aria-label="Back to citation N"`.
- The preview is `role="tooltip"`; while shown, the citing anchor carries
  `aria-describedby` pointing at it; `Esc` dismisses; it opens on focus as
  well as hover, so keyboard users get it too.
- The citation anchor remains an ordinary link: preview never replaces
  navigation.

## Machine contract

- Container: `fields: {}`, `text: ""`.
- `sem-reference` yields `fields: { href, cite, ordinal }` — attribute
  strings (`""` when absent) and the positional 1-based ordinal — with
  `text` = the reference prose.
- `.sem-references-backlinks`, `.sem-references-link` and the popover are
  chrome: skipped entirely. `.sem-references-ref` is a runtime class on an
  authored anchor and is ignored.
- Inline citations mint no record.
