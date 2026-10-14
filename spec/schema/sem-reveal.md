# Schema — `sem-reveal`

Contract per conventions.md v0.6. BDD source of truth for
`test/e2e/sem-reveal.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A Q→A disclosure, `<details>`-backed — the non-assertive counterpart to
the `sem-fact` Q/A shape (a reveal is exposition, not an assertion).
`summary` labels the closed state; when absent the leading body text
(max 60 chars, cut at the last word boundary) derives it, by the one
rule in `src/shared/summary.ts` that render and extraction share.
`collapsed` starts hidden; without it the reveal starts open. The
runtime's fallback handler — this element has no Lit component, like
`sem-views` and `sem-progress` — wraps the element in native
`<details>/<summary>`: click/keyboard toggling is the platform's;
JS-off the content is fully visible (summary as a small-caps heading).

## Authoring form

```html
<sem-reveal summary="Why not localStorage?" collapsed>
  Tokens in localStorage are readable by any script on the page…
</sem-reveal>
```

Class-form alias (conventions Appendix A): `div.sem-reveal[data-summary]`, same `collapsed` attribute.

- `summary`: string — optional label for the closed state. Default:
  the leading body text (max 60 chars, cut at the last word boundary,
  trailing punctuation dropped) acts as summary when absent.
- `collapsed`: boolean attr — starts hidden (the `sem-note[collapsed]`
  convention carries over). Without it the reveal starts **open**.
- `id`, `kind`, `tags` global.

## Rendered form

- The runtime fallback handler (`src/fallback/reveal.ts`) wraps the
  element in a native `<details>`/`<summary>` — summary text from
  `summary` (mirrored to `data-summary` like every bare parameter) or
  the `shared/summary.ts` derivation; `open` preset unless `collapsed`.
  Click/keyboard toggling is then native — no script-maintained state.
- JS-off: **content fully visible**; `summary`, when present,
  renders as a small-caps heading via CSS `::before` (either spelling).
  JS-off + no `summary`: plain prose, nothing hidden.
- `sem-note[collapsed]` vs `sem-reveal[collapsed]`: note = annotation
  tone (variant border); reveal = neutral Q→A disclosure. Same
  mechanism, different semantic — machines distinguish intent.

## Events

None (native `<details>` `toggle` event is the upgrade-time signal).

## A11y contract

- Native `<details>`/`<summary>` once the runtime wraps it — the
  summary is the disclosure control (button semantics, Enter/Space
  toggling, visible focus outline), the expanded state carried by the
  platform; no author-maintained ARIA wiring to drift.
- JS-off: nothing is hidden, so no disclosure hazard.

## Machine contract

- `summary` (or its derived label) = the question; body =
  the answer. Extractable as a Q/A pair, same shape as `sem-fact`
  statement/conclusion but *non-assertive* (a reveal is exposition,
  not an assertion).
