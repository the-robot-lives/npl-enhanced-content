/**
 * agent-kit/agent-kit-asset — the cached media asset card (contract
 * spec/schema/agent-kit/asset.md), promoting the sem-media-gallery item
 * shape to a cached embed: one `src` (the CACHED URL), a `mime` chip and
 * an authored `<agent-kit-caption>` part — the caption is the record.
 *
 * The `src` attribute is rendered verbatim into a chrome `<img>` — the
 * browser's own image load, never an element fetch — and with JavaScript
 * off no image element exists (the authored caption stands alone).
 * livePolicy 'never', like every agent-kit-* element.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitPartText } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitAsset extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    src: { type: String },
    mime: { type: String },
  };

  declare src: string;
  declare mime: string;

  constructor() {
    super();
    this.src = '';
    this.mime = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-asset-chrome', () => this.#renderAuthoredChrome());
  }

  #renderAuthoredChrome(): void {
    akitChrome(this, 'agent-kit-asset-chrome', () => {
      const src = (this.src ?? '').trim();
      const mime = (this.mime ?? '').trim();
      const caption = akitPartText(this, 'agent-kit-caption');
      return html`${src
          ? html`<img
              class="agent-kit-asset-image"
              src=${src}
              alt=${caption || 'asset'}
              loading="lazy"
            />`
          : nothing}
        ${mime
          ? html`<span class="agent-kit-asset-mime">${mime}</span>`
          : nothing}`;
    });
  }

  /** Snapshot enrichment: a stamp when the cached snapshot is dated. */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-asset-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}

defineAkit('agent-kit-asset', AkitAsset);
