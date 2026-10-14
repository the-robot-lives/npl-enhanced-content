import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-directive — inline directive chip: the element form of an NPL inline
 * directive `⟪glyph: instruction | elaboration⟫` or prefix chip
 * `emoji➤ instruction`. Display-only; no events.
 *
 *   - `glyph` (required): the emoji or symbol leading the chip.
 *   - `kind`: `directive` (default) or `prefix` — a prefix chip renders the
 *     `➤` arrow between glyph and instruction, matching the prefix form.
 *   - `qualifier` (optional): trailing label beside the instruction.
 *   - children: the instruction text; an optional `|`-separated elaboration
 *     after it becomes the chip's `title` tooltip (authored text is never
 *     rewritten — the split reads the surviving light-DOM body).
 *
 * Light DOM (no shadow root, no static styles): the authored children are
 * wrapped into `.npl-directive-body` (content stays searchable/copyable),
 * the generated chrome is `.npl-directive-glyph` before it and
 * `.npl-directive-qualifier` after it — the sem-note wrapping pattern,
 * guarded so a re-update never double-wraps. Parameters resolve through the
 * dual-form contract (nplParam) and mirror to `data-*` in `updated()` via
 * afterParse, so a parse-time write never leaks into a sem-source snapshot.
 */
export class NplDirective extends SemElement {
  static properties = {
    glyph: { type: String },
    kind: { type: String },
    qualifier: { type: String },
  };

  declare glyph: string;
  declare kind: string;
  declare qualifier: string;

  #awaitingBody = false;
  /** params whose data-* form was authored (never mirror over those). */
  #authoredData: Set<string> | null = null;

  constructor() {
    super();
    this.glyph = '';
    this.kind = 'directive';
    this.qualifier = '';
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.#authoredData === null) {
      this.#authoredData = new Set(
        ['glyph', 'kind', 'qualifier'].filter((n) => this.hasAttribute('data-' + n)),
      );
    }
  }

  updated(): void {
    // dual-form contract: mirror the bare-attribute value to data-* (deferred
    // past parse, like npl-example); empty optionals mirror nothing, an
    // authored data-* form is left alone, and the resolved value is always
    // readable through nplParam.
    this.#mirror('glyph', this.glyph);
    this.#mirror('kind', this.kind, true);
    this.#mirror('qualifier', this.qualifier);
    this.#chip();
  }

  #mirror(name: string, value: string, always = false): void {
    this.afterParse(name, () => {
      if (this.#authoredData?.has(name)) return;
      if (value || always) this.setAttribute('data-' + name, value);
    });
  }

  #chip(): void {
    if (!this.querySelector(':scope > .npl-directive-body')) {
      // upgraded before its children parsed: wait for them (sem-note's handoff)
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        this.#awaitBody();
        return;
      }
      const body = document.createElement('span');
      body.className = 'npl-directive-body';
      while (this.firstChild) body.appendChild(this.firstChild);
      this.appendChild(body);
    }
    const body = this.querySelector(':scope > .npl-directive-body')!;

    const glyph = nplParam(this, 'glyph', this.glyph);
    const kind = nplParam(this, 'kind', this.kind);
    const qualifier = nplParam(this, 'qualifier', this.qualifier);

    let chrome = this.querySelector(':scope > .npl-directive-glyph');
    if (glyph) {
      if (!chrome) {
        chrome = document.createElement('span');
        chrome.className = 'npl-directive-glyph';
        this.insertBefore(chrome, body);
      }
      chrome.textContent = kind === 'prefix' ? `${glyph}➤` : glyph;
    } else if (chrome) {
      chrome.remove();
    }

    let tag = this.querySelector(':scope > .npl-directive-qualifier');
    if (qualifier) {
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'npl-directive-qualifier';
      }
      tag.textContent = qualifier;
      this.appendChild(tag);
    } else if (tag) {
      tag.remove();
    }

    // `instruction | elaboration` grammar: the elaboration rides the title
    // tooltip; an authored `title` wins, and the body text is left intact.
    const text = body.textContent || '';
    const bar = text.indexOf('|');
    if (bar >= 0 && !this.hasAttribute('title')) {
      this.title = text.slice(bar + 1).trim();
    }
  }

  #awaitBody(): void {
    if (this.#awaitingBody) return;
    this.#awaitingBody = true;
    void this.whenChildrenReady(':scope > *').then(() => {
      this.#awaitingBody = false;
      this.requestUpdate();
    });
  }
}

defineNpl('npl-directive', NplDirective);
