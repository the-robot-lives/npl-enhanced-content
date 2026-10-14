// @vitest-environment happy-dom
// Unit spec — `npl-intent` (src/lit/npl/npl-intent.ts)
//
// Feature: display-only render of an NPL intent block
//          (normative source: spec/schema/npl/intent.md)
//   Scenario: the barrel exports NplIntent and the tag registers in the npl- namespace
//   Scenario: upgrades with light DOM; authored children survive, id/kind ride the globals
//   Scenario: each present section gets its label; a block with no sections gets no chrome
//   Scenario: the assumptions grid renders as a table with both confidence spellings
//   Scenario: the table replaces the authored rows; statement text moves into the cells

import { describe, it, expect, beforeEach } from 'vitest';
import { NplIntent } from '../../src/lit/npl/npl-intent.js';

const AUTHORED = `
<npl-intent id="launch" kind="initiative">
  <npl-intent-overview>Ship the fleet dashboard.</npl-intent-overview>
  <npl-intent-scope>Metrics only.</npl-intent-scope>
  <npl-intent-outcomes><ul><li>One pane per service</li></ul></npl-intent-outcomes>
  <npl-intent-assumptions>
    <npl-intent-assumption confidence="high">SigNoz keeps serving uptime queries.</npl-intent-assumption>
    <npl-intent-assumption data-confidence="medium">The chart repo stays ArgoCD-watched.</npl-intent-assumption>
    <npl-intent-assumption>ArgoCD auto-syncs from the chart repo.</npl-intent-assumption>
  </npl-intent-assumptions>
</npl-intent>`;

describe('npl-intent', () => {
  beforeEach(() => {
    document.body.innerHTML = AUTHORED;
  });

  const upgraded = async (): Promise<NplIntent> => {
    const el = document.querySelector('npl-intent') as NplIntent;
    await el.updateComplete;
    return el;
  };

  it('the barrel exports NplIntent and defines the npl-intent tag', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-intent')).toBe(NplIntent);
    expect(npl.NplIntent).toBe(NplIntent);
  });

  it('upgrades with light DOM; authored children survive; id/kind untouched', async () => {
    const el = await upgraded();
    expect(el).toBeInstanceOf(NplIntent);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.getAttribute('id')).toBe('launch');
    expect(el.getAttribute('kind')).toBe('initiative');
    expect(el.querySelector('npl-intent-overview')?.textContent).toContain('Ship the fleet dashboard.');
    expect(el.querySelector('npl-intent-outcomes ul li')?.textContent).toBe('One pane per service');
  });

  it('every present section gets its label, in authored order', async () => {
    const el = await upgraded();
    const labels = Array.from(el.querySelectorAll('.npl-intent-label')).map((s) => s.textContent);
    expect(labels).toEqual(['Goal', 'Scope', 'Outcomes', 'Assumptions']);
    expect(el.querySelector('npl-intent-overview')?.firstElementChild?.className).toBe('npl-intent-label');
  });

  it('renders the assumptions grid as a table; confidence from either spelling, default —', async () => {
    const el = await upgraded();
    const table = el.querySelector('npl-intent-assumptions table.npl-intent-assumptions-table');
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll('thead th')).map((th) => th.textContent))
      .toEqual(['Assumption', 'Confidence']);
    const rows = Array.from(table!.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.npl-intent-assumption-text')?.textContent)
      .toBe('SigNoz keeps serving uptime queries.');
    expect(rows[0].querySelector('.npl-intent-assumption-confidence')?.textContent).toBe('high');
    expect(rows[1].querySelector('.npl-intent-assumption-confidence')?.textContent).toBe('medium');
    expect(rows[2].querySelector('.npl-intent-assumption-confidence')?.textContent).toBe('—');
  });

  it('the table replaces the authored rows — no duplicated statements', async () => {
    const el = await upgraded();
    expect(el.querySelectorAll('npl-intent-assumptions npl-intent-assumption').length).toBe(0);
    const grid = el.querySelector('npl-intent-assumptions')!;
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(grid.textContent).toContain('ArgoCD auto-syncs from the chart repo.');
    // idempotent: a second update never re-renders the table
    el.requestUpdate();
    await el.updateComplete;
    expect(el.querySelectorAll('.npl-intent-assumptions-table')).toHaveLength(1);
  });

  it('a block with none of the four section children gets no chrome', async () => {
    document.body.innerHTML = '<npl-intent id="bare">plain prose only</npl-intent>';
    const el = await upgraded();
    expect(el.querySelectorAll('.npl-intent-label')).toHaveLength(0);
    expect(el.querySelectorAll('.npl-intent-assumptions-table')).toHaveLength(0);
    expect(el.textContent).toBe('plain prose only');
  });
});
