# Schema  `sem-browser`

Contract per conventions.md v0.6. BDD source of truth for
`test/unit/sem-browser.test.ts`. Changes here precede spec changes
precede code.

## Scope semantics

A chrome-like window that renders a SemText document live. The element
exists because the landing "The Idea" section needs a BROWSER tab that
names its document (an address bar), looks like a window (the shared
window-chrome standard), and still renders the deck as real, hydratable
DOM rather than an isolated frame. It is the window-frame sibling of
`sem-shell` and `sem-code`; all three build their chrome from
`src/shared/window-chrome.ts`.

The adopted document is **data, not code**: scripts and `on*` handlers
are stripped before adoption, and parsing happens in an inert DOMParser
document, so a fetched document cannot execute anything in the reading
page.

## Authoring form

```html
<sem-browser src="/demo/example-deck.sem.html" label="the deck">
  <!-- zero-JS fallback chrome: inert glyphs, address pill, framed deck -->
  <figure class="code-window">
    <div aria-hidden="true">← → ⟳</div>
    <div>demo/example-deck.sem.html</div>
    <iframe src="/demo/example-deck.sem.html" title="the deck" loading="lazy"></iframe>
  </figure>
</sem-browser>
```

Class-form alias (conventions Appendix A): `div.sem-browser[data-src]`
whose children are the fallback content — with no script the div IS the
framed document.

- `src` (optional): VFS path or URL of the SemText document to render.
  With no `src`, the element's authored children are the viewport
  content.
- `label` (optional): tab-label override. Priority: `label`, then the
  document's `<title>`, then the `src` basename, then `untitled`.
- `resolve` (property only, not an attribute): a host-injected
  `(path) => string | null | Promise<string | null>` consulted for
  scheme-less paths (`demo/deck.sem.html`, not `/…` or `https://…`)
  before any fetch. Returning a string adopts it; returning null errors
  without fetching.
- `id`, `kind`, `tags`, `audience` per the global catalog.

## Rendered form

### Enhanced (`src/browser/sem-browser.ts`; `SemBrowser` claims
`data-sem-upgraded` at connect and wires once)

- A `.sem-window` frame is appended as the element's child: a window
  title bar (`.sem-window-titlebar` — decorative favicon dot
  `aria-hidden="true"`, one `.sem-window-tab > .sem-window-tab-title`
  with the tab label as text) and the viewport.
- The viewport is `.sem-window-viewport`: `role="region"`,
  `tabindex="0"`, `aria-label` = "<tab title> — browser viewport".
  Authored children with no `src` move into it, once, idempotently.
- With a `src`, authored children are the zero-JS fallback only: they
  are hidden (`hidden` attribute) once the element wires, and the
  fetched document supersedes them.
- With a `src`, an address bar (`.sem-browser-address`) is inserted
  between title bar and viewport: inert back/forward/reload glyphs
  (`.sem-browser-nav`, `aria-hidden="true"`, spans, not buttons) and the
  declared src as text (`.sem-browser-url`).
- Loading: `aria-busy="true"` on the viewport while the document is in
  flight. The document is fetched through the reading view's `fetch`
  (non-2xx → `HTTP <status>` failure), parsed with `DOMParser`
  (`text/html`; a parser error is a failure), stripped of `<script>`
  elements and `on*` attributes, and its `<body>` children are adopted
  into the viewport. `aria-busy` clears on success.
- After adoption the viewport is offered to the lazy loader as
  `window.SemTextLazy.hydrate(viewport)` when present; under the full
  bundle the adopted elements upgrade on insertion and hydrate is
  redundant. A hydrate failure never breaks the displayed document.
- Failures render one `p[role="alert"].sem-browser-error-line` holding
  the message as **textContent** (never HTML from a failure) inside the
  viewport.
- While loading the viewport also carries the `sem-browser-loading`
  class for styling.

### JS-off

- The authored children are the document: a plain framed page. No
  chrome, no address bar, nothing hidden.
- With the landing fallback markup, the inert glyphs, the address pill
  and the iframe render as authored; the vocabulary CSS draws the host
  frame via `sem-browser:not([data-sem-upgraded])`.
- Print: the fallback renders like any static figure.

## Events

- `sem-browser-load` — `detail: { src, title }`; the document is in the
  viewport. Bubbles, composed.
- `sem-browser-error` — `detail: { src, message }`; resolve, fetch,
  parse or adoption failed. Bubbles, composed.

## A11y contract

- The viewport is a focusable labelled region: keyboard users can reach
  and scroll it; its name is the tab title, so a screen reader announces
  which document is shown.
- The nav glyphs are decorative chrome: `aria-hidden="true"` spans, not
  buttons — there is no session history to navigate.
- Errors are `role="alert"` text, announced when they replace the
  viewport content.
- Tab titles are text (never markup): a hostile title renders as its
  literal characters.

## Machine contract

- `fields: { src, label, title }`.
  - `src`: the attribute string, `""` when absent.
  - `label`: the attribute string, `""` when absent.
  - `title`: the resolved tab title (label, document title, src
    basename, or `untitled`).
- `text` = the viewport's text content: the adopted document's text
  under the full path, the authored children's text under JS-off.
- `.sem-window*` and `.sem-browser*` are chrome and never contribute
  text; error lines are chrome and contribute their message only.
- `hidden` on authored children is presentation state, not content: it
  is set by the element once wired and never exported.
