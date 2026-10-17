/**
 * agent-kit/persona-shared — the ONE persona renderer behind the two
 * persona tags (agent-kit-user-persona / agent-kit-agent-persona;
 * contract spec/schema/agent-kit/personas.md), shaped like the tobor
 * Persona record: name, role, bio, avatar, metadata.
 *
 * The authored inner content IS the record — `<agent-kit-persona-name>`,
 * `<agent-kit-persona-role>`, `<agent-kit-persona-bio>` and optional
 * `<agent-kit-persona-metadata>` (prose lines `key: value`). The
 * `avatar` attribute is the CACHED URL: the chrome header renders an
 * `<img>` from it verbatim — no fetching, no placeholder service, and
 * with JavaScript off no image element exists at all (the authored
 * prose stands alone). Chrome (data-sem-upgraded only, always inside
 * the `agent-kit-chrome` container): the header row with the avatar and
 * the persona-kind chip.
 *
 * livePolicy stays 'never' across the family — no client credentials;
 * live enrichment is a separate backend-proxy lane.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitPartText } from './chrome.js';

/** Which of the two registered persona tags this subclass renders as. */
export type AkitPersonaKind = 'user' | 'agent';

const KIND_LABELS: Record<AkitPersonaKind, string> = {
  user: 'User persona',
  agent: 'Agent persona',
};

/**
 * The generic renderer. Register a tag by subclassing with a
 * `personaKind` — one subclass per file, per the barrel's recipe.
 */
export class AkitPersona extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    avatar: { type: String },
  };

  /** Which of the two tags this subclass registers as. */
  static personaKind: AkitPersonaKind = 'user';

  declare avatar: string;

  constructor() {
    super();
    this.avatar = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-persona-chrome', () => this.#renderAuthoredChrome());
  }

  #renderAuthoredChrome(): void {
    akitChrome(this, 'agent-kit-persona-chrome', () => {
      const ctor = this.constructor as typeof AkitPersona;
      const kind = ctor.personaKind;
      const avatar = (this.avatar ?? '').trim();
      const name = akitPartText(this, 'agent-kit-persona-name');
      return html`<div class="agent-kit-persona-head">
        ${avatar
          ? html`<img
              class="agent-kit-persona-avatar"
              src=${avatar}
              alt=${name ? `${name} avatar` : 'persona avatar'}
              loading="lazy"
            />`
          : nothing}
        <span class="agent-kit-persona-kind" data-persona-kind=${kind}
          >${KIND_LABELS[kind]}</span
        >
      </div>`;
    });
  }

  /**
   * Snapshot enrichment (chrome beside the authored record, never a
   * replacement): a metadata strip when the cached snapshot carries a
   * `metadata` object — the authored `<agent-kit-persona-metadata>` part
   * stays the JS-off record.
   */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const meta = rec['metadata'];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return html``;
    const entries = Object.entries(meta as Record<string, unknown>).slice(0, 12);
    if (entries.length === 0) return html``;
    return html`<div class="agent-kit-persona-meta">
      ${entries.map(
        ([k, v]) =>
          html`<span class="agent-kit-persona-meta-item"
            ><b>${k}</b> ${String(v)}</span
          >`,
      )}
    </div>`;
  }
}
