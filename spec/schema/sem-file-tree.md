# Schema — `sem-file-tree`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-file-tree.cy.js`. Changes here precede spec changes
precede code.

A file listing authored as text: an indented tree (box-drawing
`├──`/`└──`/`│` or plain whitespace) inside a `<pre>`, wrapped by
`<sem-file-tree mode="text">`. The pre **is** the record — JS-off
nothing is fabricated; JS-on the same engine as sem-site-tree parses
the indentation to the shared model and adds collapse/filter/find over
generated view rows. A structured `<node>` authoring form is also
accepted (dispatched on content, like sem-site-tree).

## Scope semantics

- The `<pre>` content parses line-by-line: box prefixes measure depth
  in 4-column segments; plain indentation measures in the smallest
  positive indent unit; a trailing `/` marks a directory (`kind="dir"`).
- The authored pre is never modified and remains in the DOM in both
  tiers — JS-on it is hidden (gated on `[data-sem-upgraded]`) in favour
  of the interactive view; extraction of the record reads the pre.
- Generated chrome (`.sem-file-tree-view`, `.sem-tree-view-row`,
  `.sem-tree-chrome`, `.sem-tree-toggle`) carries no record text.

## Authoring form

```html
<sem-file-tree mode="text" label="Assets">
<pre>
assets/
├── icons/
│   └── logo.svg
├── main.css
└── app.js
</pre>
</sem-file-tree>
```

Class-form alias (conventions Appendix A): `div.sem-file-tree` ›
`div.sem-node[data-path]` (structured form) — the text form has no
node children to alias.

Children: in text mode, one `<pre>` and nothing else. In structured
mode, `node` entries exactly as sem-site-tree.md.

- `mode` — `text` | `structured` (default); explicit `mode` overrides
  content dispatch.
- `label` per the global attribute catalog.

## Rendered form

- **JS-off (CSS-only):** the authored pre renders verbatim — the
  record is the record; zero fabrication.
- **JS-on (lazy chunk `chunks/sem-file-tree.js`, shared engine
  `src/lit/sem-tree.ts`):** the parsed model renders as generated view
  rows (`.sem-file-tree-view`) with per-branch collapse, filter and
  find exactly as sem-site-tree.md (same engine, same classes, same
  gating).

## Events

None (chrome is local state; no events emitted).

## A11y contract

- The authored pre remains the accessible record; the generated view
  carries `role="tree"`/`role="treeitem"` rows with button toggles
  (`aria-expanded`, named `Expand/Collapse <path>`).
- Filter/find inputs carry `aria-label`s; the match count is a live
  region (`role="status"`).

## Machine contract

- `$defs.sem-file-tree`: extends the `container` preset (`label`,
  `open`), record; children `node` (structured form); `mode` token
  (`structured`|`text`).
- `$defs.sem-file-tree.childForms["node"]`: `path` required in tree
  context (validator child-form branch).
- The lazy manifest maps `sem-file-tree` → `chunks/sem-file-tree.js`.
