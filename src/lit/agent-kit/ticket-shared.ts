/**
 * agent-kit/ticket-shared — the ONE generic ticket renderer behind the six
 * ticket tags (agent-kit-issue / -epic / -bug / -user-story / -task /
 * -sub-task; contract spec/schema/agent-kit/tickets.md).
 *
 * A ticket is a cached embed (src/lit/shared/cached-embed.ts): the authored
 * inner content IS the record — `<agent-kit-title>`,
 * `<agent-kit-description>`, optional `<agent-kit-last-updated>`, and
 * state/labels authored as attributes OR as `<agent-kit-state>` /
 * `<agent-kit-labels>` children. Chrome (data-sem-upgraded only): the key
 * anchor (a classed empty span the board's `agent-kit-ticket-ref` scrolls
 * to), the meta row (type chip, key, state badge, label chips, refresh
 * stamp) and the "Open in agent-kit" footer carrying the share link
 * `/app/<org>/tickets/<uuid>` when a `uuid` is authored. Every fabricated
 * node lives inside the `agent-kit-chrome` container, so extraction skips
 * it whole and JS-off extraction equals JS-on (§8 invariant by
 * construction).
 *
 * livePolicy stays 'never' across the family — no client credentials; live
 * enrichment is a separate backend-proxy lane.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitPartText } from './chrome.js';
import { akitEmit } from './shared.js';

/** One of the six registered ticket tags' type segment. */
export type AkitTicketType = 'issue' | 'epic' | 'bug' | 'user-story' | 'task' | 'sub-task';

/**
 * The ticket key shape: an up-to-6-character project prefix, a dash, and a
 * zero-padded run of at least three digits (`AKIT-001`, `R2D2-0417`).
 */
export const TICKET_KEY_RE = /^[A-Z0-9]{1,6}-\d{3,}$/;

export function isTicketKey(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && TICKET_KEY_RE.test(value);
}

/** The ticket states the contract enumerates (validator-checked). */
export const TICKET_STATES = ['open', 'in-progress', 'review', 'done', 'cancelled'] as const;
export type AkitTicketState = (typeof TICKET_STATES)[number];

const TYPE_LABELS: Record<AkitTicketType, string> = {
  issue: 'Issue',
  epic: 'Epic',
  bug: 'Bug',
  'user-story': 'User story',
  task: 'Task',
  'sub-task': 'Sub-task',
};

/** The key-anchor id a ticket publishes for `agent-kit-ticket-ref` links. */
export function ticketAnchorId(key: string): string {
  return `akit-ticket-${key}`;
}

/**
 * The generic renderer. Register a tag by subclassing with a
 * `ticketType` — one subclass per file, per the barrel's recipe.
 */
export class AkitTicket extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    uuid: { type: String },
    state: { type: String },
    labels: { type: String },
  };

  /** Which of the six tags this subclass registers as. */
  static ticketType: AkitTicketType = 'issue';

  declare uuid: string;
  declare state: string;
  declare labels: string;

  #keyChecked = false;

  constructor() {
    super();
    this.uuid = '';
    this.state = '';
    this.labels = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-ticket-chrome', () => this.#renderAuthoredChrome());
  }

  /** The valid ticket key (the `key` reference attr), or '' when absent/invalid. */
  get ticketKey(): string {
    const key = (this.key ?? '').trim();
    return isTicketKey(key) ? key : '';
  }

  #warnKeyOnce(): void {
    if (this.#keyChecked) return;
    this.#keyChecked = true;
    const key = (this.key ?? '').trim();
    if (key && !isTicketKey(key)) {
      this.warn(
        `agent-kit-ticket: key "${key}" does not match /^[A-Z0-9]{1,6}-\\d{3,}$/ — ` +
          `a key is a ≤6-char project prefix, a dash, and ≥3 digits (e.g. AKIT-001)`,
      );
      akitEmit(this, 'ticket-key-invalid', { key });
    }
  }

  /**
   * State/labels resolution order: the `state`/`labels` attributes win,
   * then the authored `<agent-kit-state>`/`<agent-kit-labels>` children
   * (dual authoring per the contract). Chrome renders a badge only for the
   * attribute spelling — the child spelling is already visible content.
   */
  #attrLabels(): string[] {
    return (this.labels ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /** The authored record's stamp: the child part, else `last-refreshed`. */
  #lastUpdated(): string {
    return akitPartText(this, 'agent-kit-last-updated') || (this.lastRefreshed ?? '').trim();
  }

  /** The key anchor: a chrome-classed empty span BEFORE the authored
   *  children, so `agent-kit-ticket-ref` links land at the card's top.
   *  Extraction skips chrome subtrees whole, so the inserted node never
   *  reaches a record. */
  #placeAnchor(): void {
    const key = this.ticketKey;
    const existing = this.querySelector<HTMLElement>(':scope > .agent-kit-ticket-anchor');
    if (!key) {
      existing?.remove();
      return;
    }
    const span = existing ?? this.ownerDocument.createElement('span');
    span.className = 'agent-kit-ticket-anchor agent-kit-chrome';
    span.id = ticketAnchorId(key);
    span.setAttribute('data-sem-chrome', '');
    span.setAttribute('aria-hidden', 'true');
    if (!existing) this.prepend(span);
  }

  #renderAuthoredChrome(): void {
    this.#warnKeyOnce();
    this.#placeAnchor();
    akitChrome(this, 'agent-kit-ticket-chrome', () => {
      const ctor = this.constructor as typeof AkitTicket;
      const key = this.ticketKey;
      const state = (this.state ?? '').trim();
      const labels = this.#attrLabels();
      const refreshed = (this.lastRefreshed ?? '').trim();
      const stamp = refreshed || this.#lastUpdated();
      const uuid = (this.uuid ?? '').trim();
      const org = (this.org ?? '').trim();
      return html`<div class="agent-kit-ticket-meta">
          <span class="agent-kit-ticket-type" data-ticket-type=${ctor.ticketType}
            >${TYPE_LABELS[ctor.ticketType]}</span
          >
          ${key ? html`<span class="agent-kit-ticket-key">${key}</span>` : nothing}
          ${state
            ? html`<span class="agent-kit-ticket-state" data-state=${state}>${state}</span>`
            : nothing}
          ${labels.map((l) => html`<span class="agent-kit-ticket-label">${l}</span>`)}
          ${stamp
            ? html`<time class="agent-kit-ticket-updated" datetime=${stamp}
                >${stamp.slice(0, 10)}</time
              >`
            : nothing}
        </div>
        ${uuid && org
          ? html`<a class="agent-kit-ticket-open" href="/app/${org}/tickets/${uuid}"
              >Open in agent-kit</a
            >`
          : nothing}`;
    });
  }

  /**
   * Snapshot enrichment (chrome beside the authored record, never a
   * replacement): a stamp line when the cached snapshot carries a
   * recognizable sync time (`updated_at`, `updatedAt` or `lastRefreshed`).
   */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const raw = rec['updated_at'] ?? rec['updatedAt'] ?? rec['lastRefreshed'];
    const stamp = typeof raw === 'string' ? raw : '';
    const ts = stamp ? Date.parse(stamp) : NaN;
    if (!stamp || Number.isNaN(ts)) return html``;
    return html`<div class="agent-kit-ticket-snapshot" data-status=${this.status}>
      Snapshot · <time datetime=${stamp}>${stamp.slice(0, 10)}</time>
    </div>`;
  }
}
