import { SemElement } from './base.js';

/**
 * sem-note — Lit upgrade of the callout (tag form or class alias).
 * Light DOM per PRD §4 rule 5: content stays searchable/copyable;
 * Lit owns behavior (collapsed toggle, variant reaction), not markup.
 * Handoff contract (data-sem-upgraded) comes from SemElement.
 */
export class SemNote extends SemElement {
  static properties = {
    variant: { type: String },
    collapsed: { type: Boolean, reflect: true },
  };

  declare variant: string;
  declare collapsed: boolean;

  #awaitingBody = false;

  constructor() {
    super();
    this.variant = 'info';
    this.collapsed = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // deferred: a parse-time write would leak into a sem-source snapshot
    this.afterParse('role', () => this.setAttribute('role', 'note'));
    this.addEventListener('click', this.#onSummaryClick);
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.#onSummaryClick);
    super.disconnectedCallback();
  }

  updated(): void {
    // v0.4 CSS contract keys styling/tests off data-variant, not `variant`
    this.afterParse('variant', () => this.setAttribute('data-variant', this.variant));
    if (!this.collapsed) {
      this.#summary()?.remove();
      return;
    }
    if (this.#summary()) return;

    let body = this.querySelector('.sem-note-body');
    if (!body) {
      // element upgraded pre-parse: children aren't there yet at first update
      if (document.readyState === 'loading' || !this.firstChild) {
        this.#awaitBody();
        return;
      }
      // tag form: the body is the element's own content; wrap it so the
      // collapsed hide rule (keyed on .sem-note-body) has something to hide
      body = document.createElement('div');
      body.className = 'sem-note-body';
      while (this.firstChild) body.appendChild(this.firstChild);
      this.appendChild(body);
    }
    // a real button: click plus keyboard activation, with the UA control
    // chrome stripped by the theme so it still reads as the teaser it is
    const sum = document.createElement('button');
    sum.type = 'button';
    sum.className = 'sem-note-summary';
    sum.setAttribute('aria-expanded', 'false');
    const text = this.#bodyText();
    sum.textContent =
      (text ? text.split(/\s+/).slice(0, 10).join(' ') : this.variant) + ' …';
    this.insertBefore(sum, body);
  }

  #awaitBody(): void {
    if (this.#awaitingBody) return;
    this.#awaitingBody = true;
    void this.whenChildrenReady(':scope > *').then(() => {
      this.#awaitingBody = false;
      this.requestUpdate();
    });
  }

  #summary(): Element | null {
    return this.querySelector(':scope > .sem-note-summary');
  }

  #bodyText(): string {
    const body = this.querySelector('.sem-note-body');
    return ((body ?? this).textContent || '').trim();
  }

  #onSummaryClick(e: Event): void {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains('sem-note-summary')) return;
    const body = this.querySelector('.sem-note-body');
    this.collapsed = false;
    // the teaser removes itself in `updated()`; keep keyboard users anchored
    // on the body they just opened instead of dropping focus to <body>
    if (body) {
      body.setAttribute('tabindex', '-1');
      void this.updateComplete.then(() => (body as HTMLElement).focus());
    }
  }
}

SemElement.register('sem-note', SemNote);
