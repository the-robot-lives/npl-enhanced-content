# Schema — `semext-media-prompt`

An authored media-generation prompt with an output cache region
(authored prompt + output). The RECORD is the authored `.media.prompt`
YAML (media-tools v0.4); the OUTPUT is a cache region the future
refresh CLI fills — the element itself never fetches and never
generates, it only reports the region's state. Contract per
conventions.md and the namespace recipe in `src/lit/semext/index.ts`;
BDD source of truth for the media-prompt cases of
`test/unit/semext-embeds.test.ts` and `test/e2e/semext-embeds.cy.js`.

## Authoring form

```html
<semext-media-prompt
  id="hero-banner"
  model="z-image-turbo"
  aspect="16:9"
  assets-dir="assets/"
  org="noizu"
  project="semtext-site"
  key="hero-banner-16x9"
  status="fresh"
>
  <pre><code class="language-yaml">model: z-image-turbo
aspect: 16:9
prompt: SemText vocabulary diagram, flat vector, indigo accent
negative: text artifacts
</code></pre>
  <!-- semtext:cache:start semext-media-prompt hero-banner-16x9 -->
  <!-- semtext:cache:end semext-media-prompt hero-banner-16x9 -->
  <script type="application/json">
    { "model": "z-image-turbo", "aspect": "16:9", "output": { "generated": false } }
  </script>
</semext-media-prompt>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-media-prompt[data-model]` — same dual-form contract as the
sem-* tier, `data-<name>` wins when both spellings are present.

- `model`: `string` — the generation model slug (rendered in the
  params line; echoed verbatim).
- `aspect`: `string` — the aspect token (rendered in the params line).
- `assets-dir`: `string` — the directory the refresh CLI writes
  relative asset paths into (rendered in the params line).
- `id`, `kind`, `tags` per the global attribute catalog.

## Reference attributes

> The element points at an upstream record (the generation manifest);
> the quartet matches the schema's `reference` defPreset and rides the
> `cachedEmbed` preset.

- `org`: `string` — the owning organization slug.
- `project`: `string` — the project slug within the organization.
- `key`: `string` — the record key within the project; ALSO the cache
  region fence key (see Cached content).
- `id`: `string` — the specific record id (rides the global catalog).
- `fixtures`: `string` — optional fixture source (inline JSON or
  same-origin path) mirroring the generation parameters and manifest.
- `last-refreshed`: `string` — ISO-8601 stamp of the last sync.
- `status`: `string` — authored freshness token (`fresh` | `stale` |
  `error`); runtime rewrites it (`cached` | `stale` | `error` | `live`).

## Cached content

The authored inner content IS the record: the `.media.prompt` YAML in a
code block, plus the output cache region marked by comment fences
INSIDE the element:

    <!-- semtext:cache:start semext-media-prompt <key> -->
    …filled asset list (relative paths, e.g. an li/anchor per asset)…
    <!-- semtext:cache:end semext-media-prompt <key> -->

`<key>` is the element's `key` attribute; an unkeyed fence matches when
no `key` is authored. The fences are comments, so the region is
invisible to CSS, extraction and the position map; the component scans
childNodes READ-ONLY (never moves or rewrites the region — the CLI
owns those bytes) and reports state:

- filled (≥ 1 element entry between the fences) ⇒ a summary line ("N
  authored assets") + the host carries `data-semext-cache-region="filled"`.
- empty (no region, or a region with no asset entries) ⇒ the "Output
  not generated yet" placeholder chrome + `data-semext-cache-region="empty"`.

The optional JSON snapshot mirrors parameters and manifest:
`{ "model", "aspect", "output": { "generated", "assets": [ { "path",
"kind" }, … ] } }`. The chrome (params line + region state) renders
only when a snapshot source exists — for an ungenerated embed that is
an inline JSON child carrying at least the parameters, e.g.
`{ "model": "…", "aspect": "…" }`; without any JSON the element stays
exactly its authored record (JS-on and JS-off alike).

## Refresh contract

The refresh CLI (deferred lane) runs generation and rewrites ONLY the
region between the fences. SemText renders whatever the region holds —
relative asset paths as authored — and never resolves, fetches or
embeds the assets itself.

## Live-fetch policy

`livePolicy: 'never'` — authored record + region state only. No client
credentials ever, in any lane; generation is a CLI-side concern.
