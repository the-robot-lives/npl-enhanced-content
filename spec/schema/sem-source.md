# Schema — `sem-source`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-source.cy.js`. Changes here precede spec changes precede code.

## Scope semantics

A transparent wrapper around ordinary SemText content: the reader can
flip between the section as rendered and its markup as parsed, before
any enhancement. It exists for documents that teach or demonstrate the
vocabulary: the reader sees what a fact deck renders as, then sees exactly
what was written to get it, without a second copy of the markup that could
drift. It is a wrapper, not content: it mints no record, its children
extract exactly as they would without it, and a document without it loses
nothing a machine could read. The verbatim source is the one thing it adds,
and that is a derived view of the children, never a second authoring.

Minting justification (conventions): an interaction (the toggle), a field
(the verbatim markup shown in the fence) and a degradation behaviour (HTML
only, nothing hidden, JS-off).

## Authoring form

```html
<sem-source id="s-facts" label="Authored vs rendered">
  <h2>Facts — flashcards</h2>
  <sem-facts id="s-facts-deck" view-as="flashcards">
    <sem-fact id="s-facts-parse">
      <statement>SemText snapshots the section before enhancement</statement>
      <conclusion>The fence shows the parsed markup, never the file bytes.</conclusion>
    </sem-fact>
  </sem-facts>
</sem-source>
```

Class-form alias (conventions Appendix A): `div.sem-source[data-label][data-view-as]` with the same children.
Parameters are read as `data-<name>` first, then bare `<name>`.

- Children: any SemText content — vocabulary elements, headings, prose.
  `sem-source` must not nest inside another `sem-source` (the inner one's
  markup is part of the outer one's source; the inner toggle is undefined).
- `view-as`: `html` (default) | `source`. The initial mode. Mutable
  presentation: the toggle rewrites `data-view-as` at runtime (the
  authored bare attribute is left alone), and extraction ignores it
  (spec/extraction.md §5c).
- `label` (optional): a short caption rendered in the chrome.
- `id`, `audience` per the global catalog. `kind` / `tags` are **not**
  honoured on the wrapper: a wrapper carrying them would mint a plain
  record under the minting test, and this element is defined to mint
  nothing, so extraction treats `sem-source` as never minting regardless.

## Rendered form

### Enhanced

One script does the work, in two registered passes, because the raw markup
must be captured before any behaviour has touched it and the fence needs
`sem-code`.

**Snapshot pass — registered FIRST (core handler, `src/fallback/source.ts`).**
Before any other handler runs, every `sem-source` receives a
child `<template class="sem-source-raw">` whose content is a DOM clone of
the element's children as they stood at that moment — the section before
chrome, before line spans, before any `hidden`. The snapshot is nodes,
never a string: nothing is serialised and re-parsed, so there is no HTML
sink and no `</script` escaping; the fence text is a serialisation of the
clone (`template.innerHTML` read). It is the parser's serialisation, not
the file's bytes: attribute quoting and order, self-closing forms and
entity spelling follow the DOM, so the fence is "the document as parsed",
never a byte-for-byte copy of the source file. Idempotent: an element that
already has a snapshot is left alone; a wrapper nested in another wrapper
is skipped with a console warning (unsupported), so the outer wrapper owns
the section. Template content is not
part of the document tree, so it is inert, invisible, unreachable by CSS
and `querySelectorAll`, and skipped by extraction. Lit elements claim
`data-sem-upgraded` at parse time (anti-flash gating needs it) and the
fence strips that marker when it renders; every other attribute a Lit
element writes is deferred until the parse has finished
(`SemElement.afterParse`), i.e. after the snapshot, so the fence is the
authored markup. Because the component renders into light DOM, its first
render also drops empty `<!---->` comment markers among the children;
whichever pass takes the snapshot, the Lit wrapper strips empty comment
nodes from the captured clone (recursive; authored comments with text
survive) — runtime artefacts are never what was written. An authored
`<\/script` sequence and a real end tag both round-trip as written,
because nothing is escaped.

**Chrome and fence (reading handler, `src/reading/source.ts`; the Lit
component `SemSource` runs the same function after the snapshot pass).**

- `.sem-source-chrome` is inserted as the element's **first child**:
  `role="group"`, `aria-label="View as"`; an optional `.sem-source-label`
  caption (from `data-label`); then two `button[type="button"]`s in fixed
  order — `button[data-act="html"]` labelled `Rendered` and
  `button[data-act="source"]` labelled `Source` — each with `aria-pressed`
  reflecting the current mode.
- Activating `Source` builds the fence **once**: a `.sem-source-fence`
  appended as the element's last child, holding one class-form
  `div.sem-code[data-lang="html"][data-controls="copy,wrap"]` whose
  `<pre><code>` text is the snapshot with the parse-time
  `data-sem-upgraded` marker removed as an attribute (on a parsed clone,
  never by string replacement),
  the section's common leading indentation removed **outside**
  preformatted ranges (`<pre>`, `<textarea>` content is verbatim), and
  leading/trailing blank lines trimmed. The fence's `sem-code`
  is enhanced by the same `enhanceCodeElement` the reading handler uses, so
  copy and wrap work in it. `textContent` only — the markup is never
  parsed as HTML on the way in.
- Mode is `data-view-as` on the element: `source` shows the fence and
  hides every other child except the chrome; anything else (or absent)
  shows the children and hides the fence. Toggling sets `data-view-as`
  to `source` or `html` and updates both buttons' `aria-pressed`.
- An authored `data-view-as="source"` (either form) builds the fence at
  enhance time and starts in source mode.
- The fence is built at most once; switching back and forth shows and
  hides it. Nothing is persisted. Focus stays on the activated button.
- A deep link or outline link into a wrapper in source mode (the target
  may be the wrapper or any descendant — the resolver walks every
  ancestor) switches it back to rendered first (core handler
  `target.ts`): through the chrome's `Rendered` button when one was
  built, else by setting `data-view-as="html"` directly, so
  the core keeps its reveal contract on its own.
- The element carries `data-sem-upgraded` once wired (claimed by the
  component at connect; the enhance function is idempotent on the
  chrome's presence).

### JS-off

- The children render as HTML, in flow, exactly as if the wrapper were
  absent. No chrome, no fence, no snapshot, nothing hidden — the hide rule
  is gated on the `data-sem-upgraded` marker like every other hide rule
  (conventions §4.4),
  so `data-view-as="source"` authored on a JS-off page still shows the
  rendered content.
- Print: the rendered children, chrome and fence hidden, whatever mode the
  reader was in.

## Events

None.

## A11y contract

- The chrome is a `role="group"` labelled `View as`; the two modes are
  real `<button type="button">`s with visible text and `aria-pressed`, so
  the pair reads as a two-state segmented control.
- The fence inherits `sem-code`'s contract: copy announces through its
  status region; an overflowing `<pre>` is focusable and labelled.
- Switching mode moves nothing off the accessibility tree that the reader
  did not ask to hide, and focus stays on the button that was activated.

## Machine contract

- **Mints nothing, transparent.** `sem-source` is not a record type and
  is exempt from the plain-record minting test; extraction descends into
  its children as if the wrapper were not there, so the record array of a
  document is identical with and without the wrapper, and identical in
  `html` and `source` mode.
- Skipped whole (chrome, never text): `.sem-source-chrome`,
  `.sem-source-fence` (and therefore the `sem-code` inside it — the fence
  is a derived view, not a listing the author wrote), `.sem-source-raw`.
- `data-view-as` on the element is presentation (§5c); `data-sem-upgraded`
  is session state (§5b).
