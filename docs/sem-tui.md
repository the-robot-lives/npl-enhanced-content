# sem-tui — the terminal render mode

Every SemText element can present itself two ways: **rich** (the default
vocabulary presentation) and **tui** — a terminal text view built from the
pure renderers in `src/shared/text-render/`, the same content
`semtext format --text` prints, framed with unicode box-drawing. The
presentation changes; the DOM content and extraction never do.

## Quick start

```html
<!-- Whole subtree as a terminal frame, with a Rich/Terminal switch -->
<sem-tui cols="72" theme="amber" toggle>
  <sem-note variant="tip">Rotate JWTs per session.</sem-note>
  <sem-table>…</sem-table>
</sem-tui>

<!-- One element, no wrapper -->
<sem-note render-mode="tui">…</sem-note>
<sem-facts tui>…</sem-facts>

<!-- Rich island inside a terminal frame -->
<sem-tui>
  <sem-note render-mode="rich">stays rich</sem-note>
</sem-tui>
```

## Mode resolution

First match wins:

1. the element's own `render-mode="tui"` / `render-mode="rich"` (boolean
   `tui` is the short spelling of `render-mode="tui"`; `tui="rich"` opts out);
2. the nearest enclosing `<sem-tui>` frame's current mode;
3. `rich`.

The **outermost** tui-mode element renders the text: its whole subtree
goes through the extractor, nested sem-* elements render inline (tree
glyphs, indent), and never mount a second frame.

## What each element renders

- box-drawing frames — `sem-note` (variant in the title), `sem-tldr`,
  `sem-summary`, `sem-code` / `sem-md` (verbatim source), `sem-detail`,
  `sem-mockup`;
- `▸/▾` disclosure carets honoring `collapsed` / `open` — `sem-note
  collapsed`, `sem-reveal` (body shown only when revealed);
- `├─ └─` tree glyphs — nested records inside collections
  (`sem-facts`, `sem-procedure`, `sem-properties`, `sem-chronology`, …)
  and the tree engines (`sem-tree`, `sem-file-tree`, `sem-site-tree`,
  structured or text authoring);
- aligned columns — `sem-table`, property lists;
- meters — `sem-progress` (`[██████░░░░░░] 42%`);
- `[TL;DR]` / `SUMMARY` labels; quiz cards for `sem-question`; workflow
  rows for `sem-workflow`;
- one-line `[sem-xyz: summary]` placeholders where prose makes no sense
  — `sem-chat`, `sem-media-gallery`, `sem-upload-drop`, `sem-browser`,
  `sem-data-visualizer`, `sem-quota-meter`, `sem-artifact-card`,
  `sem-provider-picker`, `sem-review-canvas`, `sem-reader`, `sem-editor`,
  `sem-audiences`;
- transparent pass-through (rendered by their surroundings, never
  framing themselves): `sem-tui` itself, `sem-source`,
  `sem-enhanced-document`, `sem-text`.

A component may answer for itself: if the upgraded instance defines
`renderText()`, the driver uses it verbatim.

## `<sem-tui>` attributes

| attribute | type | default | meaning |
|---|---|---|---|
| `cols` | integer | `80` | wrap width for the text renderers (clamped 20–500) |
| `theme` | `dark\|light\|amber\|green` | `dark` | terminal palette (sets `data-theme`) |
| `toggle` | flag | — | render the Rich/Terminal switch |

Runtime state: `data-mode="tui|rich"` on the wrapper. The switch
dispatches the bubbling, composed `sem-render-mode-change` event; the
document driver re-renders the subtree on it (and on any DOM mutation).

## Styling

The palette rides CSS custom properties on the wrapper — override per
theme in plain CSS:

```css
sem-tui { --sem-tui-bg: #000; --sem-tui-fg: #0f0; --sem-tui-accent: #0ff; --sem-tui-dim: #888; }
```

Each rendered element mounts `<pre class="sem-tui" part="tui">` (last
child) with the text; authored children are hidden by the vocabulary CSS
while `data-sem-tui-active` is present — nothing is moved or destroyed,
so flipping back to rich restores the authored content with its wiring
intact.

## Accessibility

The text pre is the content: screen readers read it directly, with an
`aria-label` naming the element (`sem-note #id — terminal text view`).
No `role="img"` — the rendering is never decorative. The toggle is a
real button with `aria-pressed` and an accessible name; it flips with no
animation, so `prefers-reduced-motion` is inert by construction.

## Programmatic surface (core bundle)

`SemText.resolveRenderMode(el)`, `SemText.mountTui(el, text)`,
`SemText.unmountTui(el)`, `SemText.rescanRenderModes(doc)`,
`SemText.renderElementAsText(el, { cols })` — see
`src/lit/shared/render-mode.ts` (driver) and `src/shared/text-render/`
(pure renderers). Bundle note: the driver ships with the core bundle;
lazy-chunk-only pages get static `<sem-tui>` framing (no toggle) until
the core bundle is present.

## What did NOT change

Extraction (`SemText.extractRecords`) is byte-identical in both modes —
the terminal view is generated chrome. `semtext format --text` output is
unchanged. Demo: `web/demo/sem-tui.html`. Schema contract:
`spec/schema/sem-tui.md`.
