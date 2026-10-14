// @vitest-environment happy-dom
// Unit spec — the `npl-flag` component (src/lit/npl/npl-flag.ts)
//
// Feature: one runtime flag row — name, value, click-to-apply
//          (BDD source: spec/schema/npl/npl-flag.md)
//   Scenario: registering + upgrading light DOM with no shadow root
//   Scenario: the name and value render in light DOM and mirror to data-*
//   Scenario: an in-range factor value renders clean
//   Scenario: an out-of-range factor value gets the warning class, not a throw
//   Scenario: a non-numeric factor value gets the warning class
//   Scenario: frequency flags validate [0.0, 1.0]
//   Scenario: thresholds must be numeric but are unbounded
//   Scenario: free-form names (pump switches, meta) are never validated
//   Scenario: data-* spelling wins when both forms are authored
//   Scenario: clicking toggles data-applied and dispatches npl-flags-change
//   Scenario: the change event bubbles and composes to the document
//   Scenario: the row is a focusable toggle button (role, tabindex, aria-pressed)
//   Scenario: Enter and Space apply the flag like a click
//
//happy-dom never completes a Lit re-render cycle for these light-DOM
//elements (attribute/property mutations post-upgrade patch nothing), so
//every validation scenario authors a FRESH element at parse time — the
//real authoring path — instead of mutating a live one.

import { describe, it, expect, beforeEach } from 'vitest';
import { NplFlag } from '../../src/lit/npl/npl-flag.js';

describe('npl-flag', () => {
  beforeEach(() => {
    document.body.innerHTML = '<npl-flag id="f" name="calm_factor" value="0.5"></npl-flag>';
  });

  const author = (html: string): NplFlag => {
    document.body.innerHTML = html;
    return document.body.querySelector('npl-flag') as NplFlag;
  };
  const flag = (): NplFlag => document.getElementById('f') as NplFlag;
  const valueSpan = (el: NplFlag): Element | null => el.querySelector('.npl-flag-value');

  it('registers and upgrades with light DOM — no shadow root', async () => {
    const el = flag();
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplFlag);
    expect(customElements.get('npl-flag')).toBe(NplFlag);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
  });

  it('renders its name and value in light DOM and mirrors them to data-*', async () => {
    const el = flag();
    await el.updateComplete;
    expect(el.querySelector('.npl-flag-name')?.textContent).toBe('calm_factor');
    expect(valueSpan(el)?.textContent).toBe('0.5');
    expect(el.getAttribute('data-name')).toBe('calm_factor');
    expect(el.getAttribute('data-value')).toBe('0.5');
  });

  it('an in-range factor value renders clean', async () => {
    const el = author('<npl-flag name="calm_factor" value="-10"></npl-flag>');
    await el.updateComplete;
    expect(valueSpan(el)?.classList.contains('npl-flag-invalid')).toBe(false);
  });

  it('an out-of-range factor value gets the warning class, not a throw', async () => {
    const el = author('<npl-flag name="calm_factor" value="42"></npl-flag>');
    await el.updateComplete;
    expect(valueSpan(el)?.classList.contains('npl-flag-invalid')).toBe(true);
  });

  it('a non-numeric factor value gets the warning class', async () => {
    const el = author('<npl-flag name="calm_factor" value="high"></npl-flag>');
    await el.updateComplete;
    expect(valueSpan(el)?.classList.contains('npl-flag-invalid')).toBe(true);
  });

  it('frequency flags validate [0.0, 1.0]', async () => {
    const over = author('<npl-flag name="tick_frequency" value="1.1"></npl-flag>');
    await over.updateComplete;
    expect(valueSpan(over)?.classList.contains('npl-flag-invalid')).toBe(true);
    const edge = author('<npl-flag name="tick_frequency" value="0"></npl-flag>');
    await edge.updateComplete;
    expect(valueSpan(edge)?.classList.contains('npl-flag-invalid')).toBe(false);
  });

  it('thresholds must be numeric but are unbounded', async () => {
    const big = author('<npl-flag name="panic_threshold" value="999"></npl-flag>');
    await big.updateComplete;
    expect(valueSpan(big)?.classList.contains('npl-flag-invalid')).toBe(false);
    const words = author('<npl-flag name="panic_threshold" value="way-past"></npl-flag>');
    await words.updateComplete;
    expect(valueSpan(words)?.classList.contains('npl-flag-invalid')).toBe(true);
  });

  it('free-form names (pump switches, meta) are never validated', async () => {
    const pump = author('<npl-flag name="pump_switch" value="banana"></npl-flag>');
    await pump.updateComplete;
    expect(valueSpan(pump)?.classList.contains('npl-flag-invalid')).toBe(false);
    const meta = author('<npl-flag name="persona_meta" value="banana"></npl-flag>');
    await meta.updateComplete;
    expect(valueSpan(meta)?.classList.contains('npl-flag-invalid')).toBe(false);
  });

  it('the data-* spelling wins when both forms are authored', async () => {
    const el = author('<npl-flag name="calm_factor" value="0.5" data-value="42"></npl-flag>');
    await el.updateComplete;
    expect(valueSpan(el)?.textContent).toBe('42');
    expect(valueSpan(el)?.classList.contains('npl-flag-invalid')).toBe(true);
  });

  it('clicking toggles data-applied and dispatches npl-flags-change with detail', async () => {
    const el = flag();
    await el.updateComplete;
    const events: CustomEvent[] = [];
    el.addEventListener('npl-flags-change', (e) => events.push(e as CustomEvent));

    el.click();
    expect(el.hasAttribute('data-applied')).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ name: 'calm_factor', value: '0.5', applied: true });

    el.click();
    expect(el.hasAttribute('data-applied')).toBe(false);
    expect(events[1].detail).toEqual({ name: 'calm_factor', value: '0.5', applied: false });
  });

  it('the change event bubbles and composes to the document', async () => {
    const el = flag();
    await el.updateComplete;
    const events: CustomEvent[] = [];
    document.addEventListener('npl-flags-change', (e) => events.push(e as CustomEvent));
    el.click();
    expect(events).toHaveLength(1);
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
  });

  it('the row is a focusable toggle button (role, tabindex, aria-pressed)', async () => {
    const el = flag();
    await el.updateComplete;
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-pressed')).toBe('false');
    el.click();
    await el.updateComplete;
    expect(el.getAttribute('aria-pressed')).toBe('true');
    el.click();
    await el.updateComplete;
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('a host-authored role or tabindex wins over the defaults', async () => {
    const el = author('<npl-flag name="calm_factor" value="0.5" role="switch" tabindex="4"></npl-flag>');
    await el.updateComplete;
    expect(el.getAttribute('role')).toBe('switch');
    expect(el.getAttribute('tabindex')).toBe('4');
  });

  it('Enter and Space apply the flag like a click', async () => {
    const el = flag();
    await el.updateComplete;
    const events: CustomEvent[] = [];
    el.addEventListener('npl-flags-change', (e) => events.push(e as CustomEvent));

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(el.hasAttribute('data-applied')).toBe(true);
    expect(events[0]?.detail).toEqual({ name: 'calm_factor', value: '0.5', applied: true });

    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(el.hasAttribute('data-applied')).toBe(false);
    expect(events[1]?.detail).toEqual({ name: 'calm_factor', value: '0.5', applied: false });

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.hasAttribute('data-applied')).toBe(false);
    expect(events).toHaveLength(2);
  });
});
