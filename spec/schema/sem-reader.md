# Schema — `sem-reader`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-reader.cy.js`. Changes here precede spec changes precede code.

## Scope semantics

Reading chrome for a long document: an outline, a reading-progress bar,
and reader controls (focus mode, type size, colour scheme, print,
audience). Chrome, not content: it mints no record, and a document
without it loses nothing a machine could read.

One per document, a direct child of the root wrapper.

It is one element rather than one per control because every control
shares a host, a persistence policy and an a11y contract, and because
the planned `sem-themes` picker collapses into its `theme` control
(R/W3 — not in this wave).

## Authoring form

```html
<sem-reader controls="outline,progress,focus,type,color,print,audience" outline-depth="3"></sem-reader>
```

Class-form alias (conventions Appendix A): `div.sem-reader[data-controls][data-outline-depth]`. Parameters are read
as `data-<name>` first, then bare `<name>`.

- `controls`: optional. Comma flags, in any order, one of `outline`,
  `progress`, `focus`, `type`, `color`, `print`, `audience` — default
  `outline,progress`; unknown flags, including the theme flag reserved for
  R/W3, are ignored. Controls render in the **canonical order** above, not
  in attribute order.
- `outline-depth`: integer — optional. Deepest heading level in the
  generated outline, `2`–`6`; default `3`. The outline always starts at
  `h2` — `h1` is the document title.
- Child (optional): an authored `<nav aria-label="Contents">`. When
  present it is the outline, **used verbatim** — no ids are assigned, no
  list is generated, nothing inside it is rewritten. This is the JS-off
  table of contents.
- `id`, `kind`, `tags`, `audience` per the global catalog; `audience` on the
  reader itself is honoured by the audience handler like any element.

## Rendered form

### Enhanced (reading handler, `src/reading/reader.ts`; the Lit
component `SemReader` claims `data-sem-upgraded` at connect and runs the
same function after the parse)

- `.sem-reader-chrome` is inserted as the element's first child:
  `role="region"`, `aria-label="Reading controls"`. Inside it, in canonical
  order, only the controls that are enabled:
  - **outline** — `button.sem-reader-toggle[aria-expanded][aria-controls]`
    labelled `Contents`, toggling the outline panel. The panel is the
    authored `<nav>` when one exists, else a generated
    `nav.sem-reader-outline[aria-label="Contents"]` holding a nested `<ol>`
    of anchors to every `h2`…`h<depth>` inside the root wrapper (headings
    inside the reader itself excluded). A heading without an `id` receives
    a runtime id `sem-h-<n>` **unless it mints a record** (`kind` / `tags`
    present — an id on a record would change extraction); such a heading
    is left out of the outline. Headings inside a closed `sem-reveal` or
    an inactive `sem-view` **are included**: an outline link is a plain
    `#id` anchor, and the core deep-link resolver
    (`src/fallback/target.ts`) answers the `hashchange` by opening what
    encloses the heading. Both handlers live in the one bundle, so the
    links always resolve.
    The panel starts closed (`hidden`). While the
    document scrolls, the anchor whose heading is the topmost one in view
    carries `aria-current="location"` (IntersectionObserver over the
    targets in **document order**, whatever order an authored nav lists
    them; one at a time). Activating an outline link closes the panel.
    The outline is generated **once**, when the document has finished
    parsing; a heading injected later does not appear (recorded limit —
    re-run the enhance on a fresh reader, or author the nav).
  - **progress** — `.sem-reader-progress[aria-hidden="true"]` with a
    `.sem-reader-progress-fill` whose width is the fraction of the
    document scrolled, updated on scroll and resize. Purely visual; a
    screen reader has the outline.
  - **focus** — `button[data-act="focus"][aria-pressed]` toggling
    `data-sem-mode="focus"` on `<html>`.
  - **type** — `button[data-act="type-down"]` / `button[data-act="type-up"]`
    stepping `data-sem-type` on `<html>` through `s` → `m` → `l` (absent =
    `m`; the buttons disable at the ends), and `button[data-act="font"]
    [aria-pressed]` toggling `data-sem-font` between `sans` (absent) and
    `serif`.
  - **color** — `select.sem-reader-color[aria-label="Colour scheme"]` with
    `auto` / `light` / `dark`, reflected as `data-color-mode` on `<html>`
    (`auto` removes the attribute). The vocabulary sets `color-scheme` and
    the theme file provides an explicit `[data-color-mode="dark"]` token
    block mirroring its `prefers-color-scheme` block, and its media block
    yields to `[data-color-mode="light"]`.
  - **print** — `button[data-act="print"]` calling `window.print()`.
    `beforeprint` disclosure is the core handler's job (R/W0).
  - **audience** — `select.sem-reader-audience[aria-label="Audience"]`
    listing every profile declared in the document's `sem-audiences` block
    (label, else id) under a leading `Everyone` option, reflecting and
    writing the `sem-audience` hash parameter through `shared/state`. The
    audience handler (`src/fallback/audience.ts`) applies it on
    `hashchange`; the reader never sets `hidden` itself. The control is
    **not rendered** when the document declares no profiles.
