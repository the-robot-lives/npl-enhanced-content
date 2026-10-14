# SemText Data Visualizer — Design

**Status: DRAFT v0.2 — phases 1-6 built on this branch.**
Normative for `sem-data-visualizer` / `sem-data-source` / `sem-data-join` /
`sem-data-query`. Companion to `spec/conventions.md` (vocabulary rules) and
`spec/schema/sem-table.md` (the authored-table cousin). Everything marked
**phase N** is design-only until its phase ships; the phase plan (§11) records
the build status of each phase.

---

## 0. Naming decisions (recorded per brief)

- **Elements:** `<sem-data-visualizer>` is the container; `<sem-data-source>`
  is each source. Phase 5 adds two declaration children: `<sem-data-join>`
  (materializes a merged bucket from two named buckets) and
  `<sem-data-query>` (carries the editable default query).
  `sem-` prefix, per conventions §0. The class-form alias (Appendix A shape)
  is accepted by every selector as `:is(sem-data-visualizer,
  .sem-data-visualizer)` / source / join / query ditto.
- **Attributes kept exactly as briefed:** `data-type`, `data-name`,
  `data-format`, `source`, `data-views`, `data-view`, plus the later
  `data-columns`, `data-header`, `data-path`, `data-cache`. These are the
  `data-*` spellings; the vocabulary's alias rule (conventions §2) means every
  tier also accepts the bare spelling (`type=`, `name=`, `format=`, `views=`,
  `view=`, `columns=`, `header=`, `path=`, `cache=`) via the shared `param()`
  reader — `data-*` wins when both are present. `source` is the one
  bare-by-brief name (the URL of a file/API source; phase 4) and reads
  `data-source` as its alias twin.
- **Class namespace:** this element family owns `.sem-data-*` only —
  `.sem-data-body`, `.sem-data-error`, `.sem-data-schema`, `.sem-data-sort`,
  `.sem-data-pending`, `.sem-data-views`, `.sem-data-query-chrome`,
  `.sem-data-query-results`, `.sem-data-query-status` — never another
  element's classes (conventions §2). Runtime state uses `data-*`:
  `data-sem-source-index` row stamps, `data-nullable` header marker, tier
  markers (`data-sem-fallback` / `data-sem-upgraded`).

## 1. Requirements coverage (the full arc)

| # | Requirement | Phases |
| :-- | :-- | --: |
| R1 | Data sources: API links; data-file links (CSV, YAML, JSON; hosted or relative); inline CSV, YAML, SQL, Markdown table | 1 (inline table) · 2 (inline csv/yaml/json/sql) · 4 (files/API) |
| R2 | Structure definition: simple row/column declaration for simple data; OpenAPI-style YAML schema payload for nested data | 3 |
| R3 | Default query/view the user can edit or alter in the page | 1 (parse + default selection) · 5 (in-page editing) |
| R4 | Viewer: click opens a modal full-page visualizer; `#deep-links` reload a specified view | 6 |

## 2. Elements

### `sem-data-visualizer` — container (phase 1)

Wraps one or more `sem-data-source` children (plus optional `sem-data-join`
and `sem-data-query` children, phases 5). Mints no records of its own; it is
the unit of tier scanning, of the future modal viewer (R4), and of shared
view/query state (R3/5). Zero-JS: shows its source children unenhanced (like
`sem-md`, the authored text reads as pre-wrapped text).

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

### `sem-data-source` — one dataset (phase 1; formats 2, structures 3, loads 4)

Each direct `sem-data-source` child of a visualizer is one **named data
bucket**. Its payload is either the element's inline text body **or** the
resource named by `source`: an *empty* body plus `source` is the file/API
form, and a *non-empty* inline body together with `source` is an authoring
error (rendered as a clear error, never silently resolved).

