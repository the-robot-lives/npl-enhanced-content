# Schema — `sem-facts` / `sem-fact`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-facts.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A collection of fact/claim pairs. Each `sem-fact` is an assertable
statement/conclusion pair — the atomic citable unit (`id` is the citation
token; `kind`, `tags` global). `view-as` is a **presentation
parameterization, not a semantic change**: the fact *is* a fact under every
view; the view selects the recall interaction (list = read, flashcards =
self-test, quiz = scored recall).

## Authoring form

```html
<sem-facts id="auth-facts" view-as="flashcards">
  <sem-fact id="f-jwt">
    <statement>JWTs rotate per session</statement>
    <conclusion>Short-lived access tokens; the refresh
      grant issues a new pair.</conclusion>
    <incorrect-statement>Store tokens in localStorage.</incorrect-statement>
  </sem-fact>
</sem-facts>
```

Class-form alias (conventions Appendix A): `div.sem-facts[data-view-as]` › `div.sem-fact` › `.sem-statement`,
`.sem-conclusion`, `.sem-incorrect-statement`.

- `view-as`: `list` (default) | `flashcards` | `quiz`. Canonical
  attribute; display-only sugar — machines extract the same pairs
  regardless of view.
- `<statement>` + `<conclusion>`: required per fact.
- `<incorrect-statement>`: optional, quiz view only — explicit wrong candidate.
  Without one, sibling conclusions serve as distractors.
- `id` on the container and on facts: required for citation
  (`#auth-facts/f-jwt`); `kind`, `tags` global.

## View contracts

### `list` (default)

- All facts rendered, statement + conclusion visible, document order.
- **No chrome, no marker** — nothing interactive, so the
  list view keeps the plain layout.

### `flashcards` (deck semantics)

- One card visible at a time (`.sem-current`); first card initially.
- Chrome (`.sem-facts-chrome`) is the container's first child: prev/next
  buttons (`data-act`, `aria-label`) + position meter (`.sem-facts-meter`,
  text form `N/M`). **Meter class is `.sem-facts-meter` — NOT
  `.sem-progress`, which is the sem-progress element (D1).**
- Click a card to flip: front = statement, back = conclusion
  (`.sem-flipped` reveals the conclusion).
- Wrapping navigation (prev from first card → last).

### `quiz` (interaction model)

- Conclusions hidden until revealed by a correct selection.
- Current fact (`.sem-current`) renders `.sem-quiz-options`: shuffled
  buttons, one per candidate — explicit `incorrect-statement` children (up to
  3) + the `conclusion` as correct (`data-correct="true"`).
- One answer per question (`data-answered` on the option box): correct
  pick → `.sem-answered` on the button; wrong pick → `.sem-wrong-pick`;
  the meter reports `N/M · score C/A`.
- Prev/next chrome as in flashcards.

## Rendered form

- The Lit component `SemFacts` implements flashcards/quiz behavior and
  claims `data-sem-upgraded` on the container (hide rules key off it).
- List view (and empty containers) get no chrome.

## JS-off behavior

- All three views degrade to the list layout: every statement AND every
  conclusion visible. No chrome, no occlusion, no hidden content.

## Events

- `sem-navigate {index}`, `sem-flip {face}`,
  `sem-complete {correct,total,ms}` — Tier-1 (future). Not part of this
  contract yet.

## A11y contract

- Chrome buttons carry `aria-label` (`previous`/`next`).
- The position meter is text (`2/3 · score 1/1`) — readable, no ARIA
  meter role (it is not a scalar value).
- JS-off: nothing hidden, so no hidden-content AT hazard. Quiz/flashcard
  hide rules are gated on `data-sem-upgraded`.

## Machine contract

- Extractable as `[{id, statement, conclusion}]` — conclusions are
  verbatim-citable assertions; distractors are non-assertive and never
  extracted as claims.
- `view-as` never changes extraction; it changes presentation only.
