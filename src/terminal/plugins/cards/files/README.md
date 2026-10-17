# /demo — the render-card demo cards

Framed-card demos for the `render-card` shell command (the semtext-cards
plugin). Mount paths here mirror the landing page's typed session:

    render-card demo/render-demo.card
    render-card demo/render-subsection.card
    render-card demo/render-toc.card
    render-card demo/your-first-card.card

## The .card format

A card is a small YAML header plus a body — one card per file:

    # full-line comments; --- / ... document markers are ignored
    name: render-demo        # the NAME spelled into the top/bottom rules
    title: SemText in one file
    subtitle: read it three ways   # optional; the line under the title
    footer: semtext.dev/docs       # optional; the line above the bottom rule
    theme: zigzag            # optional; see render-card --list-themes
    width: 64                # optional frame width, clamped to 24..120 columns
    description: |           # literal block; ">" folds to one paragraph
      The body prose, wrapped to the frame.
      ## A section           # a "#"-heading line starts a new section
      More prose, under its own heading.

Rules: `key: value` scalars (optionally quoted), full-line comments only
(a `#` inside a value is data — a `#` at the START of a description line
starts a section), unknown keys warn and are ignored, and block scalars
are supported for `description` alone. Values are always text; the parser
executes nothing.

## Themes

    render-card --list-themes    # ids + one-line descriptions
    render-card --themes         # the gallery card drawn in every theme

| id        | frame                                                        |
| --------- | ------------------------------------------------------------ |
| zigzag    | the sketch: `/\/\` rules with the NAME in both, `\|` columns |
| double    | heavy double-line box, `║` columns                           |
| rounded   | light rounded box, `│` columns                               |
| ornate    | `✦`-capped `─✧` rules, `│` columns                           |
| heavy     | solid heavy box, `━` rules, `┃` columns                      |
| blueprint | drafting board: dashed `┄` rules, `│` columns                |
| block     | solid half-block bars, `▌▐` columns                          |
| minimal   | rule-only: two rules and the text between, no side columns   |
| ascii     | 7-bit only: `+` rules, `\|` columns (never coloured)         |

Frames measure in display columns (the screen model's width table) — CJK
and emoji bodies never spill past the border. Colour — the frame accent,
a bold underlined title, an italic subtitle, a dim footer — appears only
when stdout is a terminal; piped or redirected output stays plain. The
accent adapts to the terminal background (`--light` / `--dark` force it,
COLORFGBG decides otherwise, the default is dark).

## Reading modes

    render-card demo/your-first-card.card --plain

`--plain` prints the card as heading + text with no frame glyphs at all —
the form screen readers, find-in-page and copy read cleanly.
