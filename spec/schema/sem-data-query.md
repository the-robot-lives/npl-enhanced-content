# Schema — `sem-data-query`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-data-visualizer.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

The editable default query: a direct declaration whose text body is one
query in the read-only SQL subset (`SELECT … FROM <bucket> [WHERE]
[ORDER BY] [LIMIT]`). Placed directly inside a `sem-data-visualizer`;
no JOIN in the grammar (joins are declarative via `sem-data-join`), no
aggregates, no write path. Zero-JS the query text shows as ordinary
text (it *is* the document's record of the default query).

## Authoring form

A direct member of a `sem-data-visualizer`, addressing one of the
visualizer's named buckets — the smallest valid example therefore carries
the bucket it queries.

```html
<sem-data-visualizer id="dv-services">
  <sem-data-source data-name="services" data-format="table">
    | name    | port | ready |
    | :------ | ---: | :---- |
    | api     | 8443 | true  |
    | web     | 8080 | true  |
    | metrics | 9090 | false |
  </sem-data-source>
  <sem-data-query>SELECT name, port FROM services WHERE ready = true ORDER BY port LIMIT 5</sem-data-query>
</sem-data-visualizer>
```

Class-form alias (conventions Appendix A): `.sem-data-query`.

No component-specific parameters — the element's text body is the
query.

- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

### Enhanced (reading handler, `src/reading/data.ts`)

- The enhance renders the query chrome (`.sem-data-query-chrome`): a
  labeled editable `textarea` pre-filled with the query text, a **Run**
  button, a status region (`.sem-data-query-status`, row count), and a
  results table (`.sem-data-query-results` — the shared table machinery,
  sort included).
- The query re-runs on every edit (input event, debounced 300 ms), on
  Run, and on Ctrl/Cmd+Enter; when a bucket fills late (file/API
  source), pending queries re-run automatically.
- Editing is session-only presentation state: the authored
  `sem-data-query` text is never rewritten, the results table is
  generated chrome, and extraction stays invariant.
- Deep links: `#dv=<visualizer-id>&q=<encoded-query>` restores an edited
  default query on load; the chrome's copy-link button writes `q=` only
  when the edited statement diverges from the authored one.
- No `sem-data-query` declaration ⇒ no query chrome (plain per-source
  tables only).
- The authored statement parks in a `.sem-data-raw` box hidden by the
  same container/runtime contract as `sem-data-source` once the query
  is wired. The box stays in the DOM (edits rewrite its text; the
  element carries `data-sem-upgraded` too).

### JS-off

- The query text reads as ordinary text. Nothing hidden, nothing
  generated.

## Events

None.

## Machine contract

- Mints no record of its own; the results table is generated chrome and
  the authored statement stays byte-for-byte in the document.
- Chrome classes: `.sem-data-query-chrome`, `.sem-data-query-results`,
  `.sem-data-query-status` — this family owns `.sem-data-*` only.
