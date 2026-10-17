# SemText -- Format Spec & Conventions

**DRAFT v0.7 -- Lit-only surface, tag form canonical.** v0.7 renames the fact child
`<sem-distractor>` to `<incorrect-statement>` (breaking; no backward-compatible alias).
SemText is an XHTML vocabulary of
**custom elements**: `<sem-enhanced-document>`, `<sem-note variant="tip">`,
`<sem-facts view-as="quiz">`, `<sem-fact>` with `<statement>` and
`<conclusion>`, `<sem-step status="done">`, `<sem-property key="...">`. Element
names say what content *is*; **attributes are attributes** (`view-as`,
`status`, `key`, `kind`, `tags`, `controls`), never `data-*`. That is the
form every example in this spec, the schemas, and the reference documents
use, and the form every consumer -- theme CSS, the one script (vanilla
handlers, reading and Markdown renderers, Lit components), extraction --
accepts as its first-class input.

The v0.4 baseline rendered the same vocabulary as **classes on plain
elements** with `data-*` parameters (`<div class="sem-note"
data-variant="tip">`). That spelling is retained as a **compatibility
alias**: the mechanical mapping is in **Appendix A**, every tier keeps
accepting it, and a document may mix the two forms. New documents and new
tooling write the tag form.

CSS and script layering, in both distribution forms (SS7): (1) the base
stylesheet `semtext.css` (the vocabulary, offline-safe) and the theme file --
`--sem-*` tokens on `[data-sem-theme]`; (2) `semtext.js` -- the one script,
a Lit 3 bundle that also carries the vanilla handlers for the elements no
component defines, the reading and Markdown renderers, and extraction.
The **single-file** form inlines all of it in `<head>` (the build's
`sem:inline` markers); the **folder** form links the same files by
relative path. Neither form carries page-local CSS or JS beyond a small
layout layer. `?` = open questions (SS10).

---

## Element buckets

