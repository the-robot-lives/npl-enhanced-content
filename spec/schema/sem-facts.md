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
  <sem-fact id="f-rotate">
    <statement>JWTs rotate per session</statement>
    <conclusion>Short-lived access tokens; the refresh
      grant issues a new pair.</conclusion>
    <incorrect-statement>Store tokens in localStorage.</incorrect-statement>
  </sem-fact>
  <sem-fact id="f-expiry">
    <statement>Access tokens expire after 15 minutes</statement>
    <conclusion>The client mints a new pair from the refresh
      grant; the user never re-signs-in mid-session.</conclusion>
    <incorrect-statement>The user must sign in again every 15
      minutes.</incorrect-statement>
  </sem-fact>
  <sem-fact id="f-secret">
    <statement>Client secrets never reach the browser</statement>
    <conclusion>The confidential client holds the secret
      server-side; the browser only ever sees tokens.</conclusion>
    <incorrect-statement>Embed the client secret in the SPA
      bundle.</incorrect-statement>
  </sem-fact>
</sem-facts>
```

Class-form alias (conventions Appendix A): `div.sem-facts[data-view-as]` › `div.sem-fact` › `.sem-statement`,
`.sem-conclusion`, `.incorrect-statement`.

- `view-as`: `list` (default) | `flashcards` | `quiz`. Canonical
  attribute; display-only sugar — machines extract the same pairs
  regardless of view.
- `statement` — required per fact; the claim itself.
- `conclusion` — required per fact; the assertion the statement resolves
  to (the back of the card, the quiz answer).
- `incorrect-statement` — optional, quiz view only; an explicit wrong
  candidate. Without one, sibling conclusions serve as distractors.
- `id` on the container and on facts: required for citation
  (`#auth-facts/f-rotate`); `kind`, `tags` global.

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
  (`.sem-flipped` reveals the conclusion). The current card is focusable
  (`tabindex="0"`) and Enter/Space flip it the same way — the deck is
  operable without a mouse.
- Wrapping navigation (prev from first card → last).

### `quiz` (interaction model)

- Conclusions hidden until revealed by a correct selection.
- Current fact (`.sem-current`) renders `.sem-quiz-options`: shuffled
  buttons, one per candidate — explicit `incorrect-statement` children
  first, sibling conclusions as fillers, up to 3 distractors total, plus
  the `conclusion` as correct (`data-correct="true"`).
- One answer per question (`data-answered` on the option box): correct
  pick → `.sem-answered` on the button; wrong pick → `.sem-wrong-pick`;
  the meter reports `N/M · score C/A`. Once a question is answered,
  styling marks the correct option too — a miss teaches; the authored
  `conclusion` itself stays hidden.
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
- The flashcard deck keeps one stop in the tab order: only the current
  card takes `tabindex="0"`, and it shows a visible focus ring
  (`:focus-visible`). The card carries `aria-expanded` — `"true"` when
  flipped. The unrevealed face is `visibility: hidden` — out of the AT
  reading order until flipped.
- JS-off: nothing hidden, so no hidden-content AT hazard. Quiz/flashcard
  hide rules are gated on `data-sem-upgraded`.

## Machine contract

- Extractable as `[{id, statement, conclusion}]` — conclusions are
  verbatim-citable assertions; distractors are non-assertive and never
  extracted as claims.
- `view-as` never changes extraction; it changes presentation only.
