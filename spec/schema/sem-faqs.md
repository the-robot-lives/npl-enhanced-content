# Schema — `sem-faqs` / `sem-faq`

A FAQ collection and its entries. Family A — static knowledge/doc
containers; display stubs (no CSS-only elements: the Lit components
exist and claim `data-sem-upgraded`; everything visible is vocabulary
CSS).

Contract per conventions.md. BDD source of truth for
`test/e2e/sem-containers-b.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A collection of question/answer pairs. Each `sem-faq` is one entry —
the atomic citable unit (`id` is the citation token; `kind`, `tags`
global on the collection). The authored `<question>` and `<answer>`
children ARE the record: every question AND every answer stays visible
in every tier — a FAQ is not a disclosure (use `sem-reveal` for
Q→A occlusion). `sem-faq` mints its record inside the collection
(optionsIn: `sem-faqs`).

## Authoring form

```html
<sem-faqs id="faq-auth" kind="auth">
  <sem-faq id="q-expiry">
    <question>Do access tokens expire mid-session?</question>
    <answer>No — the client mints a fresh pair from the refresh
    grant; the user never re-signs-in mid-session.</answer>
  </sem-faq>
  <sem-faq id="q-secret">
    <question>Where do client secrets live?</question>
    <answer>Server-side, in the confidential client — the browser
    only ever sees tokens.</answer>
  </sem-faq>
</sem-faqs>
```

Class-form alias (conventions Appendix A): `div.sem-faqs` ›
`div.sem-faq` › `.sem-question`, `.sem-answer` — same dual-form
contract as every `sem-*` tier.

- `kind`: `string` — collection qualifier drawn into the label chrome
  (display-only sugar).
- `id`, `tags` per the global attribute catalog.
- `<question>` — required per entry; the asked question.
- `<answer>` — required per entry; the authored answer.

## Rendered form

Enhanced: the collection is a bordered block with an "FAQ" label drawn
by CSS `::before`; each entry is a card with the question emphasized
and the answer in normal flow. Components render nothing of their own
— no shadow roots, no generated chrome, nothing occluded. JS-off: the
identical boxes and labels from the vocabulary CSS; nothing hidden —
the §8 extraction invariant holds in both tiers.

## Events

None.

## Machine contract

`record: true` on both tags: extraction returns
`[{question, answer}]` pairs verbatim — questions and answers are
citable assertions. Contract per conventions §8.
