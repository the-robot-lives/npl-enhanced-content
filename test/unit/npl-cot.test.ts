// @vitest-environment happy-dom
// Unit spec — `npl-cot` (src/lit/npl/npl-cot.ts; schema: spec/schema/npl/cot.md)
//
// Feature: chain-of-thought steps + one outcome, folded in a native details
//   Scenario: the barrel registers npl-cot alongside the other namespace tags
//   Scenario: light DOM upgrade — native details/summary chrome is generated
//   Scenario: step children move into the details; the outcome moves outside it
//   Scenario: the summary counts the steps
//   Scenario: without `collapsed` the details starts open
//   Scenario: `collapsed` starts the details closed and mirrors to data-collapsed

import { describe, it, expect, beforeEach } from 'vitest';
import { NplCot } from '../../src/lit/npl/npl-cot.js';

const AUTHORED =
  '<npl-cot id="cot">' +
  '<sem-step>step one</sem-step>' +
  '<sem-step>step two</sem-step>' +
  '<div outcome>the answer</div>' +
  '</npl-cot>';

describe('npl-cot', () => {
  beforeEach(() => {
    document.body.innerHTML = AUTHORED;
  });

  it('the barrel registers npl-cot', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-cot')).toBe(NplCot);
    expect(typeof npl.NplCot).toBe('function');
  });

  it('upgrades with light DOM and generates native details chrome', async () => {
    const el = document.getElementById('cot') as NplCot;
    await el.updateComplete;
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    const details = el.querySelector('details.npl-cot-details');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary.npl-cot-summary')).not.toBeNull();
  });

  it('moves steps inside the details and the outcome outside it', async () => {
    const el = document.getElementById('cot') as NplCot;
    await el.updateComplete;
    const steps = el.querySelectorAll('.npl-cot-steps sem-step');
    expect(steps.length).toBe(2);
    expect(steps[0].textContent).toBe('step one');
    const outcome = el.querySelector('.npl-cot-outcome-slot [outcome]');
    expect(outcome?.textContent).toBe('the answer');
    const details = el.querySelector('details')!;
    expect(details.contains(outcome!)).toBe(false);
  });

  it('the summary counts the authored steps', async () => {
    const el = document.getElementById('cot') as NplCot;
    await el.updateComplete;
    expect(el.querySelector('.npl-cot-summary')?.textContent?.trim())
      .toBe('Chain of thought (2 steps)');
  });

  it('without collapsed the details starts open', async () => {
    const el = document.getElementById('cot') as NplCot;
    await el.updateComplete;
    expect(el.querySelector('details')?.hasAttribute('open')).toBe(true);
  });

  it('collapsed mirrors to data-collapsed and starts the details closed', async () => {
    document.body.innerHTML =
      '<npl-cot collapsed><sem-step>only step</sem-step></npl-cot>';
    const el = document.querySelector('npl-cot') as NplCot;
    await el.updateComplete;
    expect(el.collapsed).toBe(true);
    expect(el.getAttribute('data-collapsed')).toBe('true');
    expect(el.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(el.querySelector('.npl-cot-summary')?.textContent?.trim())
      .toBe('Chain of thought (1 step)');
  });
});
