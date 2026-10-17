import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { isTicketKey, ticketAnchorId } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-ticket-ref — an inline reference to a ticket record
 * (spec/schema/agent-kit/tickets.md). The authored text content is the
 * chip label (JS-off it reads as plain text); under the upgrade claim the
 * element becomes the affordance: it claims `role="link"`, is focusable,
 * and activating it (click / Enter / Space) scrolls the referenced ticket
 * card into view via the key anchor every ticket publishes
 * (#akit-ticket-<KEY>). No fabricated nodes — the affordance is behavior
 * on the element itself, so extraction is untouched by construction.
 *
 * The `key` attribute follows the ticket key shape
 * (`/^[A-Z0-9]{1,6}-\d{3,}$/`); an invalid key is warned once and the
 * reference stays inert prose under the upgrade claim too.
 */
export class AkitTicketRef extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
  };

  #wired = false;
  #keyChecked = false;

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-ticket-ref-wire', () => this.#wire());
  }

  /** The valid ticket key, or '' when absent/invalid. */
  get refKey(): string {
    const key = (this.key ?? '').trim();
    return isTicketKey(key) ? key : '';
  }

  #wire(): void {
    const key = this.refKey;
    if (!this.#keyChecked) {
      this.#keyChecked = true;
      const raw = (this.key ?? '').trim();
      if (raw && !key) {
        this.warn(
          `agent-kit-ticket-ref: key "${raw}" does not match /^[A-Z0-9]{1,6}-\\d{3,}$/ — reference stays inert`,
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
    if (key) {
      this.setAttribute('role', 'link');
      this.setAttribute('tabindex', '0');
      this.setAttribute(
        'aria-label',
        `Go to ticket ${key}` +
          (this.textContent && this.textContent.trim() !== key
            ? `: ${this.textContent.replace(/\s+/g, ' ').trim()}`
            : ''),
      );
    } else {
      this.removeAttribute('role');
      this.removeAttribute('tabindex');
      this.removeAttribute('aria-label');
    }
  }

  /** Scroll the referenced ticket card into view (no-op when absent). */
  #go(): void {
    const key = this.refKey;
    if (!key) return;
    const target = this.ownerDocument?.getElementById(ticketAnchorId(key));
    if (!target) {
      this.warn(`agent-kit-ticket-ref: no ticket card with key ${key} in this document`);
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.emit('agent-kit:ticket-ref-follow', { key });
  }

  protected override renderChrome(_data: unknown): TemplateResult {
    return html`${nothing}`;
  }
}

defineAkit('agent-kit-ticket-ref', AkitTicketRef);
