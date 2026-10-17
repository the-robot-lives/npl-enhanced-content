# Schema — `sem-reveal`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-reveal.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A Q→A disclosure — the non-assertive counterpart to the `sem-fact` Q/A
shape (a reveal is exposition, not an assertion). **The body is hidden
until the reader acts**: the closed state is the default, and the
hidden state must read as an affordance (a labelled control with a
"Reveal" hint over a blurred, clipped body), not as broken rendering.
`summary` labels the closed state; when absent the leading body text
(max 60 chars, cut at the last word boundary) derives it, by the one
rule in `src/shared/summary.ts` that render and extraction share.
`open` opts into starting revealed; `collapsed` is accepted for
back-compat and is a no-op — hidden is the default either way (the
v0.6 default-open behaviour is retired: round-2 feedback found
pre-revealed content defeats the element's purpose).

The tag form has a Lit component (`src/lit/sem-reveal.ts`); the
`div.sem-reveal` class alias keeps the native-`<details>` fallback
handler (`src/fallback/reveal.ts`), closed by default like the tag
form.

## Authoring form

```html
<sem-reveal summary="Why not localStorage?">
  Tokens in localStorage are readable by any script on the page…
</sem-reveal>
```

Class-form alias (conventions Appendix A): `div.sem-reveal[data-summary]`, same attributes.

- `summary`: string — optional label for the closed state. Default:
  the leading body text (max 60 chars, cut at the last word boundary,
  trailing punctuation dropped) acts as summary when absent.
- `open`: boolean attr — starts **revealed** (no control; the body is
  live immediately; the host carries `data-revealed`).
- `collapsed`: boolean attr — accepted, no-op. Hidden is the default.
- `id`, `kind`, `tags` global.

## Rendered form

- Tag form (Lit component, light DOM): the body moves into a
  `.sem-reveal-body` div; the label moves into a `button.sem-reveal-control`
  (`aria-expanded`, `aria-controls`, native focus/Enter/Space) with a
  small-caps "Reveal" hint. While closed the body is `inert` +
  `aria-hidden` and theme CSS blurs and clips it. The reveal is
  one-way (like `sem-details` occlusion): the control is replaced by a
  `div.sem-reveal-head` small-caps heading carrying the label, the
  body joins the accessibility tree, the host is marked
  `data-revealed` (the CSS blur gate).
- Class form (fallback handler): wraps the element in a native
  `<details>`/`<summary>` — summary text from `summary` (mirrored to
  `data-summary` like every bare parameter) or the
  `shared/summary.ts` derivation; **closed unless `open`**. Click and
  keyboard toggling are the platform's; the disclosure is reversible.
- JS-off: **content fully visible**; `summary`, when present,
  renders as a small-caps heading via CSS `::before` (either spelling).
  JS-off + no `summary`: plain prose, nothing hidden.
- `sem-note[collapsed]` vs `sem-reveal`: note = annotation tone
  (variant border); reveal = neutral Q→A disclosure. Machines
  distinguish intent.

## Events

None (the one-way reveal replaces the control; the native `<details>`
`toggle` event remains the upgrade-time signal on the class form).

## A11y contract

- Tag form: the control is a real `<button>` — visible
  `:focus-visible` outline, Enter/Space toggling natively,
  `aria-expanded`/`aria-controls` wired; the hidden body is `inert` +
  `aria-hidden` so assistive tech meets the same wall sighted readers
  do; after the reveal nothing is hidden and no author-maintained ARIA
  state remains to drift.
- Class form: native `<details>`/`<summary>` — the summary is the
  disclosure control, the expanded state carried by the platform.
- JS-off: nothing is hidden, so no disclosure hazard.

## Machine contract

- `summary` (or its derived label) = the question; body =
  the answer. Extractable as a Q/A pair, same shape as `sem-fact`
  statement/conclusion but *non-assertive* (a reveal is exposition,
  not an assertion). Extraction reads `.sem-reveal-body` when the
  runtime moved the content, else the element itself.
