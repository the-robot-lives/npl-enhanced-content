# Schema — `sem-api-call` / `sem-api-param`

Contract per conventions.md v0.7. BDD source of truth for
`test/e2e/sem-api-call.cy.js`. Changes here precede spec changes
precede code.

## Scope semantics

A function/API-call definition: documents one endpoint's contract —
method, endpoint, prose description, and its parameters (query, body,
header) and response fields. Like `sem-tag-def`, reference material
authored once: readers get a card with a parameter table; machines get
a structured record. The non-assertive counterpart to procedure steps:
it documents an interface, it does not narrate work (unlike
`sem-procedure`).

The container `sem-api-call` names the operation (`name`), its HTTP
`method` and `endpoint`, and carries the prose description; each
`sem-api-param` child is one parameter row. `in` discriminates where
the parameter lives — `query`, `body`, `header`, or `response` for
response fields. The response status rides the container's `status`
attribute ("200", "2xx" …); response field rows are
`sem-api-param[in=response]`.

## Authoring form

```html
<sem-api-call name="Create token" method="POST" endpoint="/oauth/token" status="200">
  Exchanges a grant for a token pair.
  <sem-api-param name="grant_type" in="body" type="string" required allowed="authorization_code,refresh_token">The grant to exchange.</sem-api-param>
  <sem-api-param name="code" in="body" type="string">The authorization code.</sem-api-param>
  <sem-api-param name="ttl" in="response" type="integer">Access-token lifetime in seconds.</sem-api-param>
</sem-api-call>
```

Class-form alias (conventions Appendix A): `div.sem-api-call[data-name][data-method][data-endpoint][data-status]` › `div.sem-api-param[data-name][data-in][data-type][data-required][data-default][data-allowed]`.

- `name` (on `sem-api-call`): required, string — the operation's
  display name.
- `method` (optional): string token — HTTP method, default `GET`;
  rendered uppercased, extraction records the authored spelling
  uppercased.
- `endpoint` (required): string — path or URL template.
- `status` (optional): string — the documented response status
  ("200", "2xx", "201 Created" …).
- The element body is the description (prose).
- `sem-api-param`: `name` required; `in` one of `query`, `body`,
  `header`, `response` (default `query`); `type` one of `string`,
  `boolean`, `integer`, `number` (optional); `required` boolean attr;
  `default` optional string; `allowed` comma list; body = the
  parameter's description.
- `id`, `tags` per the global attribute catalog (conventions.md §2).

## Rendered form

- Lit component (`SemApiCall`, light DOM): renders a labelled card —
  header row `METHOD endpoint` (method as a method chip) + operation
  name + status chip; the description as prose; parameters as a real
  `<table>` (Name / In / Type / Required / Default / Values /
  Description) grouped query+header first, body next, response last,
  each group under a small-caps heading. Native table semantics, no
  ARIA repair.
- JS-off: `data-method` + `data-endpoint` render as a small-caps
  heading via CSS `attr()`; each `sem-api-param` renders
  `name :: description` with its `in`, type and requiredness from
  `attr()`. Nothing hidden.
- Class-form documents keep the CSS render (no component claim).

## A11y contract

- Native `<table>` with scoped column headers; the method chip is
  text, not an icon; status is text.
- JS-off: plain prose + attr()-derived labels; nothing hidden.

## Machine contract

- `sem-api-call` extracts as one record: `name`, `method`, `endpoint`,
  `status`, `description`, `params` — an ordered array of the
  `sem-api-param` rows (`name`, `in`, `type`, `required`, `default`,
  `allowed`, `description`). A consumer can reconstruct the endpoint's
  contract without reading prose.
