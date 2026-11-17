# Schema — `semext-draftamo-diagram`

An inline Draftamo diagram whose XML is the authored children of the element, so a document or chat message carries the whole diagram with no share link, iframe or fetch.
The notation is the one Draftamo's
studio uses (class diagrams today; sequence and wireframe follow).

Contract per conventions.md and the namespace recipe in
`src/lit/semext/index.ts`. Prose is normative; the BDD source of truth for
`test/unit/semext-draftamo-diagram.test.ts`.

## Authoring form

```html
<semext-draftamo-diagram kind="uml-class" label="Hello world">
  <semext-draftamo-node id="a">Hello</semext-draftamo-node>
  <semext-draftamo-edge from="a" to="b"></semext-draftamo-edge>
  <semext-draftamo-node id="b">World</semext-draftamo-node>
</semext-draftamo-diagram>
```

Class-form alias (conventions Appendix A, semext namespace):
`.semext-draftamo-diagram[data-kind]`; `data-<name>` wins when both
spellings are present.

- `kind`: `token` — default `uml-class`. The notation. Only the box-and-arrow form is
  rendered today; other kinds render the same way until their renderers land.
- `label`: `string` — default `Diagram`. The accessible name prefix.
- `viewer-src`: `string` — default: the release-published viewer bundle on the org CDN,
  VERSION-PINNED (`https://cdn.derobot.is/draftamo/v<release>/draftamo-viewer.js`,
  immutable object; the constant bumps with each published release). When non-empty, the
  element lazily imports that module (`{ createViewer }`) after the 2D SVG renders and
  mounts the native `GraphDocument` 3D view in its place; a failed or blocked load
  warns once and the 2D SVG simply remains. `viewer-src=""` forces 2D-only.

  Trust expectations for the default: (1) a consumer whose page sets a CSP must allow
  `script-src https://cdn.derobot.is` — no first-party consumer defines a CSP today
  (verified 2026-11-17); (2) the default URL is immutable per version — integrity-sensitive
  deployments should keep the pinned default (or pin their own `viewer-src`), not track
  `latest/`; (3) the publish of a new version dir is owner-gated, and the default constant
  bumps only in the release that publishes it. Accepted residual: dynamic `import()` cannot
  carry an SRI attribute (platform limitation), so integrity rests on the immutable
  version object + the org-controlled, owner-gated bucket — not on a content hash.
- `id`, `tags` per the global attribute catalog — no bullet needed.

## Children

- `<semext-draftamo-node id label?>text</…>`: one box. The label is the `label`
  attribute, else the trimmed text, else the `id`. Ids are unique within the
  element.
- `<semext-draftamo-edge from to label?>`: one arrow from node `from` to node `to`. An edge
  naming an unknown id is ignored.

Bare `<node>` and `<edge>` are not used: `node` is already a defined part of `sem-site-tree` and `sem-file-tree`, so the diagram carries its own namespaced parts.

## Cached content

The authored children ARE the record: extraction reads them, never the
network. The element never fetches (`livePolicy` never).

## Rendered form

- **Enhanced** (`data-sem-upgraded`): an SVG in a `data-sem-chrome`
  container, boxes laid out left to right by longest-path rank (cycle-safe),
  arrows with heads, `role="img"` and an accessible name
  `<label> (<kind>): Hello → World`. The authored children stay in the DOM
  but are hidden.
- **JS-off**: the children read as plain inline text with an arrow between
  nodes joined by an edge: `Hello → World`. Nothing is generated or hidden.
  Colour is never the only carrier: edges are arrows, nodes are boxes.
