# Schema — `sem-component`

A component-inventory card: one component-registry entry (the
`components/manifest.yaml` vocabulary — tag, name, source, type, status,
labels) as a SemText card the visualizer and graders can read like any
other record. Component inventory was a recorded M1 vocabulary gap: the
evaluator rubric described a component table with no element to carry it.

Changes here precede spec changes precede code.

## Scope semantics

One card per component. The authored children ARE the component's
description — the zero-JS record, byte-identical with the script on or
off. The upgrade PREPENDS a header (tag, name, status) and APPENDS a meta
footer (type, source, labels), both marked `data-sem-chrome`, without
moving authored content (the append-chrome-only rule, conventions §4).
Cards are extraction targets like any `record: true` element: chrome
classes stay outside the extracted value.

## Authoring form

```html
<sem-component id="c-waitlist" tag="noizu-waitlist" name="Waitlist"
  source="src/components/waitlist/noizu-waitlist.ts"
  type="web-component" status="live" labels="form telemetry">
  Lightweight waitlist form: email capture, Infisical-backed
  provisioning, ArgoCD deploy hook.
</sem-component>
```

Class-form alias (Appendix A): `<div class="sem-component" tag="…">…</div>`.

Parameters (all global catalog attributes beyond these need no bullet):

- `tag` — REQUIRED token. The component's registered tag name, verbatim
  from the manifest (`noizu-waitlist`). Doubles as the `sem-see-also`
  `reference="component"` lookup key and lands in
  `data-sem-component-tag` for class-form parity.
- `name` — human name ("Waitlist"). Falls back to `tag` in the header
  when omitted.
- `source` — the component's source path in its repo. Rendered as code
  in the meta footer.
- `type` — free token describing the artifact kind (`web-component`,
  `liveview`, `service`, …). No closed vocabulary: inventories mix
  stacks.
- `status` — token `planned | wip | live | deprecated` (default none:
  unstatused cards render no status chip). The chip colour maps
  status → `--sem-component-status-*` variables; the value itself is
  text, never colour-only.
- `labels` — flaglist of inventory labels (comma- or space-separated
  tokens). Rendered as an unordered list in the meta footer.

`role="article"` + `aria-label` ("<name|tag> component card") are set at
runtime; not authored.

## Rendered form

Enhanced: block card — head row (`sem-component-head`: monospace tag,
bold name, small-caps status chip) over the authored description, meta
row (`sem-component-meta`: type, monospace source, label chips) beneath.
JS-off: the authored description in plain flow; the head/meta chrome is
not rendered — the inventory facts stay on the attributes, which any
extractor reads the same way. Nothing authored is hidden in either tier.

## Events

None emitted. The card is display-only; cross-references to it are
`sem-see-also`'s job.

## A11y contract

`role="article"` names the card for AT; the authored description is
ordinary flow content. Status is conveyed by its text ("live"), the
`data-status` attribute is a styling hook only. Labels are a real list
(`ul[aria-label="Labels"]`).

## Machine contract

`record: true`, `container` preset: extraction returns the authored
description. Attributes are data, not decoration: graders may build the
whole inventory from `tag`/`status`/`labels` alone. Contract per
conventions §8. BDD source of truth for `test/e2e/sem-component.cy.js`
and the component-eval rubric (web-component-evaluator, dimension 3).
