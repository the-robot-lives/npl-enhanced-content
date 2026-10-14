import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplEmit, nplParam } from './shared.js';

/**
 * npl-flag — one runtime flag row: a name, a value, click-to-apply.
 *
 * Child of `npl-flags` (spec/schema/npl/npl-flag.md); usable standalone.
 * The value is authored as a string and rendered verbatim. When the NAME
 * implies a numeric range, the value is checked against it — an out-of-range
 * or non-numeric value is never an error: the flag renders with the
 * `npl-flag-invalid` warning class on its value span.
 *
 *   - `freq` in the name     → [0.0, 1.0]   (frequency flags)
 *   - `factor` in the name   → [-10, 10]    (hormone factors)
 *   - `threshold` in the name→ numeric, unbounded
 *   - anything else (pump switches, meta, …) → free-form, never validated
 *
 * Clicking the flag toggles `data-applied` on it and dispatches
 * `npl-flags-change` (bubbles + composed, via nplEmit) with detail
 * `{ name, value, applied }`.
 *
 * Accessibility: the row is the apply control — a toggle button. It is
 * focusable (`tabindex="0"` unless the host authors one), exposed as
 * `role="button"` with `aria-pressed` mirroring the applied state, and
 * applied with `Enter` or `Space` as well as a pointer click.
 */
const RANGES: ReadonlyArray<{ test: (name: string) => boolean; min?: number; max?: number }> = [
  { test: (n) => n.includes('freq'), min: 0, max: 1 },
  { test: (n) => n.includes('factor'), min: -10, max: 10 },
  { test: (n) => n.includes('threshold') },
];

function rangeFor(name: string): { min?: number; max?: number } | null {
  const n = name.toLowerCase();
  return RANGES.find((r) => r.test(n)) ?? null;
}

function violates(name: string, value: string): boolean {
  const range = rangeFor(name);
  if (!range) return false;
  const num = Number(value);
  if (value.trim() === '' || Number.isNaN(num)) return true;
  return (range.min !== undefined && num < range.min) || (range.max !== undefined && num > range.max);
}

export class NplFlag extends SemElement {
  static properties = {
    name: { type: String, reflect: true },
    value: { type: String, reflect: true },
  };

  declare name: string;
  declare value: string;

  constructor() {
    super();
    this.name = '';
    this.value = '';
  }

  connectedCallback(): void {
    super.connectedCallback();
    // toggle-button a11y: host-authored role/tabindex win when present
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKeydown);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.#onKeydown);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  /** Enter/Space apply the flag, exactly like a click (toggle button). */
  #onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this.#onClick();
  };

  /** Toggle `data-applied`, announce the new state to the host app. */
  #onClick = (): void => {
    const applied = this.toggleAttribute('data-applied');
    this.requestUpdate();
    nplEmit(this, 'flags-change', {
      name: nplParam(this, 'name', this.name),
      value: nplParam(this, 'value', this.value),
      applied,
    });
  };

  updated(): void {
    const name = nplParam(this, 'name', this.name);
    if (!name) this.warn('npl-flag: no name authored — rendering an unnamed flag');
    // applied state is announced on the host (the role="button" element)
    this.setAttribute('aria-pressed', String(this.hasAttribute('data-applied')));
    // dual-form contract: the data-* spelling mirrors the bare attribute,
    // so CSS/extraction read one form (deferred past parse, like sem-note).
    this.afterParse('name', () => this.setAttribute('data-name', name));
    this.afterParse('value', () => this.setAttribute('data-value', nplParam(this, 'value', this.value)));
  }

  render() {
    const name = nplParam(this, 'name', this.name);
    const value = nplParam(this, 'value', this.value);
    const invalid = violates(name, value);
    const applied = this.hasAttribute('data-applied');
    return html`
      <span class="npl-flag-name">${name}</span>
      <span class="npl-flag-value${invalid ? ' npl-flag-invalid' : ''}${applied ? ' npl-flag-applied' : ''}">${value}</span>
    `;
  }
}

defineNpl('npl-flag', NplFlag);
