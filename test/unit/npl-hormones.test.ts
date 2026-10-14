// @vitest-environment happy-dom
// Unit spec — `npl-hormones` (src/lit/npl/npl-hormones.ts)
//
// Feature: the seven-hormone panel renders bars, deltas and alerts
//          (recipe: src/lit/npl/index.ts header; schema:
//          spec/schema/npl/npl-hormones.md)
//   Scenario: importing the component registers npl-hormones and upgrades light DOM
//   Scenario: out-of-range values clamp into [-10, 10] and mark the row
//   Scenario: the delta sign drives the arrow direction (up/down/flat)
//   Scenario: the bar width follows the clamped value
//   Scenario: panel (default) renders rows plus the state and triggered lines
//   Scenario: the bars variant renders rows only
//   Scenario: the alert variant renders only the alert elements
//   Scenario: the triggered block highlights the fired hormone's row

import { describe, it, expect, beforeEach } from 'vitest';
import { NplHormones } from '../../src/lit/npl/npl-hormones.js';

const PANEL = `
<npl-hormones id="fx">
  <panel>
    <h name="Momentum"     symbol="MTM" value="6"    delta="+2" trigger="Tests passed first try"></h>
    <h name="Restlessness" symbol="RST" value="8.5"  delta="-1" trigger="Strategy failed"></h>
    <h name="Fatigue"      symbol="FTG" value="12"   delta="+1" trigger="Session long"></h>
    <h name="Tension"      symbol="TNS" value="-15"  delta="0"  trigger="Complexity"></h>
  </panel>
  <state>Productive tension</state>
  <triggered>RST threshold crossed</triggered>
  <alert hormone="RST" value="8.5" threshold="7" behavior="strategy-switch">
    Restlessness threshold crossed. Initiating plan-of-action.
  </alert>
</npl-hormones>`;

async function mount(html: string): Promise<NplHormones> {
  document.body.innerHTML = html;
  const el = document.getElementById('fx') as NplHormones;
  await el.updateComplete;
  await el.updateComplete; // second pass: the children-read re-render
  return el;
}

const rowOf = (el: NplHormones, symbol: string) =>
  el.querySelector(`.npl-hormones-row[data-symbol="${symbol}"]`) as HTMLElement;

/** Switch variant and wait out the mirror-convergence pass. */
async function setVariant(el: NplHormones, variant: string): Promise<void> {
  el.setAttribute('variant', variant);
  await el.updateComplete;
  await el.updateComplete;
}