The SemText vocabulary groups into seven conceptual buckets; NPL
elements are not bucketed and form a single display family of their own.
Each element appears in its primary bucket below; every element is also
listed with its full entry in [SS5](#5-element-entries).

| Bucket | Elements | What it covers |
| :-- | :-- | :-- |
| **Document & structure** | `sem-enhanced-document`, `sem-reader`, `sem-audiences` / `sem-profile`, `agent` | The root wrapper, reading chrome, audience declarations and document-level metadata that frame a SemText document |
| **Prose & code** | `sem-md`, `sem-note`, `sem-code`, `sem-browser` | Content blocks beyond plain HTML -- Markdown bodies, callouts and source listings with provenance |
| **Disclosure & views** | `sem-details` / `sem-detail`, `highlight`, `sem-reveal`, `sem-source`, `sem-views` / `sem-view` | The same content under different reading interactions -- occluded detail, Q-A reveal, markup flip, perspective tabs |
| **Facts & recall** | `sem-facts` / `sem-fact`, `statement`, `conclusion`, `incorrect-statement`, `sem-question` / `sem-option` | Assertable statement/conclusion pairs -- the citable unit -- with the quiz candidates and distractors built on them |
| **Data & tables** | `sem-table`, `sem-data-visualizer`, `sem-data-source`, `sem-data-join`, `sem-data-query` | Authored tables and the data-visualizer's named buckets, joins and editable queries |
| **Sequences & progress** | `sem-chronology` / `sem-event`, `sem-procedure` / `sem-step`, `sem-progress` | Ordered, status-annotated content -- timelines, procedures and completion meters |
| **Interactive containers** | `sem-workflow` / `sem-step`, `sem-site-tree` / `node`, `sem-file-tree` / `node` | Steps with gate/check/if-no branches, and site/file trees (structured or text-authored) with collapse, filter and find |
| **Definitions & citations** | `sem-properties` / `sem-property`, `sem-references` / `sem-reference`, `sem-tag-def` / `sem-tag-attr`, `sem-api-call` / `sem-api-param` | Closed key/value assertions, the numbered works the prose cites, and the reference-definition cards that document a vocabulary's tags and an API's endpoints |
| **NPL** | `npl-agent`, `npl-directive`, `npl-section`, `npl-rubric`, `npl-critique`, `npl-declaration`, `npl-example`, `npl-flag` / `npl-flags`, `npl-hormones`, `npl-mindread`, `npl-mode`, `npl-mood`, `npl-poa`, `npl-ref`, `npl-thought`, `npl-vos`, `npl-artifact`, `npl-cot`, `npl-intent` | NPL prompt-engineering elements; loaded by `npl.js` / `npl-lazy.js` on top of the SemText core |

Every element's normative schema lives under `spec/schema/<element>.md`
(NPL schemas under `spec/schema/npl/`). The class-form alias for every
element is one row of [Appendix A](#appendix-a--class-form-alias-v04-compatibility).

---

## Outline

0. [Model](#0-model)
1. [Document skeleton](#1-document-skeleton)
2. [Attribute catalog](#2-attribute-catalog)
3. [NPL notation inside tags](#3-npl-notation-inside-tags)
4. [The script & degradation rules](#4-the-script--degradation-rules)
5. [Element entries](#5-element-entries)
6. [Theme conventions](#6-theme-conventions)
7. [Distribution forms](#7-distribution-forms)
8. [Machine-readability contract](#8-machine-readability-contract)
9. [NPL XML-variant alignment](#9-npl-xml-variant-alignment)
10. [Open questions](#10-open-questions)
- [Appendix A -- Class-form alias (v0.4 compatibility)](#appendix-a--class-form-alias-v04-compatibility)

---

## 0. Model

One file, three consumers -- human/browser (double-click, styled, interactive),
LLM/non-visual (the same XHTML read structurally; attributes qualify every
datum; same XML vocabulary NPL's MCP server already speaks), terminal (browser
or DOM-text extraction). Element names are **semantic** (`sem-fact`,
`sem-detail`) -- what content *is*; presentation is parameterized
(`view-as="quiz|flashcards|list"`) -- how it *renders*. NPL conventions live
inside the tags, never as a pre-HTML grammar.

A SemText element is a **custom element** in the `sem-` namespace. Custom
elements are valid HTML whether or not a script ever defines them: the
browser parses `<sem-fact>` as an unknown element, the vocabulary base
(`semtext.css`) gives it a block box (`sem-*:not(:defined)`, SS6). Without
the script a document shows its authored text and is not styled or
interactive: nothing is hidden or generated, every reveal is open, views
stack under their names, and the record is still extractable by DOM
tooling. `semtext.js` -- when the document loads it -- defines the
interactive ones and upgrades them in place, and drives the rest with
plain handlers (SS4).

## 1. Document skeleton

```html
<!doctype html>
<html lang="en" data-sem-theme="minimal-tech-light">
<head>
  <meta charset="utf-8">
  <title>Authoring Guide</title>
  <!-- Agents: if you have not read this SemText prompt in this session, read it first. -->
  <link rel="semtext-prompt" href="https://cdn.semtext.dev/semtext-prompt.sem.html">
  <link rel="stylesheet" href="semtext/semtext.css">
  <link rel="stylesheet" href="semtext/themes/semtext-theme-minimal-tech-light.css">
  <script defer src="semtext/semtext.js"></script>  <!-- the one script (SS4) -->
</head>
<body>
<sem-enhanced-document>

  <sem-reader controls="outline,progress,focus,type,color,print,audience"></sem-reader>

  <!-- document-level metadata: bare semantic children -->
  <agent>
    <name>Infra Guide</name>
    <bio>Deployment runbook assistant</bio>
    <instructions>Answer from sem-fact ids only.</instructions>
  </agent>

  <h1 data-kind="title">Authoring Guide</h1>

  <sem-note variant="warning">Rotation is <strong>per session</strong>.</sem-note>

  <sem-facts view-as="flashcards">
    <sem-fact id="f-jwt" kind="concept">
      <statement>JWTs rotate per session</statement>
      <conclusion>Short-lived access; the refresh grant issues a new pair.</conclusion>
    </sem-fact>
  </sem-facts>

  <!-- content: sem-* vocabulary + ordinary semantic HTML -->

</sem-enhanced-document>
</body>
</html>
```

- `<sem-enhanced-document>` is the required root wrapper (the script's
  handlers scope to it; Lit components register against it). It may carry a
  landmark role (`role="main"`) -- it is the document. The alias form may
  use `<main class="sem-enhanced-document">` for the native landmark; the
  tag form trades that for one element that is the same in every consumer,
  and states the landmark with `role`.
- `<sem-reader>`, when used, is the wrapper's first child (one per
  document; SS5).
- Metadata children (`agent`, and future `org`, `context`, `audience`) are
  **bare semantic tags** -- machine-facing, unstyled. ? **Q1** keep bare vs
  `sem-`-prefix them?
- Record **parts** are bare semantic children too: `<statement>`,
  `<conclusion>`, `<incorrect-statement>` inside `sem-fact`; `<highlight>` inside
  any prose element; `<name>`, `<bio>`, `<instructions>` inside `agent`.
- Ordinary semantic HTML is always valid content; `sem-*` enhances where
  interactivity pays. Plain HTML carrying `data-kind` or `data-tags` is a
  record too (extraction SS3) -- on a standard element the qualifier keeps
  the `data-*` spelling, which is the only valid custom attribute HTML5
  allows there (SS2).

## 2. Attribute catalog

Global attributes (any `sem-*` element), spelled **bare**:

| Attribute | Values | Machine meaning |
| :-- | :-- | :-- |
| `kind` | free token (`concept`, `anti-pattern`, `caveat`, ...) | what the data IS |
| `tags` | comma list | classification |
| `view-as` | element-defined modes | presentation parameter (identity unchanged) |
| `status` | `done`, `current`, `todo`, `blocked`, `pass`, `fail` | lifecycle/verdict |
| `controls` | comma flags: `shuffle`, `filter`, `retry`, `picker` | which controls render |
| `collapsed` | boolean | pre-collapse state |
| `audience` | profile spec: `a`, `a, b`, `!a` (profiles from `sem-audiences`) | who the datum is for -- **`spec/schema/sem-audiences.md`**; carried verbatim by extraction, never suppresses a record |
| `id` | doc-unique | stable anchor, cite target -- a `#id` or `#container/child` hash reaches it through any closed reveal, collapsed note, inactive view or non-current card (deep-link resolver) |
| `data-*` | free | extension point; also the **alias spelling** of every parameter above (Appendix A) |

Element-specific parameters (`variant`, `key`, `name`, `summary`, `value`,
`label`, `when`, `until`, `lang`, `filename`, `mark`, `wrap`, `href`,
`cite`, `implies`, `sticky`, `outline-depth`) follow the same rule: bare on
the element, documented per schema.

**Scope of the bare spelling.** Bare attributes are canonical on `sem-*`
custom elements and their bare part children (`<statement>`, `<highlight>`,
`<agent>` > `<name>`), where any attribute name is valid. On a **standard
HTML element** (`<h2>`, `<p>`, `<a>`, `<td>`) a global qualifier keeps the
`data-*` spelling -- `<h2 data-kind="section" data-tags="auth">`,
`<p data-audience="operator">`, `<td data-value="900">` -- because HTML5
allows no other custom attribute there and SS8 promises tool-parseable
documents. Every tier reads both spellings on either kind of element.

**Alias spelling.** `data-<name>` is accepted everywhere `<name>` is, and
wins when both are present (extraction SS3.6; the bundle's attribute
mirror copies each bare parameter to its `data-*` twin before any handler
runs, SS4 rule 1).
Writing both spellings on one element is an **authoring error** -- the
precedence exists so extraction stays stable and the mirror is a no-op,
not so an author can mean two things; a `sem-source` fence always shows
the markup as authored, so a mixed element would display a parameter the
tiers do not use.

**Runtime state** the script writes is always `data-*` -- `data-active` on
the shown view, `data-view-as` rewritten by a `sem-source` / `sem-md`
toggle, `data-sem-upgraded` marking what the bundle has enhanced -- so an
authored bare attribute is never overwritten and a `sem-source` fence
still shows the markup as written.

`view-as` is the core inversion: `<sem-fact>` is a fact in every view;
`view-as` only selects rendering. Unknown `view-as` => falls back to `list`/
plain + fallback-handler warning. CSS-only modes exist too:
`sem-note view-as="margin"` (right-gutter aside on wide viewports),
`sem-chronology view-as="timeline|list"`. `sem-properties
view-as="glossary"` adds term previews.

**Hash state.** The hash is `&`-joined segments (`src/shared/state.ts`):
bare `id` / `container/child` deep links, and `name=value` parameters
(`sem-audience=<profile>`). Every writer edits its own segment only, so
`#deploy/argocd&sem-audience=operator` survives a tab switch.

**Class namespace.** Each element owns exactly the class namespace
`.sem-<element>` and `.sem-<element>-*`: the alias form's identity class
(Appendix A) and the element's generated chrome (`.sem-facts-chrome`,
`.sem-note-summary`, `.sem-code-line`). No other element may reuse that
bare class name for its own chrome. One exception: `<incorrect-statement>`'s
class form is the unprefixed `.incorrect-statement`, matching its tag name
exactly (user decision, v0.7). `.sem-progress` names only the progress
element -- a facts-chrome label needing similar styling is `.sem-facts-meter`,
never `.sem-progress` borrowed from another element. The `npl-*` namespace mirrors the rule: each NPL element owns exactly
`.npl-<element>` and `.npl-<element>-*` -- its class-form identity class
(Appendix A, NPL namespace) and its generated chrome (`.npl-agent-header`,
`.npl-section-header`) -- and no other element may reuse that bare class name for
its own chrome.

## 3. NPL notation inside tags

Compact notation is legal inside element text where the schema allows;
**attributes are canonical, notation is sugar**:

| Notation | Meaning | Where |
| :-- | :-- | :-- |
| `<highlight>` | recall target -- occludes in quiz/flashcard views, `<em>` in plain view | any prose element |
| `[[cloze]]` | inline occlusion sugar (equivalent to `<highlight>`) | `sem-detail`, `sem-fact` |
| `term :: value` | pair | `sem-property` text, `sem-fact` compact form |
| `? ...` / `? ...` | correct / distractor | `sem-option` sugar |
| `- ...` | current | `sem-step` status sugar |
| `[hint \| reveal]` | agent-facing instruction, human-rendered hint | instruction-bearing elements (define in `sem-note` schema first) |

`<statement>`/`<conclusion>` children always win over `::` compact form when
both present; authors pick one per fact.

## 4. The script & degradation rules

1. `semtext/semtext.js` is the one script a SemText document loads. One
   Lit 3 IIFE, global `SemText`, it carries: the ten interactive Lit
   components (`sem-note`, `sem-facts`, `sem-details`, `sem-properties`,
   `sem-code`, `sem-references`, `sem-reader`, `sem-table`, `sem-source`,
   `sem-md`); the vanilla core handlers for everything no component
   defines -- `view-as` switching, reveal toggles, `<highlight>` occlusion,
   quiz checking, audience gating, deep-link resolution, print disclosure;
   the prose-reading renderers (sem-code chrome, reference / glossary
   previews, backlinks, `sem-reader` chrome, `sem-table` sort / filter);
   the `sem-md` Markdown renderer; and the extraction recipe
   (`SemText.extractRecords` / `SemText.extractText`, spec/extraction.md).
   Every handler selects both authoring forms from one selector
   (`:is(sem-x, .sem-x)`, the child parts `:is(conclusion, .sem-conclusion)`).
   Its first pass snapshots every `sem-source` wrapper's markup (a DOM
   clone in an inert `template.sem-source-raw` child) before any other
   handler runs; the reading renderer renders that copy. Its attribute
   mirror copies each bare tag-form parameter (`view-as`, `variant`,
   `name`, `active`, `summary`, `value`, `label`, `key`) to its `data-*`
   twin when the twin is absent, so the gated CSS rules and every later
   handler read one spelling. The list is exactly the parameters a core
   handler or a gated CSS rule reads; `controls`, `sticky`, `lang`,
   `filename`, `mark`, `wrap`, `outline-depth`, `href`, `cite`, `implies`,
   `when`, `until`, `status`, `kind` and `tags` are read in both spellings
   by the code or CSS rule that consumes them and need no mirror.
   `status` in particular is never read by a script: its only consumers
   are the no-script CSS rules of `sem-step`, `sem-event` and
   `sem-progress`, each written `:is([data-status="x"], [status="x"])`,
   which select on a *value* rather than render an `attr()` -- both
   spellings of the same value produce the same declaration, so no
   `:not([data-status])` guard is needed and the alias precedence of SS2
   cannot be observed unless an element carries two different values,
   which is the authoring error SS2 already names. The bundle runs once per
   document (host code may re-run `SemText.enhance` on injected DOM).
2. Component implementations supersede the vanilla behaviors where both
   exist: a Lit component claims `data-sem-upgraded` at connect, and the
   vanilla handlers -- which stamp the same marker on the elements they
   wire -- skip elements already claimed. `semtext.js` stamps `html` with
   `data-sem-upgraded` once it has run, for hide rules whose host element
   is deliberately unmarked (a list-view deck's distractors). The zero-JS
   elements (`sem-procedure`, `sem-chronology`, `sem-audiences`) and the
   handler-only ones (`sem-views`, `sem-progress`) define no custom
   element: they are `:not(:defined)` in every document, by design. The former two-script handoff (`data-sem-fallback`, cleared on
   upgrade) is gone with the merged bundle -- one runtime, one marker.
3. Theme CSS styles **both authoring forms from one rule** --
   `:is(sem-x, .sem-x)` throughout the vocabulary base (D10). Rules
   that must hold with **no script** read the bare and the `data-*`
   spelling (`[status="done"]`, `[data-status="done"]`; `attr(name)`,
   `attr(data-name)`), and a bare-spelling rule is guarded with
   `:not([data-<name>])` so `data-*` still wins when both are present
   (SS2). Rules that only apply once the script is driving the element key on
   the `data-*` spelling alone, which rule 1 guarantees is present. A tag-form
   document is therefore presentable before and without any script, with
   no layout shift on upgrade where feasible.
4. **Every hide rule is gated** on `[data-sem-upgraded]` (D12). With no
   script in the page nothing is hidden: incorrect statements render labelled, views
   stack under their names, collapsed bodies and every conclusion show,
   audience-qualified content is all visible. A document without
   JavaScript shows its authored text and is not styled or interactive.
   `dist/demo/*.nojs.html` and `dist/spec/*.nojs.html` are the artifacts
   that prove it.
5. Content lives in light DOM (searchable, copyable); shadow DOM carries
   interactive chrome only. Generated chrome is classed (`.sem-facts-chrome`,
   `.sem-views-tabs`, `.sem-note-summary`) so extraction can skip it; a
   collapsed note's body is the element's own content, wrapped in
   `.sem-note-body` by the tier that hides it.
6. Cross-cutting, also in the vocabulary CSS: `@media print` shows
   everything a reader could open and no chrome (`beforeprint` opens reveal
   disclosures; CSS cannot); `prefers-reduced-motion` drops transitions and
   smooth scrolling.

## 5. Element entries

Each entry shows the canonical markup; the class-form alias for every
element is one row of Appendix A. Entries are grouped by conceptual bucket
(see the [Element buckets](#element-buckets) table above). Elements marked
**Zero-JS** render entirely from CSS and markup with no script dependency.

### Document & structure

**sem-enhanced-document** -- the required root wrapper; every SemText
document wraps its vocabulary in one. **Normative statement:
[§1 Document skeleton](#1-document-skeleton)** -- the script's handlers
scope to it, Lit components register against it, and it may carry a
`role="main"` landmark; the alias form may use
`<main class="sem-enhanced-document">`.

**sem-reader** -- reading chrome: outline, progress, focus, type, colour,
print, audience. **Normative: `spec/schema/sem-reader.md`.**
```html
<sem-reader controls="outline,progress,focus,type,color,print,audience" outline-depth="3">
  <nav aria-label="Contents">...optional, used verbatim...</nav>
</sem-reader>
```
One per document, first child of the wrapper. The script inserts
`.sem-reader-chrome` (`role="region"`), generates the outline from
`h2...h<depth>` when no nav is authored (`aria-current="location"` tracks
the heading in view), and writes `data-sem-mode|type|font` and
`data-color-mode` on `<html>` -- persisted via `localStorage`, fail-open.
Audience writes the `sem-audience` hash parameter. No global key
shortcuts. **Mints nothing**; extraction skips it whole (extraction SS3
rule 7). The `theme` control is R/W3.

**sem-audiences / sem-profile** -- reader profiles; metadata, mints nothing.
**Normative: `spec/schema/sem-audiences.md`.**
```html
<sem-audiences>
  <sem-profile id="reader" label="Reader"></sem-profile>
  <sem-profile id="operator" label="Operator" implies="reader"></sem-profile>
</sem-audiences>
<sem-note audience="operator">...</sem-note>
```
Active profile = hash `sem-audience` param, else `audience` on the root
wrapper / `data-audience` on `<html>`. The bundle sets native `hidden` on
non-matching elements; JS-off everything shows; fail-open on unknown tokens.

**agent** -- document-level metadata (bare semantic tag, no `sem-` prefix).
Documented in [SS1 Document skeleton](#1-document-skeleton) above. Children:
`<name>`, `<bio>`, `<instructions>`. Machine-facing, unstyled. Future metadata
children (`org`, `context`, `audience`) will follow the same bare-tag pattern.

### Prose & code

**sem-md** -- a Markdown block, rendered in the browser.
**Normative: `spec/schema/sem-md.md`.**
```html
<sem-md label="Token lifetimes">
  | Token   | Lifetime | Rotates |
  | :------ | -------: | :-----: |
  | access  | 15 min   | no      |
</sem-md>
```
The element's text is Markdown (GFM tables, headings, lists, emphasis,
links, code, quotes, rules; raw HTML renders as text). The script adds `.sem-md-chrome` (label, `Markdown` toggle with `aria-pressed`, copy,
status region), renders into `.sem-md-body` (real `<table>` with
`th[scope="col"]`, alignment row honoured) and keeps the normalised source
in a `sem-code` fence (`.sem-md-raw`); `view-as="rendered|raw"` picks the
initial mode and the toggle rewrites `data-view-as`. JS-off: the source
reads as pre-wrapped text. Extraction keeps `source` **normalised**
(dedented), never the rendering.

**sem-note** -- callout.
**Normative: `spec/schema/sem-note.md`.**
```html
<sem-note variant="warning">Rotation is <strong>per session</strong>.</sem-note>
<sem-note variant="tip" collapsed>Shuffle flashcards before each review session.</sem-note>
```
`variant="info|warning|tip|danger"`; the body is the element's content;
`collapsed` => ten-word teaser, click to expand (the tier wraps the body in
`.sem-note-body` to hide it); `view-as="margin"` => CSS-only right-gutter
aside on wide viewports, inline otherwise. Light DOM, `role="note"`.

**sem-code** -- verbatim listing with provenance and copy / wrap.
**Normative: `spec/schema/sem-code.md`.**
```html
<sem-code lang="ts" filename="src/rotate.ts" mark="2,4-5" controls="copy,wrap">...</sem-code>
```
The listing is authored flat -- the element's own text; the element
wraps it in `<pre><code>` when it enhances. The explicit `<pre><code>`
child form is equivalent and still supported. The script adds
`.sem-code-chrome` (filename, lang, buttons, status region), wraps
lines (`span|mark.sem-code-line`, text byte-identical), `tabindex="0"`
on an overflowing `<pre>`. JS-off: plain `<pre>` with a CSS caption.
Extraction keeps `source` **verbatim**.

**sem-browser** -- chrome-like document window; renders another SemText
document live (the window-frame sibling of `sem-code`).
**Normative: `spec/schema/sem-browser.md`.**
```html
<sem-browser src="/demo/example-deck.sem.html" label="the deck">
  <figure class="code-window">
    <div aria-hidden="true">← → ⟳</div>
    <div>demo/example-deck.sem.html</div>
    <iframe src="/demo/example-deck.sem.html" title="the deck" loading="lazy"></iframe>
  </figure>
</sem-browser>
```
With a `src` the element fetches the document (DOMParser-parsed,
`<script>` and `on*` stripped before adoption) into a focusable
`.sem-window-viewport` (`role="region"`); the authored children are the
zero-JS fallback and are hidden once wired. An address bar
(`.sem-browser-address`) shows inert nav glyphs and the declared src as
text; the tab title resolves `label` → document `<title>` → src basename.
Adopted elements are offered to `window.SemTextLazy.hydrate`, so a
lazy-built host renders the deck live. Failures render one
`role="alert"` line; `sem-browser-load` / `sem-browser-error` report the
outcome. Ships lazy-first (`chunks/sem-browser.js`) and rides the full
bundle after promotion. JS-off: the authored children are the document.

### Disclosure & views

**sem-detail / sem-details** -- prose with occludable content.
**Normative: `spec/schema/sem-details.md`.**
```html
<sem-details view-as="quiz">
  <sem-detail>
    The OIDC token travels in the <highlight>Authorization</highlight> header.
  </sem-detail>
</sem-details>
```
Plain view: `<highlight>` renders `<em>`. Quiz view: occluded (`???`), reveal
per item, self-check or auto-check.

**sem-tag-def / sem-api-call** -- reference-definition cards: a
vocabulary tag's or an API endpoint's contract, authored once, rendered
as a card (native table) for readers and extracted as one structured
record for machines.
**Normative: `spec/schema/sem-tag-def.md`, `spec/schema/sem-api-call.md`.**

**sem-reveal** -- Q-A disclosure, hidden until the reader acts.
**Normative: `spec/schema/sem-reveal.md`.**
```html
<sem-reveal summary="Why not localStorage?">
  Tokens in localStorage are readable by any script on the page...
</sem-reveal>
```
`summary` optional -- first body line (<=60 chars) derives it, by the
one rule in `src/shared/summary.ts` that render and extraction share;
hidden by default, `open` starts revealed (`collapsed` accepted, no-op).
Tag form: Lit component (labelled control, `aria-expanded`, blurred
body until revealed, one-way). Class form wraps in native
`<details>/<summary>`, closed by default; JS-off: fully visible
(summary as small-caps heading). Non-assertive counterpart to
`sem-fact` Q/A shape.

**sem-source** -- a section that flips between rendered and authored markup.
**Normative: `spec/schema/sem-source.md`.**
```html
<sem-source label="Facts -- flashcards">
  <h2>Facts -- flashcards</h2>
  <sem-facts view-as="flashcards">...</sem-facts>
</sem-source>
```
Chrome `Rendered | Source` (`aria-pressed`); `view-as="source"` starts in
source mode, showing the literal markup in a `sem-code` (copy, wrap) built
from the core's pre-enhancement snapshot; the toggle rewrites
`data-view-as`. Transparent to extraction; JS-off: the rendered children,
nothing else.

**sem-views / sem-view** -- same content, switchable perspectives.
**Normative: `spec/schema/sem-views.md`.**
```html
<sem-views id="deploy">
  <sem-view name="Helm" active role="tabpanel">content...</sem-view>
  <sem-view name="ArgoCD" role="tabpanel">content...</sem-view>
</sem-views>
```
`name` unique per container; `active` marks initial view (first wins if
absent; the bundle keeps the shown view in `data-active`); it builds
the tab bar (`.sem-views-tabs`, `role="tab"` buttons), arrow-key roving
focus; deep-link `#deploy/argocd`; fires `sem-navigate {id, name, index}`.
JS-off: all views stacked, `name`-headed. **Q3 resolved v1: `sem-views`.**

### Facts & recall

**sem-facts** -- collection; the flagship surface.
**Normative: `spec/schema/sem-facts.md`.**
```html
<sem-facts view-as="quiz" controls="shuffle,filter">
  <sem-fact>...</sem-fact>
  <sem-fact>...<incorrect-statement>decoy conclusion</incorrect-statement></sem-fact>
</sem-facts>
```
- `view-as="list"` (default): filter box, tag chips.
- `view-as="flashcards"`: front = statement (+`<highlight>` prompt), back =
  conclusion; flip click/Space; -/-/swipe; progress `3/12`; `shuffle`.
- `view-as="quiz"`: statement shown; candidates = sibling conclusions,
  `<incorrect-statement>` children win when present; accuracy on `sem-complete`.
- Events: `sem-navigate {index}`, `sem-flip {face}`, `sem-complete {correct,total,ms}`.

**sem-fact** -- the atomic unit; assertable Q/A pair.
```html
<sem-fact id="f-jwt" kind="concept">
  <statement>JWTs rotate per session</statement>
  <conclusion>Short-lived access; refresh grants a new pair.</conclusion>
</sem-fact>
```
Compact form: `<sem-fact>JWT rotation :: short-lived access</sem-fact>`.
Machine view: statement+conclusion = structured assertion.

**sem-question / sem-option** -- quiz question types (Tier 1 -- flagship buildout).
```html
<sem-question type="mc">
  <p data-kind="prompt">Which header carries the OIDC token?</p>
  <sem-option correct>Authorization</sem-option>
  <sem-option>Cookie</sem-option>
</sem-question>
```
Types `mc|multi|blank|match|order|tf|short`; `correct` attr canonical,
`?` sugar; `retry` control; results block; machine view = assertable Q/A.

### Data & tables

**sem-table** -- sortable, filterable authored table.
**Normative: `spec/schema/sem-table.md`.**
```html
<sem-table controls="sort,filter" sticky>
  <table><caption>...</caption><thead><tr><th scope="col">...</th></tr></thead>
  <tbody><tr><td data-value="900">15 min</td></tr></tbody></table>
</sem-table>
```
The `<table>` is the contract (no JSON payload). The script stamps
every body row `data-sem-source-index` once, wraps headers in
`button.sem-table-sort` (`aria-sort` cycle), filters with native `hidden`,
announces via `.sem-table-status`. Extraction returns
`{caption, columns[], rows[][]}` in **authored** order from the stamp --
the recorded SS5 exception. `sticky` header and `kind="comparison"`
first column are CSS in every tier. (`td[data-value]` is a sort key on a
plain HTML cell, not a vocabulary parameter -- it stays `data-*`.)

**sem-data-source, sem-data-query, sem-data-join, sem-data-visualizer** --
data connector elements (schemas defined, implementation pending).
Schema files: `spec/schema/sem-data-source.md`, `spec/schema/sem-data-query.md`,
`spec/schema/sem-data-join.md`, `spec/schema/sem-data-visualizer.md`.

### Sequences & progress

**sem-chronology / sem-event** -- dated, ordered events; CSS-only timeline.
**Normative: `spec/schema/sem-chronology.md`.**
```html
<sem-chronology kind="release-history" role="list">
  <sem-event role="listitem" when="2026-03-02" status="done">
    <time datetime="2026-03-02">2 Mar 2026</time> v0.1 tagged.</sem-event>
</sem-chronology>
```
`when`/`until` canonical; `<time>` child is the visible label
(else CSS renders `when`); `status` optional, same vocabulary as
`sem-step`; `view-as="timeline|list"`. DOM order = chronological order;
ordinals positional. **Zero-JS element.**

**sem-procedure / sem-step** -- ordered, status-annotated procedure.
**Normative: `spec/schema/sem-procedure.md`.**
```html
<sem-procedure kind="runbook" role="list">
  <sem-step role="listitem" status="done">provision Infisical path</sem-step>
  <sem-step role="listitem" status="current">port-forward MinIO</sem-step>
  <sem-step role="listitem">run migrations</sem-step>
  <sem-step role="listitem" status="blocked">cut release</sem-step>
</sem-procedure>
```
`status`: `done|current|todo` (default) `|blocked`; DOM order =
execution order (ordinals positional, CSS counters); status sugar
(`?/-/?`) is display-only -- `status` canonical. **Zero-JS element.**

**sem-progress** -- completion meter.
**Normative: `spec/schema/sem-progress.md`.**
```html
<sem-progress value="0.62" label="coverage"
     role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.62"></sem-progress>
```
`value` canonical 0..1 (render clamps, attr untouched); the script renders
track + fill + `label :: N%`; JS-off:
text-only via CSS `attr()` -- no fake bar; the caption is gated on the
`data-sem-upgraded` marker on the element,
so it never duplicates the script-free text. `status="done"` ? 1 by
convention.

### Interactive containers

**sem-workflow / sem-step** -- ordered steps carrying operational
metadata: `action` (required in workflow context), `description`,
`gate`, `check`, `if-no` (underscore `if_no` accepted by the
component), `output`; the shared `status` catalog applies.
**Normative: `spec/schema/sem-workflow.md`.**
```html
<sem-workflow kind="release" duration="45m">
  <sem-step action="Build images" gate="CI green" check="gh run view"
    if-no="fix CI, then re-run" output="dist/*.tar">push the tag</sem-step>
</sem-workflow>
```
JS-off: CSS-ordered list; ordinals are workflow-scoped counters; gate
(`⛨`) and check (`▸`) badges are `::before`/`::after` `attr()` chrome.
JS-on: an `if-no` step grows a collapsible branch (button with
`aria-expanded`/`aria-controls`), gated on the container's
`data-sem-upgraded` marker. The workflow step parameters are a
per-parent schema childForm: a sem-procedure step keeps its plain
status-only contract, and `action` outside a workflow is an
unknown-attribute warning.

**sem-site-tree / node** -- a tree authored as nested bare `<node
path label kind collapsed>` children (class form `div.sem-node`).
**Normative: `spec/schema/sem-site-tree.md`.**
```html
<sem-site-tree label="Monorepo layout">
  <node path="src" label="Source" kind="dir">
    <node path="src/lit" kind="dir"><node path="src/lit/app.ts"></node></node>
  </node>
</sem-site-tree>
```
JS-off: a static nested list purely via CSS (guides, counters,
`attr()` labels). JS-on: one shared engine (per-node collapse with
`aria-expanded`, filter box that keeps ancestor chains, find with
`data-match` marks and an Enter-cycled current match), all gated on
the `data-sem-upgraded` marker. `path` is required in tree context
(schema childForm); a stray `node` is an orphan-part warning.

**sem-file-tree** -- the same tree model authored as text: an
indented (box-drawing or whitespace) tree inside a `<pre>`, wrapped by
`<sem-file-tree mode="text">`.
**Normative: `spec/schema/sem-file-tree.md`.**
```html
<sem-file-tree mode="text"><pre>
assets/
├── icons/
│   └── logo.svg
</pre></sem-file-tree>
```
The pre **is** the record: JS-off it renders verbatim, nothing
fabricated; JS-on the shared engine parses the indentation (4-column
box segments, or the smallest whitespace indent unit; trailing `/`
marks a directory) and renders generated view rows with the same
collapse/filter/find chrome. A structured `<node>` form is also
accepted (dispatched on content).

### Definitions & citations

**sem-properties / sem-property** -- definition/properties block.
**Normative: `spec/schema/sem-properties.md`.**
```html
<sem-properties kind="config">
  <sem-property key="token ttl" role="definition" aria-label="token ttl">15m</sem-property>
</sem-properties>
```
`key` = the term, property text = the value. Zero-JS: key column
renders via CSS `attr(key)`; AT gets the pair via
`role="definition"` + `aria-label` = key. Compact `term :: value` sugar
(conventions SS3) is display-only -- `key` canonical. Renders
`<dl>`-equivalent grid; **Q2 resolved v1: pure definition list, no
copy/search chrome.**

**sem-references / sem-reference** -- numbered citable entries.
**Normative: `spec/schema/sem-references.md`.**
```html
<p>...per use<a href="#r-rfc">[1]</a>.</p>
<sem-references kind="bibliography" role="list">
  <sem-reference id="r-rfc" role="listitem" href="https://..." cite="RFC 6749">...</sem-reference>
</sem-references>
```
CSS-counter numbering in every document, scripted or not; the script adds
hover / focus
previews on citing anchors (`.sem-references-ref`, popover
`role="tooltip"`, `Esc` closes), backlinks (`aria-label="Back to citation
N"`) and an external link. Citations mint nothing; print shows `(href)`
inside the block only.

### NPL


NPL elements are loaded by `npl.js` / `npl-lazy.js` on top of the SemText
core. Each has a normative schema under `spec/schema/npl/`. The core bundle
(`semtext.js`, `semtext-lazy.js`) carries no NPL code. Each element also carries the class-form alias of Appendix A's NPL
namespace (`.npl-<element>` identity class, `data-<parameter>`
parameters, `.npl-<part>` part aliases).

Key NPL elements: `npl-agent` (agent definition), `npl-directive` (instruction),
`npl-section` (section marker), `npl-rubric` (scoring guide),
`npl-critique` (evaluation), `npl-declaration` (statement of intent),
`npl-example` (worked example), `npl-flag` / `npl-flags` (warning/note flags),
`npl-mindread` (intent/subtext analysis), `npl-thought` (reasoning trace),
`npl-poa` (plan of action), `npl-ref` (post-hoc reflection), `npl-vos` (voice/style),
`npl-artifact` (output artifact), `npl-mode` (operating mode),
`npl-mood` (tone), `npl-hormones` (drive settings),
`npl-cot` (chain of thought), `npl-intent` (intent declaration).

## 6. Theme conventions

- `data-sem-theme="<slug>"` on `<html>`; one theme per doc; themes compiled
  from TRP-format YAML - `semtext/themes/semtext-theme-<slug>.css`;
  `--sem-*` tokens; the vocabulary base (`semtext.css`) gives every `sem-*`
  element its box before any definition
  (`sem-*:not(:defined)` and the never-defined zero-JS elements
  alike -- custom elements are inline by default, the vocabulary is
  block-level).
- Shadow components read tokens via fallback indirection -- zero-JS theme flips.
- Ship 4 TRP ports: `minimal-tech-light` (default), `nocturne-console`,
  `organic-warm`, `editorial-settings`; auto light/dark via
  `prefers-color-scheme`, `data-color-mode` forces.

## 7. Distribution forms

1. **Folder** -- `doc.html` + relative `semtext/` (`semtext.js` +
   `semtext.css` + `themes/`).
2. **Single-file** -- the bundle + CSS + data all inlined; one file
   shares anywhere.
3. **MHTML** -- multi-page bundle.
4. Hard rules: no ES-module scripts; no runtime fetch in portable docs;
   `semtext.js` is the only script a document carries. A document without
   it shows authored text only -- not styled, not interactive (SS4).
5. **Hosted lazy** -- served pages only. A page served over HTTP(S) may
   load `semtext-lazy.js` + `chunks/` instead of the full bundle -- and an
   NPL document may load `npl-lazy.js` + `npl-chunks/` the same way, or
   `npl.js`, the optional full NPL bundle, on top of `semtext.js` when it
   wants every npl component without chunk loading. Each loader scans the
   document for its namespace's tags (`sem-*` / `npl-*`; a `<sem-text>`
   wrapper is welcome, not required) and imports only the component
   chunks those tags need -- components not on the page never download,
   and a failed chunk degrades only its own elements to authored prose
   with a `role="alert"` note. Core keeps only the `sem-*` components:
   `semtext.js` and `semtext-lazy.js` carry no npl code. The hard rules
   in (4) govern **portable** documents and are unchanged: forms 1-3
   still carry no ES-module scripts, and `semtext.js` remains the only
   script they carry. The trade is the point: the lazy surface cannot be
   saved to disk and reopened from `file://` -- dynamic import needs a
   server -- so a document that must survive offline carries the full
   bundle (SS2).

## 8. Machine-readability contract

- Semantic children (`<statement>`, `<conclusion>`, `<highlight>`) + attrs
  (`kind`, `status`, `tags`, `view-as`) qualify every datum.
- Well-formed, correctly nested HTML -- parseable by XML/HTML tooling; the same
  vocabulary is the XML variant of NPL (SS9). Custom elements with bare
  attributes are what an XML consumer sees: `<sem-fact kind="concept">`
  is one element with one attribute, no class list to tokenise and no
  `data-` prefix to strip. The document stays **valid HTML5** as well:
  bare attributes appear only on custom elements, and a standard element
  carries its qualifier as `data-*` (SS2).
- Events + attrs documented per schema = agent integration surface.
- "Text extraction" reference recipe (DOM - annotated plain text) ships with
  the lib for terminal/LLM pipelines.

### The extraction invariant (normative)

For any document `D`, where `E` is extraction, `R(D)` is `D` after
`semtext.js` has run, and `I(D)` is `D` after any
sequence of user interactions the vocabulary supports (tab switches, card
flips, reveals, table sorts and filters, audience profile switches,
`sem-source` / `sem-md` view toggles, reader chrome changes):

```
E(D) = E(R(D)) = E(I(R(D)))
```

Equality is deep equality of the record array, including `sourceOrder`, and
the same guarantee covers every `view-as` mode. This is the format's central
promise: the machine consumer does not get a degraded reading of what the
human consumer saw. The full formal statement -- the three refusal rules that
make it hold (extraction never looks at generated chrome, runtime state, or
presentation attributes: `data-view-as`, `data-active`, `collapsed`) and the
one recorded exception (`sem-table` row reordering, made safe by the
`data-sem-source-index` stamp) -- is normative and lives in
`spec/extraction.md` SS5; this section does not weaken or restate it.

### What a consumer may rely on

Normative, each item enforced by the tests named below:

- The record array: flat, document-ordered, `sourceOrder` = array index,
  containment a `parent` index tree; record shape fixed
  (`type`, `id`, `kind`, `tags`, `audience`, `parent`, `fields`, `text`,
  `sourceOrder` -- `spec/extraction.md` SS2).
- `audience` is carried verbatim on every record and never removes one;
  filtering by audience is a consumer operation on the extracted array.
- The annotated plain-text tier (`extractText` / `renderRecordsAsText`) is a
  pure function of the records, so it inherits the invariant unchanged.
- Extraction itself is a total, pure function: no configuration, no I/O, no
  DOM mutation (`spec/extraction.md` SS9).

### Best-effort only (not guaranteed)

- Which view an author meant to show first: `data-active` is a state marker,
  excluded from extraction by design. An author marks a primary perspective
  with a durable qualifier (`kind`, `tags`) on the view.
- Live presentation state (quiz answers, current sort, reader font/mode,
  disclosure state): invisible to extraction. If a consumer needs it, the
  vocabulary must carry it as a durable qualifier instead.
- Element families without a schema entry extract as plain records
  (`fields: {}`, prose `text`); their payloads are best-effort until a
  schema defines them.

Evidence (each bullet is asserted, not aspirational):
`test/e2e/extraction.cy.js` (invariant core: JS-off = JS-on, every
`view-as`, before/after interaction), `test/e2e/extraction-reading.cy.js`
(reading elements; sort + filter deep-equal baseline),
`test/e2e/sem-table.cy.js` (the recorded reordering exception),
`test/e2e/sem-audiences.cy.js` (invariant across profile switches),
`test/e2e/spec-pages.cy.js` (this document itself: records identical JS-off,
JS-on, and after interaction).

## 9. NPL XML-variant alignment

This vocabulary is the **XML variant of NPL**: NPL yaml already models agents
(name/bio/instructions), instructions, and structured prompt sections via the
MCP server; this format is its document-shaped rendering target. Alignment
tasks (tracked, not blocking M1): map `<agent>` children to NPL agent schema;
map `sem-fact` to NPL fact/knowledge records; define `sem-enhanced-document`
as a valid MCP `NPLLoad`/render target. ? **Q4** who owns the mapping -- this
repo exports it, or NPL MCP consumes a schema file we publish?

## 10. Open questions

| # | Question | My lean |
| :-- | :-- | :-- |
| Q1 | bare `<agent>` metadata children vs `sem-`-prefixed | bare (per your example; matches NPL yaml shape) |
| Q2 | `sem-properties` pure `<dl>` v1 | **resolved (this branch)** -- pure `<dl>`, chrome only if a consumer demands it |
| Q3 | tabs-family name: `sem-views` vs `sem-perspectives` | **resolved (this branch)** -- `sem-views` |
| Q4 | NPL MCP alignment ownership | we publish the schema file; MCP consumes |
| Q5 | fallback handler scope: baseline interactivity only vs full quiz logic | **resolved, superseded (2026-10)** -- the vanilla fallback is retired; one Lit bundle carries everything (spec v0.6) |
| Q6 | class-form alias lifetime: keep indefinitely, or retire once every reference document is tag-form | keep -- it costs one `:is()` per rule and lets HTML generators that cannot emit custom elements participate |

## Appendix A -- Class-form alias (v0.4 compatibility)

The v0.4 baseline spelled the vocabulary as **classes on plain elements**
with `data-*` parameters. Every tier still accepts that spelling and a
document may mix forms; it is an alias, not a second vocabulary. The
mapping is mechanical: identity = `class="sem-<element>"` on a `div`
(or `span` for inline parts), every bare parameter = `data-<parameter>`,
every bare child part = a `div`/`span` classed `.sem-<part>`. One
exception: `<incorrect-statement>`'s class form is the unprefixed
`.incorrect-statement`, matching its tag name exactly (user decision, v0.7).

| Canonical tag form | Class-form alias |
| :-- | :-- |
| `<sem-enhanced-document>` | `div.sem-enhanced-document` |
| `<agent>` + name/bio/instructions | `div.sem-agent` > `.sem-agent-name/-bio/-instructions` |
| `<sem-note variant="warning">` body | `div.sem-note[data-variant="warning"]` > `.sem-note-body`; `collapsed` attr |
| `<sem-audiences>` / `<sem-profile id label implies>` | `div.sem-audiences` > `div.sem-profile[id][data-label][data-implies]`; `audience="..."` - `data-audience` |
| `<sem-facts view-as="quiz">` | `div.sem-facts[data-view-as="quiz"]` |
| `<sem-fact>` > `<statement>` / `<conclusion>` | `div.sem-fact` > `.sem-statement`, `.sem-conclusion` |
| `<incorrect-statement>` | `div.incorrect-statement` |
| `<sem-details>` / `<sem-detail>` | `div.sem-details` > `div.sem-detail` |
| `<highlight>` | `span.sem-highlight` (occluded form: `.sem-occluded`) |
| `<sem-procedure>` / `<sem-step status>` | `div.sem-procedure` > `div.sem-step[data-status]` |
| `<sem-properties>` / `<sem-property key>` | `div.sem-properties` > `div.sem-property[data-key]` |
| `<sem-properties view-as="glossary">` | `div.sem-properties[data-view-as="glossary"]` > `div.sem-property[id][data-key]`; term anchors `<a href="#id">`, `<dfn>` optional |
| `<sem-views>` / `<sem-view name active>` | `div.sem-views[id]` > `div.sem-view[data-name]`, `data-active` marker |
| `<sem-reveal summary>` | `div.sem-reveal[data-summary]`, `open` attr (starts revealed; `collapsed` accepted, no-op) |
| `<sem-tag-def tag name group children>` / `<sem-tag-attr name type required default allowed>` | `div.sem-tag-def[data-tag][data-name][data-group][data-children]` > `div.sem-tag-attr[data-name][data-type][data-required][data-default][data-allowed]` |
| `<sem-api-call name method endpoint status>` / `<sem-api-param name in type required default allowed>` | `div.sem-api-call[data-name][data-method][data-endpoint][data-status]` > `div.sem-api-param[data-name][data-in][data-type][data-required][data-default][data-allowed]` |
| `<sem-progress value label>` | `div.sem-progress[data-value][data-label]` |
| `<sem-chronology view-as>` / `<sem-event when until status>` | `div.sem-chronology[data-view-as]` > `div.sem-event[data-when][data-until][data-status]` (+ `<time datetime>`) |
| `<sem-code lang filename mark wrap controls>` > `<pre><code>` | `div.sem-code[data-lang][data-filename][data-mark][data-controls]` > `<pre><code>` |
| `<sem-references kind>` / `<sem-reference id href cite>` | `div.sem-references[data-kind]` > `div.sem-reference[id][data-href][data-cite]`; citations are plain `<a href="#id">` |
| `<sem-source label view-as="html\|source">` > any content | `div.sem-source[data-label][data-view-as]` > any content; transparent wrapper, mints nothing |
| `<sem-reader controls outline-depth>` > optional `<nav aria-label="Contents">` | `div.sem-reader[data-controls][data-outline-depth]` > same optional nav; chrome, mints nothing |
| `<sem-md label view-as="rendered\|raw" controls>` > Markdown text | `div.sem-md[data-label][data-view-as][data-controls]` > Markdown text |
| `<sem-table controls sticky>` > `<table>` | `div.sem-table[data-controls][data-sticky]` > authored `<table>` (`<th scope="col">`, `td[data-value]` sort keys) |
| `<sem-workflow kind duration label>` / `<sem-step action description gate check if-no output status>` | `div.sem-workflow[data-kind][data-duration][data-label]` > `div.sem-step[data-action][data-description][data-gate][data-check][data-if-no][data-output][data-status]` |
| `<sem-site-tree label mode>` / `<node path label kind collapsed>` | `div.sem-site-tree[data-label][data-mode]` > `div.sem-node[data-path][data-label][data-kind]`, nested |
| `<sem-file-tree mode label>` | `div.sem-file-tree[data-mode][data-label]`; text form keeps the authored `<pre>`, structured form nests `div.sem-node[data-path]` |
| `<sem-browser src label>` > fallback figure | `div.sem-browser[data-src]` > the fallback children — with no script the div IS the framed document |

Rules the alias inherits unchanged: a `data-*` parameter wins over a bare
one on the same element (SS2); the hide rules, tier markers and events are
identical (SS4); extraction yields the **same records** from either form
(`spec/extraction.md`, the cross-form equality test in
`test/e2e/sem-source.cy.js`). Reference class-form documents:
`web/demo/index.html`, `web/demo/reading.html`.

### NPL namespace (npl-*)

The NPL namespace aliases by the same mechanical mapping: identity =
`class="npl-<element>"` on a `div` (or `span` for inline parts), every bare
parameter = `data-<parameter>`, every bare child part = a `div`/`span`
classed `.npl-<part>` -- parts may be read either way where a schema
documents it (`npl-ref` sections, `npl-critique` children). Parameters
read in either spelling with `data-<name>` winning, the same contract as
§2 (the `nplParam` reader implements it). One recorded exception:
`collapsed` on `npl-cot` -- the component mirrors the boolean to
`data-collapsed` for CSS/extraction parity but reads the bare attribute
only; its schema is normative for that attribute.

| Canonical tag form | Class-form alias |
| :-- | :-- |
| `<npl-agent name>` | `.npl-agent[data-name]` |
| `<npl-directive glyph>` | `.npl-directive[data-glyph]` |
| `<npl-section type>` | `.npl-section[data-type]` |
| `<npl-rubric title>` | `.npl-rubric[data-title]` > `.npl-criterion`, `.npl-overall-score` |
| `<npl-critique>` | `.npl-critique` > `.npl-subject`, `.npl-perspective`, `.npl-strengths`, `.npl-weaknesses`, `.npl-verdict` |
| `<npl-declaration version>` | `.npl-declaration[data-version]` |
| `<npl-example label>` | `.npl-example[data-label]` |
| `<npl-flag name>` | `.npl-flag[data-name]` |
| `<npl-flags preset>` | `.npl-flags[data-preset]` |
| `<npl-mindread confidence>` | `.npl-mindread[data-confidence]` |
| `<npl-thought type>` | `.npl-thought[data-type]` |
| `<npl-poa direction>` | `.npl-poa[data-direction]` |
| `<npl-ref variant>` | `.npl-ref[data-variant]` |
| `<npl-vos phase>` | `.npl-vos[data-phase]` |
| `<npl-artifact type>` | `.npl-artifact[data-type]` > `.npl-title`, `.npl-content` |
| `<npl-mode primary>` | `.npl-mode[data-primary]` |
| `<npl-mood mood>` | `.npl-mood[data-mood]` |
| `<npl-hormones variant>` | `.npl-hormones[data-variant]` |
| `<npl-cot>` | `.npl-cot`; `collapsed` stays bare in both forms (like `sem-note`, `sem-reveal`) |
| `<npl-intent>` | `.npl-intent`; parts in both spellings -- `.npl-intent-assumptions` etc. |

The alias form is the same compatibility contract Q6 keeps for the `sem-*`
tier: supported in both namespaces, tag form canonical. Each element's
schema (`spec/schema/npl/<element>.md`) is normative for its attribute
list.
