# Schema — `sem-changelogs` / `sem-changelog`

A changelog collection and its entries. Family A — static
knowledge/doc containers; display stubs (no CSS-only elements: the Lit
components exist and claim `data-sem-upgraded`; everything visible is
vocabulary CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A collection of dated change entries. Each `sem-changelog` is one
entry: `date` (authored stamp, machine format YYYY-MM-DD), `name` and
`title` (global/standard attributes) head the entry; the impacted
surfaces are authored either as a `<tags>` child (comma/space list of
tags) or as an `impacted` attribute listing the same — both spellings
are display-only sugar for the chrome, and the entry prose (authored
inner content) IS the record. `sem-changelog` mints its record inside
the collection (optionsIn: `sem-changelogs`).

## Authoring form

```html
<sem-changelogs id="cl-auth" kind="spec">
  <sem-changelog date="2026-10-18" name="rotation" title="Per-session JWT rotation">
    Rotation landed behind the release train; the refresh grant
    issues a fresh pair.
    <tags>auth, tokens</tags>
  </sem-changelog>
  <sem-changelog date="2026-10-17" impacted="deploy">
    Chart-tag bumps moved fully to CI; agents never touch chart
    tags for release.
  </sem-changelog>
</sem-changelogs>
```

Class-form alias (conventions Appendix A): `div.sem-changelogs` ›
`div.sem-changelog` › `.sem-tags` — same dual-form contract as every
`sem-*` tier.

- `date`: `string` — per entry; the authored stamp (YYYY-MM-DD),
  drawn into the entry heading chrome.
- `name`, `title`: per the global/standard attribute catalog — entry
  heading qualifiers, drawn into the entry chrome.
- `impacted`: per entry — a comma list of impacted tags; alternative
  to the `<tags>` child (both display-only sugar).
- `kind`, `id`, `tags` per the global attribute catalog.

## Rendered form

Enhanced: the collection is a bordered block with a "changelog" label
drawn by CSS `::before`; each entry is a card whose `::before` draws
`<date> · <title>` (falling back to `name`/`kind` when absent) and
whose `<tags>` child renders as a muted chip row. Components render
nothing of their own. JS-off: the identical boxes and labels from the
vocabulary CSS; nothing hidden — the §8 extraction invariant holds in
both tiers.

## Events

None.

## Machine contract

`record: true` on both tags: extraction returns the entries' authored
prose; `date`/`impacted`/`name`/`title` are attributes and the
`<tags>` child is authored text — never generated chrome. Contract per
conventions §8.