| Attribute | Values | Meaning |
| :-- | :-- | :-- |
| `data-name` | free text | Human label; renders as the table `caption`. Also the **bucket key** every query, join, and cross-source view reference uses (§5 bucket naming). |
| `data-format` | `table` (default) · `csv` · `yaml` · `json` · `sql` | Payload syntax of the body (or of the `source` target). Unknown format ⇒ clear inline error, never a silent blank. |
| `data-type` | absent · `rows` · `yaml-schema` | **Structure declaration.** Absent ⇒ the tier infers (§4). `rows` ⇒ simple row/column definition (`data-columns`); `yaml-schema` ⇒ the payload is an OpenAPI-style YAML document (§6). |
| `data-columns` | `name:string, port:integer, ready:boolean?` | With `data-type="rows"`: the per-column declaration (`:type` optional, `?` suffix = nullable). Declared types **override** inference per column; inference still fills any column the declaration omits. (§6.1) |
| `source` / `data-source` | URL | Where the data lives for file/API sources (phase 4). Inline payload and `source` are mutually exclusive. |
| `data-views` | `name=colspec; name=colspec` | Named views; `colspec` is `*` or a comma list of column names, matched case-insensitively. Malformed segments are skipped (a typo hides a view, it never breaks the document). |
| `data-view` | view name | The default view. Resolution: `data-view` name ⇒ first declared view ⇒ implicit `all=*`. An unknown `data-view` name resolves by those fallbacks. |
| `data-header` | `true` (default) · `false` | `csv` only: `false` ⇒ the first row is data and headers synthesize `col-<n>`. |
| `data-path` | dot/bracket path | `json`/API only: path into a nested response (`data.items`, `rows[2].entries`) that flattens to the row array. (§7.4) |
| `data-cache` | (default) · `no` | `no` ⇒ skip the in-memory fetch cache (one fetch per URL per page load by default). |

### `sem-data-join` — join two buckets on a named key (phase 5)

Direct child of the visualizer; a declaration, not a rendered dataset (zero-JS
it is invisible; there is nothing to read). Materializes one extra bucket that
queries can address by `name`:

```html
<sem-data-join name="user-orders" left="Users" right="Orders" on="user-id">
```

| Attribute | Meaning |
| :-- | :-- |
| `data-name` (alias `name`) | Bucket key of the join result. Required; colliding with a source name is an authoring error. |
| `data-left` / `data-right` (aliases `left`/`right`) | The two buckets to join, by `data-name` reference (§5). Required. |
| `data-on` (alias `on`) | The **named key column**: must exist (case-insensitive) in both buckets. Required. |

Semantics: **inner join**. For each left row matched by ≥1 right row the
result row is the left row's columns plus the right row's columns minus the
key; a right column whose name already exists in the left bucket is exposed as
`<right-bucket-ref>.<column>` (§5 normalization). Unmatched left rows drop.
Key equality: both sides numeric (finite number-coercible) compare
canonicalized (`String(Number(v))`), else trimmed strings. Outer joins,
multiple keys, and non-equality joins are out of scope.

A join whose buckets or key do not resolve renders
`.sem-data-error` (role=alert) on the join element and registers no bucket.

### `sem-data-query` — the default query (phase 5)

Direct child of the visualizer; its text is one query in the §8 SQL subset.
Zero-JS the query text shows as ordinary text (it *is* the document's
record of the default query). The enhance renders a **query chrome**: a
labeled editable `textarea` pre-filled with the query text, a **Run** button,
a status region (row count), and a results table (the §3 table machinery,
sort included). The query re-runs on every edit (input event, debounced
300 ms), on Run, and on Ctrl/Cmd+Enter. When a bucket fills late (file/API
source, phase 4), pending queries re-run automatically.

Editing is session-only presentation state: the authored `sem-data-query`
text is never rewritten, the results table is generated chrome, and
extraction stays invariant.

```html
<sem-data-query>SELECT name, port FROM services WHERE ready = true ORDER BY port LIMIT 5</sem-data-query>
```

No `sem-data-query` child ⇒ no query chrome (plain per-source tables only).

## 3. Views (R3)

