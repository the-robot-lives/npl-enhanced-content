/**
 * agent-kit/agent-kit-board — the kanban-ish column layout over ticket
 * refs (contract spec/schema/agent-kit/board.md).
 *
 * Authored record: one or more `<agent-kit-column heading="...">`
 * parts, each holding `<agent-kit-ticket-ref key="...">` children (and
 * free prose). The layout is CSS (the agent-kit section of
 * `themes/_vocabulary.css`); the refs themselves are the batch-1
 * component — they already scroll to their `#akit-ticket-<KEY>` anchors
 * and need no wiring here. Display stub per the brief: the one piece of
 * logic is the chrome header chip, which counts the authored columns.
 * livePolicy 'never', like every agent-kit-* element.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitBoard extends CachedEmbedElement {
  static properties = { ...CachedEmbedProps };

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-board-chrome', () => {
      akitChrome(this, 'agent-kit-board-chrome', () => {
        const columns = this.querySelectorAll('agent-kit-column').length;
        const refs = this.querySelectorAll('agent-kit-ticket-ref').length;
        return html`<span class="agent-kit-board-chip" data-column-count=${String(columns)}>
          Board · ${columns} column${columns === 1 ? '' : 's'} · ${refs} ref${refs === 1 ? '' : 's'}</span>`;
      });
    });
  }

  /**
   * Snapshot enrichment (chrome beside the authored record): a stamp
   * when the cached snapshot carries a parseable `updated_at` — the
   * authored board stays the record.
   */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-board-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}

defineAkit('agent-kit-board', AkitBoard);
