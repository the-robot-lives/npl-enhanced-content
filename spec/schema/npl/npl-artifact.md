# Schema — `npl-artifact`

A structured output block with metadata — the display of an artifact an NPL
agent emits (generated code, a report, a figure). Display-only: no events, no
state; the authored children carry the data and the upgrade turns them into
display chrome in place (`title` becomes the heading, `content` becomes
preformatted text, or a sandboxed iframe when `type="svg"`) — Lit
`NplArtifact`, `src/lit/npl/npl-artifact.ts`.

## Authoring form

```html
<npl-artifact type="code">
  <title>Q3 revenue breakdown</title>
  <content>def q3(): return rows("2026-Q3")</content>
</npl-artifact>

<npl-artifact type="svg">
  <title>Quarterly trend</title>
  <content><svg width="320" height="120"><rect x="0" y="70" width="40" height="50"/><rect x="60" y="40" width="40" height="80"/><rect x="120" y="15" width="40" height="105"/></svg></content>
</npl-artifact>

<npl-artifact class="npl-artifact" data-type="text">
  <span class="npl-title">Release note</span>
  <span class="npl-content">v2.4 ships the viewer M2 lazy opt-in.</span>
</npl-artifact>
```

The first block is the tag form with a `code` artifact; the second shows the
only type that changes rendering (`svg` routes the content to a sandboxed
iframe); the third is the class-form alias with the `data-` parameter
spelling.

Class-form alias (conventions Appendix A, npl namespace):
`.npl-artifact[data-type]` with `.npl-title` / `.npl-content` part twins
(the bare-tag / class pair mirrors `sel`/`part`, src/shared/sel.ts).

- `type`: string — default `` (unset). A content type such as `text`,
  `code`, `svg`, `markdown`. `svg` routes the content through a
  sandboxed iframe; every other value (including unset) renders the
  content preformatted. Mirrored to `data-type` (dual-form contract;
  the mirror is deferred past parse via afterParse).
- `id`, `kind`, `tags` per the global attribute catalog — no bullet needed.

Children: `title` and `content` — bare tags or class aliases; the
enhancement preserves their authored inner nodes.

## Rendered form

- Enhanced: `<npl-artifact>` itself (Lit `NplArtifact` — light DOM, no
  shadow root). Generated chrome (`.npl-artifact-<part>`):
  - title → `<h3 class="npl-artifact-title">` heading;
  - content → `<pre class="npl-artifact-content">` for every non-`svg`
    type (preformatted text, searchable and copyable);
  - content → `<iframe class="npl-artifact-svg" sandbox="" srcdoc title>` for
    `type="svg"`. The markup is never inlined — untrusted SVG can carry
    `<script>` or event-handler attributes — and the empty `sandbox`
    attribute is the strictest setting: no scripts, no same-origin, no
    forms, no popups. The iframe carries the artifact title text as its
    accessible name (`title` attribute, fallback `SVG artifact` — an
    untitled iframe is a serious axe violation), states `frameborder="0"`
    to drop the legacy frame chrome, and mirrors the authored `<svg>`
    root's `width`/`height` when both are plain pixel lengths, so the
    artifact displays at its own size; with no authored dimensions it
    stays at the UA default and the theme layer owns the box.
- JS-off: the block box from the npl section of `themes/_vocabulary.css`
  (`npl-artifact, .npl-artifact { display: block; }`). Nothing hidden,
  nothing generated — the authored title and content read as plain
  prose.
