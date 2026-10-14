# npl-enhanced-content (SemText)

**Repo:** https://github.com/noizu-labs-ml/npl-enhanced-content

SemText — XHTML-first semantic markup: one document that reads as a styled interactive page, a structural record for LLMs, and plain text in a terminal. One Lit bundle (`dist/semtext.js`) + its stylesheet + themes; with JavaScript off the document degrades to plain prose. Zero React.

```html
<sem-enhanced-document>
  <sem-note variant="warning">Refresh tokens rotate per use.</sem-note>
  <sem-facts view-as="flashcards">
    <sem-fact id="f-jwt" kind="concept">
      <statement>JWTs rotate per session</statement>
      <conclusion>Short-lived access; the refresh grant issues a new pair.</conclusion>
    </sem-fact>
  </sem-facts>
  <sem-procedure kind="runbook" role="list">
    <sem-step role="listitem" status="done">provision the secret</sem-step>
    <sem-step role="listitem" status="current">cut the release</sem-step>
  </sem-procedure>
</sem-enhanced-document>
```

The vocabulary is **custom elements with bare attributes** (`view-as`, `status`, `kind`, `key`); `<sem-enhanced-document>` is the required root wrapper (conventions §1). Record **parts** are deliberately unprefixed children — `<statement>`, `<conclusion>`, `<highlight>` — because they only ever occur inside a `sem-*` record. The older `div.sem-*` + `data-*` spelling is a compatibility alias every tier still accepts — see `spec/conventions.md` Appendix A.

## What

The NPL ecosystem's rich-content spec plus its JavaScript artifacts (`package` name: `semtext`):

- **`spec/`** — normative format specs: conventions (`.md`/`.html`), extraction rules, and `spec/schema/` (Tier-0 schemas).
- **`src/`** — one classic-IIFE artifact, `dist/semtext.js` (`semtext/lit`, global `SemText`): the Lit custom elements, the vanilla handlers, and extraction (`SemText.extractRecords` / `SemText.extractText`), all exporting nothing — consume as `<script src>`/CDN or side-effect ESM import. `dist/semtext.css` + `themes/*` ship as raw CSS.
- **`web/`** — demo + site; **`test/`** — Cypress e2e + support; **`docs/`** — PROJ-ARCH/LAYOUT/SCHEMA docs with `.summary.md` digests.

There is deliberately no `.` export — ROADMAP debt D9: dropping it removes the false promise of an importable root rather than papering over it.

## Why

NPL content was plain text; agents and humans need the same document to serve both. SemText makes XHTML the canonical form: LLMs read structure, browsers render styled interactive content via Lit islands, and terminal/plain-text consumers get a graceful reduction — one source, three readings, no React runtime.

## Getting Started

```bash
npm install
npm run build           # scripts/build.mjs + build-standalone.mjs → dist/
npm run build:strict    # build with strict size budget
npm run test:unit       # vitest
npm test                # cypress e2e (run AFTER npm run build — tests run against dist/demo/, not web/demo/ markers)
npm run serve           # vite preview on :4173
```

## How It Works

- Author XHTML using the SemText conventions/spec; the one bundle (`semtext/lit` → `dist/semtext.js`) registers custom elements and runs the vanilla handlers that progressively enhance it in the browser, and pulls the plain-text/structural reduction via `SemText.extractRecords` / `SemText.extractText`. With the script absent, the document reads as plain prose.
- Top-level directories are domains: `spec/`, `src/` (`lit/`, `fallback/`, `reading/`, `md/`, `extract/`, `shared/`), `themes/` (kept top-level as a subpath export + CDN asset), `web/`, `test/`, `scripts/`, `docs/`.
- Builds enforce a size budget (`build:strict`); theme CSS doubles as a CDN asset.

## Agent toolkit (`semtext-agent`)

Machine tooling over the extraction contract (§8 of `spec/conventions.md`):
agents read and edit the **authored XHTML** — never a markdown lossy copy —
through one CLI that is also an importable module (`dist/semtext-agent.js`,
global `SemTextAgent`; `./agent` subpath export). Every command accepts
`--json`; compact human text is the default. Requires `npm run build` first.
`write` and `edit` always validate against `spec/schema/semtext.schema.json`
and refuse to write on errors.

```bash
node bin/semtext-agent.mjs <command> <file> [args] [--json]
```

| command | purpose | example |
|---|---|---|
| `outline <file> [--depth N]` | one stable id per block, nested, no bodies | `semtext-agent outline web/demo/index.html --depth 2` |
| `expand <file> <id> [--format xhtml]` | lazy expansion of one block by id | `semtext-agent expand web/demo/index.html x-sec-procedure-status-runbook` |
| `filter <file>` | select blocks by type/id/kind/tag/attr/audience/selector (AND) | `semtext-agent filter web/demo/index.html --kind runbook --audience operator` |
| `search <file> <query> [--regex] [--attrs]` | full-text or attribute search, ids + short context | `semtext-agent search web/demo/index.html PKCE` |
| `write` | markdown (or SemText fragment) in → validated SemText XHTML out | `echo 'note' \| semtext-agent write --format md --id n-new` |
| `edit <file> --id <id> --content X [--mode outer]` | surgical single-block replacement; bytes outside untouched | `semtext-agent edit page.html --id n-tip --content 'New text' --in-place` |
| `xslt <file> <stylesheet>` | XSLT transform of the serialized document | `semtext-agent xslt page.html facts.xsl` |

