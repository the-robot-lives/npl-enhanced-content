# Schema — `sem-procedure` / `sem-step`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-procedure.cy.js`. Changes here precede spec changes
precede code.

An ordered, status-annotated procedure.

Children: one `sem-step` per instruction, each carrying a `status`
attribute. A step's `status` is its lifecycle annotation — `done` |
`current` | `todo` default | `blocked`; DOM order is execution order —
no step-number attribute, ordinals are positional and rendered with CSS
counters. Status sugar (`✅/→/❌`) is display-only: `status` is
canonical. Zero-JS element — pure CSS rendering. `kind` is a free token
(`runbook`, `recipe`, `migration` …).

## Scope semantics

An ordered, status-annotated procedure. Each `sem-step` is one
instruction and `status` is its lifecycle annotation (`done` |
`current` | `todo` default | `blocked`); DOM order is execution order —
no step-number attribute, ordinals are positional and rendered with CSS
counters. Status sugar (`✅/→/❌`) is display-only: `status` is
canonical. Zero-JS element — pure CSS rendering. `kind` is a free token
(`runbook`, `recipe`, `migration` …).

## Authoring form

```html
<sem-procedure kind="runbook" role="list">
  <sem-step role="listitem" status="done">provision Infisical path</sem-step>
  <sem-step role="listitem" status="current">port-forward MinIO</sem-step>
  <sem-step role="listitem">run migrations</sem-step>
  <sem-step role="listitem" status="blocked">cut release — waiting on CI</sem-step>
</sem-procedure>
```

Class-form alias (conventions Appendix A): `div.sem-procedure[data-kind]` › `div.sem-step[data-status]`.

- `status`: `done` | `current` | `todo` (default) | `blocked`.
- Status sugar (conventions §3) inside step text — `✅ …` = done,
  `→ …` = current, `❌ …` = blocked — **is sugar only**; `status`
  is canonical. Authors pick one. The fallback handler does NOT parse
  sugar; authors wanting sugar write the attr too.
- `kind` free token (`runbook`, `recipe`, `migration` …).
- `id`, `tags` per global attribute catalog.
- **DOM order = execution order.** No step-number attribute; ordinals
  are positional (CSS counters render them).

## Rendered form

- **Zero-JS element.** Pure CSS: `role="list"` container, each step
  `role="listitem"`, ordinal via CSS counter, status glyph via
  `[status]` / `[data-status]` `::after` (✓ done · → current · ⛔ blocked · ○ todo).
- `status="current"` step gets accent border; `blocked` muted-red.
- Lit milestone may add click-to-toggle status; not yet.

## Events

None.

## A11y contract

- `role="list"` / `role="listitem"` authored in markup (no JS needed).
- Status conveyed by glyph **and** `status` attribute (machine +
  AT via text alternative).

## Machine contract

- Container = one ordered procedure; children in DOM order are steps.
- `status` per step is the lifecycle annotation; a procedure with
  any `blocked` step is itself blocked (derivable, not authored).
