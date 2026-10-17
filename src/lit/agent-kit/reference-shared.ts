/**
 * agent-kit/reference-shared — the ONE reference-card renderer behind
 * agent-kit-organization / agent-kit-project (contract
 * spec/schema/agent-kit/reference-cards.md).
 *
 * Authored record: `<agent-kit-name>` and `<agent-kit-description>`
 * parts (the shared part defs — a name is a name). Chrome under the
 * upgrade claim: the header row with the kind chip (from the tag, not
 * an attribute) and the "Open in agent-kit" footer when the card is
 * slug-addressable — organization: `/app/<org>`, project:
 * `/app/<org>/projects/<key>`. A cached snapshot's `updated_at` renders
 * a snapshot stamp. livePolicy 'never', like every agent-kit-* element.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitPartText } from './chrome.js';

/** Which of the two registered reference tags this subclass renders as. */
export type AkitReferenceKind = 'organization' | 'project';

const KIND_LABELS: Record<AkitReferenceKind, string> = {
  organization: 'Organization',
  project: 'Project',
};

/**
 * The generic renderer. Register a tag by subclassing with a
 * `refKind` — one subclass per file, per the barrel's recipe.
 */
export class AkitReferenceCard extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    uuid: { type: String },
  };

  /** Which of the two tags this subclass registers as. */
  static refKind: AkitReferenceKind = 'organization';

  declare uuid: string;

  constructor() {
    super();
    this.uuid = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-reference-chrome', () => this.#renderAuthoredChrome());
  }

  get #href(): string | null {
    const ctor = this.constructor as typeof AkitReferenceCard;
    const org = (this.org ?? '').trim();
    if (!org) return null;
    if (ctor.refKind === 'organization') return `/app/${encodeURIComponent(org)}`;
    const key = (this.key ?? '').trim();
    if (!key) return null;
    return `/app/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}`;
  }

  #renderAuthoredChrome(): void {
    akitChrome(this, 'agent-kit-reference-chrome', () => {
      const ctor = this.constructor as typeof AkitReferenceCard;
      const kind = ctor.refKind;
      const name = akitPartText(this, 'agent-kit-name');
      const href = this.#href;
      return html`<div class="agent-kit-reference-head">
          <span class="agent-kit-reference-kind" data-ref-kind=${kind}
            >${KIND_LABELS[kind]}</span
          >
        </div>
        ${href
          ? html`<div class="agent-kit-reference-foot">
              <a class="agent-kit-reference-open" href=${href}>Open in agent-kit</a>
            </div>`
          : nothing}`;
    });
  }

  /** Snapshot enrichment: a stamp when the cached snapshot is dated. */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-reference-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}
