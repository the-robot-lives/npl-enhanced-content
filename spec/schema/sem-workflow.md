# Schema — `sem-workflow`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-workflow.cy.js`. Changes here precede spec changes
precede code.

An ordered workflow whose steps carry operational metadata: what to do,
how to verify it (gate + check), and what to do when the check fails
(`if-no`). The same `sem-step` element sem-procedure uses; the
workflow-context parameters are a per-parent childForm in the machine
schema, so a sem-procedure step's contract is untouched.

Children: one `sem-step` per step, in DOM execution order — ordinals
are positional (CSS counters), never authored.

## Scope semantics

`sem-workflow` is a container of steps with verification affordances
that a plain procedure lacks:

- `gate` — what must be true before the step is done (e.g. `CI green`);
  rendered as a badge.
- `check` — the command/URL that verifies the gate (e.g. `gh run view`).
- `if-no` — what to do when the check fails; JS-on it renders as a
  collapsible branch on the step (the underscore spelling `if_no` is
  accepted by the component; author `if-no`).
- `output` — the step's artifact (path, ticket, tag).

Steps keep the shared `status` catalog (`done`/`current`/`todo`/
`blocked`) and its sugar rules from sem-procedure.md. `kind` and
`duration` are free tokens (`runbook`, `45m` …).

## Authoring form

```html
<sem-workflow kind="release" duration="45m" label="Cut a release">
  <sem-step id="s1" action="Build images" description="sha-tagged via CI"
    gate="CI green" check="gh run view" output="dist/*.tar">push the tag</sem-step>
  <sem-step id="s2" action="Deploy stage" gate="images present"
    check="gh-wait deploy" if-no="fix CI, then re-run the release workflow">merge to stage</sem-step>
</sem-workflow>
```

Class-form alias (conventions Appendix A): `div.sem-workflow[data-kind]` ›
`div.sem-step[data-action]`.

Children: `sem-step` rows (or the Appendix A class form), DOM order =
execution order.

- `duration` — free token (`45m`, `2h` …); whole-workflow estimate.
- `label`, `kind`, `id`, `tags` per the global attribute catalog.
- Per-step parameters (`action` required, plus `description`, `gate`,
  `check`, `if-no`/`if_no`, `output`) are workflow-context only —
  authoring `action` on a procedure step is an unknown-attribute
  warning, and the validator enforces `action` as required under
  `sem-workflow` (schema `childForms`).

## Rendered form

- **JS-off (CSS-only):** an ordered list — ordinals are CSS counters
  scoped to the workflow (so procedure and workflow counters never
  share a sequence); `gate` renders as a `⛨` badge and `check` as a
  `▸` badge via `::after`/`::before` `attr()` chrome — outside the
  record. A gated step's badge takes the status glyph's slot.
- **JS-on (lazy chunk `chunks/sem-workflow.js`):** each step carrying
  `if-no` grows a disclosure control (`.sem-step-branch-toggle`,
  `aria-expanded`/`aria-controls`) and a `.sem-step-branch` section —
  hidden + `inert` until expanded. Generated chrome carries no record
  text beyond the branch's own rendered `if-no` value; extraction of
  the record reads the authored attributes + step text, identical in
  both tiers.

## Events

None (disclosure is local state; no events emitted).

## A11y contract

- Container keeps `role="list"`, steps `role="listitem"` authored in
  markup (JS-off ordering must stay navigable).
- Branch toggles are real `<button>`s with `aria-expanded` +
  `aria-controls`; collapsed branches are `hidden` + `inert`.
- Gate/check badges are `::before`/`::after` chrome; the underlying
  attributes remain the machine-readable source.

## Machine contract

- `$defs.sem-workflow`: record container; children `sem-step`;
  attributes `duration` + `label`.
- `$defs.sem-workflow.childForms["sem-step"]`: `action` required;
  `description`, `gate`, `check`, `if-no`, `if_no`, `output` optional —
  merged over the shared `sem-step` def only when the parent resolves
  to `sem-workflow` (validator child-form branch).
- The lazy manifest maps `sem-workflow` → `chunks/sem-workflow.js`.
