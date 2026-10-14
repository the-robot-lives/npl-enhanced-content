/**
 * sem-scroll — the virtual scrollbar for the v2 terminal shell (CORE-V2 §10).
 *
 * A Lit, shadow-DOM component bound to the screen's viewport model — total
 * rows (scrollback ring + primary), visible rows, and the offset of the first
 * visible row. It draws track + thumb as absolutely-positioned divs, never a
 * native scrollbar, and never styles itself from hard-coded colors: every
 * color reads a `--sem-shell-scroll-*` theme token (with a translucent-neutral
 * fallback that works over both dark and light frames), so the terminal CSS
 * block owns the look and dark/light follows the host frame.
 *
 *   --sem-shell-scroll-track         the track fill      (default transparent)
 *   --sem-shell-scroll-thumb         the thumb           (default grey 45%)
 *   --sem-shell-scroll-thumb-active  hover/drag/focus    (default grey 70%)
 *
 * Output is one contract, two spellings, so the terminal binds it either way:
 * the `onscrollto` callback property (CORE-V2 §10's `scrollto` callback) and a
 * bubbling, composed `sem-scrollto` CustomEvent with `{ row }` detail (the
 * `sem-` prefix is deliberate: an event named `scrollto` would collide with
 * the `onscrollto` handler property and double-fire the consumer). The
 * component is output-only — it never moves its own `offset`; the screen
 * consumes the request and feeds the new offset back, so the screen stays the
 * one owner of the viewport (and can refuse, e.g. while a full-screen app owns
 * the screen). `atBottom` lets the screen read the pin state the §10 rule
 * ("dragging pins the viewport at bottom only when released there") needs.
 *
 * Input: pointer drag on the thumb (pointer capture), click-to-page on the
 * track, and PgUp/PgDn/Home/End — only while the scrollbar itself is focused
 * (tabindex=0; a focused scrollbar is the ARIA `scrollbar` pattern, not a key
 * interception: an unfocused sem-scroll installs no key handling and swallows
 * nothing, so the terminal's own key path is untouched). Wheel is pure
 * passthrough — no listener at all — so the terminal's wheel handler (bound on
 * a container that includes this element) sees wheel-over-track for free.
 *
 * Hidden entirely when the content fits; a no-arg render is empty, and the
 * host carries the `hidden` attribute so `:host([hidden])` and the UA rule
 * both hide it. Reduced motion is honoured by construction: nothing here
 * animates — no transitions, no smooth scrolling, every viewport move is the
 * instant jump the screen makes when it applies `scrollto`.
 *
 * Placement note: CORE-V2 §10 names `src/terminal/chrome/sem-scroll.ts`; the
 * round brief places lane ownership at `src/shared/sem-scroll.ts` (alongside
 * the other terminal-independent chrome, `window-chrome.ts`). The brief wins;
 * the module is terminal-independent and moves if the lead prefers.
 */

import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import type { PropertyValues } from 'lit';

/** The viewport model the terminal publishes to the scrollbar. */
export interface ViewportModel {
  /** Rows that exist — scrollback ring + primary screen lines. */
  total: number;
  /** Rows the viewport shows at once. */
  visible: number;
  /** Index of the first visible row (0 = top of the buffer). */
  offset: number;
}

/** The thumb never gets smaller than this, px (CORE-V2 §10). */
export const MIN_THUMB_PX = 24;

/** True when there is nothing to scroll — the scrollbar hides entirely. */
export function fits(v: ViewportModel): boolean {
  return v.total <= 0 || v.visible <= 0 || v.total <= v.visible;
}

/** Clamp a requested row to the legal viewport range (integer). */
export function clampOffset(v: ViewportModel, row: number): number {
  const max = Math.max(0, v.total - v.visible);
  return Math.min(max, Math.max(0, Math.round(row)));
}

/**
 * Thumb geometry over a track of `trackLength` px: proportional to the
 * visible fraction, clamped to MIN_THUMB_PX, positioned so the thumb's
 * progress maps offset/scrollable over the remaining travel. Zero-sized when
 * the content fits or the track is unmeasured.
 */
export function thumbGeometry(
  v: ViewportModel,
  trackLength: number,
): { top: number; height: number } {
  if (trackLength <= 0 || fits(v)) return { top: 0, height: 0 };
  const height = Math.max(MIN_THUMB_PX, (v.visible / v.total) * trackLength);
  const travel = Math.max(0, trackLength - height);
  const scrollable = v.total - v.visible;
  const top = scrollable > 0 ? (v.offset / scrollable) * travel : 0;
  return { top: Math.round(top), height: Math.round(height) };
}