Phase 1 honors `data-views`/`data-view` as parsing plus a default: the named
view selects which columns render visible; every column stays in the DOM
(`hidden` attribute on excluded `th`/`td`), so extraction and a later view
switch never lose data. Phase 5 adds the **view chrome**: a source with ≥2
declared views renders one button per view (`role="group"` of buttons,
`aria-pressed` on the active one); clicking toggles the hidden state of the
already-rendered columns. Like edits, a view switch is session-only
presentation state — authored markup is never rewritten.

## 4. Schema inference (phase 1; `src/data/table.ts`, pure)

Given the parsed table, each column gets `{ name, type, nullable }`:

- **null cells:** an empty cell (after trim) is null. A column whose every
  body cell is empty — or a table with no body rows — infers `type: "null"`,
  `nullable: true`.
- **per-cell narrowest type:** `integer` (`/^[+-]?\d+$/`) → `boolean` (literal
  `true`/`false` only; `yes`/`no` stay string) → `date` (ISO-8601 shaped
  `YYYY-MM-DD[THH:MM[:SS]][Z|±HH:MM]` that `Date.parse` accepts) → `number`
  (finite numeric) → `string`.
- **column type:** all non-null cells agree ⇒ that type; `integer`+`number`
  mix ⇒ `number`; any other mix ⇒ `string`.
- **nullable:** at least one empty cell in the column.
- **names:** header text, trimmed; an empty header synthesizes `col-<n>`
  (1-based).
- **exposure:** the enhance appends
  `<script type="application/json" class="sem-data-schema">` to the source
  with `{ name, format, type, view, views, columns: ColumnSchema[] }` — JSON
  in a script child, so no attribute quoting/escaping mangles it. The pure
  functions (`parseGfmTable`, `inferSchema`, `parseViews`, `resolveView`,
  `visibleColumns`, `parseCsv`, `parseYamlSubset`, `parseQuery`, `runQuery`,
  …) are exported from the bundle for programmatic use.

**Table parsing rules** (GFM, mirroring `src/md/parse.ts`): first non-blank
line must carry `|`; a delimiter row must follow and match the header width;
body rows continue until a blank or pipe-less line. Ragged rows follow the
Markdown renderer: missing cells are empty (inferred null), extras dropped.
The body's common indentation is stripped (`dedent`) — tables are authored
inside element markup. A non-table body is a **clear error**, rendered inline
(`.sem-data-error`, `role="alert"`) and warned on the author channel; the
tier never guesses. Cell splitting keeps pipes inside code spans literal.

## 5. Buckets and naming (phase 5)

Every parsed source registers a bucket under its `data-name`; every
`sem-data-join` registers its result under its own name. References resolve:

1. exact match, then
2. case-insensitive match, then
3. **normalized** match — lowercase, runs of non-alphanumeric characters
   collapsed to `-`, edge `-` trimmed (so `Token lifetimes`, `token-lifetimes`
   and `token_lifetimes` name one bucket).

`SELECT … FROM`, `data-left`/`data-right`, and cross-source view references
all use this resolution. A reference nothing resolves to is a clear error, on
the query chrome or join element respectively.

## 6. Structure declaration (R2, phase 3)

### 6.1 `data-type="rows"` — simple row/column

`data-columns="name:string, port:integer, ready:boolean?"` — a comma list of
`name[:type][?]`. Types: `string`, `number`, `integer`, `boolean`, `date`,
`null` (the §4 set). `?` marks the column nullable. An unknown type name, or a
declaration naming no column this payload has, warns and is ignored for that
column; inference still fills every column the declaration omits. Declared
columns apply to every tabular format (`table`, `csv`, `json`, `yaml`).
Declared types **override** the inferred type and nullability per column;
cells are never rewritten — a non-empty cell whose text violates its declared
type logs a warning (author channel) and renders as-is (validation is
advisory, rows are never dropped).

### 6.2 `data-type="yaml-schema"` — OpenAPI-style YAML subset

The payload is YAML (the §7.3 subset) shaped:

