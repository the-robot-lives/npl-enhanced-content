# Schema — `sem-media-prompt`

An ACTIVE media-generation prompt record: the authored `.media.prompt`
YAML is the record, and — unlike its passive cached twin
`semext-media-prompt` (livePolicy 'never') — this sem-tier sibling can
run a generation through an author-controlled `endpoint` proxy, render
the returned assets and evals, and edit the prompt in place. It holds
no API keys and sets no auth headers: the browser's ambient credentials
are all it ever sends, and nothing it sends or receives is persisted by
the element. With no endpoint and no fixtures it is authored-only: it
never fabricates a generation.

Contract per conventions.md. BDD source of truth for
`test/unit/sem-media-prompt.test.ts`. Changes here precede spec changes
precede code.

## Scope semantics

`sem-media-prompt` frames one media-generation record and its output
history. The prompt is authored as `.media.prompt` YAML (media-tools
v0.4: `prompt`, `negative`, `aspect`, `seed` — parsed and validated by
the same `parseMediaPrompt` the refresh CLI uses, so the authoring form
and the CLI can never drift). Generations are displayed through the
existing `sem-media-gallery` (lightbox grid) and evals through the
existing `sem-eval` / `sem-rubric` display containers — this element
reinvents neither. It ships as its own lazy chunk (interactive stubs
are excluded from the core bundle) and registers idempotently through
the shared SemElement base.

## Authoring form

```html
<sem-media-prompt
  id="hero-banner"
  model="z-image-turbo"
  aspect="16:9"
  assets-dir="assets/"
  endpoint="/api/media/generate"
  org="noizu"
  project="semtext-site"
  key="hero-banner-16x9"
  status="idle"
>
  <pre><code class="language-yaml">prompt: SemText vocabulary diagram, flat vector, indigo accent
negative: text artifacts
aspect: 16:9
seed: 42
</code></pre>
  <sem-media-gallery items='[{"src":"assets/hero-v1.png","caption":"v1","mime":"image/png"}]'></sem-media-gallery>
  <sem-eval kind="recall" status="scored">
    <p>Brand palette fidelity — 4 / 5</p>
  </sem-eval>
  <script type="application/json">
    { "model": "z-image-turbo", "aspect": "16:9",
      "output": { "generated": true,
                  "assets": [ { "path": "assets/hero-v1.png", "kind": "image",
                                "mime": "image/png", "caption": "v1" } ],
                  "evals": [ { "rubric": "brand-palette", "score": 4, "max": 5 } ] } }
  </script>
</sem-media-prompt>
```

Class-form alias (Appendix A): `<div class="sem-media-prompt">…</div>`
— same dual-form contract as every `sem-*` element. Every attribute
below also reads its `data-<name>` mirror spelling; `data-<name>` wins
when both are present (conventions §2). Attributes are read live at
action time, so a host may rewrite them between runs.

- `aspect`: `string` — optional aspect token (`1:1`, `16:9`, `9:16`,
  `4:3`, `3:4`, `21:9`); the fallback when the YAML carries no `aspect`.
- `assets-dir`: `string` — optional directory prefix joined onto
  relative asset paths returned by the endpoint (absolute URLs pass
  through untouched); default none.
- `edit-mode`: `boolean` — renders the editable prompt textarea (see
  Edit mode); also honored through an ancestor `<sem-editor edit-mode>`.
- `endpoint`: `string` — the POST target for Generate; no default — an
  unset endpoint means authored-only, never a URL invented here.
- `fixtures`: `string` — optional fixture source: an inline JSON string
  or a same-origin path fetched once. While set, the element NEVER
  fetches `endpoint` (see Fixtures).
- `key`: `string` — the record key within the project (reference
  quartet; display-only for this element).
