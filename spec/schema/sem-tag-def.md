# Schema — `sem-tag-def` / `sem-tag-attr`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-tag-def.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A markup-tag definition: documents one XML/HTML-ish tag's contract
inside a document — the machine-checkable twin of an `elements.json`
entry. The reference docs use it so a vocabulary's contract is authored
once and renders (for readers) and extracts (for machines) from the
same source. The container `sem-tag-def` names the tag (`tag`) and
carries the prose description as its body; each `sem-tag-attr` child is
one attribute row of the documented tag (name, type, required,
default, allowed values, description). The documented tag's CHILD tags
are declared on the container's `children` attribute as a token list —
child tags need no per-child metadata in v1, and a token list is
already the house spelling for list-valued attributes (`tags` global).

Non-assertive and descriptive: a tag definition asserts nothing about
the world (unlike `sem-fact`) — it is reference material, like
`sem-property`, with a table render instead of a key/value grid.

## Authoring form

```html
<sem-tag-def tag="sem-note" name="Note" group="annotation"
             children="sem-note-body sem-note-summary">
  An inline annotation with an optional variant and a collapsible body.
  <sem-tag-attr name="variant" type="string" allowed="tip,warning,danger" default="tip">Display variant.</sem-tag-attr>
  <sem-tag-attr name="collapsed" type="boolean">Starts hidden.</sem-tag-attr>
</sem-tag-def>
```

Class-form alias (conventions Appendix A): `div.sem-tag-def[data-tag][data-name][data-group][data-children]` › `div.sem-tag-attr[data-name][data-type][data-required][data-default][data-allowed]`.

- `tag` (on `sem-tag-def`): required, string — the documented tag's
  name (backtick-free, strict tag shape).
- `name` (optional): string — human display name ("Note") when it
  differs from the tag name.
- `group` (optional): free token — grouping label for reference
  indexes (`annotation`, `layout`, `data` …).
- `children` (optional): comma/space token list — the documented tag's
  child tags.
- The element body is the description (prose).
- `sem-tag-attr`: `name` required; `type` one of `string`, `boolean`,
  `integer`, `number` (optional); `required` boolean attr; `default`
  optional string; `allowed` comma list of values; body = the
  attribute's description.
- `id`, `tags` per the global attribute catalog (conventions.md §2).

## Rendered form

- Lit component (`SemTagDef`, light DOM): renders a labelled card —
  header row `<tag>` + display name + group chip; the description as
  prose; the attributes as a real `<table>` (Name / Type / Required /
  Default / Values / Description) when any `sem-tag-attr` is authored,
  each declared child as a chip row under a "Children" heading. The
  table keeps native table semantics (scope="col" headers) — readable,
  copyable, screen-reader-navigable with zero ARIA repair.
- JS-off: the authored markup reads as a definition — `data-tag`
  renders as a small-caps heading via CSS `attr()`, each
  `sem-tag-attr` renders `name :: description` with its type and
  requiredness from `attr()`. Nothing hidden, nothing lost.
- Class-form documents keep the CSS render (no component claim).

## A11y contract

- The rendered table is a native `<table>` with scoped column
  headers; the card header is a heading-level-free label row (the
  document owns outline levels).
- JS-off: plain prose + attr()-derived labels; no disclosure, nothing
  hidden.

## Machine contract

- `sem-tag-def` extracts as one record: `tag`, `name`, `group`,
  `children` (token array), `description` (body text), `attributes` —
  an ordered array of the `sem-tag-attr` rows (`name`, `type`,
  `required`, `default`, `allowed`, `description`). Same shape as the
  `elements.json` entry for a tag, so a page of tag definitions IS a
  vocabulary index a machine can diff.
