# arch/vocabulary — element vocabulary model

SemText v0.5 is a vocabulary of XHTML custom elements (`<sem-note>`,
`<sem-facts>`, `<sem-step>`, … — 16 per-element schemas under `spec/schema/`).
**Tag form is canonical**; the v0.4 class-on-plain-element spelling is
retained as a compatibility alias (conventions.md Appendix A). Documents may
mix both forms.

## Tier gating and the marker contract

Every tier must be able to address the same element, and the styling layers
must know *which tier currently owns an element*. Two mechanisms do this
(`themes/_vocabulary.css`):

- **Dual spelling selectors** — every rule targets `:is(sem-x, .sem-x)`, so
  tag-form and class-form documents get identical treatment.
- **Runtime marker** — scripts stamp `data-sem-upgraded` on every element they
  wire (vanilla handlers and Lit components alike; `data-sem-fallback` is
  retired as of 0.9.0). Hide rules that would otherwise leave JS-off pages
  empty are gated on `:not([data-sem-upgraded])`, so they render only when
  no script has run.

The JS-off tier stays text-only by construction: pseudo-element content is
plain `attr()` only (the fallback-argument `attr()` form is not yet
universal) — e.g. `sem-progress` renders `label :: value` from its
attributes, never a fake bar (see the progress rules around
`_vocabulary.css:330`, gated in PR #37).

## Degradation ladder

1. **JS-off** — theme + `_vocabulary.css` only: accent borders, attribute
   labels, presentable, no layout shift when a later tier activates.
2. **Vanilla core** — the handlers in `src/vanilla/` claim elements
   (`data-sem-upgraded`), full baseline interactivity, zero Lit.
3. **Reading** — `SemTextReading` adds prose chrome; chrome mints nothing
   (extraction-safe).
4. **Upgraded** — Lit components register, set `data-sem-upgraded`, own
   behavior.

Content always lives in the light DOM (searchable, copyable, extractable);
shadow DOM carries interactive chrome only.
