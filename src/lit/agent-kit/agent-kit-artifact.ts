/**
 * agent-kit/agent-kit-artifact — the cached typed-artifact card
 * (contract spec/schema/agent-kit/artifact.md), promoting the
 * sem-artifact-card shape to a cached embed: a `type` chip
 * (markdown|json|diff|code) plus the authored
 * `<agent-kit-artifact-content>` part — the current version's content,
 * authored, escaped by the document itself, IS the record.
 *
 * A cached snapshot may carry `versions` (`[{id, label, createdAt}]`) —
 * the chrome renders them as an inert version list (no slider, no
 * buttons: a static document has nothing to scrub). Display stub beyond
 * the chip/list. livePolicy 'never', like every agent-kit-* element.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitArtifact extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    type: { type: String },
  };

  declare type: string;

  constructor() {
    super();
    this.type = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-artifact-chrome', () => this.#renderAuthoredChrome());
  }

  #renderAuthoredChrome(): void {
    akitChrome(this, 'agent-kit-artifact-chrome', () => {
      const type = (this.type ?? '').trim();
      return html`${type
        ? html`<span class="agent-kit-artifact-type" data-artifact-type=${type}>${type}</span>`
        : nothing}`;
    });
  }

  /**
   * Snapshot enrichment: the cached version list renders as inert chips
   * (label + date), a dated snapshot adds the stamp — the authored
   * content part stays the record.
   */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const versions = Array.isArray(rec['versions']) ? (rec['versions'] as unknown[]) : [];
    const clean = versions
      .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
      .slice(0, 12);
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    const stamp =
      d && !Number.isNaN(d.getTime())
        ? html`<span class="agent-kit-artifact-snapshot"
            >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
          >`
        : nothing;
    if (clean.length === 0 && !stamp) return html``;
    return html`${stamp}
      ${clean.length > 0
        ? html`<div class="agent-kit-artifact-versions">
            ${clean.map((v) => {
              const label = String(v['label'] ?? v['id'] ?? '');
              const cat = String(v['createdAt'] ?? '');
              const day =
                cat && !Number.isNaN(new Date(cat).getTime()) ? new Date(cat).toISOString().slice(0, 10) : '';
              return html`<span class="agent-kit-artifact-version"
                >${label}${day ? html` · ${day}` : nothing}</span
              >`;
            })}
          </div>`
        : nothing}`;
  }
}

defineAkit('agent-kit-artifact', AkitArtifact);
