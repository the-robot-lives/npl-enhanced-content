# Schema — `sem-data-source`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-data-visualizer.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

One named data bucket inside a `sem-data-visualizer`. Its payload is
either the element's inline text body or the resource named by `source`
(an empty body plus `source` is the file/API form; a non-empty inline
body together with `source` is an authoring error, rendered as a clear
error, never silently resolved). Formats: inline Markdown table, CSV
(RFC 4180), a YAML subset, JSON, a SQL result-shape declaration, or a
file/API load; zero-JS the authored text reads as pre-wrapped text.

## Authoring form

```html
<sem-data-visualizer>
  <sem-data-source data-name="Token lifetimes" data-format="table"
                   data-views="core=token,max-uses; all=*" data-view="all">
    | Token | Max uses | Lifetime | Rotates | Since      |
    | :---- | -------: | :------- | :------ | :--------- |
    | access | 200     | 15 min   | true    | 2026-01-05 |
    | id     | 1000    | 1 hour   | false   | 2026-02-14 |
  </sem-data-source>
</sem-data-visualizer>
```

The `sem-data-visualizer` container is the unit of tier scanning: the
enhanced table renders only for a source inside a container; a bare
source, or any source with scripts disabled, shows the authored payload as
pre-wrapped text.

Class-form alias (conventions Appendix A): `.sem-data-source`. Parameters
are read as `data-<name>` first, then bare `<name>` via the shared
`param()` reader; `data-*` wins when both are present. `source` is the
one bare-by-brief name and reads `data-source` as its alias twin.

- `data-name`: free text — human label rendered as the table `caption`,
  and the bucket key every query, join and cross-source view reference
  resolves (exact, then case-insensitive, then normalized: lowercase,
  non-alphanumeric runs collapsed to `-`, edge `-` trimmed).
- `data-format` (optional): one of `table`, `csv`, `yaml`, `json`,
  `sql` — payload syntax of the body or of the fetched resource; default
  `table`. Unknown format is a clear inline error, never a silent blank.
- `data-type` (optional): one of `rows`, `yaml-schema` — structure
  declaration; default none (absent ⇒ the tier infers). rows ⇒ simple
  row/column definition via the per-column declaration attribute;
  yaml-schema ⇒ the payload is an OpenAPI-style YAML document whose
  nested objects flatten to dotted column paths.
- `data-columns` (optional): string — with `data-type="rows"`, the
  per-column declaration, a comma list of `name[:type][?]` (`?` = nullable;
  types `string`, `number`, `integer`, `boolean`, `date`, `null`).
  Declared types override inference per column; inference fills any
  column the declaration omits.
- `source` (optional): string — URL of a relative/same-origin file or an
  absolute `http(s)` file/API endpoint; inline payload and `source` are
  mutually exclusive. `file://` is refused when the document itself is
  `file://`.
- `data-views` (optional): named views as `name=colspec; name=colspec` —
  `colspec` is `*` or a comma list of column names, matched
  case-insensitively; malformed segments are skipped (a typo hides a
  view, it never breaks the document).
- `data-view` (optional): view name — the default view. Resolution:
  `data-view` name ⇒ first declared view ⇒ implicit `all=*`.
- `data-header` (optional): one of `true`, `false`; default `true` —
  csv only: `false` ⇒ the first row is data and headers synthesize
  `col-<n>`.
- `data-path` (optional): string — `json`/API only: dot/bracket path
  into a nested response (`data.items`, `rows[2].entries`) that flattens
  to the row array.
- `data-cache` (optional): one of `no`; default none — `no` ⇒ skip the
  in-memory fetch cache (one fetch per URL per page load by default).
- `id`, `kind`, `tags` per the global attribute catalog.

## Rendered form

### Enhanced (reading handler, `src/reading/data.ts`)

- The payload parses by format and renders a native `<table>` (caption =
  `data-name`) with per-column typed sort. The inferred/declared schema
  is exposed as a `<script type="application/json" class="sem-data-schema">`
  child (`{ name, format, type, view, views, columns }`).
- Views: every column stays in the DOM (`hidden` on excluded
  `th`/`td`); with ≥2 declared views an `aria-pressed` button group
  (`.sem-data-views`) toggles column visibility.
- File/API sources render a `.sem-data-pending` region (`role=status`)
  first, then the table or the error. Fetch failures, non-2xx status,
  parse failures and CORS blocks render `.sem-data-error`
  (`role="alert"`) naming the cause — never a blank pane.
- Cells and captions render via `textContent` only; JSON parses with
  `JSON.parse` — a payload can style nothing and run nothing.
- The element carries `data-sem-upgraded` once wired. A successful
  render shows the generated table alone: the authored payload text
  must not echo above it. A failed render keeps the authored text
  visible alongside the inline error; a pending load shows it with the
  status region.

### JS-off

- The authored text reads as pre-wrapped text. Nothing hidden, nothing
  generated.

## Events

None.

## Machine contract

- `fields: { caption, columns, rows }` via the shared table machinery;
  the schema JSON is an inert `application/json` script child, so no
  attribute quoting/escaping mangles it.
- Runtime state uses `data-*`: `data-sem-source-index` row stamps,
  `data-nullable` header marker, tier markers (`data-sem-fallback` /
  `data-sem-upgraded`).
- Editing and view switches are session-only presentation state: the
  authored markup is never rewritten and extraction stays invariant.