Details agents should know:

- **ids** — authored `id`s are used verbatim; blocks without one get a
  deterministic minted id (`x-<type>-<slug>`) in both `outline` and `edit`.
- **audience** — `filter --audience <profile>` resolves `sem-profile`
  `implies` chains and `!negations`; unqualified content is always visible.
- **fragments** — `write` output is validated in its embedding context
  (wrapped in `<sem-enhanced-document>` when the fragment carries no root).
- **edit** — replaces one block's inner HTML (`--mode inner`, default) or the
  whole element (`--mode outer`) by scanning the source; everything outside
  the block is byte-identical. Add `--in-place` to write back, `--out FILE`
  otherwise.
- **xslt** — prefers the pure-JS `xslt-processor` (optional peer dep),
  falls back to the `xsltproc` binary. The class form (`div class="sem-fact"`)
  and the tag form (`<sem-fact>`) are both real elements after
  serialization; select with `//*[contains(concat(' ',normalize-space(@class),' '),' sem-fact ')]`
  or `//sem-fact` accordingly.

Importable core (no DOM environment needed until you pass one). The bundle is
an IIFE, so in Node evaluate it and take the global it defines (in a browser,
a plain `<script src>` is enough):

```js
import { readFileSync } from 'node:fs';
const SemTextAgent = new Function(
  readFileSync('./dist/semtext-agent.js', 'utf8') + ';return SemTextAgent;',
)();
const doc = new Window().document; // parse your file…
SemTextAgent.outline(doc.body, 2);      // → OutlineNode[] (compact; no bodies)
SemTextAgent.expand(doc.body, 'f-jwt'); // → text for one block
```

## Command line (`semtext`) — pipes and the terminal

`bin/semtext.mjs` is the user-facing front end: pipe-friendly commands plus an
interactive browser. Every pipe command reads a document from a file or stdin
(`-`), writes data to stdout only, and never prompts. Exit codes follow the
grep convention — **0** ok, **1** usage or parse error, **2** no matches —
with errors on stderr only. (The agent CLI's contract differs: 1 domain
error, 2 usage; its `--json` shapes are depended on, so the two are
deliberately not merged.)

```console
$ # the headline pipe: pick records, render them as plain text
$ semtext filter --type sem-facts doc.html | semtext format --text

$ # filter by attribute or free text; emit normalised XHTML by default
$ semtext filter --attr data-variant=warning doc.html
$ semtext filter --text "device flow" doc.html --json | jq '.[].id'

$ # heading tree, whole-document formats, one block in full
$ semtext outline doc.html | head -20
$ semtext view doc.html            # plain text (== `semtext format --text`)
$ semtext format doc.html > normalised.html
$ semtext expand doc.html f-jwt
```

`--json` on `outline` / `filter` / `expand` / `format` emits machine-readable
records. Read a document from stdin with `-`
(`cat doc.html | semtext outline -`).

### Terminal browser

```console
$ semtext tui doc.html
```

Keyboard only: **arrows / j / k** move · **Enter** expand or collapse ·
**/** search — type, Enter jumps to the first hit and closes the prompt
(**n** cycles matches, Esc cancels) · **r** raw source of the current
element · **q** quit. The browser runs entirely in the
terminal (alternate screen, no dependencies beyond Node's stdlib) and
restores the terminal on quit or error. Without a TTY it refuses to start
with a stderr note and exit code 1.

## Docs

`docs/PROJ-ARCH.md`, `docs/PROJ-LAYOUT.md`, `docs/PROJ-SCHEMA.md` (digests alongside); normative specs in `spec/`.

## Analytics (GA4)

Analytics are off by default. The measurement id is a **deploy-time** value, not
a build-time one: `index.html` ships an inert `<!-- GA_MEASUREMENT_ID_SNIPPET -->`
marker, and `docker/20-ga-measurement-id.sh` (run by nginx's stock
`/docker-entrypoint.d/` hook on every container start) regenerates the served
page from a pristine template in the image.

- `GA_MEASUREMENT_ID` set to a `[A-Za-z0-9_-]+` id → the gtag snippet is injected.
- unset, empty, or malformed → the marker line is dropped entirely: no script
  tag, no partial tag, no comment, no JS.

Enable it via the chart value:

```yaml
gaMeasurementId: "G-XXXXXXXXXX"   # helm/<chart>/values.yaml, default ""
```

Flipping it is a redeploy of the same image — no rebuild.