- `model`: `string` — optional generation model slug; passed through in
  the request body only when authored (an absent model sends no `model`
  key, so the server's default routing applies).
- `org`: `string` — the owning organization slug (reference quartet).
- `project`: `string` — the project slug within the organization
  (reference quartet).
- `status`: one of `idle`, `generating`, `generated`, `error` —
  lifecycle token, reflected; the runtime rewrites it as a run
  progresses (an authored value survives until the first action).
- `id`, `kind`, `tags` per the global attribute catalog.

The authored children are the record: a `.media.prompt` YAML code block
(`pre > code.language-yaml`, first match wins), generations in a nested
`sem-media-gallery`, evals in nested `sem-eval` / `sem-rubric`
containers, and an optional inline JSON snapshot
(`<script type="application/json">`). The element never moves,
rewrites or re-serializes any authored node — the YAML block stays
byte-identical with the script on or off.

The JSON snapshot mirrors the generation parameters and, once a run
landed, the asset manifest:
`{ "model", "aspect", "output": { "generated", "assets": [ { "path",
"kind", "mime", "caption" }, … ], "evals": [ { "rubric", "score",
"max" }, … ] } }`. A snapshot with `output.generated: true` renders its
assets and evals at upgrade — that is authored data being displayed,
not a fabrication. Fixtures outrank the snapshot when both are present.

## Generation contract

The Generate button renders only when `endpoint` is set and no
fixtures source is active. A run:

1. parses the authored YAML (invalid or missing prompt ⇒ inline error,
   no request);
2. reflects `status="generating"` and disables the button;
3. POSTs JSON to `endpoint`:
   `{ model?, prompt, negative?, aspect?, seed? }` — `prompt` /
   `negative` / `seed` from the YAML, `aspect` from the YAML when
   present else the `aspect` attribute, `model` from the `model`
   attribute only; `seed` is sent as an integer; absent optional keys
   are omitted, never sent empty;
4. reads the reply as `{ output: { assets: [ { path, kind, mime,
   caption } ], evals: [ { rubric, score, max } ] } }`;
5. renders the assets into the nested gallery (the authored one when
   present, else a chrome gallery it creates) and the evals as
   `sem-eval` containers, reflects `status="generated"`, and emits
   `sem-media-added` per asset so any other gallery on the page
   appends them too.

Asset `src` resolution: an absolute URL passes through; a relative
`path` is joined onto `assets-dir` when authored. `caption` defaults to
the path, `mime` to the empty string (the gallery then renders an
image). The element's own gallery never double-appends its own events:
assets it renders itself are set as gallery items, and the
`sem-media-added` emissions serve the OTHER galleries on the page.

Errors — network failures, non-2xx replies, an unparseable reply —
render inline as a `role="alert"` message, reflect `status="error"`,
re-enable the button, and surface through the shared author-warning
channel (`warn()`); nothing is thrown at the console.

## Fixtures

`fixtures` accepts an inline JSON string or a same-origin path (fetched
once, `Accept: application/json`). The payload is either the endpoint
reply shape (`{ output: { assets, evals } }`) or a bare array of gallery
items (`[ { src, caption, mime } ]`, the agent-kit media fixture shape).
A fixtures source applies at upgrade and makes the element local-only:
no Generate button, no request to `endpoint` ever — the demo stub
contract shared with `sem-chat`. A failed fixture load surfaces the
same inline alert as a failed run.

## Edit mode

With `edit-mode` (own attribute or an ancestor `<sem-editor edit-mode>`
— the base class queues the editor handoff either way) the chrome
gains a labelled textarea seeded with the authored YAML verbatim. Each
input re-parses the text: a valid parse emits `sem-media-prompt-change`
(bubbles, composed, detail = the parsed fields object — `prompt`,
`negative?`, `aspect?`, `seed?`, all strings as authored); an invalid
parse shows the parser's message inline and emits nothing. The textarea
is chrome: the authored YAML block is never rewritten — persisting an
edit is the host/editor's job, via the event.

## Events

- `sem-media-prompt-change` — bubbles, composed; detail is the parsed
  prompt fields object (Edit mode).
- `sem-media-added` — bubbles, composed; detail `{ src, caption, mime }`
  per returned asset, the window-level contract every
  `sem-media-gallery` listens for.

## Rendered form

Enhanced: the authored record renders as-is; all runtime chrome (params
line, Generate button, textarea, alert, runtime gallery and evals)
lives inside one `data-sem-chrome` container appended after the authored
children. JS-off: the authored YAML reads as a plain code block, the
authored gallery/evals as their own prose, and no chrome exists — the
§8 extraction invariant holds in both tiers (chrome is
extraction-invisible; authored bytes are never touched).

## Terminal text view

The component implements the optional `renderText(opts)` hook of the
`<sem-tui>` protocol (src/shared/text-render): a boxed `MEDIA PROMPT`
frame carrying the model/aspect title, the wrapped YAML fields, and an
output line — asset and eval counts with a bracket meter per eval when
a run has landed, else "not generated yet". The hook is pure: it reads
the authored record and the last output, never writes. Components carry
no render-mode logic; the shared driver mounts/unmounts the frame.

## Machine contract

`record: true`: extraction returns the authored YAML, gallery, evals
and snapshot content; runtime chrome never extracts. Contract per
conventions §8.

## Live-fetch policy

Active, endpoint-gated: the ONLY network this element ever performs is
the author-pointed `endpoint` POST (and the one same-origin fixtures
GET when a path is authored). No endpoint ⇒ no request, no generation,
no fabricated output — the authored record stands alone. This is the
deliberate sem-tier contrast to `semext-media-prompt`, whose
livePolicy is 'never' and whose output only the refresh CLI fills.