- **Persistence.** `focus`, `type`, `font` and `color` are written to
  `localStorage` under `sem-reader:<name>` through `shared/state.writeLocal`
  and re-applied on the next load **before** the chrome renders — but only
  for the controls this reader offers: a document without a `color`
  control keeps its own scheme however the reader of another document
  set theirs. Storage is
  fail-open: a document on `file://` in a browser that refuses storage
  behaves identically for the session and simply forgets. Audience lives
  in the hash (shareable), not in storage.
- The bar's measured height is published as `--sem-reader-offset` on
  `<html>` (ResizeObserver); the vocabulary uses it for `scroll-margin-top`
  on in-document targets and for the `top` of sticky table headers, so
  nothing lands underneath the bar.
- Every listener and observer is recorded; `disposeReaderElement`
  releases them (the component calls it on disconnect). Chrome stays.
- The element carries `data-sem-upgraded` once wired.

### JS-off

- No chrome, no progress bar, no persisted state. An authored
  `<nav aria-label="Contents">` renders as a plain list of links; without
  one the reader is empty and takes no space. Every control's *effect* that
  a reader could want without JS is already available: the browser's own
  zoom, print and colour-scheme preference.

## Events

None. The reader writes document attributes, the hash and storage; nothing
listens for it and it listens for nothing but its own controls, `scroll`,
`resize` and `hashchange`.

## A11y contract

- The chrome is a landmark: `role="region"`, `aria-label="Reading controls"`.
- Every toggle is a real `<button type="button">` with visible text and
  `aria-pressed` (focus, font) or `aria-expanded` + `aria-controls`
  (outline). Selects carry `aria-label`.
- **No global single-key shortcuts.** The reader binds keys only while
  focus is inside it: `Escape` with the outline open closes it and returns
  focus to the toggle.
- The outline is a `<nav aria-label="Contents">` with real anchors, so it
  is reachable from the landmark list and works with the deep-link
  resolver; `aria-current="location"` names the reader's position.
- The progress bar is `aria-hidden` — a moving percentage is noise to a
  screen reader that already has the outline.
- `prefers-reduced-motion` disables smooth scrolling (R/W0) and the
  progress-fill transition.
- Focus mode changes layout only; it never removes content from the
  accessibility tree except page chrome outside the root wrapper.

## Machine contract

- **Mints nothing.** `sem-reader` is in the extraction skip set beside the
  root wrapper (spec/extraction.md §3 rule 7): the element, its authored
  `<nav>`, and all generated chrome are skipped entirely — no record, no
  text.
- The runtime heading ids (`sem-h-<n>`) are assigned only to headings that
  mint no record, so extraction output is unchanged by the outline.
- `data-sem-mode`, `data-sem-type`, `data-sem-font`, `data-color-mode` on
  `<html>` and `aria-current` on outline anchors are session state
  (spec/extraction.md §5b).
- Chrome classes: `sem-reader-chrome`, `sem-reader-outline`,
  `sem-reader-progress`, `sem-reader-progress-fill`, `sem-reader-toggle`,
  `sem-reader-color`, `sem-reader-audience`.
