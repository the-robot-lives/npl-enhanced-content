# Schema — `sem-md`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-md.cy.js`. Changes here precede spec changes precede code.

## Scope semantics

A block whose content is authored as **Markdown** and rendered to HTML in
the browser. The element exists for the one kind of content that is
cheaper to write as Markdown than as HTML and that a machine wants back as
Markdown: tables above all, then headings, lists, emphasis, links, code and
quotes. It is not a second authoring format for the vocabulary — a
`sem-fact` is still written as a `sem-fact` — and it never fetches, never
evaluates and never injects markup: the renderer builds DOM nodes from the
parsed text, so anything that looks like HTML inside the Markdown is
rendered as the characters that were typed.

Minting justification (conventions): a field (`source`, the Markdown), an
interaction (rendered / raw toggle, copy) and a degradation behaviour (the
raw Markdown shows as readable preformatted text with JS off).

## Authoring form

```html
<sem-md id="m-lifetimes" label="Token lifetimes" controls="toggle,copy">
  | Token   | Lifetime | Rotates |
  | :------ | -------: | :-----: |
  | access  | 15 min   | no      |
  | refresh | 30 days  | yes     |
</sem-md>
```

Class-form alias (conventions Appendix A): `div.sem-md[data-label][data-view-as][data-controls]` with the same
text child. Parameters are read as `data-<name>` first, then bare `<name>`.

- Content: the element's **text** is the Markdown. Authors indent freely:
  the common leading whitespace of the non-blank lines is stripped and
  leading / trailing blank lines are dropped (**normalised source**). The
  document is still HTML, so `<` and `&` in the Markdown are written
  `&lt;` and `&amp;`; entities decode before parsing.
- `view-as` (optional): `rendered` (default) or `raw` — the initial
  mode. **Mutable presentation**: the toggle rewrites `data-view-as` at
  runtime (the authored bare attribute is left alone) and extraction
  ignores it (spec/extraction.md §5c).
- `label` (optional): a short caption rendered in the chrome.
- `controls` (optional): comma flags from `toggle`, `copy`; default
  both, also when the attribute is present but empty. Unknown flags are
  ignored.
- `id`, `kind`, `tags`, `audience` per the global catalog.

### Markdown dialect

A fixed subset, parsed by `src/md/parse.ts` (no dependency, no HTML
pass-through):

| Block | Syntax |
| :-- | :-- |
| heading | `#` … `######` + space |
| paragraph | consecutive non-blank lines; `  ` (two trailing spaces) or `\` at line end is a hard break |
| thematic break | `---`, `***`, `___` |
| block quote | `> ` prefix, nestable |
| list | `-`, `*`, `+`, `1.`, `1)`; nested by indentation; tight lists unwrap their paragraphs |
| fenced code | ```` ``` ```` or `~~~` with optional info string → `<pre><code class="language-x">` |
| table (GFM) | header row, delimiter row (`:--`, `--:`, `:-:` set alignment), body rows; `\|` escapes a pipe |

| Inline | Syntax |
| :-- | :-- |
| code span | `` `code` ``; the closing backtick run must be exactly as long as the opening one (`` ``a` b`` `` is one span containing a backtick) |
| strong / emphasis | `**` `__` / `*` `_` |
| strikethrough | `~~` |
| link | `[text](url "title")`; destination allowlist below; the title is accepted and dropped |
| autolink | `<https://…>`, `<mailto:…>`, `<tel:…>`, `<ftp:…>` (written `&lt;…&gt;` in the HTML) |
| image | `![alt](src)`; same allowlist |
| escape | `\` before a punctuation character |

Also parsed: **setext headings** (`===` / `---` under a paragraph line →
`h1` / `h2`; a `---` with no paragraph above it is a rule). Precedence: a
GFM table needs a delimiter row that contains a pipe, so a bare `---`
under a line is always a setext underline even when that line has a pipe
(`a | b` / `---` → `h2`), while `a | b` / `-|-` is a table; a `---` after a
list item is not part of the item (it is not indented), so it is a rule. `_` never opens
or closes emphasis inside a word (`snake_case_name`, `foo_bar_baz` stay
text; `*` has no such rule).

**Destination allowlist.** A destination is parsed with the WHATWG URL
parser (`new URL(dest, document.baseURI)`) — which trims leading and
trailing C0 controls and spaces and removes tab / LF / CR anywhere, so
`java&#9;script:` and `javascript:` yield the same protocol — and the
**parsed object's protocol** is checked: admitted when it is `http:`,
`https:`, `mailto:`, `tel:`, `ftp:` or `file:` (a double-clicked document;
a relative path, fragment or `//host` resolves to the document's own
scheme, which is admitted only when it is one of these — a page served
under `blob:` or another scheme does not widen the list). What is written to `href` / `src` is that object's `href`, never
the authored string, so relative destinations render as absolute URLs
resolved against the document (`#id` becomes `<document>#id`). Anything
else (`javascript:`, `data:`, `vbscript:`, any casing, angle-bracket form
included) and any destination the parser rejects renders as the link
text, or the alt text for an image. Percent-encoding is the parser's:
`<my file.html>` becomes `…/my%20file.html`, authored escapes (`%20`,
`%23`, even `%2541`) pass through untouched, a lone surrogate becomes
`%EF%BF%BD`. This is the form static analysis recognises as sanitised
(CodeQL `js/xss-through-dom`): a protocol check on a parsed URL object,
followed by writing that object's `href`. Anchors carry
`rel="noopener noreferrer"`.

**Bounds.** Nesting (quotes, lists, emphasis, link text) is capped at 16
levels; deeper content renders as text. The inline scanner is linear in the
line length for every construct but one: the intraword-`_` rescan (skipping
a closing `_` that is followed by a word character) is bounded but
worst-case quadratic on pathological input such as `_a` repeated ten
thousand times. If rendering throws regardless, the element's source text
is put back and the element is left unenhanced. Implementation note: the
module-level sticky `BACKTICKS` regex is shared by the inline scanner and
the table cell splitter through `lastIndex`, so neither may call the other
while a match is in flight (non-reentrant by design).

**Not parsed** (they render as their literal characters): raw HTML,
reference-style links `[a][b]`, footnotes, task lists, indented code
blocks, HTML entities beyond what the HTML parser already decoded.

The fenced-code info string becomes `class="language-<info>"` on the
`<code>` (characters outside `[\w.+-]` dropped) — the one class the
renderer mints outside the `.sem-md-*` namespace, kept because every
highlighter keys on it.

## Rendered form

### Enhanced (md handler, `src/md/element.ts`; the Lit
component `SemMd` claims `data-sem-upgraded` at connect and runs the
same function after the parse)

