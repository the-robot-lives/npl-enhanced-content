# Authoring guide — your first SemText document

Audience: technical writers maintaining long-form documents (persona
P-001, "Doc Author"). This is a **tutorial**: it walks a first document
from a minimal skeleton to a full one, one element group at a time. The
normative reference is [`spec/conventions.html`](../spec/conventions.html)
and the per-element contracts in [`spec/schema/`](../spec/schema/) — this
guide links to them instead of restating them. For serving SemText from
your own site, see the [integration quickstart](./integration-quickstart.md).

A note on provenance: the personas these docs are written for are
**inferred from the codebase and its history, not from user research**
(see `ROADMAP.md`, "Personas & stories"). If a step misses what you
actually need, open a repo issue — that is a finding.

## Your first document

SemText is XHTML: valid HTML5 whose custom elements carry meaning, not
presentation. The minimal valid document:

```html
<!doctype html>
<html lang="en" data-sem-theme="minimal-tech-light">
<head>
  <meta charset="utf-8">
  <title>My first document</title>
  <link rel="stylesheet" href="semtext/themes/_vocabulary.css">
  <link rel="stylesheet" href="semtext/themes/minimal-tech-light.css">
</head>
<body>
<sem-enhanced-document>
  <h1 data-kind="title">My first document</h1>

  <p>Ordinary semantic HTML is always valid content. SemText elements
  enhance where interactivity pays.</p>
</sem-enhanced-document>
</body>
</html>
```

`<sem-enhanced-document>` is the required root wrapper. With only the
vocabulary CSS linked and **no script at all**, this already renders as a
readable page — that is the founding guarantee, and the reason authoring
starts here rather than at the scripts. Copy the `semtext/` folder next
to the file (or see the [integration quickstart](./integration-quickstart.md))
and it also becomes interactive. The repo's own spec pages
(`spec/conventions.html`) and site (`web/site/index.html`) are real,
dogfooded SemText documents — steal from them freely.

## Agents pick it up — the `semtext-prompt` head snippet

Documents that agents will read or author advertise the SemText prompt in
the `<head>`, so it is the first thing an agent sees when it reads the raw
file:

```html
<!-- Agents: if you have not read this SemText prompt in this session, read it first. -->
<link rel="semtext-prompt" href="https://cdn.semtext.dev/semtext-prompt.sem.html">
```

The comment is the instruction; the `link` (`rel="semtext-prompt"`) is the
machine-findable handle. The URL serves the concise core prompt — the
format's conventions plus one prompt page per element, generated from the
spec's element index (`npm run build:prompts`). An agent that has not read
it this session reads it before the body. Keep prompts out of the document
itself: the prompt reference lives in the head, never as body content.
(The CDN host does not serve the prompts yet — the publish job is off by
default — so the URL may 404 until that ships.)

## Checking your work today

The validator exists: `semtext-validate` (US-301) checks a document
against the machine-readable schema derived from the spec and reports
`file:line: severity rule — message` diagnostics — unknown `sem-*`
elements, missing required attributes, dual-spelling authoring errors,
unknown attributes, and more.

```bash
npx semtext-validate my-doc.html        # text diagnostics; --format json also
```

Three manual checks remain worth running alongside it:

1. **Open it in a browser.** The validator catches contract violations;
   rendering still catches what only eyes catch.
2. **Read it with scripts off** — devtools "disable JavaScript", or
   strip the `<script>` tags into a copy. If anything becomes
   unreadable or disappears, your document (or your CSS) broke the
   zero-JS contract. The bottom tier is the contract.
3. **Compare against the demo pages** (`web/demo/`, built to
   `dist/demo/`) and the schemas in `spec/schema/` for the element.

## Growing the document

Each section below gives the canonical **tag form** (spec v0.5) with a
link to its normative schema. The older `div.sem-*` + `data-*` spelling
still works everywhere — it is a compatibility alias, spec Appendix A —
but write tag form in new documents.

### Notes — `sem-note`

```html
<sem-note variant="warning">Rotation is <strong>per session</strong>.</sem-note>
<sem-note variant="tip" collapsed>Shuffle flashcards before each review.</sem-note>
```

`variant="info|warning|tip|danger"`. `collapsed` starts the body hidden
behind a teaser — with scripts off, it shows. Schema:
[`sem-note.md`](../spec/schema/sem-note.md).

### Facts — `sem-facts` / `sem-fact`

```html
<sem-facts view-as="flashcards">
  <sem-fact id="f-jwt" kind="concept">
    <statement>JWTs rotate per session</statement>
    <conclusion>Short-lived access; the refresh grant issues a new pair.</conclusion>
  </sem-fact>
</sem-facts>
```

The atomic unit is the assertable Q/A pair; `view-as` picks how the
collection renders (`list` default, `flashcards`, `quiz`) without
changing what it *is*. Give every fact you cite an `id`. Schema:
[`sem-facts.md`](../spec/schema/sem-facts.md).

### Occludable prose — `sem-details` / `sem-detail` / `<highlight>`

```html
<sem-details view-as="quiz">
  <sem-detail>The token travels in the <highlight>Authorization</highlight> header.</sem-detail>
</sem-details>
```

`<highlight>` marks a recall target: plain `<em>` normally, occluded in
quiz/flashcard views. Schema: [`sem-details.md`](../spec/schema/sem-details.md).

### Procedures — `sem-procedure` / `sem-step`

```html
<sem-procedure kind="runbook" role="list">
  <sem-step role="listitem" status="done">provision the secret</sem-step>
  <sem-step role="listitem" status="current">cut the release</sem-step>
  <sem-step role="listitem">run migrations</sem-step>
</sem-procedure>
```

