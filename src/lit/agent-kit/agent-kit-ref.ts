import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-ref — an inline reference to a document or artifact record by
 * UUID: `<agent-kit-ref kind="doc|artifact" id="<uuid>">Title</agent-kit-ref>`
 * (spec/schema/agent-kit/ref.md). The authored text is the chip label and the
 * JS-off view. Under the upgrade claim it becomes the affordance: `role="link"`,
 * focusable, and activating it (click / Enter / Space) emits
 * `agent-kit:ref-follow` {kind, id}. The element fetches nothing and navigates
 * nowhere itself: the host decides what following means (a viewer modal, a page).
 *
 * `kind` must be `doc` or `artifact` and `id` a UUID; otherwise the reference is
 * warned once and stays inert prose (no role, no tabindex, no event).
 */
export const REF_KINDS = ['doc', 'artifact'] as const;
export type RefKind = (typeof REF_KINDS)[number];
export const REF_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AkitRef extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
  };

  #wired = false;
  #checked = false;

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-ref-wire', () => this.#wire());
  }

  /** The reference kind, or '' when absent/invalid. */
  get refKind(): RefKind | '' {
    const k = (this.getAttribute('data-kind') ?? this.getAttribute('kind') ?? '').trim().toLowerCase();
    return (REF_KINDS as readonly string[]).includes(k) ? (k as RefKind) : '';
  }

  /** The referenced record id (lowercased), or '' when absent/invalid. */
  get refId(): string {
    const id = (this.getAttribute('id') ?? '').trim();
    return REF_ID_RE.test(id) ? id.toLowerCase() : '';
  }

  #wire(): void {
    const kind = this.refKind;
    const id = this.refId;
    const valid = kind !== '' && id !== '';
    if (!this.#checked) {
      this.#checked = true;
      if (!valid) {
        this.warn(
          `agent-kit-ref: needs kind="doc|artifact" and a UUID id (got kind="${this.getAttribute('kind') ?? ''}", id="${this.getAttribute('id') ?? ''}") — reference stays inert`,
        );
      }
    }
    if (!this.#wired) {
      this.#wired = true;
      this.addEventListener('click', () => this.#go());
      this.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.#go();
        }
      });
    }
    if (valid) {
      const label = (this.textContent ?? '').replace(/\s+/g, ' ').trim();
      this.setAttribute('role', 'link');
      this.setAttribute('tabindex', '0');
      this.setAttribute('aria-label', `Open ${kind}${label ? `: ${label}` : ` ${id.slice(0, 8)}`}`);
    } else {
      this.removeAttribute('role');
      this.removeAttribute('tabindex');
      this.removeAttribute('aria-label');
    }
  }

  #go(): void {
    const kind = this.refKind;
    const id = this.refId;
    if (!kind || !id) return;
    this.emit('agent-kit:ref-follow', { kind, id });
  }

  protected override renderChrome(_data: unknown): TemplateResult {
    return html`${nothing}`;
  }
}

defineAkit('agent-kit-ref', AkitRef);
