import { html, nothing } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-declaration — display-only banner for an NPL declaration block: the
 * `⌜NPL@<version>⌝ ... ⌞NPL@⌟` (definition) and `⌜extend:NPL@<version>⌝`
 * ... ⌞NPL@⌟ (extension) source forms. The banner text renders as a header; the authored
 * children — the rules content — are the body and stay untouched (light DOM).
 *
 * Same pattern as npl-example (recipe: ./index.ts header):
 *
 *   - extend SemElement — light DOM (no shadow root, no static styles),
 *     the `data-sem-upgraded` claim, afterParse, whenChildrenReady;
 *   - reactive `static properties` mirrored to the `data-*` spelling in
 *     `updated()` via afterParse (the dual-form contract; a parse-time write
 *     would leak into a sem-source snapshot, hence afterParse);
 *   - `type` is `definition` (default) or `extension`; anything else falls
 *     back to definition. An extension names its `extend-target` when one is
 *     authored; a missing `version` warns (it is required) and renders bare.
 */
export class NplDeclaration extends SemElement {
  static properties = {
    version: { type: String, reflect: true },
    type: { type: String, reflect: true },
    extendTarget: { type: String, attribute: 'extend-target', reflect: true },
  };

  declare version: string;
  declare type: string;
  declare extendTarget: string;

  constructor() {
    super();
    this.version = '';
    this.type = 'definition';
    this.extendTarget = '';
  }

  /** The resolved kind — `extension` or `definition`; unknown falls back. */
  get kind(): 'definition' | 'extension' {
    return nplParam(this, 'type', this.type) === 'extension' ? 'extension' : 'definition';
  }

  updated(): void {
    // dual-form contract: the data-* spellings mirror the bare attributes,
    // so CSS/extraction read one form (deferred past parse, like sem-note).
    this.afterParse('version', () => this.setAttribute('data-version', this.displayVersion));
    this.afterParse('type', () => this.setAttribute('data-type', this.kind));
    this.afterParse('extend-target', () => {
      const target = this.displayTarget;
      if (target) this.setAttribute('data-extend-target', target);
      else this.removeAttribute('data-extend-target');
    });
    // banner-before-body: a light-DOM render appends the header after the
    // authored rules content, so hoist it above them once present; later
    // renders update the same element in place.
    this.afterParse('banner-order', () => {
      const banner = this.querySelector('.npl-declaration-banner');
      if (banner?.previousSibling) this.insertBefore(banner, this.firstChild);
    });
    if (!this.displayVersion) {
      this.warn('npl-declaration: version is required (⌜NPL@<version>⌝)');
    }
  }

  render() {
    const version = this.displayVersion;
    const mark =
      this.kind === 'extension' ? `⌜extend:NPL@${version}⌝` : `⌜NPL@${version}⌝`;
    const target = this.displayTarget;
    return html`
      <header class="npl-declaration-banner">
        <span class="npl-declaration-mark">${mark}</span>${target
          ? html`<span class="npl-declaration-target">${target}</span>`
          : nothing}
      </header>
    `;
  }

  /** Either authoring spelling; `data-version` wins (spec/conventions.md §2). */
  private get displayVersion(): string {
    return nplParam(this, 'version', this.version);
  }

  private get displayTarget(): string {
    return nplParam(this, 'extend-target', this.extendTarget);
  }
}

defineNpl('npl-declaration', NplDeclaration);