```yaml
schema:
  type: object            # or: array (+ items:)
  properties:
    name:
      type: string
    port:
      type: integer
    address:
      type: object
      properties:
        city: { type: string }   # block form equally fine; flow maps out of the YAML subset
    tags:
      type: array
      items:
        type: string
  required:        # optional; block or flow sequence of property names
    - name
    - port
data:              # sequence of records (or one mapping = a single row)
  - name: alpha
    port: 8080
    address:
      city: Springfield
    tags:
      - core
      - edge
```

- The record shape is `schema.properties` directly (`type: object`) or
  `schema.items.properties` (`type: array`).
- Nested `type: object` properties **flatten to dotted column paths**
  (`address.city`), depth first, declaration order.
- `type: array` properties serialize the whole array as one JSON cell;
  nested arrays of mappings likewise.
- `required` drives `nullable: false` (everything else nullable);
  declared `type` drives the column type. Properties missing from a row do
  not error — the cell is null (a missing *required* property warns).
- Columns present in the data but absent from `properties` append after the
  declared ones, inferred as usual ("inference fills what the declaration
  omits").
- Mismatch between a declared type and a cell value warns, never drops.

## 7. Source kinds and payload formats (R1 — phases 2/4)

Seven source kinds, two mechanisms: an **inline payload** (the element's
text) or a **`source` reference** (a relative file, a same-origin file, an
absolute `http(s)` file, or a JSON API endpoint).

### 7.1 `table` — inline Markdown (phase 1)

GFM table per §4.

### 7.2 `csv` — inline or file (phase 2/4)

RFC 4180: quoted fields, `""` escapes, embedded commas and newlines, CRLF
tolerated. First record = header, unless `data-header="false"` ⇒ headers
synthesize `col-<n>`. Ragged rows pad/drop like §4. Inline only in phase 2;
file loads in phase 4.

### 7.3 `yaml` — inline or file (phase 2/4)

A deliberate YAML **subset** (a general parser is out of scope for the
bundle budget):

- in scope: block mappings (`key: value`), block sequences (`- item`),
  nested indentation (spaces only), comments (`#`), quoted scalars
  (single-quoted with `''` escape, double-quoted with `\"`/`\\`/`\n`),
  plain scalar typing (`null`/`~`/empty → null, `true`/`false`, integers,
  floats, else string), and **flow sequences of scalars** (`[a, b]`).
- out of scope (clear parse error): flow mappings (`{k: v}`), anchors and
  aliases (`&`/`*`), tags, block scalars (`|`/`>`), multi-document streams
  (`---`), tabs in indentation.

A `yaml` payload (absent `data-type="yaml-schema"`) must be a sequence of
mappings ⇒ rows (columns = key union, first-seen order); a nested mapping
value serializes as a JSON cell. Anything else is a clear error that
suggests `data-type="yaml-schema"`. Nested payloads declare the structure
and go through §6.2.

### 7.4 `json` — inline or API (phase 2/4)

`JSON.parse` (never `eval`). In scope: array of objects (rows; column union,
first-seen), object of arrays (columns), `data-path` extraction for nested
responses (`data.items`, `rows[2].entries` — dot segments + `[n]` indexes).
Out of scope: JSONL, nested-object rows without a `data-path`, JSON pointers
beyond dot/bracket.

### 7.5 `sql` — inline declaration (phase 2)

A single `SELECT` statement carried as **data** — the projection declares the
result shape; nothing executes at declaration time. Columns = the projection
list (`SELECT a, b` ⇒ columns `a`, `b`; expressions/aliases out of scope).
`SELECT *` resolves its columns from the `FROM` bucket when that bucket
exists in the same visualizer, else errors clearly. Rows: **zero** — the
declaration is a shape, not a result; the editable query (§8, phase 5) is how
results are produced in-page.

### 7.6 Relative and same-origin files (phase 4)

`source="data/services.csv"` (relative to the document base) or a
same-origin absolute URL. Fetch with `credentials: "same-origin"`; response
parsed by format (format precedence: explicit `data-format` > file extension
`.csv`/`.yaml`/`.yml`/`.json`/`.md` > sniff). A failed fetch, non-2xx
status, or parse failure renders the standard `.sem-data-error` channel —
never a blank pane.

### 7.7 Absolute http(s) links and APIs (phase 4)

`source="https://example.com/api/services"` fetches like §7.6. **CORS** is
the browser's to grant: a blocked request surfaces as a clear error naming
the URL and CORS as the likely cause. `data-format="json"` + `data-path`
turns an API response into rows (§7.4).

## 8. Queries (R3, phase 5) — the SQL subset

One query addresses the visualizer's buckets (§5). The language is a
deliberately small, read-only SQL subset:

```sql
SELECT <column-list | *> FROM <bucket>
  [WHERE <condition>]
  [ORDER BY <column> [ASC | DESC]]
  [LIMIT <integer>]
```

- **SELECT** — `*` or a comma list of column names. No aliases, no
  expressions, no aggregates.
- **FROM** — exactly one bucket (§5 resolution). JOIN is *not* in the
  grammar: joins are declarative (`sem-data-join`, §2).
- **WHERE** — comparisons `<column> <op> <literal>` with
  `op` ∈ `= != <> < <= > >=`; `IS NULL` / `IS NOT NULL`; literals are
  `'single-quoted'` strings (`''` escapes), numbers, `true`/`false`/`null`.
  Conditions combine with `AND` / `OR` (`AND` binds tighter; parentheses are
  out of scope).
- **ORDER BY** — one column, `ASC` (default) or `DESC`; nulls sort last
  either direction; stable (authored order breaks ties).
- **LIMIT** — non-negative integer.

Comparison semantics: both sides numeric ⇒ numeric; both boolean ⇒
`false < true`; else numeric-aware string comparison. `= null` is never true
(use `IS NULL`).

**Out of scope (rejects with a clear syntax error):** `JOIN`/`UNION`/
subqueries, `GROUP BY`/aggregates (`COUNT`, `SUM`, …), `DISTINCT`, `OFFSET`,
`IN`/`BETWEEN`/`LIKE`, function calls, arithmetic, aliases, multi-statement
queries, and every mutating statement (`INSERT`, `UPDATE`, `DELETE`, `CREATE`,
…). Queries are **read-only by construction**: they evaluate in memory over
page buckets and touch nothing else.

## 9. Loader design (R1 files/API — phase 4)

- **`source` URL resolution:** absolute URL, or relative to the document
  base. Format precedence: explicit `data-format` > extension (`.csv`,
  `.yaml`/`.yml`, `.json`, `.md`) > sniff (first non-blank char/line).
- **Fetch contract:** `fetch(source)` with `credentials: "same-origin"`;
  responses parsed by format (§7). Errors (network, status ≥ 400, parse)
  render the same `.sem-data-error` channel with the status/parse cause —
  never a blank pane. A source may declare `data-cache="no"` to skip the
  in-memory cache (one fetch per URL per page load by default).
- **Security rules:**
  - **Same-origin / relative only by guarantee:** relative and same-origin
    URLs always load. Cross-origin `http(s)` is attempted and depends on
    CORS — a blocked load is a clear error, never a blank pane.
  - **`file://` refused:** when the document itself is `file://`, the loader
    refuses every fetch with a visible message (portable single-file docs
    inline their payloads; conventions §7 hard rule). This is a hard
    refusal, not a best effort.
  - **No script in data:** cells and captions render via `textContent`
    only; JSON parses with `JSON.parse`; the schema exposure is an inert
    `application/json` script child. A payload can style nothing and run
    nothing.
  - **SQL is read-only:** §8 — the engine has no write path at all.
- **API sources** (phase 4): `source` + `data-format="json"` covers JSON
  APIs; `data-path` (dot/bracket path into the response, e.g.
  `data.items`) flattens a nested payload into rows.
- **Sequencing:** loaders are async; the enhance renders a placeholder
  `.sem-data-pending` region (role=status), then swaps in the table (or
  error) and re-runs any pending queries (§2). The sync render path is
  unchanged for inline sources.

## 10. Modal viewer and deep links (R4 — phase 6)

Clicking a visualizer's expand control opens a full-page modal rendering the
active view large (same enhance output, `role="dialog"`, `aria-modal`, focus
trap, `Esc` closes). The modal teleports the container's own children into
the dialog panel — the rendered tables, view buttons and query chrome stay
live and keep their listeners — and moving back on close restores the
original order, so the enhance stays idempotent.

Deep links reload the document with a state restored, as `&`-joined hash
segments (the `src/shared/state.ts` form):

```
#view=<name>&bucket=<source-name>          one view of one source
#dv=<visualizer-id>&view=<name>            container-scoped state (query chrome included)
#dv=<visualizer-id>&q=<encoded-query>      the edited default query (DV-Q5)
&modal=1                                   minted from the modal — reopen it
```

A deep link activates that view/query on load and, when the link was minted
from the modal (`modal=1`), opens the modal. The `dv` id is matched exactly
(HTML ids are case-sensitive); the `bucket` name goes through the §5
normalized reference, so `Fleet status` and `fleet-status` name the same
source. Links are authorable: the chrome exposes a copy-link button that
mints the link from live state (active view when it differs from the
authored default, edited query when it diverges from the authored statement,
`modal=1` while the modal is open) and leaves every other hash segment —
sem-views bare links, audience — byte-for-byte intact. Container ids or a
single named source are required to mint; a container with neither renders
no copy-link button.

## 11. Phase plan

| Phase | Scope | Status |
| --: | :-- | :-- |
| **1** | Container + inline Markdown-table source; schema inference + JSON exposure; native-table render; per-column typed sort; `data-views`/`data-view` parsing + default selection; clear errors. Unit-tested. | **BUILT (this branch)** |
| **2** | Inline `csv` (RFC 4180), `yaml` (§7.3 subset), `json` (§7.4) payloads; `sql` result-shape declarations (§7.5). Unit-tested. | **BUILT (this branch)** |
| **3** | Structure declarations: `data-type="rows"` + `data-columns` (§6.1) and OpenAPI-style YAML payloads (§6.2); declared-over-inferred types; nested flattening to dotted paths; advisory validation. Unit-tested. | **BUILT (this branch)** |
| **4** | `source` loaders: relative and same-origin files, absolute http(s) with CORS-as-error, `file://` refusal (§9); async render contract; `data-path`; `data-cache`. Unit-tested. | **BUILT (this branch)** || **5** | Query chrome: editable default query (`sem-data-query`) re-run on change; named buckets (§5); `sem-data-join` on a named key; the §8 SQL subset engine; per-source view-switch buttons (§3). Unit-tested. | **BUILT (this branch)** |
| 6 | Modal full-page viewer + `#`-deep-links (§10). | **BUILT (this branch)** |

## 12. Open questions

| # | Question | Lean |
| :-- | :-- | :-- |
| DV-Q1 | Should `yes`/`no` (and `on`/`off`) read boolean? | No — literal `true`/`false` only; locale prose stays prose. Revisit with a real corpus. |
| DV-Q2 | Should views live on the container (shared across sources) instead of per source? | Per source for now; phase 5 adds container-level composed views via queries/joins. |
| DV-Q3 | Schema JSON: script child (current) vs `data-sem-schema` attribute mirror for no-DOM consumers? | Script child; add the attribute mirror only if a consumer asks. |
| DV-Q4 | YAML: adopt a general parser dependency instead of the §7.3 subset? | No — the subset is a few KB; a general parser would crowd the reading budget for syntax this spec excludes anyway. Revisit only if a corpus needs flow maps or anchors. |
| DV-Q5 | Should the query chrome persist an edited query into the hash (phase 6 deep links)? | Yes, in phase 6 — `#dv=<id>&q=<encoded>`; not before. **RESOLVED (phase 6):** built exactly so; the copy-link button writes `q=` only when the edited statement diverges from the authored one. |
