# Schema — `sem-views` / `sem-view`

`sem-views` holds one subject under named perspectives: a tab bar of
`sem-view` names shows one view at a time; with no script all views
render stacked under their names. Switching is by click, arrow keys or
hash, and never moves or rewrites the content itself.

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-views.cy.js`. Changes here precede spec changes precede
code.

❓ Q3 resolved for v1: **`sem-views`** (not `sem-perspectives`) — shorter,
`name` reads naturally, tab-family semantics are the intent.

## Authoring form

```html
<sem-views id="deploy">
  <sem-view name="Helm" active>content…</sem-view>
  <sem-view name="ArgoCD">content…</sem-view>
</sem-views>
```

Class-form alias (conventions Appendix A): `div.sem-views[id]` › `div.sem-view[data-name][data-active]`.

- `name`: required, unique within the container, human label.
- `active`: boolean marker on the initially-visible view; **if no view
  carries it, the first view is active**. The shown view is tracked at
  runtime in `data-active` (the component mirrors an authored `active`
  there, then moves it on every switch); the authored attribute is never
  rewritten.
- `id`: required **for enhancement, not only for deep links** — the
  handler selects `.sem-views[id]`, so a container without an id never
  upgrades and stays stacked (the JS-off form) even with script running.
  Also the deep-link head (`#deploy/argocd`); `kind`, `tags` global.
- Any content is legal inside a view — including other `sem-*` elements.
- Exactly one view active at a time; two `active` ⇒ the component keeps
  the first, warns.

## Rendered form

- Handler-only element (no custom element; conventions rule 4-2): the
  `sem-views` handler builds the tab bar (`.sem-views-tabs`, `role="tablist"`)
  as the container's first child — one `role="tab"` button per view — and
  stamps the container `role="region"` + `aria-label` when the author has
  not set them. `aria-selected` follows `data-active`.
- Tabs and views are wired: each tab gets an id and `aria-controls`; each
  view gets `role="tabpanel"` + `aria-labelledby` pointing at its tab. A
  view without an authored id receives a generated panel id for the wiring
  only — deep links still record the authored id-or-name, so the canonical
  `#<id>/<name>` form survives.
- Roving tabindex: the active tab is the only tab stop; ArrowLeft/Right
  move activation and focus (wrapping), Home/End jump to first/last. If
  the view being hidden held focus, focus follows to its tab.
- Active view: `display:block`; inactive: `display:none` (gated on the
  handler's `data-sem-upgraded` marker, D12).
- JS-off: **all views render, stacked, each headed by its `name`**
  (readability over interactivity — degradation rule §4).

## Events

- `sem-navigate {id, name, index}` — fired on every active-view change
  (click, keyboard, or hash).

## A11y contract

- The handler, not the author, wires the roles: the container becomes a
  `region` (`aria-label` = authored label, else the id); the generated bar
  carries `tablist` because a tablist must own the tab buttons it creates;
  buttons get `role="tab"` + roving tabindex; views get `role="tabpanel"`
  + `aria-labelledby`. The `tab`/`tabpanel` roles on authored markup in the
  Authoring form are redundant — the handler sets them.
- Authored `active` is the pre-JS state marker; JS-off everything is
  visible so there is no hidden-content AT hazard. Two `active` markers:
  the first wins, warned once, the rest cleared so the upgraded page shows
  exactly one view.
- Switching never moves or rewrites view content: only `data-active`,
  `aria-selected`, tab state and the hash segment change; views keep their
  DOM position, so nothing reflows outside the container.

## Machine contract

- `sem-views` = same subject under named perspectives; each `name`
  is the perspective token. Deep-link form `#<id>/<name>` is canonical
  for citation.
