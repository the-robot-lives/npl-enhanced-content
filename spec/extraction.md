# Schema — extraction (DOM → records → annotated text)

Contract per conventions.md v0.6 §8 ("Machine-readability contract"). BDD
source of truth for `test/e2e/extraction.cy.js`. Reference
implementation: `src/extract/records.ts`. Changes here precede spec changes
precede code.

This is the reference recipe conventions.md §8 has promised since v0.1. It is
normative, not illustrative: the per-element "Machine contract" sections in
`spec/schema/*.md` say *what* each element means; this file says what a
consumer actually receives, in what order, and what it is guaranteed never to
see.

## 1. Scope decision (recorded)

Extraction is defined over the **authored document**, not the rendered one.

Three readings were available:

1. **Adopted — authored projection.** Extraction reads only authored
   semantics. Generated chrome, runtime state classes, and mutable
   presentation attributes are invisible to it. The output is therefore a
   function of the source markup alone.
2. *Rejected — rendered projection.* Extracting what the reader currently
   sees would make the output depend on JS availability, `view-as`, and
   session history. Every downstream contract (citation, audience, recall
   keys) would then be unstable.
3. *Rejected — dual projection.* Shipping both an authored and a rendered
   extractor doubles the contract surface and invites consumers to compare
   two things that are not comparable. If a rendered probe is ever needed it
   will be specified separately and named so no one mistakes it for this.

Consequence, stated plainly: **extraction is not a screen reader.** It is the
machine-facing reading of the file, and the file is the same file whether or
not a browser ran its scripts.

## 2. Record shape

Extraction returns a flat array of records in document order.

```ts
interface SemRecord {
  type: string;                    // 'sem-fact', or a tag name for a minted record
  id: string | null;               // citation token
  kind: string | null;             // data-kind / kind
  tags: string[];                  // data-tags / tags, comma-split, [] when absent
  audience: string | null;         // data-audience / audience, verbatim (§7)
  parent: number | null;           // sourceOrder of the enclosing record
  fields: Record<string, unknown>; // per-type payload (§4)
  text: string;                    // one-line human rendering of this record
  sourceOrder: number;             // 0-based; equals the array index
}
```

- `type` is normalized across authoring forms. `<sem-fact>` (canonical)
  and `div.sem-fact` (the class-form alias, conventions Appendix A) both
  yield `sem-fact`; `<agent>` yields `sem-agent`.
- `parent` carries containment. A fact inside `#auth-facts` cites as
  `#auth-facts/f-jwt`, which the consumer composes from the fact's `id` and
  its parent record's `id`. Containment is a number, not an id, because
  containers are not required to carry one — the flashcards deck in
  `web/demo/index.html` does not.
- `text` is always present and always a single line: whitespace runs are
  collapsed to one space and the result is trimmed. Container records carry
  `text: ""`; their content lives in their children.
- `fields` is the only place a type-specific key may appear. Nothing is
  invented: every key below is populated from something an element actually
  carries.

**Not in the shape, deliberately:** `view`. See §5.

## 3. Emission rules

1. **One record per vocabulary element**, in document order. Twenty-one
   element types mint records: `sem-agent`, `sem-note`, `sem-facts`,
   `sem-fact`, `sem-details`, `sem-detail`, `sem-procedure`, `sem-step`,
   `sem-properties`, `sem-property`, `sem-views`, `sem-view`, `sem-reveal`,
   `sem-progress`, (R/W1) `sem-chronology`, `sem-event`, `sem-code`,
   `sem-references`, `sem-reference`, (R/W2) `sem-table` and (R/W2.2)
   `sem-md`. Inline
   citations and glossary term anchors are plain `<a>` and mint nothing;
   `sem-reader` is chrome and mints nothing (rule 7); `sem-source` is a
   transparent wrapper and mints nothing (rule 8).
2. **Parts are not records.** `.sem-statement`, `.sem-conclusion`,
   `.incorrect-statement`, `.sem-highlight`, `.sem-note-body`, and the
   `.sem-agent-*` children are fields of their owning record, never entries
   of their own.
3. **The root wrapper is scope, not content.** `.sem-enhanced-document`
   delimits extraction and mints nothing. Given a `Document`, extraction
   scopes to the wrapper when present, otherwise to `<body>`. The
   `sem-audiences` / `sem-profile` declaration block is metadata of the same
   standing: it is walked, and it mints nothing.
