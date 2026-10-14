import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-artifact — a structured output block with metadata (an NPL artifact).
 *
 * Display-only: no events, no state. The authored children carry the data —
 * `title` and `content`, either as bare tags or as the class-form aliases
 * `.npl-title` / `.npl-content` (the part twins of `sel`/`part` in
 * src/shared/sel.ts, nspaced to npl). Enhancement converts those two into
 * display chrome in place, preserving the authored inner nodes:
 *
 *   - title   → `<h3 class="npl-artifact-title">` (the heading);
 *   - content → `<pre class="npl-artifact-content">` — preformatted text —
 *     for every type except `svg`;
 *   - content → `<iframe class="npl-artifact-svg" sandbox="" srcdoc=…>`
 *     for `type="svg"`. The markup is NOT inlined: untrusted SVG can carry
 *     `<script>` and event-handler attributes, and even inside light DOM a
 *     browser would fire those handlers. It is handed to an iframe with an
 *     EMPTY sandbox attribute — the strictest setting (no scripts, no
 *     same-origin, no forms, no popups) — via `srcdoc`. The iframe gets the
 *     artifact title as its accessible name (`title` attribute; an untitled
 *     iframe is a serious axe violation), `frameborder="0"` to drop the
 *     legacy frame chrome, and mirrors the authored `<svg>` root's pixel
 *     `width`/`height` so the figure displays at its own size instead of
 *     the UA-default 300×150 box.
 *
 * The `type` parameter is optional; absent (or anything but `svg`) renders
 * the content preformatted, which is the safe display of raw text.
 * Light DOM throughout (PRD §4 rule 5): content stays searchable and
 * copyable; recipe: ./index.ts header.
 */
const TITLE = ':scope > :is(title, .npl-title)';
const CONTENT = ':scope > :is(content, .npl-content)';
const CHILDREN = ':scope > :is(title, content, .npl-title, .npl-content)';

/** Plain pixel length ("320", "320px") read from an attribute; else null.
 *  SVG root attributes are authored data — read, never executed. */
function pxAttr(el: Element | null, name: string): string | null {
  const v = el ? el.getAttribute(name) : null;
  if (!v || !/^\d+(\.\d+)?(px)?$/.test(v)) return null;
  return String(Math.round(parseFloat(v)));
}

export class NplArtifact extends SemElement {
  static properties = {
    type: { type: String, reflect: true },
  };

  declare type: string;

  #enhanced = false;
  #watching = false;

  constructor() {
    super();
    this.type = '';
  }

  updated(): void {
    // dual-form contract: bare `type` mirrors to `data-type`, deferred past
    // parse so a sem-source snapshot never sees the runtime write — and an
    // authored `data-type` is never clobbered (it wins over bare `type`).
    if (this.type) {
      this.afterParse('type', () => {
        if (!this.hasAttribute('data-type')) this.setAttribute('data-type', this.type);
      });
    }
    if (this.#enhanced || this.#watching) return;
    this.#watching = true;
    void this.whenChildrenReady(CHILDREN).then(() => {
      // one-shot: the display is fixed at enhancement time.
      this.#enhanced = true;
      this.enhance();
    });
  }

  /** Turn the authored title/content children into their display chrome. */
  private enhance(): void {
    const type = nplParam(this, 'type', this.type || 'text');

    const title = this.querySelector(TITLE);
    // Capture the title text BEFORE the nodes move — the iframe's a11y name.
    const label = title?.textContent?.trim() || '';
    if (title) {
      const heading = document.createElement('h3');
      heading.className = 'npl-artifact-title';
      while (title.firstChild) heading.appendChild(title.firstChild);
      title.replaceWith(heading);
    }

    const content = this.querySelector(CONTENT);
    if (!content) return;

    if (type === 'svg') {
      // Sandbox the markup instead of inlining it: scripts cannot run.
      const frame = document.createElement('iframe');
      frame.className = 'npl-artifact-svg';
      frame.setAttribute('sandbox', '');
      frame.setAttribute('title', label || 'SVG artifact');
      frame.setAttribute('frameborder', '0');
      const root = content.querySelector('svg');
      const w = pxAttr(root, 'width');
      const h = pxAttr(root, 'height');
      if (w && h) {
        frame.setAttribute('width', w);
        frame.setAttribute('height', h);
      }
      frame.setAttribute('srcdoc', content.innerHTML);
      content.replaceWith(frame);
      return;
    }

    const pre = document.createElement('pre');
    pre.className = 'npl-artifact-content';
    while (content.firstChild) pre.appendChild(content.firstChild);
    content.replaceWith(pre);
  }
}

defineNpl('npl-artifact', NplArtifact);
