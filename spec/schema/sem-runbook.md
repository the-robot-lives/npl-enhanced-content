# Schema — `sem-runbook`

An operational runbook container: preconditions, procedure and
references are authored inside with the existing elements; the
container adds chrome + label. Family A — static knowledge/doc
containers; a no-logic display stub (no CSS-only elements: the Lit
component exists and claims `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-a.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-runbook` frames one operational procedure as a runbook: the
preconditions, the ordered steps and the reference links are authored
inside (e.g. prose, `sem-procedure`, `sem-references`). The container
adds the runbook frame and its label; it owns no behavior and no
procedure logic of its own. Machines read the authored inner content
byte-identically with the script on or off.

## Authoring form

```html
<sem-runbook id="rb-rotate" kind="ops" audience="on-call">
  <p><strong>Preconditions:</strong> port-forward to the admin DB.</p>
  <sem-procedure>
    <sem-step>Snapshot the current chart tag.</sem-step>
    <sem-step>Bump and deploy.</sem-step>
  </sem-procedure>
  <sem-references></sem-references>
</sem-runbook>
```

Class-form alias (Appendix A): `<div class="sem-runbook">…</div>` —
same dual-form contract as every `sem-*` element.

- `kind`: `string` — optional qualifier drawn into the label chrome
  (display-only sugar).
- `audience`: `any` — per the global catalog (`sem-audiences`); the
  runbook itself does no audience gating, the document profiles do.
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: a bordered block box with a "runbook" label drawn by CSS
`::before` (`runbook · <kind>` when a kind is present). Authored
children render as-is — no shadow root, no generated chrome. JS-off:
the identical box and label from the vocabulary CSS; nothing hidden —
the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true`: extraction returns the authored inner content. Label
chrome never enters extracted text; `data-sem-upgraded` is present iff
the core bundle loaded. Contract per conventions §8.
