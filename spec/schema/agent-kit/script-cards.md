# Schema — `agent-kit-cypress` + `agent-kit-cucumber`

The cached script cards; the authored spec source displays as written.

> One contract for the script-card pair (`src/lit/agent-kit/
> script-shared.ts`, `AkitScriptCard`; `agent-kit-cypress.ts`,
> `agent-kit-cucumber.ts`): the runner spec lives in an authored
> `<script type="text/plain" data-agent-kit-script>` child or a `file`
> attribute, and DISPLAYS as authored — the vocabulary stylesheet
> promotes the text/plain block to a preformatted panel with JavaScript
> on or off. The element never parses, re-renders, or executes it.
> Mirrors the sem-* prose contracts in `spec/schema/*.md`: prose is
> normative — changes here precede spec changes precede code, and the
> file is the BDD source of truth for
> `test/unit/agent-kit-testing.test.ts`.

Contract per conventions.md and the namespace recipe in
`src/lit/agent-kit/index.ts`.

## Authoring form

```html
<agent-kit-cypress kind="script" tags="authoring" file="cypress/e2e/board.cy.js">
  <script type="text/plain" data-agent-kit-script>
    describe('board', () => { it('mints refs', () => { … }) })
  </script>
</agent-kit-cypress>

<agent-kit-cucumber kind="script" tags="authoring"
                    org="acme" project="semtext" key="feature-extraction">
  <script type="text/plain" data-agent-kit-script>
    Feature: extraction
      Scenario: JS-off equals JS-on
        Given an authored board
        When the records are extracted
        Then both passes agree
  </script>
</agent-kit-cucumber>
```

Class-form alias (conventions Appendix A, agent-kit namespace):
`.agent-kit-cypress[data-attr]` / `.agent-kit-cucumber[data-attr]` —
same dual-form contract as the sem-* tier.

Script-card attributes, per the pair contract (all strings):

- `file`: `string` — optional same-origin path of the spec source when
  the script is not inline; the chrome renders it as a `source:`
  reference chip. NEVER fetched by this element (Live-fetch policy
  below) — declared so the reader (and the driver lane, later) can
  find the source.
- `fixtures`: `string` — optional same-origin JSON path naming a cached
  snapshot for enrichment (cached-embed preset; a fixture source vetoes
  any `endpoint`). The pair defines no snapshot shape — declared for
  family symmetry only.
- `endpoint`: `string` — optional same-origin API path; NEVER fetched
  by this element (Live-fetch policy below) — declared for the
  authoring pipeline only.
- `last-refreshed`: authored ISO-8601 stamp of the most recent sync
  (cached-embed preset).
- `status`: `string` — one of `fresh`, `stale`, `error` (cached-embed
  preset).
- `org`, `project`, `key`: `string` — the reference quartet (schema
  `reference` preset) — see Reference attributes below.
- `id`, `kind`, `tags` per the global attribute catalog — no bullet
  needed.

Children — the cached body:

- `<script type="text/plain" data-agent-kit-script>` — the spec
  source, inline (at most one). NOT a schema child part: the element
  never touches it, and the validator has no rule for script children.
  The document's own escaping governs; the vocabulary stylesheet
  promotes the block to a preformatted panel (`themes/_vocabulary.css`,
  agent-kit section — author origin beats the UA's
  `script { display: none }`), so BROWSING the page with JavaScript
  disabled shows the panel unchanged. The `.nojs` build artifact is a
  different, stricter artifact: its transform strips EVERY `<script>`
  (hard build invariant), so only there the panel is absent — chips and
  panel drop, the records do not.

## Reference attributes

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the spec's record key within the project.
- `id`: `string` — the specific record id (rides the global catalog).

## Cached content

The record carries the reference attributes; the script payload is
display-only by construction — extraction skips script elements (the
§8 invariant: inline JSON is cached-embed DATA), so the script text
never enters any record, on either side of the .nojs transform. The
`file` chip and kind chip are chrome.

## Run affordance — DEFERRED

There is no same-origin driver endpoint discoverable from a static
document, and a dead Run button is worse than none. The cards show the
script and its reference; the Run affordance arrives with the
backend-proxy driver lane as a separate decision, never as a disabled
button.

## Refresh contract

- `last-refreshed`: authored stamp of the most recent sync (machine
  format: ISO-8601).
- `semtext:cache` markers: a cache entry names its source and age with
  `data-semtext-cache` metadata in the host document — never a runtime
  fetch. The element itself performs NO fetching; refresh is the
  authoring pipeline's job.

## Live-fetch policy

`agent-kit-*` elements never fetch at render time (`livePolicy:
'never'` — no client credentials; live enrichment is a separate
backend-proxy lane). The `file` attribute names the source; it is
rendered as text, never loaded. A runtime fetch would break the §8
extraction invariant and the file:// offline contract.

## Rendered form

- Enhanced: the `<agent-kit-cypress>` / `<agent-kit-cucumber>` element
  itself (Lit `AkitCypress` / `AkitCucumber` — light DOM, no shadow
  root). Under the `data-sem-upgraded` claim the element renders chrome
  inside ONE `agent-kit-chrome` container: the kind chip
  (`data-script-kind`, "Cypress spec" / "Cucumber feature") and, when
  `file` is authored, the `source:` reference chip. The script block
  displays as a preformatted panel through the agent-kit section of
  `themes/_vocabulary.css` — authored markup, untouched. Chrome is
  appended after the authored record, never replaces it; extraction
  skips chrome subtrees whole, so the §8 invariant holds by
  construction.
- JS-off: browsing with JavaScript disabled, the script panel displays
  identically (the promotion rule is plain CSS); no chips. In the
  `.nojs` build artifact the panel is absent (scripts stripped by the
  build) — the reference attributes and any sibling prose stand
  alone.
