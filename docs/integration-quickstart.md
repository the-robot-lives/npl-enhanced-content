# Integration quickstart — embedding SemText in a host site

Audience: developers adding SemText to an existing site or app (persona
P-004, "Framework Integrator"). Goal: a working, themed page in an
afternoon. This is a how-to; the normative contract is
[`spec/conventions.html`](../spec/conventions.html) and the per-element
schemas under [`spec/schema/`](../spec/schema/). For writing SemText
documents (as opposed to serving them), see the
[authoring guide](./authoring-guide.md).

## The model in one paragraph

A SemText document is a plain XHTML file. Two states can drive it:
**no script** (the vocabulary CSS alone renders a readable document —
this is the contract tier) and **the one bundle** (dist/semtext.js: Lit
custom elements, the vanilla handlers for everything no component
defines, and extraction, in a single classic IIFE installing the global
`SemText`). Your job as a host is to link the CSS, load the one script
deferred, and do nothing that breaks the zero-JS tier. Optional companions
ship alongside the bundle for the `npl-*` namespace (`npl.js`), opt-in lazy
mounts (`semtext-lazy.js`, `npl-lazy.js`) and the CLI (`semtext-agent.js`) —
none of them are needed for the standard vocabulary; see
`docs/arch/bundles.md`.

## Getting the artifacts

The npm package is `semtext`. The bundle is a classic IIFE script that
installs the global `SemText` and exports **nothing** — consume the
`semtext/lit` subpath as a `<script src>` tag (or a CDN URL), or as a
side-effect ESM import (`import 'semtext/lit'`). Named imports are not
available from it, and there is deliberately no `.` root export.

- **npm / bundler:** `npm install semtext`, then resolve
  `semtext/lit` to `dist/semtext.js` and emit it as a script tag (a
  side-effect import also works). `semtext/themes/*` maps to the raw
  CSS.
- **Vendored folder (portable docs):** copy `dist/semtext.js`,
  `dist/semtext.css` and `dist/themes/` next to your document as
  `semtext/` — this is distribution form 1 in the spec (§7) and is what
  makes `file://` double-click work.
- **CDN:** releases publish to `cdn.semtext.dev` under an immutable
  `/<version>/` prefix plus a mutable `/latest/` pointer (see
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)). Pin `/<version>/` in
  production; treat `/latest/` as a convenience for experiments only.

## The artifacts

The one runtime bundle, plus stylesheets. Sizes are measured from the current
`develop` build (raw minified / gzipped; CI enforces the script budget
via `build:strict`). Companions exist (`npl.js` for `npl-*` elements,
`semtext-lazy.js` / `npl-lazy.js` chunk loaders, `semtext-agent.js` CLI,
`semtext-js-shell.js` JS shell) — see `docs/arch/bundles.md` — but a page
that only wants the `sem-*` vocabulary needs exactly this table:

| File | Size | Installs | Drives | Load it when |
|---|---|---|---|---|
| `dist/semtext.js` | see `npm run build` | global `SemText` | Everything scripted: the Lit custom elements (`sem-note`, `sem-facts`, `sem-details`, `sem-properties`, `sem-code`, `sem-references`, `sem-reader`, `sem-table`, `sem-source`, `sem-md`, `sem-data-visualizer`, `sem-data-source`, `sem-quota-meter` and the provider/mode chrome), the vanilla handlers (views, reveals, highlight occlusion, quiz checking, audience gating, deep links, the `sem-source` snapshot), and extraction (`SemText.extractRecords` / `SemText.extractText`) | **Any page that wants interactivity or extraction.** There is no smaller script for that surface |
| `dist/semtext.css` | — | — | the required vocabulary layer | **Always** |
| `dist/themes/semtext-theme-<name>.css` | — | — | one theme on top of the vocabulary | **Always** (one theme of your choice) |

`sem-procedure`, `sem-chronology` and `sem-audiences` are **zero-JS
elements**: CSS renders them completely, no script ever defines them.

## Load order

```html
<link rel="stylesheet" href="semtext/semtext.css">
<link rel="stylesheet" href="semtext/themes/semtext-theme-minimal-tech-light.css">
<script defer src="semtext/semtext.js"></script>
```

One tag, and placement barely matters: `defer` is the only rule. Inside
the bundle the ordering is handled for you — the `sem-source` snapshot
pass runs before any chrome-building handler, the reader is generated
last, and the components skip anything already claimed. Every handler
and component agrees on one marker: `data-sem-upgraded`.

