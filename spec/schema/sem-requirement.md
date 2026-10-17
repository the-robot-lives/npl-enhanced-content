# Schema — `sem-requirement`

A requirement statement container. Family A — static knowledge/doc
containers; a no-logic display stub (no CSS-only elements: the Lit
component exists and claims `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-requirement` marks one requirement: the authored inner content IS
the statement. `kind` classifies it (functional vs non-functional vs
constraint), `status` carries its lifecycle token and `priority` its
weight — all display-only sugar for the CSS chrome and for machines
that read the attributes; the statement itself is never re-rendered or
summarized. A stable `id` is the citation token
(`#spec/req-session-rotate`).

## Authoring form

```html
<sem-requirement id="req-session-rotate" kind="functional"
  status="approved" priority="high">
  Access tokens MUST rotate at most 15 minutes after issue.
</sem-requirement>
```

Class-form alias (Appendix A): `<div class="sem-requirement">…</div>` —
same dual-form contract as every `sem-*` element.

- `kind`: one of `functional`, `non-functional`, `constraint` — the
  requirement class, drawn into the label chrome.
- `status`: one of `draft`, `approved`, `implemented` — lifecycle
  token, drawn as a status chip (display-only).
- `priority`: `string` — free token (e.g. `high`); drawn into the
  status chip when present.
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "requirement" label drawn by CSS
`::before` (`requirement · <kind>`) and a status chip drawn by CSS
`::after` (`<status>` / `<status> · <priority>`) — both outside
textContent. Authored children render as-is. JS-off: the identical box,
label and chips from the vocabulary CSS; nothing hidden — the §8
extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored statement; consumers
read `kind`/`status`/`priority` from the attributes, never from
rendered chrome. Contract per conventions §8.