4. **Generated nodes are invisible.** The following are skipped entirely,
   contributing neither records nor text: `.sem-facts-chrome`,
   `.sem-facts-meter`, `.sem-quiz-options`, `.sem-views-tabs`,
   `.sem-note-summary`, `.sem-progress-track`, `.sem-progress-fill`,
   `.sem-code-chrome`, `.sem-code-status`, `.sem-references-backlinks`,
   `.sem-references-link`, `.sem-popover` (the script's preview
   surface, appended to `<body>`), `.sem-reader-chrome`,
   `.sem-reader-outline`, `.sem-reader-progress`, `.sem-table-chrome`,
   `.sem-table-status`, `.sem-table-filter`, `.sem-source-chrome`,
   `.sem-source-fence` (the derived markup fence, `sem-code` inside it
   included), `.sem-source-raw` (the core's inert `template` snapshot),
   `.sem-md-chrome`, `.sem-md-body` (the rendering — a projection of
   `source`, never content of its own), `.sem-md-raw` (the source fence,
   the `sem-code` inside it included; §4 reads `source` from it on
   purpose), and the
   `<summary>` the reveal component synthesizes inside its `<details>`. An
   authored `<details>`/`<summary>` elsewhere in the document is ordinary
   content and is not skipped.
5. **Extraction never writes.** No attribute is set or removed, no node is
   inserted, moved, or deleted, no event is dispatched. Running extraction
   against a live interactive page leaves that page byte-identical.
6. **Both authoring forms are accepted.** Parameters are read as
   `data-<name>` first (the class-form alias, and the spelling the script
   mirrors bare attributes to at runtime), then as a bare `<name>` attribute
   (the canonical tag form). A document may mix forms; a consumer should
   not have to know which one a document was written in — the same
   document yields the same records either way.
7. **`sem-reader` is chrome.** The element is skipped **entirely** — no
   record, no text, no descent — including an authored
   `<nav aria-label="Contents">` child, which is navigation, not content,
   and the runtime outline, progress bar and controls. The root wrapper
   (rule 3) and the reader are the two authored elements in the skip set.
   The reader assigns runtime ids (`sem-h-<n>`) only to headings that mint
   no record, so the outline cannot change a record's `id`.
8. **`sem-source` is transparent.** The wrapper (spec/schema/sem-source.md)
   mints nothing — it is exempt from the plain-record minting test even
   when it carries `kind` / `tags` — and extraction descends into its
   children as if it were not there, so a document extracts identically
   with and without it and identically in `html` and `source` mode. Its
   chrome, fence and snapshot are skipped whole (rule 4).

## 4. Per-element field mapping

### `sem-agent`

`fields: { name, bio, instructions }` from `.sem-agent-name` / `<name>`,
`.sem-agent-bio` / `<bio>`, `.sem-agent-instructions` / `<instructions>`.
Missing children yield `""`. `text` = `name`.

### `sem-note`

`fields: { variant }` — `data-variant` / `variant`, defaulting to `info` per
`spec/schema/sem-note.md`. `text` = the note body: `.sem-note-body` when
present, otherwise the note's own prose.

`collapsed` is **not** extracted. It is initial disclosure state, and the
component removes the attribute when the reader opens the note (see §5).

### `sem-facts` / `sem-fact`

`sem-facts` is a container: `fields: {}`, `text: ""`, carrying `id`, `kind`,
`tags` for citation and grouping.

`sem-fact` yields
`fields: { statement, conclusion, incorrectStatements: string[], highlights: string[] }`.

- `statement` / `conclusion` from `.sem-statement` / `<statement>` and
  `.sem-conclusion` / `<conclusion>`.
- When neither child is present, the compact form applies: the fact's own
  text is split on the first `::`, left → `statement`, right → `conclusion`.
  With no `::`, the whole text is the `statement` and `conclusion` is `""`.
  Children always win over the compact form (conventions §3).
- `incorrectStatements` are extracted **as distractors and never as claims**, which
  is exactly what `spec/schema/sem-facts.md` requires: they appear in their
  own array, never in `text`, never as a `conclusion`.
- `highlights` are the fact's recall prompts, in either the authored
  (`.sem-highlight`, `<highlight>`) or occluded (`.sem-occluded`) form.
- `text` = `statement :: conclusion` when both exist, otherwise `statement`.

Implicit distractors — the sibling conclusions the quiz view borrows when a
fact has no `<incorrect-statement>` child — are a **rendering** decision and are not
extracted. They are already in the output as other facts' conclusions.

### `sem-details` / `sem-detail`

`sem-details` is a container: `fields: {}`, `text: ""`.

`sem-detail` yields `fields: { highlights: string[] }` and `text` = the
passage prose. This is the `{container, passage, cloze}` shape
`spec/schema/sem-details.md` promises, spelled as `parent`, `text`, and
`highlights`.

A highlight is reported identically whether it is authored
(`span.sem-highlight`), occluded by the quiz view (`span.sem-occluded`), or
revealed (`span.sem-highlight.sem-revealed`). The occlusion is a mask over
text that is still in the DOM; extraction reads through it.

### `sem-procedure` / `sem-step`

`sem-procedure` is a container: `fields: {}`, `text: ""`, typically carrying
`kind` (`runbook`, `recipe`, …).

`sem-step` yields `fields: { status, ordinal }`.

- `status` = `data-status` / `status`, defaulting to `todo`.
- `ordinal` is **positional and 1-based**, counted among sibling steps. There
  is deliberately no ordinal attribute: `spec/schema/sem-procedure.md`
  makes DOM order the execution order, and extraction is where that becomes a
  number a consumer can use.
- Status sugar (`✅`, `→`, `❌`) in step text is display-only and is not
  parsed; the attribute is canonical.

"A procedure with any blocked step is itself blocked" stays derivable, not
extracted — the consumer computes it from the step records.

### `sem-properties` / `sem-property`

`sem-properties` is a container: `fields: {}`, `text: ""`.

`sem-property` yields `fields: { key, value }`; `text` = `key :: value`.

- `key` = `data-key` / `key`; `value` = the property's own text.
- When `data-key` is absent, the compact `term :: value` sugar is parsed.
  `data-key` wins when both are present. **Extraction parses `::` here even
  though the v0.4 handler did not** — conventions §3 declares the sugar
  legal, and a machine reader that dropped the key would silently lose the
  subject of the assertion. The divergence is intentional and one-directional
  (extraction is more permissive than render).
- Duplicate keys within one container are an authoring error. Extraction
  reports both records faithfully and does not deduplicate; diagnosing the
  duplicate is the script's job (console warning) and the linter's.

### `sem-views` / `sem-view`

`sem-views` is a container: `fields: {}`, `text: ""`, carrying the `id` that
deep links cite.

`sem-view` yields `fields: { name, index }`; `text` = the view's own prose.

- `name` = `data-name` / `name`; `index` is 0-based among sibling views.
- Citation form `#<views-id>/<view-name>` is composed from the parent
  record's `id` and this record's `name`.
- `data-active` is **not** extracted. See §5.

### `sem-reveal`

`fields: { summary, summarySource }`; `text` = the reveal body.

- `summary` = `data-summary` / `summary` when authored
  (`summarySource: "authored"`).
- Otherwise it is **derived** (`summarySource: "derived"`) from the body:
  the leading run of the normalized body text, at most 60 characters, cut at
  the last word boundary, with no ellipsis. The derivation is a pure function
  of the body, which is what lets it survive the component's `<details>`
  rewrite unchanged.
- The body is read from `.sem-reveal-body` when the script has wrapped the
  reveal, and from the element itself otherwise. Both yield the same text.
- `collapsed` is not extracted (§5).

**Divergence closed.** The v0.4 handler used to derive its `<summary>` as
the first eight words plus `" …"` while extraction implemented the schema's
60-character rule. Both now call `deriveSummary` in `src/shared/summary.ts`,
so the label a reader sees is the `summary` a machine receives. The
generated `<summary>` is still skipped as chrome — the field is derived from
the body, never read from the DOM.

### `sem-progress`

`fields: { value, rawValue, label }`, plus `status` when `data-status` is
present; `text` = `label :: N%` with `N` the rounded clamped percentage.

- `value` is the clamped number in `[0,1]`; a non-numeric or absent attribute
  clamps to `0`.
- `rawValue` is the **authored attribute string, untouched**.
  `spec/schema/sem-progress.md` is explicit that render clamps while the
  attribute stays as written, so a machine reader must be able to see
  `1.4` and know the author asserted something out of range.
- `text` is **derived from the attributes, never read from the DOM**. The
  The component overwrites the element's text content when it builds the meter,
  so reading `textContent` here would break the §5 invariant outright. This
  is the one record whose text is not a reading of the element's children,
  and the reason is recorded here so no one "fixes" it later.

### `sem-chronology` / `sem-event`

`sem-chronology` is a container: `fields: {}`, `text: ""`.

`sem-event` yields `fields: { when, until, ordinal }` plus `status` only
when authored. `when` / `until` are the attribute strings (`""` when
absent); `ordinal` is positional and 1-based among sibling events, as for
`sem-step`. There is deliberately no default status: an event records
something that happened, not a task. `text` = the event prose including
its `<time>` label. `view-as` (`timeline` | `list`) is not extracted.

### `sem-code`

`fields: { lang, filename, marks: number[], source }`; `text` = the
normalised single-line form of `source`.

- `source` is **verbatim** — the `<code>` (else `<pre>`) text with
  whitespace intact. This is the second recorded exception to the
  normalised-text rule (after `sem-progress`): a listing whose indentation
  was collapsed would be a different program. The script's line
  spans and `<mark>` are read through; `\n` text nodes between them keep
  the text byte-identical, which is what the §5 invariant relies on.
- `marks` is the parsed `data-mark` grammar (`2,4-5` → `[2,4,5]`),
  out-of-range lines dropped; the parser is shared with the renderer.
- `data-wrap` is presentation and is not extracted.

### `sem-md`

`fields: { source }`; `text` = the normalised single-line form of `source`.

- `source` is the **normalised Markdown** — the element's text with the
  common leading indentation of its non-blank lines stripped and leading /
  trailing blank lines dropped (`src/shared/mdsource.ts`, the one rule the
  renderer and the extractor share). Third recorded exception to the
  normalised-text rule: Markdown is whitespace-sensitive, so a consumer
  gets a string it can parse.
- Once enhanced the element's text lives in the raw fence's `<code>`
  (`.sem-md-raw`); the extractor reads it there, and from the element's
  own text when no fence exists, and applies the (idempotent)
  normalisation on **both** paths — so the §5 invariant is enforced by the
  extractor, not by the fence happening to stay byte-identical. The rendered `.sem-md-body` is never read: a rendering is a
  projection of the source, not a second copy of the content.
- `data-view-as` (`rendered` | `raw`) is presentation, rewritten by the
  toggle, and is not extracted (§5c).

### `sem-references` / `sem-reference`

`sem-references` is a container: `fields: {}`, `text: ""`, carrying
`kind` (`footnotes` | `bibliography`).

`sem-reference` yields `fields: { href, cite, ordinal }` — attribute
strings (`""` when absent) and the positional 1-based ordinal — with
`text` = the reference prose. Backlinks, the external link and the
preview are chrome; `.sem-references-ref` on a citing anchor is a runtime
class and is ignored.

### `sem-properties view-as="glossary"`

Unchanged: a glossary property is a `sem-property` record and the block a
`sem-properties` container. `.sem-properties-ref` on term anchors is a
runtime class.

### `sem-table`

`fields: { caption, columns: string[], rows: string[][] }`; `text` = the
caption (`""` when absent).

- `caption` from the authored `<caption>`; `columns` from the `<thead>`
  cells, read *through* the script's `button.sem-table-sort`
  wrapper (a wrapper, not chrome).
- `rows` are the `<tbody>` rows in **authored order**: sorted by the
  `data-sem-source-index` the script stamps once at enhancement,
  DOM order when the stamp is absent (JS-off). A row carrying `hidden`
  (filtered out) is still a row.
- The inner `<table>` mints no plain record even when it carries `kind`
  (`comparison` is a CSS hook there); a `<table kind>` outside a
  `sem-table` mints as before. Nested vocabulary inside a cell still mints
  its own record and is excluded from the cell text, as everywhere.
- `aria-sort`, `data-sem-source-index` and `hidden` are session state.

### `sem-reader`

Mints nothing; see §3 rule 7.

### Minted plain-HTML records

Plain semantic HTML carrying an sem global qualifier is extracted as a record
too: `type` is the lowercased tag name (`figure`, `table`, `blockquote`,
`h1`, …), `fields: {}`, `text` = the element's own prose, with `id`, `kind`,
and `tags` read as usual.

`kind` or `tags` mints. `id` alone does not — ids are ubiquitous anchors, not
semantic claims, and minting on `id` would fill the output with navigation
targets.

This is the **minting test** in operational form: if plain HTML plus the
global attribute catalog already carries the meaning, we do not mint a new
element for it. `<figure kind="diagram">` is a record without
`<sem-figure>` ever existing. A new element earns its place only when it
needs fields, interaction, or degradation behavior that attributes on plain
HTML cannot express.

## 5. The central invariant

> **Extraction output is identical whether or not JS ran, and identical
> regardless of `view-as`.**

Formally, for any document `D`, where `E` is extraction, `R(D)` is `D` after
the script has run, `I(D)` is `D` after any
sequence of user interactions the vocabulary supports, and `V(D, m)` is `D`
with any container's `view-as` set to any legal mode `m`:

```
E(D) = E(R(D)) = E(I(R(D))) = E(V(D, m)) = E(V(R(D), m))
```

Equality is deep equality of the record array, including `sourceOrder`.

This is a testable claim, and `test/e2e/extraction.cy.js` is the test. It
is the executable form of the format's central promise: one file, three
consumers, and the machine consumer does not get a degraded reading of what
the human consumer saw.

Three rules make it hold, and each is a rule about what extraction refuses to
look at.

**(a) Generated chrome is skipped** (§3.4). Everything the script adds is
enumerated and excluded by class.

**(b) Runtime state classes and attributes are ignored.** `.sem-current`,
`.sem-flipped`, `.sem-answered`, `.sem-wrong-pick`, `.sem-revealed`,
`.sem-target` (the transient deep-link marker), `.sem-references-ref`,
`.sem-properties-ref`, `data-sem-upgraded`,
`data-answered`, `data-wrap`, `aria-sort`, `data-sem-source-index`,
`aria-current` on outline links, `data-sem-mode` / `data-sem-type` /
`data-sem-font` / `data-color-mode` and the inline `--sem-reader-offset`
style on `<html>`, the runtime heading ids the reader assigns, `aria-describedby` set by the preview, the
`id` the script assigns to an id-less citing anchor, and the
`hidden` attribute the audience handler sets are session facts, not
document facts. Extraction matches on vocabulary classes only and never
consults visibility.

**Recorded exception — DOM reordering (`sem-table`, R/W2).** Every rule
above is about what extraction refuses to *look at*; this one is about
authored nodes that *move*. Sorting a `sem-table` re-appends `<tbody>`
rows, so `I(R(D))` has a different DOM order from `D`. The invariant
still holds because the script stamps every row
`data-sem-source-index` before its first sort and `buildTable` orders
rows by that stamp, never by position. This is the only element whose
runtime reorders authored content; a second one would need its own
recorded stamp and its own line here. `test/e2e/sem-table.cy.js` and
`extraction-reading.cy.js` assert sort + filter → deep-equal baseline.

**(c) Mutable presentation attributes are excluded from the record.** Three
attributes describe initial *display* state and are rewritten at runtime:

| Attribute | Who mutates it | Why it is excluded |
| :-- | :-- | :-- |
| `data-view-as` | author; the `sem-source` toggle rewrites it (`html` / `source`), the `sem-md` toggle (`rendered` / `raw`) | Presentation parameter by definition (conventions §2: "identity unchanged"). Including it would make `E(V(D, m)) ≠ E(D)` by construction and contradict every schema's "`view-as` never changes extraction". |
| `data-active` | the component normalizes it onto the first view; every tab click moves it | Reports which tab a reader is looking at. Not a property of the document. |
| `collapsed` | the component removes it when the reader expands a note | Initial disclosure state. Not a property of the document. |

The cost is real and worth naming: a consumer cannot learn from extraction
which view an author intended to show first. That is correct. `data-active`
is a *state marker*, not a semantic claim, and it is not durable enough to
carry one — the component overwrites it before the reader touches anything. An
author who needs to mark a semantically primary perspective should say so
with a durable qualifier (`kind`, `tags`) on the view, which extraction does
report. This is a gap in the vocabulary, not a gap in extraction.

## 6. Annotated plain text

The record array renders to annotated plain text for terminal and LLM
pipelines — the deliverable conventions §8 names. The renderer is a pure
function of the records, so it inherits §5 unchanged.

Line form, indented by containment depth:

```
<type>[ (#id kind=… tags=a|b audience=…)][: text]
  <field>: <value>
```

Array-valued fields join with ` | `. Only fields that carry meaning a reader
would lose otherwise are emitted (a fact's incorrect statements, a detail's
highlights, a step's status, a progress element's raw value, a reveal's
summary, a note's variant, an agent's bio and instructions, a view's name,
an event's `when` / `until` / `status`, a code listing's `lang` and
`filename`, a reference's `href` and `cite`, a table's `columns`);
`text` already carries the rest. A `sem-table` additionally emits one
indented line per row, cells joined with ` | `. `sem-code` and `sem-md` are
the two types whose head line carries no `: text`: their `source` follows
as a `source:` line and an indented block (four spaces deeper than the
head), so the listing — or the Markdown — survives the rendering intact.

## 7. The audience qualifier

Declared here in v0.4 as a forward declaration; closed by
`spec/schema/sem-audiences.md`. The rules that were fixed then still hold:

- `audience` is **a field on every record**, populated from
  `data-audience` / `audience` **verbatim** — the spec string (`operator`,
  `reader, operator`, `!operator`), not a parsed structure and not a
  resolved boolean. `null` when absent.
- **Audience never removes a record from canonical extraction.** Filtering by
  audience is a consumer operation performed on the extracted array, never a
  suppression performed during extraction. The handler's `hidden` attribute
  is invisible to extraction (§5b); an extractor that dropped off-audience
  records would produce different output for different readers, which is
  the same failure mode as extracting the rendered document (§1).
- **No inheritance.** A record reports only its own attribute. A fact inside
  an operator-only `sem-facts` carries `audience: null`; a consumer that
  wants the container's audience applied downward has `parent` for it.
  Recording the inherited value would let one attribute rewrite every
  descendant record, which is the instability this section exists to
  prevent.
- **Conflict** (a record whose audience contradicts its container's) is
  therefore not an extraction question: both values are reported, each on
  its own record, and the consumer's filter decides.
- The invariant in §5 holds across profile switches: `E(D)` is the same
  with any profile active, with none, and JS-off.
  `test/e2e/sem-audiences.cy.js` asserts it.

## 8. Worked example

Input:

```html
<sem-enhanced-document>
  <h2 data-kind="section" data-tags="auth, tokens">Token handling</h2>
  <sem-facts id="auth-facts" view-as="quiz">
    <sem-fact id="f-jwt" kind="concept">
      <statement>JWTs rotate per session</statement>
      <conclusion>Short-lived access; refresh issues a new pair.</conclusion>
      <incorrect-statement>Store them in localStorage.</incorrect-statement>
    </sem-fact>
  </sem-facts>
  <sem-progress id="p-cov" value="1.4" label="coverage"></sem-progress>
</sem-enhanced-document>
```

(The class-form alias of the same document — `div.sem-facts[data-view-as]`
› `div.sem-fact` › `.sem-statement` … — yields the identical array below.)

Output:

```json
[
  { "type": "h2", "id": null, "kind": "section", "tags": ["auth", "tokens"],
    "audience": null, "parent": null, "fields": {},
    "text": "Token handling", "sourceOrder": 0 },

  { "type": "sem-facts", "id": "auth-facts", "kind": null, "tags": [],
    "audience": null, "parent": null, "fields": {},
    "text": "", "sourceOrder": 1 },

  { "type": "sem-fact", "id": "f-jwt", "kind": "concept", "tags": [],
    "audience": null, "parent": 1,
    "fields": {
      "statement": "JWTs rotate per session",
      "conclusion": "Short-lived access; refresh issues a new pair.",
      "incorrectStatements": ["Store them in localStorage."],
      "highlights": []
    },
    "text": "JWTs rotate per session :: Short-lived access; refresh issues a new pair.",
    "sourceOrder": 2 },

  { "type": "sem-progress", "id": "p-cov", "kind": null, "tags": [],
    "audience": null, "parent": null,
    "fields": { "value": 1, "rawValue": "1.4", "label": "coverage" },
    "text": "coverage :: 100%", "sourceOrder": 3 }
]
```

Rendered as annotated plain text:

```
h2 (kind=section tags=auth|tokens): Token handling
sem-facts (#auth-facts)
  sem-fact (#f-jwt kind=concept): JWTs rotate per session :: Short-lived access; refresh issues a new pair.
    incorrectStatements: Store them in localStorage.
sem-progress (#p-cov): coverage :: 100%
  rawValue: 1.4
```

Note what did not appear: `view-as="quiz"` (presentation), the
`.sem-quiz-options` the component would build (chrome), and the clamped-vs-raw
distinction collapsing (both `value` and `rawValue` are reported).

## 9. Machine contract

- Extraction is a **total, pure function** from a `Document` or root
  `Element` to `SemRecord[]`. It has no configuration, no I/O, and no
  dependencies.
- The array is ordered; `sourceOrder` is the index and is stable.
- Containment is a tree over `parent`; citation tokens compose from `id`
  along that tree.
- The invariant in §5 is the contract consumers may rely on. Any change that
  weakens it is a breaking change to the format, not to the library.
