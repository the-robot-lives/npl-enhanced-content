# Schema — `sem-badge`

Contract per conventions.md v0.6. Changes here precede code.

## Scope semantics

A small inline status chip: a glyph plus the authored text, never colour
alone. `variant` is `success` | `warning` | `danger` | `info` | `neutral`
(default `neutral`); an unknown value renders as `neutral`. Light DOM, the
text is the content. Presentation is vocabulary CSS only, so JS-off reads
the same: `✓ success: train 6 live`. Not a record (status chrome, not a
claim); the text is extracted as ordinary prose.

## Authoring form

```html
<sem-badge variant="success">train 6 live</sem-badge>
<sem-badge variant="warning">train 7 blocked</sem-badge>
```

Class-form alias: `span.sem-badge[variant]`.

## Attributes

- `variant`: `success` | `warning` | `danger` | `info` | `neutral` — default `neutral`.

## Fallback

JS-off: the vocabulary CSS draws the pill and glyph from `variant`; the
glyph carries a spoken label (`success: `) so assistive tech does not
rely on colour.
