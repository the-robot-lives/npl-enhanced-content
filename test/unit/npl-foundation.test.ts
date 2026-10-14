// @vitest-environment happy-dom
// Unit spec — the `npl-*` component foundation (src/lit/npl/)
//
// Feature: the NPL namespace registers, renders light DOM and shares the
//          sem-* conventions (recipe: src/lit/npl/index.ts header)
//   Scenario: importing the barrel registers npl-example and exposes the helpers
//   Scenario: defineNpl refuses a tag outside the npl- namespace and is idempotent
//   Scenario: npl-example upgrades without a shadow root; authored children survive
//   Scenario: the label renders in light DOM and mirrors to data-label
//   Scenario: nplParam reads either spelling, data-* wins, fallback applies
//   Scenario: nplEmit dispatches a bubbling, composed npl-* CustomEvent

import { describe, it, expect, beforeEach } from 'vitest';
import { NplExample } from '../../src/lit/npl/npl-example.js';
import { defineNpl, nplParam, nplEmit } from '../../src/lit/npl/shared.js';

describe('npl foundation', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<npl-example id="ex" label="hello">authored <em>child</em></npl-example>';
  });

  it('the barrel registers npl-example and exposes the namespace helpers', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-example')).toBe(NplExample);
    expect(typeof npl.defineNpl).toBe('function');
    expect(typeof npl.nplParam).toBe('function');
    expect(typeof npl.nplEmit).toBe('function');
  });

  it('defineNpl refuses a tag outside the npl- namespace and is idempotent', () => {
    expect(() => defineNpl('sem-hijack', NplExample)).toThrow(/npl-/);
    expect(() => defineNpl('npl-example', NplExample)).not.toThrow();
  });

  it('upgrades with light DOM — no shadow root, authored children survive', async () => {
    const el = document.getElementById('ex') as NplExample;
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplExample);
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector('em')?.textContent).toBe('child');
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
  });

  it('renders the label in light DOM and mirrors it to data-label', async () => {
    const el = document.getElementById('ex') as NplExample;
    await el.updateComplete;
    const label = el.querySelector('.npl-example-label');
    expect(label?.textContent).toBe('hello');
    expect(el.getAttribute('data-label')).toBe('hello');
  });

  it('nplParam reads either spelling, data-* wins, fallback applies', () => {
    const el = document.getElementById('ex')!;
    expect(nplParam(el, 'label')).toBe('hello');
    el.setAttribute('data-label', 'data-form');
    expect(nplParam(el, 'label')).toBe('data-form');
    expect(nplParam(el, 'missing')).toBeNull();
    expect(nplParam(el, 'missing', 'fallback')).toBe('fallback');
  });

  it('nplEmit dispatches a bubbling, composed npl-* CustomEvent with detail', () => {
    const el = document.getElementById('ex')!;
    const events: CustomEvent[] = [];
    document.addEventListener('npl-example-seen', (e) => events.push(e as CustomEvent));
    expect(el.announce()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ label: 'hello' });
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
  });
});
