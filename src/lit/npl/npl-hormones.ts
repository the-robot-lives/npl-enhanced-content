import { html, nothing, type TemplateResult } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-hormones — display-only render of an NPL synthetic-hormones block
 * (source: the NoizuPromptLingo `synthetic-hormones` pump): a panel of
 * biochemical-analog hormones (Momentum MTM, Tension TNS, Curiosity CRS,
 * Confidence CNF, Affinity AFN, Fatigue FTG, Restlessness RST) drawn as
 * bars with delta arrows, plus threshold alerts. Schema:
 * spec/schema/npl/npl-hormones.md.
 *
 * Display-only: reads the authored children once they exist
 * (whenChildrenReady), renders rows via light-DOM Lit templates, and
 * leaves every authored element in place. No events, no network, no
 * timers.
 */
const HORMONE = ':scope > panel > h';
const ALERT = ':scope > alert';
const STATE = ':scope > state';
const TRIGGERED = ':scope > triggered';
const MIN = -10;
const MAX = 10;

interface NplHormoneRow {
  name: string;
  symbol: string;
  /** Parsed `value`, clamped to [MIN, MAX]. */
  value: number;
  /** The authored value text, kept for the data-value mirror. */
  raw: string;
  /** The authored value fell outside [MIN, MAX] and was clamped. */
  outOfRange: boolean;
  /** Parsed `delta` sign (NaN/absent → 0 → flat arrow). */
  delta: number;
  /** The `triggered` block names this hormone or its trigger. */
  fired: boolean;
}

interface NplHormoneAlert {
  hormone: string;
  value: string;
  threshold: string;
  behavior: string;
  body: string;
}

function clampValue(raw: string): { value: number; outOfRange: boolean } {
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return { value: 0, outOfRange: false };
  if (parsed < MIN) return { value: MIN, outOfRange: true };
  if (parsed > MAX) return { value: MAX, outOfRange: true };
  return { value: parsed, outOfRange: false };
}

function deltaOf(raw: string | null): number {
  const parsed = Number.parseFloat(raw ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function deltaDir(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function deltaGlyph(delta: number): string {
  if (delta > 0) return '↑';
  if (delta < 0) return '↓';
  return '→';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class NplHormones extends SemElement {
  static properties = {
    variant: { type: String, reflect: true },
  };

  declare variant: string;

  #rows: NplHormoneRow[] = [];
  #state = '';
  #triggered = '';
  #alerts: NplHormoneAlert[] = [];
  #wired = false;
  #seeded = false;

  constructor() {
    super();
    this.variant = 'panel';
  }

  updated(): void {
    // dual-form contract: data-<name> wins when both spellings are authored.
    // Seeded once at upgrade; afterwards the reactive property (the bare
    // form) is the single render source and the mirror below keeps the
    // data-* spelling in step for CSS/extraction. A self-authored mirror
    // must never outvote a fresh bare write, so past the seed it is
    // write-only — and only written when it actually moves (a same-value
    // setAttribute would just re-enter Lit's update loop).
    if (!this.#seeded) {
      const authored = nplParam(this, 'variant');
      if (authored !== null) this.variant = authored;
      this.#seeded = true;
    }
    if (this.getAttribute('data-variant') !== this.variant) {
      this.afterParse('variant', () => this.setAttribute('data-variant', this.variant));
    }
    if (this.#wired) return;
    void this.whenChildrenReady(`${HORMONE}, ${ALERT}`).then(() => {
      this.#read();
      this.#wired = true;
      this.requestUpdate();
    });
  }

  /** Snapshot the authored children into render state (display-only). */
  #read(): void {
    const triggered = this.querySelector(TRIGGERED)?.textContent?.trim() ?? '';
    const fired = this.#firedMatcher(triggered);
    this.#rows = Array.from(this.querySelectorAll(HORMONE)).map((h) => {
      const symbol = nplParam(h, 'symbol', '');
      const raw = nplParam(h, 'value', '0');
      const { value, outOfRange } = clampValue(raw);
      const name = nplParam(h, 'name', '');
      return {
        name,
        symbol,
        value,
        raw,
        outOfRange,
        delta: deltaOf(nplParam(h, 'delta')),
        fired: fired(symbol, name, nplParam(h, 'trigger')),
      };
    });
    this.#state = this.querySelector(STATE)?.textContent?.trim() ?? '';
    this.#triggered = triggered;
    this.#alerts = Array.from(this.querySelectorAll(ALERT)).map((a) => ({
      hormone: nplParam(a, 'hormone', ''),
      value: nplParam(a, 'value', ''),
      threshold: nplParam(a, 'threshold', ''),
      behavior: nplParam(a, 'behavior', ''),
      body: (a.textContent ?? '').trim(),
    }));
  }

  /**
   * A row is highlighted when the authored `triggered` block names the
   * hormone — by symbol (word match: RST must not hit "first"), by name,
   * or by its trigger text. "none" (the source convention's empty value)
   * matches nothing.
   */
  #firedMatcher(
    triggered: string,
  ): (symbol: string, name: string, trigger: string | null) => boolean {
    const hay = triggered.toLowerCase();
    if (hay === '' || hay === 'none') return () => false;
    return (symbol, name, trigger) =>
      (symbol !== '' && new RegExp(`\\b${escapeRe(symbol)}\\b`, 'i').test(triggered)) ||
      (name !== '' && hay.includes(name.toLowerCase())) ||
      (trigger !== null && trigger !== '' && hay.includes(trigger.toLowerCase()));
  }

  render(): TemplateResult {
    const variant = this.variant;
    if (variant === 'alert') {
      return html`${this.#alerts.map((a) => this.#alert(a))}`;
    }
    const rows = this.#rows.map((row) => this.#row(row));
    if (variant === 'bars') {
      return html`${rows}`;
    }
    return html`${rows}
      <div class="npl-hormones-state">State: ${this.#state}</div>
      <div class="npl-hormones-triggered">Triggered: ${this.#triggered}</div>`;
  }


  #row(row: NplHormoneRow): TemplateResult {
    const percent = Math.round(((row.value - MIN) / (MAX - MIN)) * 100);
    return html`<div
      class="npl-hormones-row"
      data-symbol=${row.symbol}
      data-value=${row.raw}
      data-clamped=${row.outOfRange ? '' : nothing}
      data-fired=${row.fired ? '' : nothing}
    >
      <span class="npl-hormones-symbol">${row.symbol}</span>
      <span class="npl-hormones-name">${row.name}</span>
      <span
        class="npl-hormones-bar"
        role="img"
        aria-label="${row.name} ${row.value} (range ${MIN} to ${MAX})"
      >
        <span class="npl-hormones-fill" style=${`width: ${percent}%`}></span>
      </span>
      <span class="npl-hormones-value">${row.value}</span>
      <span class="npl-hormones-delta" data-delta=${deltaDir(row.delta)}
        >${deltaGlyph(row.delta)}</span
      >
    </div>`;
  }

  #alert(alert: NplHormoneAlert): TemplateResult {
    return html`<div class="npl-hormones-alert" data-hormone=${alert.hormone}>
      <span class="npl-hormones-alert-head"
        >${alert.hormone} ${alert.value} ≥ ${alert.threshold} · ${alert.behavior}</span
      >
      <span class="npl-hormones-alert-body">${alert.body}</span>
    </div>`;
  }
}

defineNpl('npl-hormones', NplHormones);
