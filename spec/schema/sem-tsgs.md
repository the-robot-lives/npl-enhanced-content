# Schema — `sem-tsgs` / `sem-tsg`

A troubleshooting-guide collection and its entries. Family A — static
knowledge/doc containers; display stubs (no CSS-only elements: the Lit
components exist and claim `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A collection of troubleshooting entries. Each `sem-tsg` is one
symptom→solution entry: the authored children ARE the record — `<name>`
(the entry's short label), `<title>` (the symptom headline),
`<description>` (what the reader observes), `<tags>` (impacted topics)
and `<when>` (the trigger condition), followed by the solution prose.
All children are optional authored structure; the solution prose is the
entry body. `sem-tsg` mints its record inside the collection
(optionsIn: `sem-tsgs`).

## Authoring form

```html
<sem-tsgs id="tsg-deploy" kind="deploys">
  <sem-tsg>
    <name>stale-image</name>
    <title>Pod serves the old image after a green sync</title>
    <description>ArgoCD reports Synced/Healthy but the rollout
    did not change.</description>
    <tags>deploy, argocd</tags>
    <when>right after a release merge</when>
    Confirm the pod image spec per container — Synced/Healthy alone
    can serve a stale image.
  </sem-tsg>
  <sem-tsg>
    <name>port-forward</name>
    <title>Admin MinIO unreachable for terragrunt</title>
    Port-forward 127.0.0.1:9000 before any --all run.
  </sem-tsg>
</sem-tsgs>
```

Class-form alias (conventions Appendix A): `div.sem-tsgs` ›
`div.sem-tsg` (children as `.sem-name`, `.sem-title`, …) — same
dual-form contract as every `sem-*` tier.

- `kind`: `string` — collection qualifier drawn into the label chrome
  (display-only sugar).
- `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: the collection is a bordered block with a "troubleshooting"
label drawn by CSS `::before`; each entry is a card whose `<name>`
child renders as the entry heading, `<when>` gets a "when · " prefix
drawn by CSS `::before` and `<tags>` a muted chip row. Components
render nothing of their own — no shadow roots, no generated chrome.
JS-off: the identical boxes and labels from the vocabulary CSS;
nothing hidden — the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true` on both tags: extraction returns the collection's
authored entries verbatim — the entry children are authored text, not
generated chrome. Contract per conventions §8.
