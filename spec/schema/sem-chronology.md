# Schema — `sem-chronology` / `sem-event`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-chronology.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

An ordered sequence of dated events — a timeline. Each `sem-event` is one
dated assertion: *at `when` (until `until`), this happened*, optionally
carrying a lifecycle `status`. DOM order is chronological order; the
vocabulary does not sort. `view-as` selects the timeline rail or a plain
list and never changes what an event means.

## Authoring form

```html
<sem-chronology kind="release-history" view-as="timeline" role="list">
  <sem-event role="listitem" when="2026-03-02" status="done">
    <time datetime="2026-03-02">2 Mar 2026</time> v0.1 tagged — Lit bundle ships.
  </sem-event>
  <sem-event role="listitem" when="2026-06" until="2026-08" status="current">
    <time datetime="2026-06">Jun–Aug 2026</time> Reading-experience waves.
  </sem-event>
  <sem-event role="listitem" when="2026-Q4">Theme pipeline.</sem-event>
</sem-chronology>
```

Class-form alias (conventions Appendix A): `div.sem-chronology[data-kind][data-view-as]` › `div.sem-event[data-when][data-until][data-status]`.
Parameters are read as `data-<name>` first, then bare `<name>`.

- `when` (recommended): the event's date or period start, as the
  author wants a machine to see it (ISO-8601 preferred, free text allowed).
- `until` (optional): period end.
- `status` (optional): `done | current | todo | blocked` — same
  vocabulary as `sem-step`. Absent means unannotated, **not** `todo`: an
  event is a record of something that happened, not a task.
- Recommended first child `<time datetime>`: the human-readable date.
  When present it is the date the reader sees; when absent the CSS renders
  `when` verbatim as the date label (`:not(:has(time))`).
- `view-as`: `timeline` (default) | `list`. Unknown values render as
  `timeline`.
- `id`, `kind`, `tags`, `audience` per the global catalog. DOM order =
  chronological order; there is no ordinal attribute.

## Rendered form

- **Zero-JS element.** Pure CSS, pattern `sem-procedure`: a vertical rail
  with one marker per event, the date label above the body, status tint on
  the marker (`done` correct-colour, `current` accent, `todo` muted-colour,
  `blocked` wrong-colour, unannotated border-colour).
- `view-as="list"`: no rail; events render as a plain stacked list with the
  date label inline.
- The `<time>` child is the label when present; otherwise `::before`
  renders `when` (`attr()`, either spelling). `until` is appended by CSS when present
  and no `<time>` is authored.
- Neither tier marks the element; nothing is hidden in any tier.

## Events

None.

## A11y contract

- `role="list"` / `role="listitem"` authored in markup (no JS needed).
- `<time datetime>` gives AT and machines the same date the reader sees.
- Status conveyed by marker colour **and** the `status` attribute;
  colour is never the only signal (`::after` glyph as in `sem-step`).

## Machine contract

- Container = one ordered chronology: `fields: {}`, `text: ""`.
- `sem-event` yields `fields: { when, until, ordinal }` plus `status` when
  authored. `when` / `until` are the authored attribute strings (`""` when
  absent); `ordinal` is positional and 1-based among sibling events, exactly
  as `sem-step`. `text` = the event's prose, `<time>` label included.
- `view-as` never changes extraction.
