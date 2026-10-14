# Schema — `npl-<name>`

> TEMPLATE — copy to `spec/schema/npl/<name>.md` (one file per component;
> never edit a shared schema file), replace every `<name>` placeholder,
> delete this blockquote and any section the component does not use.
> Mirrors the sem-* prose contracts in `spec/schema/*.md` (e.g.
> `../sem-note.md`): prose is normative — changes here precede spec
> changes precede code, and the file is the BDD source of truth for
> `test/unit/npl-<name>.test.ts`.

Contract per conventions.md v0.6 and the namespace recipe in
`src/lit/npl/index.ts`.

## Authoring form

```html
<npl-<name> attr="value">body HTML</npl-<name>>
```

Class-form alias (conventions Appendix A, npl namespace):
`.npl-<name>[data-attr]` — same dual-form contract as the sem-* tier,
`data-<name>` wins when both spellings are present.

- `<attr>`: `<string|number|boolean>` — default `<value>`. `<one bullet
  per parameter, alphabetical>`
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Rendered form

- Enhanced: `<npl-<name>>` itself (Lit `Npl<Name>` — light DOM, no shadow
  root; content stays searchable/copyable; generated chrome uses
  `.npl-<name>-<part>` classes).
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-<name>, .npl-<name> { display: block; }`). Nothing hidden,
  nothing generated — authored text reads as plain prose.

## Events

- `npl-<event>`: bubbles + composed; `detail`: `{ <field>: <type>, … }`.