/**
 * Offset for a pointer drag: the thumb keeps its grab distance and follows
 * the pointer; the offset is the thumb's position mapped back to rows.
 * Returns the current offset when there is no travel (content fits, or the
 * thumb is clamped to the whole track).
 */
export function offsetFromDrag(
  v: ViewportModel,
  trackLength: number,
  pointerY: number,
  grabOffset: number,
): number {
  const { top, height } = thumbGeometry(v, trackLength);
  const travel = trackLength - height;
  if (travel <= 0) return v.offset;
  const scrollable = v.total - v.visible;
  if (scrollable <= 0) return v.offset;
  return clampOffset(v, ((pointerY - grabOffset) / travel) * scrollable);
}

/**
 * Offset for a track click (click-to-page): one viewport page toward the
 * click — above the thumb pages up, below pages down — clamped.
 */
export function offsetFromTrackClick(
  v: ViewportModel,
  trackLength: number,
  pointerY: number,
): number {
  const { top, height } = thumbGeometry(v, trackLength);
  const toward = pointerY < top + height / 2 ? -v.visible : v.visible;
  return clampOffset(v, v.offset + toward);
}

/** Detail of the `sem-scrollto` CustomEvent. */
export interface ScrollToDetail {
  /** The clamped row the scrollbar asks the screen to move to. */
  row: number;
}

export class SemScroll extends LitElement {
  static properties = {
    total: { type: Number },
    visible: { type: Number },
    offset: { type: Number },
    label: { type: String },
    onscrollto: { attribute: false },
    trackLen: { state: true },
  };

  /** Total rows in the buffer (scrollback ring + primary). */
  declare total: number;
  /** Rows the viewport shows at once. */
  declare visible: number;
  /** First visible row — owned by the screen; fed back after `scrollto`. */
  declare offset: number;
  /** Accessible name (aria-label). */
  declare label: string;
  /** The screen's viewport move — CORE-V2 §10's `scrollto` callback. */
  declare onscrollto: ((row: number) => void) | null;
  /** Measured track length, px. 0 until measured (or unrendered). */
  declare trackLen: number;

  /** Active drag: pointerId + the pointer-to-thumb-top grab distance. */
  #drag: { id: number; grab: number } | null = null;
  #ro: ResizeObserver | null = null;

  constructor() {
    super();
    this.total = 0;
    this.visible = 0;
    this.offset = 0;
    this.label = 'Terminal scrollback';
    this.onscrollto = null;
    this.trackLen = 0;
  }

