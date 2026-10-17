/**
 * agent-kit/agent-kit-chatroom — the cached chatroom transcript card
 * (contract spec/schema/agent-kit/chatroom.md).
 *
 * Reuses sem-chat's rendering approach against a CACHED transcript and
 * never couples to the live endpoint: the authored
 * `<agent-kit-chat-msg author role at>` children (free-form content —
 * plain text, links, even sem-* inline markup) are the record, exactly
 * like sem-chat's authored `.sem-chat-msg` fallback markup. No
 * composer, no endpoint mode — sending is out of scope for a cached
 * embed. Chrome under the upgrade claim: a header chip counting the
 * messages; a cached snapshot's `updated_at` renders a snapshot stamp.
 * The author label rides the `author` attribute through a CSS
 * `::before` rule — visible with styles on or off, never part of any
 * extracted record. livePolicy 'never'.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitChatroom extends CachedEmbedElement {
  static properties = { ...CachedEmbedProps };

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-chatroom-chrome', () => {
      akitChrome(this, 'agent-kit-chatroom-chrome', () => {
        const msgs = this.querySelectorAll('agent-kit-chat-msg').length;
        return html`<span class="agent-kit-chatroom-chip" data-message-count=${String(msgs)}>
          Chatroom · ${msgs} message${msgs === 1 ? '' : 's'}</span>`;
      });
    });
  }

  /** Snapshot enrichment: a stamp when the cached snapshot is dated. */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-chatroom-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}

defineAkit('agent-kit-chatroom', AkitChatroom);
