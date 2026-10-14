import { SemElement } from './base.js';

/**
 * sem-quota-meter — a rolling usage window (e.g. a provider's 5-hour cap).
 *
 * Pure display: the page passes numbers in via attributes; the element never
 * reads or stores credentials and fetches nothing. `used` is clamped into
 * [0, limit]; a missing or non-positive `limit` is the "no limit set" state —
 * the text reads as such and no bar is rendered.
 *
 * Colour is a data-level on the host (ok → warn at 75%, hot at 90%) and the
 * vocabulary paints it from --sem-quota-meter-ok/-warn/-hot, each falling
 * back to a theme token, so themes override without touching this file.
 *
 * `resets-at` (ISO 8601) adds a relative "resets in 2h 14m" line refreshed
 * once a minute; the interval is cleared on disconnect (and when the
 * attribute is removed), so a detached meter never keeps a timer alive.
 *
 * Light DOM per PRD §4 rule 5: the meter chrome is plain `.sem-*` spans the
 * themes style; the host carries role="meter" + the ARIA value triple.
 */

const MINUTE = 60_000;

export class SemQuotaMeter extends SemElement {
  static properties = {
    used: { type: Number },
    limit: { type: Number },
    label: { type: String },
    resetsAt: { type: String, attribute: 'resets-at' },
  };

  declare used: number;
  declare limit: number;
  declare label: string;
  declare resetsAt: string | null;

  #timer: ReturnType<typeof setInterval> | null = null;
  #box: HTMLDivElement | null = null;

  constructor() {
    super();
    this.used = 0;
    this.limit = 0;
    this.label = 'quota';
    this.resetsAt = null;
  }

  disconnectedCallback(): void {
    this.#stopTimer();
    super.disconnectedCallback();
  }

  updated(): void {
    this.#render();
    this.#syncTimer();
  }

  /** Used clamped into [0, limit]; NaN on either side degrades to 0. */
  #clamped(): { used: number; limit: number; hasLimit: boolean } {
    const limit = Number.isFinite(this.limit) ? this.limit : 0;
    const raw = Number.isFinite(this.used) ? this.used : 0;
    const hasLimit = limit > 0;
    const used = hasLimit ? Math.min(Math.max(raw, 0), limit) : Math.max(raw, 0);
    return { used, limit, hasLimit };
  }

  #level(used: number, limit: number): 'ok' | 'warn' | 'hot' {
    const ratio = used / limit;
    if (ratio >= 0.9) return 'hot';
    if (ratio >= 0.75) return 'warn';
    return 'ok';
  }

  #render(): void {
    const { used, limit, hasLimit } = this.#clamped();
    const pct = hasLimit ? Math.round((used / limit) * 100) : 0;

    this.setAttribute('role', 'meter');
    this.setAttribute('aria-label', this.label);
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuenow', String(hasLimit ? used : 0));
    this.setAttribute('aria-valuemax', String(hasLimit ? limit : 0));
    this.setAttribute('data-level', hasLimit ? this.#level(used, limit) : 'none');

    // The element owns its chrome, but Lit's render-root part markers live
    // as direct children of the light-DOM host — so everything this element
    // rewrites sits inside one wrapper div it fully owns. Clearing the host
    // itself would eject Lit's markers and break the next update.
    let box = this.#box;
    if (!box || !box.isConnected) {
      box = document.createElement('div');
      box.className = 'sem-quota-meter-box';
      this.appendChild(box);
      this.#box = box;
    }
    box.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'sem-quota-meter-label';
    label.textContent = this.label;
    box.appendChild(label);

    const value = document.createElement('span');
    value.className = 'sem-quota-meter-value';
    value.textContent = hasLimit ? used + ' of ' + limit : 'no limit set';
    box.appendChild(value);

    if (hasLimit) {
      const track = document.createElement('span');
      track.className = 'sem-quota-meter-track';
      const fill = document.createElement('span');
      fill.className = 'sem-quota-meter-fill';
      fill.style.width = pct + '%';
      track.appendChild(fill);
      box.appendChild(track);
    }

    if (this.#resetTime() !== null) box.appendChild(this.#resetSpan());
  }

  #resetTime(): number | null {
    if (!this.resetsAt) return null;
    const t = Date.parse(this.resetsAt);
    return Number.isNaN(t) ? null : t;
  }

  #resetSpan(): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'sem-quota-meter-reset';
    span.textContent = SemQuotaMeter.#formatReset(this.#resetTime() as number - Date.now());
    return span;
  }

  static #formatReset(ms: number): string {
    if (ms <= 0) return 'resets now';
    const total = Math.floor(ms / MINUTE);
    const d = Math.floor(total / 1440);
    const h = Math.floor((total % 1440) / 60);
    const m = total % 60;
    if (d > 0) return 'resets in ' + d + 'd ' + h + 'h';
    if (h > 0) return 'resets in ' + h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
    return 'resets in ' + m + 'm';
  }

  #updateResetText(): void {
    const t = this.#resetTime();
    const span = this.querySelector('.sem-quota-meter-reset');
    if (t === null || !span) return;
    span.textContent = SemQuotaMeter.#formatReset(t - Date.now());
  }

  #syncTimer(): void {
    const active = this.#resetTime() !== null && this.isConnected;
    if (active && this.#timer === null) {
      this.#timer = setInterval(() => this.#updateResetText(), MINUTE);
    } else if (!active) {
      this.#stopTimer();
    }
  }

  #stopTimer(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}

SemElement.register('sem-quota-meter', SemQuotaMeter);