For a **portable document** (double-click from `file://`, shareable as
one file), the spec requires the script *embedded inline* in the page
(`<script>…</script>` with the bundle's bytes) rather than fetched —
portable docs make no runtime requests (§7). Use
`scripts/build-standalone.mjs` to assemble that form; it is what builds
this repo's own demos and spec pages.

## Theming

Two stylesheets: `semtext.css` (the built vocabulary — required, it
gives every `sem-*` element its box before and without any custom
element definition) and one theme file (today the repo ships
`semtext-theme-minimal-tech-light.css`; the wider theme set is gated on
the W3 theme pipeline, see `ROADMAP.md`). Set the theme on `<html>`:

```html
<html lang="en" data-sem-theme="minimal-tech-light">
```

Themes are plain CSS files (`--sem-*` tokens); link them from your own
hosting — `themes/*` ships in the published image and the npm package
(`files: ["dist", "themes"]`). Do not fork the vocabulary CSS to
re-theme; override `--sem-*` tokens or add a theme file.

## What renders with JavaScript off

With only the CSS and no script at all, a SemText document is complete
and readable: **every hide rule in the vocabulary is gated on the
`data-sem-upgraded` marker**, which only a script sets. No script ⇒
nothing is hidden — incorrect statements render labelled, tab views stack under
their names, collapsed bodies show, all audience-qualified content is
visible. Zero-JS elements (`sem-procedure`, `sem-chronology`,
`sem-audiences`, `sem-properties`, `sem-progress`, `sem-table` markup,
`sem-code`'s `<pre>`) never needed a script in the first place. The
mechanism is spec §4 rules 3–4; read that, don't re-derive it.

The repo proves this per page: `npm run build` emits a script-stripped
`<name>.nojs.html` variant next to every demo and spec page in `dist/`.
Adopt the same check for your own hosted documents if you can — the
honest test is *scripts removed*, not JS disabled.

## Minimal working example

```
mysite/
  index.html
  semtext/
    semtext.js
    semtext.css
    themes/semtext-theme-minimal-tech-light.css
```

```html
<!doctype html>
<html lang="en" data-sem-theme="minimal-tech-light">
<head>
  <meta charset="utf-8">
  <title>Rotation runbook</title>
  <link rel="stylesheet" href="semtext/semtext.css">
  <link rel="stylesheet" href="semtext/themes/semtext-theme-minimal-tech-light.css">
  <script defer src="semtext/semtext.js"></script>
</head>
<body>
<sem-enhanced-document>
  <h1 data-kind="title">Token rotation runbook</h1>

  <sem-note variant="warning">Rotation is <strong>per session</strong>.</sem-note>

  <sem-procedure kind="runbook" role="list">
    <sem-step role="listitem" status="done">provision the secret</sem-step>
    <sem-step role="listitem" status="current">cut the release</sem-step>
  </sem-procedure>

  <sem-facts view-as="flashcards">
    <sem-fact id="f-jwt" kind="concept">
      <statement>JWTs rotate per session</statement>
      <conclusion>Short-lived access; the refresh grant issues a new pair.</conclusion>
    </sem-fact>
  </sem-facts>
</sem-enhanced-document>
</body>
</html>
```

Serve it over HTTP (or open it from `file://` — the folder form needs no
server). `<sem-enhanced-document>` is the required root wrapper; the
handlers scope to it and Lit registers against it.

## Common pitfalls

- **Attribute spelling by element kind.** Bare parameters (`view-as`,
  `status`, `kind`) are canonical **on `sem-*` custom elements** and
  their part children. On a **standard HTML element** (`<h2>`, `<td>`,
  `<p>`) the same qualifier must be spelled `data-*`
  (`<h2 data-kind="section">`) — HTML5 allows no other custom attribute
  there. Both spellings are read on either kind of element.
- **Never write both spellings on one element.** `data-*` wins, but the
  combination is defined as an authoring error (spec §2), and a
  `sem-source` fence will display markup the readings disagree about.
- **Don't author runtime state.** `data-sem-upgraded`, `data-active`
  etc. are written by the script.
- **Don't import named exports.** The bundle has none; there is no `.`
  export at all. The one global is `SemText` — extraction included, as
  `SemText.extractRecords` / `SemText.extractText`.
- **Don't add ungated `display:none`.** Any hiding your host CSS adds
  must be gated on `data-sem-upgraded`, or you have broken the zero-JS
  contract for your page.

## Version pinning

Two independent versions, don't conflate them:

- **`specVersion`** (`"0.6"` in `package.json`) labels the *format
  draft* the documents and demo copy self-describe as. It moves with the
  spec, not with releases.
- **`version`** (the npm package version) labels the *artifacts*. The
  bundle file is stamped at build; the CDN publishes each release under
  an immutable `/<version>/` prefix, so pinning the CDN path or the npm
  version both give you a fixed artifact set.

A document authored against a spec draft reads correctly under every
artifact that accepts that draft; check `spec/conventions.html` for the
current draft before pinning an older artifact set.

## Where to go next

- Writing documents: [authoring guide](./authoring-guide.md)
- Normative reference: [`spec/conventions.html`](../spec/conventions.html),
  per-element contracts in [`spec/schema/`](../spec/schema/)
- Sizes/budgets and wave status: [`ROADMAP.md`](../ROADMAP.md)
- Release/branch policy and CDN publishing:
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)
