# Schema — `semext-<name>`

> TEMPLATE — copy to `spec/schema/semext/<name>.md` (one file per
> component; never edit a shared schema file), replace every `<name>`
> placeholder, delete this blockquote and any section the component does
> not use. Mirrors the sem-* prose contracts in `spec/schema/*.md` (e.g.
> `../sem-note.md`): prose is normative — changes here precede spec
> changes precede code, and the file is the BDD source of truth for
> `test/unit/semext-<name>.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/semext/index.ts`.

## Authoring form

```html
<semext-<name> attr="value">body HTML</semext-<name>>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-<name>[data-attr]` — same dual-form contract as the sem-* tier,
`data-<name>` wins when both spellings are present.

- `<attr>`: `<string|number|boolean>` — default `<value>`. `<one bullet
  per parameter, alphabetical>`
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

## Reference attributes

> Keep this section when the element points at an upstream record; the
> quartet matches the schema's `reference` defPreset.

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

> Keep when the element embeds upstream content. The contract: the
> authored inner content IS the record — extraction reads it, never the
> network; JS-off renders exactly what was authored. Attributes match the
> schema's `cachedEmbed` defPreset.

## Refresh contract

- `last-refreshed`: authored stamp of the most recent sync (machine
  format: ISO-8601).
- `semtext:cache` markers: a cache entry names its source and age with
  `data-semtext-cache` metadata in the host document — never a runtime
  fetch. The element itself performs NO fetching; refresh is the
  authoring pipeline's job.

## Live-fetch policy

`semext-*` elements never fetch at render time. A document that wants
live data embeds the fetched result as authored content and stamps it
(see Refresh contract); a runtime fetch would break the §8 extraction
invariant and the file:// offline contract. Elements that genuinely need
a live channel (endpoint/resolve style, see sem-browser) declare it in
their contract and degrade to authored children when the channel is
absent.

## Rendered form

- Enhanced: `<semext-<name>>` itself (Lit `Semext<Name>` — light DOM, no
  shadow root; content stays searchable/copyable; generated chrome uses
  `.semext-<name>-<part>` classes).
- JS-off: the block box from the semext section of
  `themes/_vocabulary.css` (`semext-<name>, .semext-<name> { display:
  block; }`). Nothing hidden, nothing generated — authored text reads as
  plain prose.

## Events

- `semext:<event>`: bubbles + composed; `detail`: `{ <field>: <type>, … }`.
