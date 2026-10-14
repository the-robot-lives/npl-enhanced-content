# Schema — `sem-audiences` / `sem-profile` and the `audience` qualifier

Contract per conventions.md v0.6 §2 (global attribute catalog). BDD source
of truth for `test/e2e/sem-audiences.cy.js`. Changes here precede spec
changes precede code and close the forward declaration in
`spec/extraction.md` §7.

Two halves, one contract: a declaration block (`sem-audiences`) names
the profiles a document knows about, and an `audience` qualifier says who
each element is for. The reader picks a profile;
the script hides what is not for them. Nothing is ever removed from the
document, and extraction never looks at the result.

## Authoring form

Declaration block — document metadata, one per document, anywhere inside the
root wrapper (conventionally next to `sem-agent`):

```html
<sem-audiences>
  <sem-profile id="reader" label="Reader"></sem-profile>
  <sem-profile id="operator" label="Operator" implies="reader"></sem-profile>
</sem-audiences>
```

Class-form alias (conventions Appendix A): `div.sem-audiences` › `div.sem-profile[id][data-label][data-implies]`.
Both forms are accepted; parameters are read as `data-<name>` first, then
bare `<name>`.

- `id` (required, document-unique): the profile token that `audience`
  specs and the hash parameter refer to. It is an ordinary element id, so it
  shares the document's id space.
- `label` (optional): human label; the id renders when absent.
- `implies` (optional, comma list): profiles this one satisfies as
  well. `operator implies reader` means an operator sees reader content.
  Closure is transitive; a cycle is an authoring error, warned once and
  broken.

The declaration unit is empty: content authored inside a `sem-profile`
has no effect, and a stray `sem-profile` outside a `sem-audiences` block
is not read.

Qualifier — on any `sem-*` element or plain semantic HTML:

```html
<sem-note audience="operator">Operators only.</sem-note>
<sem-note audience="!operator">Everyone except operators.</sem-note>
<p data-audience="reader, operator">Either profile.</p>
```

(`data-audience` is the alias spelling on a `sem-*` element, and the
required spelling on a standard HTML element — conventions §2.)

Spec grammar (`src/shared/audience.ts` is the reference):

| Spec | Visible when |
| :-- | :-- |
| absent / empty | always |
| `a` | active profile is `a`, or implies `a` |
| `a, b` | either term matches |
| `!a` | active profile is not `a` and does not imply `a` |
| `a, !b` | authoring error; warned; positive terms only |
| unknown token | authoring error; warned; **shown** (fail-open) |

With **no active profile**, a positive spec does not match and a negated
spec does. Content that is "for operators" is therefore hidden until a
reader says they are one; content that is "not for operators" is shown.
Authors who want a default audience declare it (below).

## Active profile

Resolved in this order; first hit wins:

1. hash parameter `sem-audience` (`#…&sem-audience=operator`, composed via
   `src/shared/state.ts` so the sem-views bare segment survives beside it);
2. `audience` / `data-audience` on the root wrapper
   (`sem-enhanced-document`) — the author's default;
3. `data-audience` on `<html>` — the same default, spelled on the document.

The handler (`src/fallback/audience.ts`) reflects the resolved profile
onto `<html data-audience>` and re-resolves on every `hashchange`.
`data-audience` on the wrapper or on `<html>` is a **default marker,
never a restriction** — neither element is hidden by it.

## Rendered form

- Handler (`src/fallback/audience.ts`): every element carrying
  `data-audience` / `audience` gets the `hidden` attribute when its spec does
  not match, and loses it when it does. Native `hidden` — no class, no
  inline style — so AT sees ordinary hidden content and no vocabulary rule
  is needed for standard HTML. Custom element forms default to
  `display: inline` and the vocabulary's block rule can override the UA
  `[hidden]` rule, so `themes/_vocabulary.css` carries one global
  `[hidden] { display: none !important; }` guard covering both spellings
  in any scope (full document, host-embedded pane). The handler also reads
  a pane-scoped call from the pane's own `sem-audiences` block when it
  declares one, falling back to the document's when it declares none —
  two panes carrying the same profile ids must not double-count. The
  profile block itself renders as a muted metadata strip, one chip per
  profile.
- Lit: `SemElement.audienceMatches()` reads the same attributes and the
  same `<html data-audience>` and returns the same answer. An element that
  renders audience-dependent chrome asks it; the handler's `hidden` is
  the authoritative hide.
- JS-off: **everything is visible.** The qualifier is invisible to CSS by
  design — a document is a readable artifact first. A printed page shows
  what the screen showed.

The chips are the strip's entire render: a chip carries the profile's
`label` when present, else its `id`. An `implies` edge is closure
metadata — it widens what a profile sees and adds nothing to the strip.

## Events

None. State lives in the hash so a link carries it.

## A11y contract

- Hidden content uses the native `hidden` attribute, so it is removed from
  the accessibility tree while hidden and returns intact.
- The profile block carries no role; it is metadata, like `sem-agent`.
- No live region announces a switch — the switch is the reader's own
  navigation.

## Machine contract (extraction.md §7 closed)

- Every record carries `audience`: the element's own `data-audience` /
  `audience` string **verbatim**, `null` when absent. Spec syntax is not
  parsed into the record; the consumer that filters parses it.
- **Never suppressed.** Extraction reads the `hidden` element exactly as it
  reads a visible one. Filtering is a consumer operation over the array.
- **No inheritance.** A record's `audience` is its own attribute only. A
  fact inside an operator-only `sem-facts` reports `audience: null`;
  containment is available through `parent` for a consumer who wants to
  apply the container's audience downward. Recording the inherited value
  would make one attribute change rewrite every descendant record, which is
  the kind of instability §7 was declared to prevent.
- `sem-audiences` and `sem-profile` mint **no records**. They are
  declarations, not content; a consumer that needs the profile list reads
  the block directly.
- The central invariant holds across profile switches: `E(D)` is identical
  with any profile active, with none, and JS-off.
