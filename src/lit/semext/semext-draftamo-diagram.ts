import { html, render, svg, type TemplateResult } from 'lit';
import { SemElement } from '../base.js';
import { defineSemext, semextParam } from './shared.js';
import { describe, layout, parseDiagram, type DiagramModel } from './draftamo-diagram-model.js';

/**
 * semext-draftamo-diagram — an INLINE Draftamo diagram: the diagram XML is
 * the authored children of the element (no share link, no iframe, no fetch).
 *
 *   <semext-draftamo-diagram kind="uml-class" label="Hello">
 *     <semext-draftamo-node id="a">Hello</semext-draftamo-node><semext-draftamo-edge from="a" to="b"></semext-draftamo-edge>
 *     <semext-draftamo-node id="b">World</semext-draftamo-node>
 *   </semext-draftamo-diagram>
 *
 * Children: `<semext-draftamo-node id label?>text</…>` (label = attribute, else text) and
 * `<semext-draftamo-edge from to label?>`. (Bare `<node>` is taken: it is a part of
 * sem-site-tree / sem-file-tree.) Enhanced, an SVG renders left to right by rank
 * inside a `data-sem-chrome` container and the authored children are hidden
 * (still in the DOM, so extraction reads them). JS-off, the children read as
 * plain text; the vocabulary rules add the arrow so it reads "Hello → World".
 * `kind` (default `uml-class`) is the notation; only the box-and-arrow form
 * ships today. `livePolicy` is never: the element does not fetch.
 */
export class SemextDraftamoDiagram extends SemElement {
  static override properties = {
    kind: { type: String, reflect: false },
    label: { type: String, reflect: false },
  };
  declare kind: string;
  declare label: string;

  #chrome: HTMLElement | null = null;
  #mo: MutationObserver | null = null;

  constructor() {
    super();
    this.kind = 'uml-class';
    this.label = 'Diagram';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#mo = new MutationObserver((records) => {
      // Ignore our own chrome writes; only authored edits re-render.
      if (records.every((r) => this.#chrome && this.#chrome.contains(r.target))) return;
      this.requestUpdate();
    });
    this.#mo.observe(this, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  override disconnectedCallback(): void {
    this.#mo?.disconnect();
    this.#mo = null;
    super.disconnectedCallback();
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    this.afterParse('semext-draftamo-diagram:chrome', () => this.#paint());
  }

  #paint(): void {
    const model = parseDiagram(this);
    if (model.nodes.length === 0) {
      this.#chrome?.remove();
      this.#chrome = null;
      return;
    }
    if (!this.#chrome) {
      const chrome = document.createElement('div');
      chrome.className = 'semext-draftamo-diagram-chrome';
      chrome.setAttribute('data-sem-chrome', '');
      this.#chrome = chrome;
      this.append(chrome);
    }
    this.#mo?.takeRecords();
    render(this.#svg(model), this.#chrome);
    this.#mo?.takeRecords();
  }

  #svg(model: DiagramModel): TemplateResult {
    const { pos, width, height } = layout(model);
    const kind = (semextParam(this, 'kind') ?? this.kind ?? 'uml-class').trim() || 'uml-class';
    const name = `${(semextParam(this, 'label') ?? this.label ?? 'Diagram').trim() || 'Diagram'} (${kind}): ${describe(model)}`;
    const edges = model.edges.map((e) => {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const [x1, y1, x2, y2] =
        b.x > a.x ? [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2]
        : b.y >= a.y ? [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y]
        : [a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h];
      return svg`<line class="semext-draftamo-diagram-edge" x1=${x1} y1=${y1} x2=${x2} y2=${y2} marker-end="url(#semext-dd-arrow)"></line>`;
    });
    const boxes = model.nodes.map((n) => {
      const p = pos.get(n.id)!;
      return svg`<g><rect class="semext-draftamo-diagram-box" x=${p.x} y=${p.y} width=${p.w} height=${p.h} rx="4"></rect>
        <text class="semext-draftamo-diagram-text" x=${p.x + p.w / 2} y=${p.y + p.h / 2} text-anchor="middle" dominant-baseline="central">${n.label}</text></g>`;
    });
    return html`<svg viewBox="0 0 ${width} ${height}" width=${width} role="img" aria-label=${name}>
      <defs><marker id="semext-dd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="semext-draftamo-diagram-head" d="M0 0 L10 5 L0 10 z"></path></marker></defs>
      ${edges}${boxes}</svg>`;
  }
}

defineSemext('semext-draftamo-diagram', SemextDraftamoDiagram);
