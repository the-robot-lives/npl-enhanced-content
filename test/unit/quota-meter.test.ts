// @vitest-environment happy-dom
// Unit spec — src/lit/sem-quota-meter.ts · the rolling-usage meter
//
// Feature: numbers in via attributes, meter out — nothing more (the element
//          never reads or stores credentials) (spec v0.6, lit tier)
//   Scenario: used is clamped into [0, limit] for the bar and the ARIA triple
//   Scenario: data-level flips ok → warn at 75% and warn → hot at 90%
//   Scenario: limit 0 / missing reads "no limit set" with no bar
//   Scenario: resets-at renders "resets in 2h 14m" and refreshes every minute
//   Scenario: disconnect clears the per-minute timer
//   Scenario: role="meter" carries aria-valuenow/min/max and aria-label

import { describe, it, expect, vi, afterEach } from 'vitest';
import '../../src/lit/sem-quota-meter.js';
import type { SemQuotaMeter } from '../../src/lit/sem-quota-meter.js';

const MINUTE = 60_000;

async function meter(attrs: Record<string, string>): Promise<SemQuotaMeter> {
  const el = document.createElement('sem-quota-meter') as SemQuotaMeter;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const text = (el: SemQuotaMeter, cls: string) =>
  el.querySelector('.' + cls)?.textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('sem-quota-meter clamping', () => {
  it('clamps used below 0 to 0', async () => {
    const el = await meter({ used: '-5', limit: '100', label: 'z.ai 5h' });
    expect(text(el, 'sem-quota-meter-value')).toBe('0 of 100');
    expect(el.getAttribute('aria-valuenow')).toBe('0');
    expect((el.querySelector('.sem-quota-meter-fill') as HTMLElement).style.width).toBe('0%');
  });

  it('clamps used above the limit to the limit', async () => {
    const el = await meter({ used: '250', limit: '100', label: 'z.ai 5h' });
    expect(text(el, 'sem-quota-meter-value')).toBe('100 of 100');
    expect(el.getAttribute('aria-valuenow')).toBe('100');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
    expect((el.querySelector('.sem-quota-meter-fill') as HTMLElement).style.width).toBe('100%');
  });

  it('reads a non-numeric used as 0', async () => {
    const el = await meter({ used: 'abc', limit: '50', label: 'q' });
    expect(el.getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('sem-quota-meter colour thresholds', () => {
  it('is ok below 75%, warn from 75%, hot from 90%', async () => {
    const cases: Array<[string, string]> = [
      ['74', 'ok'],
      ['75', 'warn'],
      ['89', 'warn'],
      ['90', 'hot'],
      ['100', 'hot'],
    ];
    for (const [used, level] of cases) {
      const el = await meter({ used, limit: '100', label: 'q' });
      expect(el.getAttribute('data-level'), used + '% →').toBe(level);
      el.remove();
      await el.updateComplete;
    }
  });
});

describe('sem-quota-meter no-limit state', () => {
  it('limit=0 shows "no limit set" and renders no bar', async () => {
    const el = await meter({ used: '10', limit: '0', label: 'q' });
    expect(text(el, 'sem-quota-meter-value')).toBe('no limit set');
    expect(el.querySelector('.sem-quota-meter-track')).toBeNull();
    expect(el.getAttribute('data-level')).toBe('none');
  });

  it('a missing limit shows "no limit set" and renders no bar', async () => {
    const el = await meter({ used: '10', label: 'q' });
    expect(text(el, 'sem-quota-meter-value')).toBe('no limit set');
    expect(el.querySelector('.sem-quota-meter-track')).toBeNull();
  });
});

describe('sem-quota-meter ARIA', () => {
  it('host carries role=meter with valuenow/min/max and the label', async () => {
    const el = await meter({ used: '42', limit: '100', label: 'z.ai 5-hour window' });
    expect(el.getAttribute('role')).toBe('meter');
    expect(el.getAttribute('aria-label')).toBe('z.ai 5-hour window');
    expect(el.getAttribute('aria-valuemin')).toBe('0');
    expect(el.getAttribute('aria-valuenow')).toBe('42');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
  });
});

describe('sem-quota-meter reset timer', () => {
  it('renders relative text and refreshes once a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const resetsAt = new Date('2026-10-13T12:14:00Z').toISOString();
    const el = await meter({ used: '42', limit: '100', label: 'q', 'resets-at': resetsAt });
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets in 2h 14m');

    vi.advanceTimersByTime(MINUTE); // exactly one minute → one recomputation
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets in 2h 13m');

    vi.advanceTimersByTime(MINUTE - 1); // no second tick before the minute
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets in 2h 13m');
  });

  it('reads "resets now" once the timestamp has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const el = await meter({ used: '9', limit: '10', label: 'q', 'resets-at': '2026-10-13T09:59:00Z' });
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets now');
  });

  it('stops the timer on disconnect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const el = await meter({ used: '1', limit: '10', label: 'q', 'resets-at': '2026-10-13T13:00:00Z' });
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets in 3h');

    el.remove();
    expect(clearSpy).toHaveBeenCalled();

    // A running timer would rewrite the text on the next tick; a detached
    // element is gone, so re-append and confirm nothing fires for the old
    // element while an hour of fake time passes.
    vi.advanceTimersByTime(60 * MINUTE);
    expect(text(el, 'sem-quota-meter-reset')).toBe('resets in 3h');
    clearSpy.mockRestore();
  });

  it('renders no reset line without resets-at, and none for a bad timestamp', async () => {
    const el = await meter({ used: '1', limit: '10', label: 'q' });
    expect(el.querySelector('.sem-quota-meter-reset')).toBeNull();
    el.setAttribute('resets-at', 'not-a-date');
    await el.updateComplete;
    expect(el.querySelector('.sem-quota-meter-reset')).toBeNull();
  });
});
