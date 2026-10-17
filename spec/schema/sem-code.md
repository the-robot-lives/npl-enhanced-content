# Schema — `sem-code`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-code.cy.js`. Changes here precede spec changes precede code.

## Scope semantics

A source listing with provenance: a filename, a language, emphasised
lines a machine can read back, and copy / wrap controls plain
`<pre><code>` cannot carry. The listing itself is **verbatim**:
whitespace is content, never normalised.

## Authoring form

The listing is authored **flat**: as the element's own text, with no
`<pre>` child. The element wraps it in `<pre><code>` itself when it
enhances, so authors never nest the pair by hand.

```html
<sem-code id="c-rotate" lang="ts" filename="src/rotate.ts" mark="2,4-5" controls="copy,wrap">export function rotate(pair: Pair): Pair {
  const next = mint();
  retire(pair.refresh);
  return next;
}</sem-code>
```

The explicit form — one `<pre>` wrapping one `<code>` — is equivalent and
still supported (a `<pre>` child is never rewritten; the flat form is
adopted only when no `<pre>` is authored):

```html
<sem-code lang="sh"><pre><code>npm run build</code></pre></sem-code>
```

One leading newline directly after the open tag, and the trailing
whitespace before the close tag, are authoring layout and are stripped
from the listing; interior whitespace stays byte-identical.

Class-form alias (conventions Appendix A): `div.sem-code[data-lang][data-filename][data-mark][data-wrap][data-controls]`
with the listing as its own text or as the same `<pre><code>` child.
Parameters are read as `data-<name>` first, then bare `<name>`.

Every attribute is optional: the authoring forms below are all the same
element, chosen to suit the listing.

```html
<!-- smallest valid listing: default controls (copy only), no chrome labels -->
<sem-code>npm run build</sem-code>

<!-- the defaults soften for a listing wider than the pane -->
<sem-code lang="sh">curl -sS … | jq -r '.access_token'</sem-code>

<!-- start soft-wrapped; the Wrap control renders pressed -->
<sem-code lang="json" filename="config.json" wrap controls="copy,wrap">{ "retry": { "attempts": 5 } }</sem-code>
```

- Child: the listing — authored flat (the element's own text) or as
  **at most one `<pre>`**, conventionally wrapping one `<code>`. Flat
  text with no `<pre>` is adopted into `<pre><code>` at enhance time; a
  host that already has a `<pre>` child is left as authored. A `<code>`
  that already holds element children (author-side highlighting) is left
  as authored — no line spans or `<mark>` are generated over it. More
  than one `<pre>` child is an error (schema `childRules`).
- `lang` (optional): language token, rendered as a badge.
- `filename` (optional): provenance label.
- `mark` (optional): emphasised lines, 1-based, comma list of numbers
  and `a-b` ranges (`2,4-5`). Out-of-range entries are ignored.
- `wrap` (boolean, optional): start with soft-wrapped lines.
- `controls` (optional): comma flags from `copy`, `wrap`; default
  `copy`. Unknown flags are ignored.
- `id`, `kind`, `tags`, `audience` per the global catalog.

## Rendered form

### Enhanced (reading handler, `src/reading/code.ts`; the Lit
component `SemCode` claims `data-sem-upgraded` at connect and runs the
same function once its children are parsed)

- `.sem-code-chrome` is inserted as the element's **first child**: filename
  (`.sem-code-filename`), language badge (`.sem-code-lang`), then the
  control buttons in `controls` order — `button[data-act="copy"]` and
  `button[data-act="wrap"][aria-pressed]` — and a `.sem-code-status` live
  region.
- Lines are wrapped: every line of the listing becomes
  `span.sem-code-line`; a marked line becomes `mark.sem-code-line`. Line
  wrapping keeps the `<code>` text **byte-identical** (`\n` text nodes
  between spans) so the listing reads back unchanged. A `<code>` that
  already contains element children (author-side highlighting) is left as
  authored and only the chrome is added.
- Copy writes the listing to the clipboard (Clipboard API, falling back to
  `execCommand('copy')` on a selection); the status region announces
  `Copied`. When neither mechanism exists the copy button is not rendered.
- Wrap toggles `data-wrap` on the element; the button reflects it through
  `aria-pressed`.
- The `<pre>` receives `tabindex="0"` when it overflows horizontally, so a
  keyboard reader can scroll it.
- The element carries `data-sem-upgraded` once wired (the enhance
  function is idempotent — chrome already present means nothing is added
  twice).

### JS-off

- Plain `<pre>`; the filename renders as a caption through
  `::before { content: attr(filename) }` (either spelling); the language badge likewise.
- No chrome, no line marks (they are runtime spans), nothing hidden.
- Print: `white-space: pre-wrap` so long lines do not clip.

## Events

None.

## A11y contract

- Control buttons are real `<button type="button">` elements with visible
  text labels; the wrap toggle carries `aria-pressed`.
- `.sem-code-status` is `role="status"` (`aria-live="polite"`), so a copy
  is announced without moving focus.
- An overflowing `<pre>` is focusable (`tabindex="0"`) and labelled with
  the filename (or `code`) via `aria-label`, so keyboard users can reach
  and scroll it.
- Marked lines use `<mark>` — an announced, semantic emphasis, not colour
  alone.

## Machine contract

- `fields: { lang, filename, marks: number[], source }`.
  - `lang` / `filename`: attribute strings, `""` when absent.
  - `marks`: the parsed, expanded, ascending line numbers.
  - `source`: the listing **verbatim** — the `<code>` text content with
    its whitespace intact; in the flat form, the element's own text minus
    the two structural trims (the same bytes the element wraps into
    `<pre><code>`). This is a recorded exception to the "text is
    normalised" rule (like `sem-progress`'s derived text): a listing whose
    indentation was collapsed would be a different program.
- `text` = the normalised single-line form of the source (whitespace runs
  collapsed), so consumers that only read `text` still get the content.
- The annotated-text renderer emits `source` as an indented block under
  the record head instead of repeating the normalised text.
- `.sem-code-chrome`, `.sem-code-status` are chrome and never contribute
  text; `.sem-code-line` spans and `<mark>` are read through.
- `data-wrap` is presentation; not extracted.
