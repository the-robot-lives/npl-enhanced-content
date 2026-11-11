# Schema — `sem-tui`

A subtree wrapper that switches every SemText element below it to the
terminal text view: the same content `semtext format --text` prints,
framed with unicode box-drawing. sem-tui is the render-mode context
provider — it changes how the subtree is PRESENTED, never what it means;
extraction is byte-identical with the wrapper present, in either mode.

Changes here precede spec changes precede code.

## Scope semantics

`sem-tui` is a frame, not a record: it mints nothing and is invisible to
extraction (`record: false`, chrome). Its authored children stay in place
untouched — rich wiring keeps running underneath, and flipping the
presentation back to rich removes one node and one attribute. Elements
inside the subtree render their terminal text UNLESS they carry their own
opt-out: the outermost tui-mode element renders its whole subtree inline
(nested sem-* elements never double-frame), exactly like a terminal does.

The mode of any element resolves independently of the wrapper too:
`render-mode="tui"` (or the boolean `tui` spelling) forces the terminal
view; `render-mode="rich"` forces rich; the nearest enclosing `sem-tui`
decides otherwise; with neither, the element is rich. An element inside a
tui subtree may opt itself out with `render-mode="rich"` — it then shows
its rich presentation inside the frame (rich island in a terminal
document), while its parent's text render still quotes its content.

## Authoring form

```html
<sem-tui id="tui-auth" cols="72" theme="amber" toggle>
  <sem-note variant="tip" id="n-rotate">
    Rotate JWTs per session; keep refresh tokens server-side.
  </sem-note>
  <sem-table id="tbl-auth">…</sem-table>
</sem-tui>
```

- `cols`: `integer` — wrap width for the text renderers, in columns;
  default `80`. Clamped to 20–500.
- `theme`: `string` — one of `dark`, `light`, `amber`, `green`; selects
  the terminal palette (CSS custom properties `--sem-tui-bg`, `--sem-tui-fg`,
  `--sem-tui-accent`, `--sem-tui-dim`); default `dark`. Invalid values
  fall back to the default.
- `toggle` — boolean flag; renders the Rich/Terminal switch in the frame
  header. Without it the subtree is statically terminal.
- `id`, `kind`, `tags` per the global attribute catalog.
- Runtime state: `data-theme` (reflected palette) and `data-mode`
  (`tui` | `rich`, the subtree's current mode) are written by the
  component; authors may write `data-mode` to pin a subtree to rich.

Elements anywhere (not only inside a wrapper) may carry:

- `render-mode`: `string` — one of `tui`, `rich`; forces that element's
  presentation regardless of any enclosing `sem-tui`.
- `tui` — boolean flag spelling of `render-mode="tui"`; `tui="rich"`
  opts back out.

## Rendered form

The wrapper renders as a terminal frame: monospace, palette background,
border and padding, themed by `data-theme`. Each rendered element mounts
`<pre class="sem-tui" part="tui">` as its LAST child with the text view;
the authored children are hidden by the vocabulary CSS while the driver
marker (`data-sem-tui-active`) is present. With JavaScript off the
wrapper is an unknown element: children render as the ordinary rich
document. The toggle (when authored) is a real `<button>` with
`aria-pressed`; flipping it dispatches the bubbling, composed
`sem-render-mode-change` event and the driver re-renders the subtree.

Elements whose content cannot sensibly become text (chat transcripts,
media galleries, upload targets, chrome) render a one-line
`[sem-xyz: summary]` placeholder instead.

## Events

`sem-render-mode-change` — bubbles, composed, no detail; dispatched by
the toggle when the subtree mode flips. Programmatic hosts may listen
for it (the document driver does).

## A11y contract

The text pre is the readable content: screen readers read the terminal
text directly, and the pre carries `aria-label` naming the element it
renders (`sem-note #id — terminal text view`). No `role="img"`: the
rendering is never purely decorative — it IS the content. The toggle is
a real button with `aria-pressed` and an explicit accessible name. The
switch flips instantly (no transition), so `prefers-reduced-motion` is
inert here by construction; the vocabulary CSS still declares an explicit
reduce guard for the toggle. Authored children are `display: none` while
the terminal view is mounted — the same content is available as text, so
nothing is hidden from assistive tech in either mode.

## Machine contract

`record: false`: the wrapper mints nothing and extraction never sees it
or its frame chrome. The terminal text view is generated at runtime
(marker `data-sem-tui-active`, node `pre.sem-tui`) — generated chrome
must not appear in authored source. Extraction of the subtree is
identical in `tui` and `rich` modes (the presentation, not the DOM
content, changes), so §8's invariant holds in both. Contract per
conventions §8.
