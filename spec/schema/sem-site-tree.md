# Schema — `sem-site-tree`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-site-tree.cy.js`. Changes here precede spec changes
precede code.

A site/file tree as authored structure: nested bare `<node>` entries
with `path`, optional `label` and `kind`. One internal model shared
with sem-file-tree (which authors the same model as text); the same
engine serves both.

Children: `node` entries — bare element children (nested freely), or
the Appendix A class form. A `node` outside a tree container (or whose
parent is not another node) is an orphan-part warning; inside a tree,
`path` is required (schema childForm).

## Scope semantics

- `path` — required in tree context; the node's identity (repo path,
  URL path, key path). Display label if no `label`.
- `label` — optional display refinement (`path` shows when absent).
- `kind` — `dir` | `file` | `symlink`; drives the JS-on glyph.
- `collapsed` (global catalog) on a node — JS-on the branch starts
  collapsed; JS-off everything renders expanded (hide rules gate on the
  upgrade marker — degradation never loses content).

## Authoring form

```html
<sem-site-tree label="Monorepo layout">
  <node path="src" label="Source" kind="dir">
    <node path="src/lit" kind="dir" collapsed>
      <node path="src/lit/sem-workflow.ts" kind="file"></node>
      <node path="src/lit/sem-tree.ts" kind="file"></node>
    </node>
  </node>
  <node path="themes" kind="dir"></node>
</sem-site-tree>
```

Class-form alias (conventions Appendix A): `div.sem-site-tree` ›
`div.sem-node[data-path]`.

Children: `node` rows (or `div.sem-node`), nested to any depth.

- `mode` — `structured` (default) | `text`; text selects the pre-form
  parse (see sem-file-tree.md — the same dispatch serves both tags).
- `label` per the global attribute catalog.

## Rendered form

- **JS-off (CSS-only):** a nested list — nodes are block rows, guides
  via left borders, ordinal counters scoped to the tree, and each
  node's label drawn from `attr(label)` / `attr(path)` `::before`
  chrome — outside the record. Nothing is fabricated.
- **JS-on (lazy chunk `chunks/sem-site-tree.js`, shared engine
  `src/lit/sem-tree.ts`):**
  - per-node collapse — branch nodes grow a `.sem-tree-toggle`
    `<button>` carrying `aria-expanded` and the label; `[collapsed]`
    hides descendants (gated on the container's
    `[data-sem-upgraded]`);
  - filter box (`.sem-tree-filter`) — hides non-matching branches,
    keeps every ancestor chain visible and forces matches' ancestors
    open;
  - find box (`.sem-tree-find`) — marks matches `data-match`, count in
    `.sem-tree-count` (`role="status"`), Enter cycles
    `data-match-current` (opening ancestors as needed).

## Events

None (chrome is local state; no events emitted).

## A11y contract

- Tree container keeps `role="tree"`, nodes `role="treeitem"`
  authored in markup; nested `<node>` rows stay navigable JS-off.
- Toggles are real `<button>`s with `aria-expanded` + an accessible
  name (`Expand/Collapse <label>`).
- Filter/find inputs carry `aria-label`s; the match count is a live
  region (`role="status"`).

## Machine contract

- `$defs.sem-site-tree`: extends the `container` preset (`label`,
  `open`), record; children `node`; `mode` token
  (`structured`|`text`).
- `$defs.node`: record part of `sem-site-tree`/`sem-file-tree`/`node`
  (nested nodes legal); class alias `div.sem-node`; attributes `kind`
  (values `dir`/`file`/`symlink`) + the global catalog (`label`,
  `collapsed`).
- `$defs.sem-site-tree.childForms["node"]`: `path` required in tree
  context (validator child-form branch).
- The lazy manifest maps `sem-site-tree` → `chunks/sem-site-tree.js`;
  the engine factors into a shared chunk both tree tags import.
