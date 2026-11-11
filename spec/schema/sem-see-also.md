# Schema — `sem-see-also`

A related-reference affordance: names ONE related target — a section of
this document, a component card, or a file — and renders a link with
three affordances on the shared reading surfaces: hover/focus preview
(the shared popover, the glossary surface), click-to-modal (the shared
modal shell factored out of sem-data-visualizer in 0.9.5), and a
"View all" affordance opening the target in a new tab.

Changes here precede spec changes precede code.

## Scope semantics

One see-also per related target. The authored children are the LABEL —
and, with the script off, the whole record: the target reference as
plain text plus its affordances can't exist, so JS-off shows the authored
label inline and nothing else. With the script on, the label becomes the
link text (originals hidden by the upgraded hide-rule; extraction keeps
reading them). Targets are resolved AT READ TIME against the document;
a dangling target warns and still renders the link shell (the doc may be
a fragment of a larger site).

## Authoring form

```html
<!-- section of this document -->
<sem-see-also reference="section" target="#bands">
  Score-to-grade bands — the table the total maps through.
</sem-see-also>

<!-- component card by manifest tag -->
<sem-see-also reference="component" target="noizu-waitlist"
  preview="tldr">Waitlist intake flow</sem-see-also>

<!-- file, described by the authored text -->
<sem-see-also reference="file" target="src/reading/see-also.ts"
  preview="file">The wiring for this element.</sem-see-also>

<!-- embedded in place instead of link chrome -->
<sem-see-also reference="section" target="#dv-review-store"
  insert-as="inline">Full component inventory</sem-see-also>
```

Class-form alias (Appendix A): `<div class="sem-see-also" …>…</div>`.

Parameters:

- `reference` — token `section | component | file` (default
  `section`). What kind of thing `target` names, and therefore how the
  link resolves: `section` → `getElementById` (leading `#` optional),
  `component` → `sem-component[tag=target]` then id lookup, `file` →
  never resolved in-document; `href` becomes the target path itself.
- `target` — REQUIRED text. The id/`#id`, component tag, or file path.
  Validator cross-checks section/component targets against ids present
  in the same document (id-drift check, warning severity).
- `preview` — token `tldr | file` (default `tldr`). Hover content:
  `tldr` clones the target's `sem-tldr`, else its heading + first
  paragraph (a component card's head); `file` shows the authored label
  text plus the target path.
- `insert-as` — token `link | inline` (default `link`). `inline` embeds
  a CLONE of the target in place (label stays as the heading); skip the
  link chrome entirely.
- `href` — optional explicit URL overriding the resolved one (external
  docs, a path the validator can't check). §8 safety rule applies; the
  View-all affordance and the modal's deep target use it.

## Rendered form

Enhanced (link mode): an inline link (`sem-see-also-link`, labelled by
the authored children) with `aria-haspopup="dialog"`; hover/focus opens
the shared popover; click opens the shared modal shell — a CLONE of the
target (ids/roles stripped via `cloneContent`, interactive descendants
inert), Esc/close returns focus to the link; a small "View all"
(`sem-see-also-view`, `target="_blank" rel="noopener"`) follows the
link. Enhanced (inline mode): a dashed inset box carrying the clone.
JS-off: the authored label as plain flow text — no chrome, no hidden
content.

Deep link: `#ref=<id-of-a-see-also>` (the `src/data/deeplink.ts`
grammar, alongside `#dv=`) opens that see-also's modal once per page
load. The `ref` key rides the same `&`-joined hash as `dv`/`bucket`.

## Events

None emitted. Modal open/close is the shared shell's own state
(`data-sem-ref-open` flag on the modal container); no public events.

## A11y contract

The link is a real anchor with `aria-haspopup="dialog"`; the preview is
WCAG 2.2 SC 1.4.13 (dismissible, hoverable, persistent) via the shared
popover; the modal is `role="dialog"` + `aria-modal` with a focus trap
and focus return (shared shell contract). "View all" is `target="_blank"`
with `rel="noopener"` and visible text. JS-off loses only the
affordances, never the label.

## Machine contract

`record: true` with the target metadata as attributes: extraction
returns the authored label; graders read `reference`/`target` to map a
document's cross-reference graph. Section/component targets MUST resolve
in-document (warning when they don't — same severity tier as unknown
attributes). Contract per conventions §8. BDD source of truth for
`test/e2e/sem-see-also-hover.cy.js`, `sem-see-also-modal.cy.js`,
`sem-see-also-deep-link.cy.js`.