describe('npl-hormones', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers npl-hormones and upgrades light DOM — authored children survive', async () => {
    const el = await mount(PANEL);
    expect(customElements.get('npl-hormones')).toBe(NplHormones);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector(':scope > panel > h')).not.toBeNull();
    expect(el.querySelector(':scope > alert')).not.toBeNull();
    expect(el.getAttribute('data-variant')).toBe('panel');
  });

  it('clamps out-of-range values into [-10, 10] and marks the row', async () => {
    const el = await mount(PANEL);
    const high = rowOf(el, 'FTG');
    expect(high.querySelector('.npl-hormones-value')?.textContent).toBe('10');
    expect(high.querySelector('.npl-hormones-fill')?.getAttribute('style')).toBe('width: 100%');
    expect(high.hasAttribute('data-clamped')).toBe(true);
    expect(high.getAttribute('data-value')).toBe('12');

    const low = rowOf(el, 'TNS');
    expect(low.querySelector('.npl-hormones-value')?.textContent).toBe('-10');
    expect(low.querySelector('.npl-hormones-fill')?.getAttribute('style')).toBe('width: 0%');
    expect(low.hasAttribute('data-clamped')).toBe(true);

    expect(rowOf(el, 'MTM').hasAttribute('data-clamped')).toBe(false);
  });

  it('the delta sign drives the arrow direction', async () => {
    const el = await mount(PANEL);
    const deltaOf = (symbol: string) => rowOf(el, symbol).querySelector('.npl-hormones-delta')!;
    expect(deltaOf('MTM').getAttribute('data-delta')).toBe('up');
    expect(deltaOf('MTM').textContent).toBe('↑');
    expect(deltaOf('RST').getAttribute('data-delta')).toBe('down');
    expect(deltaOf('RST').textContent).toBe('↓');
    expect(deltaOf('TNS').getAttribute('data-delta')).toBe('flat');
    expect(deltaOf('TNS').textContent).toBe('→');
  });

  it('the bar width follows the clamped value', async () => {
    const el = await mount(PANEL);
    const fill = rowOf(el, 'MTM').querySelector('.npl-hormones-fill')!;
    // (6 - -10) / 20 = 80%
    expect(fill.getAttribute('style')).toBe('width: 80%');
  });

  it('panel is the default variant and renders rows plus state and triggered lines', async () => {
    const el = await mount(PANEL);
    expect(el.querySelectorAll('.npl-hormones-row')).toHaveLength(4);
    expect(el.querySelector('.npl-hormones-state')?.textContent).toContain('Productive tension');
    expect(el.querySelector('.npl-hormones-triggered')?.textContent).toContain(
      'RST threshold crossed',
    );
  });

  it('the bars variant renders the rows only', async () => {
    const el = await mount(PANEL);
    await setVariant(el, 'bars');
    expect(el.querySelectorAll('.npl-hormones-row')).toHaveLength(4);
    expect(el.querySelector('.npl-hormones-state')).toBeNull();
    expect(el.querySelector('.npl-hormones-triggered')).toBeNull();
    expect(el.querySelector('.npl-hormones-alert')).toBeNull();
  });

  it('the alert variant renders only the alert elements', async () => {
    const el = await mount(PANEL);
    await setVariant(el, 'alert');
    expect(el.querySelectorAll('.npl-hormones-row')).toHaveLength(0);
    expect(el.querySelector('.npl-hormones-state')).toBeNull();
    expect(el.querySelector('.npl-hormones-triggered')).toBeNull();
    const alert = el.querySelector('.npl-hormones-alert') as HTMLElement;
    expect(alert.getAttribute('data-hormone')).toBe('RST');
    expect(alert.querySelector('.npl-hormones-alert-head')?.textContent).toContain(
      'RST 8.5 ≥ 7 · strategy-switch',
    );
    expect(alert.querySelector('.npl-hormones-alert-body')?.textContent).toContain(
      'Initiating plan-of-action',
    );
  });

  it('the triggered block highlights the fired hormone row; none highlights nothing', async () => {
    const el = await mount(PANEL);
    expect(rowOf(el, 'RST').hasAttribute('data-fired')).toBe(true);
    expect(rowOf(el, 'MTM').hasAttribute('data-fired')).toBe(false);
    expect(rowOf(el, 'FTG').hasAttribute('data-fired')).toBe(false);

    // a symbol must not match inside another word ("first")
    const el2 = await mount(PANEL.replace('RST threshold crossed', 'first response drafted'));
    expect(rowOf(el2, 'RST').hasAttribute('data-fired')).toBe(false);

    // the source convention's empty value
    const el3 = await mount(PANEL.replace('RST threshold crossed', 'none'));
    expect(el3.querySelectorAll('[data-fired]')).toHaveLength(0);
  });

  it('data-variant wins when both spellings are authored; the mirror follows the resolved variant', async () => {
    const el = await mount(
      PANEL.replace(
        '<npl-hormones id="fx">',
        '<npl-hormones id="fx" variant="bars" data-variant="alert">',
      ),
    );
    expect(el.querySelectorAll('.npl-hormones-row')).toHaveLength(0);
    expect(el.querySelector('.npl-hormones-alert')).not.toBeNull();
    // the component mirrors the resolved spelling for CSS/extraction
    expect(el.getAttribute('data-variant')).toBe('alert');
  });
});