  static styles = css`
    :host {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      width: 12px;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      outline: none;
    }
    :host([hidden]) { display: none; }
    .track {
      position: absolute;
      inset: 0;
      background: var(--sem-shell-scroll-track, transparent);
    }
    .thumb {
      position: absolute;
      inset-inline-end: 2px;
      width: 6px;
      border-radius: 3px;
      background: var(--sem-shell-scroll-thumb, rgba(127, 127, 127, 0.45));
    }
    .thumb:hover,
    .thumb[data-dragging] {
      background: var(--sem-shell-scroll-thumb-active, rgba(127, 127, 127, 0.7));
    }
    /* Focus ring on the thumb — the host itself is the focusable element. */
    :host(:focus-visible) .thumb {
      outline: 1px solid var(--sem-shell-scroll-thumb-active, rgba(127, 127, 127, 0.7));
      outline-offset: 2px;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'scrollbar');
    this.setAttribute('aria-orientation', 'vertical');
    this.setAttribute('tabindex', '0');
    this.addEventListener('keydown', this.#onKeyDown);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.#onKeyDown);
    this.#endDrag();
    this.#ro?.disconnect();
    this.#ro = null;
    super.disconnectedCallback();
  }

  /** Last legal offset — the top row index when the viewport is at bottom. */
  get maxOffset(): number {
    return Math.max(0, this.total - this.visible);
  }

  /** True when the viewport sits at (or past) the bottom of the buffer. */
  get atBottom(): boolean {
    return !fits(this.#viewport()) && this.offset >= this.maxOffset;
  }

  protected updated(changed: PropertyValues): void {
    // Hidden entirely when the content fits (CORE-V2 §10).
    this.toggleAttribute('hidden', fits(this.#viewport()));
    this.setAttribute('aria-label', this.label);
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', String(this.maxOffset));
    this.setAttribute('aria-valuenow', String(clampOffset(this.#viewport(), this.offset)));
    this.#measure();
    if (!this.#ro && typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver(() => this.#measure());
      const track = this.renderRoot.querySelector('.track');
      if (track) this.#ro.observe(track);
    }
  }

  protected render(): TemplateResult | typeof nothing {
    const v = this.#viewport();
    if (fits(v)) return nothing;
    const { top, height } = thumbGeometry(v, this.trackLen);
    return html`
      <div
        class="track"
        @pointerdown=${this.#onPointerDown}
        @pointermove=${this.#onPointerMove}
        @pointerup=${this.#onPointerUp}
        @pointercancel=${this.#onPointerUp}
      >
        <div class="thumb" ?data-dragging=${this.#drag !== null} style="top:${top}px;height:${height}px"></div>
      </div>
    `;
  }

  #viewport(): ViewportModel {
    return { total: this.total, visible: this.visible, offset: this.offset };
  }

  /** Measure the track (resize + first paint). No-op when it reads 0. */
  #measure(): void {
    const track = this.renderRoot.querySelector('.track');
    if (!track) return;
    const len = track.getBoundingClientRect().height;
    if (len > 0 && len !== this.trackLen) this.trackLen = len;
  }

  /**
   * Emit a viewport move: fire `scrollto` (bubbling, composed) and call the
   * `onscrollto` callback with the clamped row. Never mutates `offset` — the
   * screen feeds it back. Suppressed when the row equals the current offset,
   * so a drag parked in place is silent.
   */
  #emit(row: number): void {
    const next = clampOffset(this.#viewport(), row);
    if (next === this.offset) return;
    this.dispatchEvent(
      new CustomEvent<ScrollToDetail>('sem-scrollto', {
        bubbles: true,
        composed: true,
        detail: { row: next },
      }),
    );
    this.onscrollto?.(next);
  }

  #onPointerDown = (e: PointerEvent): void => {
    const v = this.#viewport();
    if (fits(v) || this.#drag) return;
    const track = this.renderRoot.querySelector('.track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const trackLen = rect.height > 0 ? rect.height : this.trackLen;
    const y = e.clientY - rect.top;
    const thumb = this.renderRoot.querySelector('.thumb');
    const onThumb = thumb !== null && (e.target === thumb || thumb.contains(e.target as Node));
    if (!onThumb) {
      // Click-to-page on the track (CORE-V2 §10); not a drag.
      this.#emit(offsetFromTrackClick(v, trackLen, y));
      return;
    }
    const { top } = thumbGeometry(v, trackLen);
    this.#drag = { id: e.pointerId, grab: y - top };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is unavailable in some hosts (incl. test DOMs) — the
         listeners below are bound to the track regardless. */
    }
  };

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#drag || e.pointerId !== this.#drag.id) return;
    const track = this.renderRoot.querySelector('.track');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const trackLen = rect.height > 0 ? rect.height : this.trackLen;
    this.#emit(
      offsetFromDrag(this.#viewport(), trackLen, e.clientY - rect.top, this.#drag.grab),
    );
  };

  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#drag || e.pointerId !== this.#drag.id) return;
    this.#endDrag();
  };

  #endDrag(): void {
    this.#drag = null;
    // Re-render to drop the data-dragging paint.
    this.requestUpdate();
  }

  /**
   * PgUp/PgDn/Home/End, only while focused. Every other key — and every key
   * when unfocused — passes through untouched: this element never intercepts
   * the terminal's key path (CORE-V2 §10).
   */
  #onKeyDown = (e: KeyboardEvent): void => {
    const v = this.#viewport();
    if (fits(v)) return;
    let row: number | null = null;
    if (e.key === 'PageUp') row = v.offset - v.visible;
    else if (e.key === 'PageDown') row = v.offset + v.visible;
    else if (e.key === 'Home') row = 0;
    else if (e.key === 'End') row = this.maxOffset;
    else return;
    e.preventDefault();
    e.stopPropagation();
    this.#emit(row);
  };
}

if (typeof customElements !== 'undefined' && !customElements.get('sem-scroll')) {
  customElements.define('sem-scroll', SemScroll);
}

declare global {
  interface HTMLElementTagNameMap {
    'sem-scroll': SemScroll;
  }
}
