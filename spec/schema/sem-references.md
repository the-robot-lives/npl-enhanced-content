# Schema — `sem-references` / `sem-reference`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-references.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A numbered list of works or notes the prose cites. Each `sem-reference` is
one citable entry with an `id`; **inline citations are plain anchors**
(`<a href="#r1">`) and mint nothing. The element exists because a
reference needs fields a `<li>` cannot carry (`href`, `cite`) and because
backlinks and hover previews are reading affordances that need JS.

## Authoring form

```html
<p>Rotate refresh tokens per use<a href="#r-rfc">[1]</a>.</p>

<sem-references id="refs" kind="bibliography" role="list">
  <sem-reference id="r-rfc" role="listitem"
       href="https://www.rfc-editor.org/rfc/rfc6749" cite="RFC 6749">
    The OAuth 2.0 Authorization Framework, §10.4.
  </sem-reference>
  <sem-reference id="r-note" role="listitem">
    A footnote with no external target.
  </sem-reference>
</sem-references>
```

Class-form alias (conventions Appendix A): `div.sem-references[data-kind]` › `div.sem-reference[id][data-href][data-cite]`.
Parameters are read as `data-<name>` first, then bare `<name>`.

- `kind`: `footnotes` | `bibliography` (free token; these two get
  distinct styling). Optional.
- `sem-reference`: the citable entry; its text is the reference's
  description.
- `id` (optional; on each `sem-reference`): the citation target — the
  global `id`. Absent ⇒ the **AUTO-ID** below. An authored `id` always
  wins and is never overwritten.
- `href` (optional; on each `sem-reference`): external location
  (`data-href` in the class form).
- `cite` (on each `sem-reference`): the locator / short citation label
  (`RFC 6749`, a path, a URL). It is the AUTO-ID source; a `cite` that is
  an `http(s)` URL also gets the external link when no `href` is given.
  `href` is the pre-v0.6 compat alias (cite wins for the auto-id).
- Inline citation: any `<a href="#<reference-id>">` outside the references
  container. Its text is the author's (`[1]`, `¹`, a name) — the vocabulary
  does not renumber authored citation text.

## Auto-id

An id-less `sem-reference` answers to a derived id — a **pure function**
of authored attributes, so machine consumers (extraction, the validator,
the semtext.dev reference) compose the same anchor without running the
document:

```
id      = <block-id> + "-" + referenceSlug(cite || href)
block-id = the parent sem-references id, default "refs"
referenceSlug(s) = lowercase(s), every run of chars outside [a-z0-9] → "-",
                   leading/trailing "-" stripped (URL schemes not special-cased)
```

| cite | block id | derived id |
| --- | --- | --- |
| `RFC 6749` | `refs` | `refs-rfc-6749` |
| `Projects/github-tools/docs/gh-wait.md` | *(none)* | `refs-projects-github-tools-docs-gh-wait-md` |
| `https://www.rfc-editor.org/rfc/rfc6749` | `auth-refs` | `auth-refs-https-www-rfc-editor-org-rfc-rfc6749` |

```html
<p>Rotate refresh tokens per use<a href="#refs-rfc-6749">[1]</a>.</p>
<sem-references id="refs">
  <sem-reference cite="RFC 6749" href="https://www.rfc-editor.org/rfc/rfc6749">
    The OAuth 2.0 Authorization Framework, §10.4.
  </sem-reference>
</sem-references>
```

- Exported as `SemText.referenceSlug(cite)`, `SemText.referenceId(blockId,
  cite)` and `SemText.deriveReferenceId(el)` (`src/shared/reference-id.ts`);
  the validator carries a plain-JS twin pinned by unit test.
- The runtime materializes the id (marked `data-sem-minted-id`); extraction
  reports the same derived id with JS on or off, so the §8 invariant holds.
- JS-off the derived id is absent from the DOM: deep links to it resolve
  only once the bundle runs — author an explicit `id` for no-script anchors.
- Validator: id-less + `cite`/`href` ⇒ `info auto-id`; id-less with neither
  ⇒ `error reference-id`; a derived id colliding with another id ⇒ warning.

## Rendered form

### All tiers (CSS)

- Entries are numbered by CSS counter (`::before`), 1-based in DOM order.
- The `:target` entry is highlighted (deep-linking from a citation works
  with no script).
- `kind="bibliography"` uses a hanging indent; `kind="footnotes"` a
  compact list.

### Enhanced (reading handler, `src/reading/references.ts`; the Lit
component `SemReferences` claims `data-sem-upgraded` at connect and runs
the same function once its `sem-reference` children exist)

- Every citing anchor gets the runtime class `.sem-references-ref` and a
  hover / focus **preview popover** (`src/shared/popover.ts`) showing the
  reference's text; `Esc` closes it; the anchor still navigates on click.
- Every cited reference gets `.sem-references-backlinks` appended: one
  `<a>` per citing anchor, `aria-label="Back to citation N"`, pointing at
  that anchor (which is given an id when it has none).
- A reference with `data-href` gets `.sem-references-link`, an external
  link to it, appended.
- The container carries `data-sem-upgraded` once wired (idempotent per
  anchor and per reference).
- The `SemReference` component (per entry, after the parse): materializes
  the auto-id, stamps `data-ordinal` (1-based position — the theme draws it
  as the footnote number badge in place of the plain counter), sets a
  `title` tooltip from `cite` when none is authored, and emits
  `sem:reference-ready` (`{id, ordinal, minted}`). Authored children are
  never touched.

### JS-off

- Numbered list, `:target` highlight, no backlinks, no popover.
- Print: each reference with an `href` shows `(href)` after its text —
  inside the references block only, never at the citation.

## Events

- `sem:reference-ready` — bubbles, composed, from each element-form
  `sem-reference` once its id/ordinal are set: `detail = {id, ordinal,
  minted}` (`minted` = the id was derived).

## A11y contract

- `role="list"` / `role="listitem"` authored in markup.
- Backlinks carry `aria-label="Back to citation N"`.
- The preview is `role="tooltip"`; while shown, the citing anchor carries
  `aria-describedby` pointing at it; `Esc` dismisses; it opens on focus as
  well as hover, so keyboard users get it too.
- The citation anchor remains an ordinary link: preview never replaces
  navigation.

## Machine contract

- Container: `fields: {}`, `text: ""`.
- `sem-reference` yields `fields: { href, cite, ordinal }` — attribute
  strings (`""` when absent) and the positional 1-based ordinal — with
  `text` = the reference prose.
- `sem-reference` record `id` = the authored id, else the AUTO-ID (§ Auto-id)
  — identical in both tiers.
- `.sem-references-backlinks`, `.sem-references-link` and the popover are
  chrome: skipped entirely. `.sem-references-ref` is a runtime class on an
  authored anchor and is ignored.
- Inline citations mint no record.
