# Schema — `sem-data-visualizer`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-data-visualizer.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

The container for data-visualizer state: it wraps one or more
`sem-data-source` children (plus optional `sem-data-join` and
`sem-data-query` declaration children). It mints no records of its own —
it is the unit of tier scanning, of the modal viewer, and of shared
view/query state. Zero-JS it shows its source children unenhanced (the
authored text reads as pre-wrapped text).

## Authoring form

```html
<sem-data-visualizer id="dv-tokens">
  <sem-data-source data-name="Token lifetimes" data-format="table"
                   data-views="core=token,max-uses; all=*" data-view="all">
    | Token | Max uses | Lifetime | Rotates | Since      |
    | :---- | -------: | :------- | :------ | :--------- |
    | access | 200     | 15 min   | true    | 2026-01-05 |
    | id     | 1000    | 1 hour   | false   | 2026-02-14 |
  </sem-data-source>
</sem-data-visualizer>
```

Class-form alias (conventions Appendix A): `.sem-data-visualizer` — every
selector reads `:is(sem-data-visualizer, .sem-data-visualizer)`.

- Children: one or more `<sem-data-source>` (each a named data bucket);
  optional `<sem-data-join>` and `<sem-data-query>` declaration children
  (phase 5).
- `id`: optional — names the container for the modal deep link
  (`#dv=<visualizer-id>`). The copy-link chrome prefers the container's
  id; with none it falls back to the container's sole named source
  (`#bucket=<name>`), and a container with neither mints no copy-link
  button.
- `kind`, `tags` per the global attribute catalog.

## Rendered form

### Enhanced (reading handler, `src/reading/data.ts`; the Lit component
`sem-data-visualizer` runs the same function)

- The container is the enhance unit: its direct `sem-data-source`,
  `sem-data-join` and `sem-data-query` children are wired, per-source
  tables render with typed sort and views, and the query chrome renders
  when a `sem-data-query` child is present.
- The container renders one tools row (`.sem-data-tools`) above its
  children: a `.sem-data-expand` button that opens the modal viewer and,
  when the container is linkable, a `.sem-data-copy` button that mints
  the current container/view/query state onto the document URL.
- Clicking the container's expand control (`.sem-data-expand`) opens the
  full-page modal viewer (phase 6): the container's own children teleport
  into a `role="dialog"` / `aria-modal` panel — same enhance output, still
  live — with a focus trap, Esc-to-close, and in-order restore that keeps
  the enhance idempotent (`data-sem-modal-open` guards re-entry).
- Deep links apply at enhance and again per source render (late file/API
  loads): `#dv=<id>&view=<name>` scopes a container, `#dv=<id>&q=<query>`
  restores an edited default query, `modal=1` reopens the modal.
- The element carries `data-sem-upgraded` once wired.

### JS-off

- The source children show unenhanced, like `sem-md`: the authored text
  reads as pre-wrapped text. Nothing hidden, nothing generated.

## Events

None.

## Machine contract

- Mints no record of its own; the sources mint.
- Owns the `.sem-data-*` class namespace only — never another element's
  classes (conventions §2).
