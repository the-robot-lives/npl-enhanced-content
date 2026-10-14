import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplEmit, nplParam } from './shared.js';

/**
 * npl-example — display-only placeholder proving the NPL component pattern
 * end to end. Delete it once real components exist (and its schema file
 * spec/schema/npl/npl-example.md); the pattern it demonstrates stays:
 *
 *   - extend SemElement — light DOM (no shadow root, no static styles),
 *     the `data-sem-upgraded` claim, afterParse, whenChildrenReady;
 *   - reactive `static properties` for parameters, mirrored to the
 *     `data-*` spelling in `updated()` via afterParse (the dual-form
 *     contract sem-note's variant follows; a parse-time write would leak
 *     into a sem-source snapshot, hence afterParse). The mirror writes the
 *     *resolved* value, so an authored `data-label` is never clobbered by
 *     the default (conventions §2: `data-*` wins when both are present);
 *   - generated chrome leads the element, authored children follow.
 *     Light DOM skips LitElement's renderBefore adjustment (base.ts returns
 *     `this`), so `updated()` enforces the order — npl-agent's rule;
 *   - render() for display-only output; authored children survive beside
 *     it (light DOM);
 *   - `defineNpl('<tag>', <Class>);` as the file's last line;
 *   - registration + the two-line import pair in ./index.ts, one CSS box
 *     line in the npl section of themes/_vocabulary.css, one schema file
 *     per spec/schema/npl/TEMPLATE.md, one unit spec per
 *     test/unit/npl-foundation.test.ts.
 */
export class NplExample extends SemElement {
  static properties = {
    label: { type: String, reflect: true },
  };

  declare label: string;

  constructor() {
    super();
    this.label = 'npl-example';
  }

  /** Resolved label: the `data-*` spelling wins when both are authored. */
  #resolved(): string {
    return nplParam(this, 'label', this.label);
  }

  updated(): void {
    // chrome order: the generated label leads the element, the authored
    // children follow. Light DOM skips LitElement's renderBefore adjustment,
    // so enforce the position here, where render and children have both
    // happened (npl-agent's rule). The check is against firstChild, not
    // firstElementChild: a text-only body (this tag's authored example) has
    // no element child to anchor on, and the label would stay appended after
    // it. Only the div moves; lit's text part keeps updating it in place.
    const label = this.querySelector(':scope > .npl-example-label');
    if (label && label !== this.firstChild) {
      this.insertBefore(label, this.firstChild);
    }
    // dual-form contract: data-label mirrors the resolved value, so an
    // authored data-label is never overwritten by the default (deferred past
    // parse, like sem-note — a parse-time write would leak into a
    // sem-source snapshot).
    this.afterParse('label', () => this.setAttribute('data-label', this.#resolved()));
  }

  render() {
    // A block-level label (like npl-agent-header / npl-section-header) so the
    // generated chrome reads on its own line, not fused inline with the
    // authored body; the vocabulary CSS only box-models the host.
    return html`<div class="npl-example-label">${this.#resolved()}</div>`;
  }

  /** Event contract demo: `npl-example-seen`, bubbles + composed. */
  announce(): boolean {
    return nplEmit(this, 'example-seen', { label: this.#resolved() });
  }
}

defineNpl('npl-example', NplExample);