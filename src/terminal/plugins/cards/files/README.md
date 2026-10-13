# /demos — the render-card demo cards

Framed-card demos for the `render-card` shell command (the semtext-cards
plugin). Mount paths here mirror the landing page's typed session:

    render-card demo/render-demo.card
    render-card demo/render-subsection.card
    render-card demo/render-toc.card

## The .card format

A card is a small YAML header plus a body — one card per file:

    # full-line comments; --- / ... document markers are ignored
    name: render-demo        # the NAME spelled into the top/bottom rules
    title: SemText in one file
    theme: zigzag            # optional; zigzag | double | rounded | ornate | ascii
    width: 64                # optional frame width, clamped to 24..120 columns
    description: |           # literal block; ">" folds to one paragraph
      The body prose, wrapped to the frame.

Rules: `key: value` scalars (optionally quoted), full-line comments only
(a `#` inside a value is data), unknown keys warn and are ignored, and
block scalars are supported for `description` alone. Values are always
text; the parser executes nothing.

## Themes

    render-card --list-themes

| id      | frame                                              |
| ------- | -------------------------------------------------- |
| zigzag  | the sketch: `/\/\` rules with the NAME in both, `\|` columns |
| double  | heavy double-line box, `║` columns                 |
| rounded | light rounded box, `│` columns                     |
| ornate  | `✦`-capped `─✧` rules, `│` columns                 |
| ascii   | 7-bit only: `+` rules, `\|` columns                |

Frames measure in display columns — CJK and emoji bodies never spill past
the border. The title underlines (SGR 4) only when stdout is a terminal;
piped or redirected output stays plain.
