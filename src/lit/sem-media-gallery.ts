/**
 * sem-media-gallery — interactive media grid with lightbox (agent-kit demo stub).
 *
 * Data-driven from an `items` JSON attribute. Zero-JS: server-rendered light-DOM
 * `<img>` children are visible while the element is undefined; once upgraded the
 * shadow DOM (with no `<slot>`) takes over and the light DOM stops rendering
 * naturally — no explicit hide mechanism needed.
 *
 * Listens for the bubbling `sem-media-added` event to append new items.
 */
import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';

export interface MediaItem {
  src: string;
  caption: string;
  mime: string;
}

const KEY_LEFT = 'ArrowLeft';
const KEY_RIGHT = 'ArrowRight';
const KEY_ESCAPE = 'Escape';

export class SemMediaGallery extends LitElement {
  static properties = {
    items: { type: String },
  };

  declare items: string;

  #parsed: MediaItem[] = [];
  #lightboxIndex: number = -1;
  #closeBound = this.#close.bind(this);
  #keyBound = this.#onKey.bind(this);

  createRenderRoot(): LitElement['renderRoot'] {
    return this.attachShadow({ mode: 'open' });
  }

  static styles = css`
    :host {
      display: block;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    @media (max-width: 720px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
    .card {
      display: block; width: 100%; border: none; background: #1e1e2e;
      border-radius: 8px; overflow: hidden; cursor: pointer; padding: 0;
      color: #cdd6f4; text-align: left; font: inherit;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .card:hover, .card:focus-visible {
      transform: scale(1.02);
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      outline: 2px solid #89b4fa;
    }
    .card-media {
      width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block;
      background: #181825;
    }
    .card-caption {
      padding: 0.5rem 0.75rem; font-size: 0.85rem; color: #a6adc8;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* lightbox */
    .lb-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 1000;
      display: flex; align-items: center; justify-content: center;
    }
    .lb-content {
      max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column;
      align-items: center; gap: 0.75rem;
    }
    .lb-media { max-width: 100%; max-height: 70vh; border-radius: 4px; }
    .lb-caption { color: #cdd6f4; font-size: 0.95rem; }
    .lb-controls { display: flex; gap: 0.5rem; align-items: center; }
    .lb-btn {
      background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
      color: #cdd6f4; border-radius: 6px; padding: 0.4rem 0.9rem;
      cursor: pointer; font-size: 0.9rem;
    }
    .lb-btn:hover, .lb-btn:focus-visible {
      background: rgba(255,255,255,0.22); outline: 2px solid #89b4fa;
    }
    .lb-close { position: fixed; top: 1rem; right: 1rem; z-index: 1001; }
    .lb-counter { color: #a6adc8; font-size: 0.85rem; }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('sem-media-added', this.#onMediaAdded as EventListener);
  }

  disconnectedCallback(): void {
    window.removeEventListener('sem-media-added', this.#onMediaAdded as EventListener);
    this.#close();
    super.disconnectedCallback();
  }

  willUpdate(_changed: PropertyValues): void {
    if (_changed.has('items')) {
      try {
        this.#parsed = JSON.parse(this.items || '[]') as MediaItem[];
      } catch {
        this.#parsed = [];
      }
    }
  }

  render() {
    return html`
      <div class="grid" role="list" aria-label="Media gallery">
        ${this.#parsed.map((item, i) => this.#card(item, i))}
      </div>
      ${this.#lightboxIndex >= 0 ? this.#lightbox() : nothing}
    `;
  }

  #card(item: MediaItem, i: number) {
    return html`
      <button
        class="card" role="listitem"
        aria-label="View: ${item.caption}"
        @click=${() => this.#open(i)}
      >
        ${this.#thumb(item)}
        <span class="card-caption">${item.caption}</span>
      </button>
    `;
  }

  #thumb(item: MediaItem) {
    if (item.mime?.startsWith('video/')) {
      return html`<video class="card-media" muted preload="metadata" src=${item.src}></video>`;
    }
    return html`<img class="card-media" src=${item.src} alt=${item.caption} loading="lazy">`;
  }

  #lightbox() {
    const item = this.#parsed[this.#lightboxIndex];
    if (!item) return nothing;
    const total = this.#parsed.length;
    return html`
      <div class="lb-backdrop" @click=${this.#backdropClick} @keydown=${this.#keyBound}>
        <div class="lb-content" @click=${(e: Event) => e.stopPropagation()}>
          ${item.mime?.startsWith('video/')
            ? html`<video class="lb-media" controls autoplay src=${item.src}></video>`
            : html`<img class="lb-media" src=${item.src} alt=${item.caption}>`}
          <span class="lb-caption">${item.caption}</span>
          <div class="lb-controls">
            <button class="lb-btn" aria-label="Previous" ?disabled=${this.#lightboxIndex <= 0}
              @click=${() => this.#prev()}>Previous</button>
            <span class="lb-counter">${this.#lightboxIndex + 1} / ${total}</span>
            <button class="lb-btn" aria-label="Next" ?disabled=${this.#lightboxIndex >= total - 1}
              @click=${() => this.#next()}>Next</button>
          </div>
        </div>
        <button class="lb-btn lb-close" aria-label="Close" @click=${this.#closeBound}>Close</button>
      </div>
    `;
  }

  #open(index: number): void {
    this.#lightboxIndex = index;
    this.requestUpdate();
    // Focus the close button after render
    requestAnimationFrame(() => {
      const btn = this.shadowRoot?.querySelector('.lb-close') as HTMLElement | null;
      btn?.focus();
    });
  }

  #close(): void {
    if (this.#lightboxIndex < 0) return;
    // Return focus to the triggering card
    const idx = this.#lightboxIndex;
    this.#lightboxIndex = -1;
    this.requestUpdate();
    requestAnimationFrame(() => {
      const cards = this.shadowRoot?.querySelectorAll<HTMLElement>('.card');
      cards?.[idx]?.focus();
    });
  }

  #prev(): void {
    if (this.#lightboxIndex > 0) {
      this.#lightboxIndex--;
      this.requestUpdate();
    }
  }

  #next(): void {
    if (this.#lightboxIndex < this.#parsed.length - 1) {
      this.#lightboxIndex++;
      this.requestUpdate();
    }
  }

  #backdropClick(e: Event): void {
    if (e.target === e.currentTarget) this.#close();
  }

  #onKey(e: KeyboardEvent): void {
    if (e.key === KEY_ESCAPE) { e.preventDefault(); this.#close(); }
    if (e.key === KEY_LEFT) { e.preventDefault(); this.#prev(); }
    if (e.key === KEY_RIGHT) { e.preventDefault(); this.#next(); }
  }

  #onMediaAdded = (e: Event): void => {
    const detail = (e as CustomEvent<MediaItem>).detail;
    if (!detail?.src) return;
    this.#parsed = [...this.#parsed, detail];
    this.requestUpdate();
  };
}

if (typeof customElements !== 'undefined' && !customElements.get('sem-media-gallery')) {
  customElements.define('sem-media-gallery', SemMediaGallery);
}