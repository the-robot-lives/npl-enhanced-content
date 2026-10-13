# Schema — `sem-details` / `sem-detail` / `highlight`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-details.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

Prose with occludable content. Recall-oriented prose, distinct from
`sem-reveal` (block disclosure) and `sem-views` (perspective switching):
same prose, a different interaction model per view. Each `sem-detail` is
one prose passage; a `<highlight>` child marks a recall target
(`[[cloze]]` sugar maps to `<highlight>`) — `<em>` in plain view,
occluded and revealed per item in the `quiz` view (self-check model).
`view-as` is display-only sugar (`plain` default, `quiz`): the prose is
identical under both.

## Scope decision (recorded)

Three candidate readings existed for `sem-details`; this schema adopts the
**PRD §5 catalog reading — prose passage with occludable content**:

1. **Adopted**: container of `sem-detail` prose passages whose
   `<highlight>` children mark cloze/recall targets;
   `view-as="quiz"` occludes them (the universal `<highlight>` cloze,
   PRD §4 rule 3). The demo prototype (web/demo/index.html) already implements
   this — M3 formalizes it.
2. *Rejected — collapsible detail block*: `sem-reveal` already owns
   Q→A disclosure (`<details>`/`<summary>`); a second collapsible block
   would duplicate its mechanism and BDD.
3. *Rejected — accordion group of reveal-like items*: overlaps
   `sem-reveal` (disclosure semantics) and `sem-views` (mutually-exclusive
   visibility + named switching). An accordion adds a third sibling/
   sibling-hiding mechanism without new semantics.

`sem-details` is therefore **recall-oriented prose**, distinct from
`sem-reveal` (block disclosure) and `sem-views` (perspective switching):
same prose, different interaction model per view.

## Authoring form

```html
<sem-details id="oidc-details" view-as="quiz">
  <sem-detail>
    The OIDC token travels in the
    <highlight>Authorization</highlight> header.
  </sem-detail>
</sem-details>
```

Class-form alias (conventions Appendix A): `div.sem-details[data-view-as]` › `div.sem-detail` › `span.sem-highlight`.

Default authoring (`view-as` omitted — plain reading): the same prose with
the `<highlight>` emphasized and fully legible, nothing occluded:

```html
<sem-details id="oidc-docs">
  <sem-detail>
    The OIDC token travels in the
    <highlight>Authorization</highlight> header.
  </sem-detail>
</sem-details>
```

- `view-as`: `plain` (default) | `quiz`. Display-only sugar — the
  prose is identical; quiz view additionally occludes highlights.
- `sem-detail`: one prose passage; any inline content, `<highlight>`
  marks a recall target. `[[cloze]]` sugar maps to `<highlight>`.
- `highlight` — the recall targets of the passage, zero or more;
  emphasized and fully legible in the `plain` view, occluded and revealed
  per item in the `quiz` view.
- `id` on the container; `kind`, `tags` global. Facts may also carry
  `<highlight>` prompts (schema sem-facts), but occlusion wiring for
  prose lives here.

## Rendered form

- `plain` (default): highlights render emphasized (`:is(highlight, .sem-highlight)` —
  accent-tinted, non-italic-safe inline emphasis). No JS needed, no marker.
- `quiz`: the Lit component (`SemDetails`) replaces each highlight with an
  occluded span (`.sem-occluded`): text masked (background chip, transparent
  color), `role="button"`, `tabindex="0"`, `aria-label="reveal"`.
  Container claims `data-sem-upgraded`; hide/mask rules key off it.
- Reveal: click or Enter/Space on the occluded span → becomes
  `.sem-highlight .sem-revealed` (readable, accent-tinted), loses
  `role`/`tabindex` and the `reveal` label (revealed text is no longer a
  control, so the label must not override its accessible name). Reveals
  are per-item and irreversible (self-check model).

## JS-off behavior

- Both views fully readable: highlights stay visible emphasized. No
  occlusion, no hidden content, no marker.

## Events

None (self-check reveals are local). Sequencing (`sem-details` full:
guided item-by-item recall) is Tier-1.

## A11y contract

- Occluded span is a keyboard-operable button (`role="button"`,
  `tabindex="0"`, `aria-label="reveal"`); Enter/Space reveal; focus is
  preserved on reveal (the span is replaced in place — replaceWith keeps
  focus on the new node when it is the same position; tests assert
  content visibility, not focus).
- JS-off: nothing occluded, so no hidden-content AT hazard.

## Machine contract

- Extractable as `[{container, passage, cloze: [strings]}]` — each
  highlight is a recall target the reader must produce. In quiz context a
  document's highlights + the matching facts form the recall key set;
  `view-as` never changes extraction.
