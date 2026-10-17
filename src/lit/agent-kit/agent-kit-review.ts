/**
 * agent-kit/agent-kit-review — the cached review card (contract
 * spec/schema/agent-kit/review.md), promoting the sem-review-canvas
 * shape to a cached embed: the authored `<agent-kit-comment author at>`
 * list and the `verdict` attribute are the record. No pins, no radio
 * group, no click-to-comment — a static document records the review, it
 * does not conduct one. The chrome header chip renders the verdict
 * label; a cached snapshot's `updated_at` renders a snapshot stamp.
 * livePolicy 'never', like every agent-kit-* element.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

const VERDICT_LABELS: Record<string, string> = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Commented',
  pending: 'Pending review',
};

export class AkitReview extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    verdict: { type: String },
  };

  declare verdict: string;

  constructor() {
    super();
    this.verdict = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-review-chrome', () => {
      akitChrome(this, 'agent-kit-review-chrome', () => {
        const verdict = (this.verdict ?? '').trim() || 'pending';
        const count = this.querySelectorAll('agent-kit-comment').length;
        return html`<span class="agent-kit-review-verdict" data-verdict=${verdict}
          >${VERDICT_LABELS[verdict] ?? verdict}</span
        >
        <span class="agent-kit-review-count">${count} comment${count === 1 ? '' : 's'}</span>`;
      });
    });
  }

  /** Snapshot enrichment: a stamp when the cached snapshot is dated. */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-review-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}

defineAkit('agent-kit-review', AkitReview);