- `.sem-md-chrome` is inserted as the element's **first child**: the label
  (`.sem-md-label`, when authored), then the controls in `data-controls`
  order — `button[data-act="toggle"][aria-pressed]` (visible text
  `Markdown`; pressed while the raw view shows) and
  `button[data-act="copy"][aria-label="Copy Markdown"]` — and a
  `.sem-md-status` live region.
- `.sem-md-body` follows: the rendered HTML. Tables are real `<table>`
  elements with `<thead>`, `<th scope="col">` and `<tbody>`; the GFM
  alignment row is honoured per column (`style.textAlign` on every cell).
  Links carry `rel="noopener noreferrer"`.
- `.sem-md-raw` follows: the normalised Markdown inside a `sem-code`
  (`data-lang="markdown"`, `data-controls="copy,wrap"`), built once. Its
  copy / wrap chrome is `sem-code`'s own: the md handler calls the same
  `enhanceCodeElement` the reading handler uses (one bundle, one
  import), so the listing code is never duplicated and the fence gets
  working copy and wrap buttons.
- The authored text nodes are consumed: after enhancement the element
  holds exactly chrome, body and raw fence. The normalised source lives in
  the fence's `<code>`, byte-identical to what the parser saw.
- `data-view-as` is normalised to `rendered` or `raw` on enhancement; the
  toggle flips it and mirrors the state on `aria-pressed`. CSS hides the
  fence in rendered mode and the body in raw mode — both hide rules are
  gated on the tier marker.
- Copy writes the normalised Markdown to the clipboard (Clipboard API,
  falling back to `execCommand('copy')`); the status region announces
  `Copied`. When neither mechanism exists the copy button is not rendered.
- The element carries `data-sem-upgraded` once wired. The md handler
  itself stamps **only the element**, never `<html>` — the bundle as a
  whole stamps `<html>` when its full enhance pass runs
  (`SemText.enhance`).

### JS-off

- The raw Markdown shows as readable preformatted text: the vocabulary CSS
  applies `white-space: pre-wrap` and a monospace face to an element that
  carries no tier marker. Nothing is hidden, nothing is generated; a
  reader sees the table as its pipe-delimited source.
- Print: the rendered body, no chrome, no fence.

## Events

None.

## A11y contract

- The toggle is a real `<button type="button">` with visible text and
  `aria-pressed` reflecting whether the raw view is showing.
- The copy button carries `aria-label="Copy Markdown"`.
- `.sem-md-status` is `role="status"` (`aria-live="polite"`); it is written
  only on copy, so it never spams.
- Rendered tables keep native semantics (`<th scope="col">`, `<caption>`
  never synthesised); rendered headings are real `h1`–`h6` for assistive
  technology, but the `sem-reader` outline **skips** headings inside
  `.sem-md-body`: they are this record's content, not document structure.
- Rendered links are ordinary anchors; no link opens a new window.

## Machine contract

- `fields: { source }`.
  - `source`: the **normalised Markdown** — common indentation stripped,
    leading / trailing blank lines dropped, otherwise verbatim. The
    extractor applies the normalisation on **both** paths (fence and
    element text); it is idempotent, so the contract does not rest on
    the fence staying byte-identical. Third
    recorded exception to the "text is normalised" rule (after
    `sem-progress` and `sem-code`): Markdown is whitespace-sensitive, so
    the record carries what a Markdown consumer can parse.
- `text` = the single-line normalised form of `source` (whitespace runs
  collapsed).
- The annotated-text renderer emits `source` as an indented block under
  the record head, exactly as `sem-code` does.
- `.sem-md-chrome`, `.sem-md-body` and `.sem-md-raw` (the fence and the
  `sem-code` inside it included) are chrome: they mint nothing and
  contribute no text. Extraction reads `source` from the fence when it
  exists and from the element's own text otherwise, applying the same
  normalisation, so a JS-off document and an enhanced one extract
  identically, in either view.
- `data-view-as` is presentation; not extracted.