`status="done|current|todo|blocked"`. DOM order is execution order.
Zero-JS: CSS renders it fully. Schema:
[`sem-procedure.md`](../spec/schema/sem-procedure.md).

### Chronology — `sem-chronology` / `sem-event`

```html
<sem-chronology kind="release-history" role="list">
  <sem-event role="listitem" when="2026-03-02" status="done">
    <time datetime="2026-03-02">2 Mar 2026</time> v0.1 tagged.</sem-event>
</sem-chronology>
```

`when`/`until` are canonical; DOM order is chronological order.
Schema: [`sem-chronology.md`](../spec/schema/sem-chronology.md).

### Properties & glossary — `sem-properties` / `sem-property`

```html
<sem-properties kind="config">
  <sem-property key="token ttl" role="definition" aria-label="token ttl">15m</sem-property>
</sem-properties>
```

`view-as="glossary"` on the container turns it into a glossary with term
previews. Schema: [`sem-properties.md`](../spec/schema/sem-properties.md).

### Reveals, views, progress — `sem-reveal`, `sem-views`, `sem-progress`

```html
<sem-reveal summary="Why not localStorage?" collapsed>…</sem-reveal>
<sem-views id="deploy">
  <sem-view name="Helm" active role="tabpanel">…</sem-view>
  <sem-view name="ArgoCD" role="tabpanel">…</sem-view>
</sem-views>
<sem-progress value="0.62" label="coverage" role="meter"
     aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.62"></sem-progress>
```

Schemas: [`sem-reveal.md`](../spec/schema/sem-reveal.md),
[`sem-views.md`](../spec/schema/sem-views.md),
[`sem-progress.md`](../spec/schema/sem-progress.md).

### Code and Markdown — `sem-code`, `sem-md`

```html
<sem-code lang="bash" filename="deploy.sh" mark="2" controls="copy,wrap">
<pre><code>helm upgrade …</code></pre>
</sem-code>

<sem-md label="Token lifetimes">
  | Token  | Lifetime | Rotates |
  | :----- | -------: | :-----: |
  | access | 15 min   | no      |
</sem-md>
```

`sem-md` needs the Markdown bundle loaded to render (see the
[integration quickstart](./integration-quickstart.md)); without any
script it reads as pre-wrapped text. Schemas:
[`sem-code.md`](../spec/schema/sem-code.md),
[`sem-md.md`](../spec/schema/sem-md.md).

### Showing your markup — `sem-source`

Wrap a section in `<sem-source label="…">` and readers can flip between
the rendered result and the authored markup — useful in tutorials and
spec documents (this repo wraps every demo section in one).

### Tables — `sem-table`

```html
<sem-table controls="sort,filter" sticky>
  <table><caption>…</caption>
    <thead><tr><th scope="col">Token</th></tr></thead>
    <tbody><tr><td data-value="900">15 min</td></tr></tbody>
  </table>
</sem-table>
```

The authored `<table>` is the data — no payload elsewhere. `td[data-value]`
is a plain-HTML sort key (note the `data-*`: standard element). Schema:
[`sem-table.md`](../spec/schema/sem-table.md).

### References — `sem-references` / `sem-reference`

```html
<p>…per use<a href="#r-rfc">[1]</a>.</p>
<sem-references kind="bibliography" role="list">
  <sem-reference id="r-rfc" role="listitem" href="https://…" cite="RFC 6749">…</sem-reference>
</sem-references>
```

Schema: [`sem-references.md`](../spec/schema/sem-references.md).

### Audiences — `sem-audiences` and the `audience` qualifier

```html
<sem-audiences>
  <sem-profile id="operator" label="Operator" implies="reader"></sem-profile>
</sem-audiences>
<sem-note audience="operator">Operator-only note.</sem-note>
```

Audience gating never *removes* content for machines, and with scripts
off everything shows. Schema:
[`sem-audiences.md`](../spec/schema/sem-audiences.md).

### Reading chrome and metadata — `sem-reader`, `<agent>`

`<sem-reader controls="outline,progress,focus,type,color,print,audience">`,
when used, is the root wrapper's first child, one per document; it mints
no content and extraction skips it whole. Machine-facing metadata is bare
semantic children of the wrapper (`<agent><name>…</name>…</agent>`) —
unstyled, for agents. Schema: [`sem-reader.md`](../spec/schema/sem-reader.md).

## Rules that bite

- **Bare attributes on custom elements; `data-*` on standard ones.**
  `view-as="quiz"` on `<sem-facts>`, but `data-kind="section"` on `<h2>`.
- **One spelling per element.** Writing both the bare and `data-*` form
  on the same element is an authoring error (spec §2).
- **`id` is the citation system.** A `#id` deep link reaches content
  through any collapsed note, closed reveal, inactive view or non-current
  card. Give citable records stable ids.
- **Compact sugar is display-only.** `term :: value`, `✅/✗`, `→` are
  sugar the spec §3 defines; the attributes are canonical. When in doubt,
  write the attribute.
- **`view-as` never changes meaning.** A fact is a fact in every view.
  If rendering and meaning start to diverge in your draft, you are
  holding it wrong.

## What is stable, what is growing

The Tier-0 vocabulary above is shipped and spec'd (v0.5). The machine
validator and its schema shipped with it (`semtext-validate`, US-301;
`spec/schema/semtext.schema.json`, US-302); the W4 wave continues with
the CI corpus action, an md→SemText converter, and editor support — see
[`ROADMAP.md`](../ROADMAP.md).
