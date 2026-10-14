// @vitest-environment happy-dom
// Unit spec — the `npl-rubric` weighted scoring rubric (src/lit/npl/npl-rubric.ts)
//
// Feature: display-only rubric table from NPL rubric blocks
//          (recipe: src/lit/npl/index.ts header; schema: spec/schema/npl/npl-rubric.md)
//   Scenario: criteria render as a light-DOM table with weight and score
//   Scenario: without a stated overall score the weighted average is computed and marked
//   Scenario: criteria with a missing or non-numeric weight are marked and ignored
//   Scenario: a stated overall_score takes precedence over the computed average (value attr or text)
//   Scenario: title renders as the caption and mirrors to data-title

import { describe, it, expect } from 'vitest';
import { NplRubric } from '../../src/lit/npl/npl-rubric.js';

/** Mount a rubric and wait for the collect → requestUpdate → render cycle. */
async function mount(markup: string): Promise<NplRubric> {
  document.body.innerHTML = markup;
  const el = document.querySelector('npl-rubric') as NplRubric;
  await el.updateComplete;
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

describe('npl-rubric', () => {
  it('renders criteria as a light-DOM table with weight and score', async () => {
    const el = await mount(`
      <npl-rubric title="Quality">
        <npl-criterion name="Correctness" weight="3" score="4"></npl-criterion>
        <npl-criterion name="Style" weight="1" score="5"></npl-criterion>
      </npl-rubric>`);
    expect(el).toBeInstanceOf(NplRubric);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    const table = el.querySelector('table.npl-rubric-table')!;
    expect(table).not.toBeNull();
    // A single table, never one per authored child.
    expect(el.querySelectorAll('table.npl-rubric-table')).toHaveLength(1);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Correctness');
    expect(rows[0].textContent).toContain('3');
    expect(rows[0].textContent).toContain('4');
    // The authored criteria are the data, not rows: they never appear inside
    // the table (the browser's light-DOM render replaces them outright; the
    // happy-dom unit env keeps them, so pin the invariant that works in both).
    expect(table.querySelectorAll('npl-criterion')).toHaveLength(0);
  });

  it('computes the weighted average when no overall score is stated, marked computed', async () => {
    // (3·4 + 1·5) / (3 + 1) = 4.25
    const el = await mount(`
      <npl-rubric>
        <npl-criterion name="Correctness" weight="3" score="4"></npl-criterion>
        <npl-criterion name="Style" weight="1" score="5"></npl-criterion>
      </npl-rubric>`);
    const overall = el.querySelector('tr.npl-rubric-overall')!;
    expect(overall.getAttribute('data-source')).toBe('computed');
    expect(overall.querySelector('.npl-rubric-overall-value')?.textContent?.trim()).toBe('4.25');
    expect(overall.querySelector('.npl-rubric-source')?.textContent).toBe('(computed)');
  });

  it('marks and ignores criteria with a missing or non-numeric weight (or score)', async () => {
    // Only "A" counts: (2·4) / 2 = 4
    const el = await mount(`
      <npl-rubric>
        <npl-criterion name="A" weight="2" score="4"></npl-criterion>
        <npl-criterion name="B" score="5"></npl-criterion>
        <npl-criterion name="C" weight="high" score="2"></npl-criterion>
        <npl-criterion name="D" weight="1" score="n/a"></npl-criterion>
      </npl-rubric>`);
    const rows = Array.from(el.querySelectorAll('tbody tr'));
    const byName = new Map(
      rows.map((r) => [r.querySelector('th')!.textContent!.trim().split('\n')[0].trim(), r]),
    );
    expect(byName.get('B')!.getAttribute('data-excluded')).toContain('no numeric weight');
    expect(byName.get('C')!.getAttribute('data-excluded')).toContain('no numeric weight');
    expect(byName.get('D')!.getAttribute('data-excluded')).toContain('no numeric score');
    expect(byName.get('B')!.querySelector('.npl-rubric-flag')?.textContent).toContain('ignored');
    expect(byName.get('A')!.hasAttribute('data-excluded')).toBe(false);
    const overall = el.querySelector('tr.npl-rubric-overall')!;
    expect(overall.getAttribute('data-source')).toBe('computed');
    expect(overall.querySelector('.npl-rubric-overall-value')?.textContent?.trim()).toBe('4');
  });

  it('a stated overall_score takes precedence over the computed average', async () => {
    const el = await mount(`
      <npl-rubric>
        <npl-criterion name="Correctness" weight="3" score="4"></npl-criterion>
        <npl-criterion name="Style" weight="1" score="5"></npl-criterion>
        <npl-overall-score value="4.5"></npl-overall-score>
      </npl-rubric>`);
    const overall = el.querySelector('tr.npl-rubric-overall')!;
    expect(overall.getAttribute('data-source')).toBe('stated');
    expect(overall.querySelector('.npl-rubric-overall-value')?.textContent?.trim()).toBe('4.5');
    expect(overall.querySelector('.npl-rubric-source')?.textContent).toBe('(stated)');
    // The consumed overall-score element is never re-rendered inside the table.
    expect(el.querySelectorAll('.npl-rubric-table npl-overall-score')).toHaveLength(0);
  });

  it('reads a stated overall score from the element text when value is absent', async () => {
    const el = await mount(`
      <npl-rubric>
        <npl-criterion name="A" weight="1" score="1"></npl-criterion>
        <npl-overall-score> 3.5 </npl-overall-score>
      </npl-rubric>`);
    const overall = el.querySelector('tr.npl-rubric-overall')!;
    expect(overall.getAttribute('data-source')).toBe('stated');
    expect(overall.querySelector('.npl-rubric-overall-value')?.textContent?.trim()).toBe('3.5');
  });

  it('renders the title as caption and mirrors it to data-title', async () => {
    const el = await mount('<npl-rubric title="Review rubric"></npl-rubric>');
    expect(el.querySelector('caption.npl-rubric-title')?.textContent).toBe('Review rubric');
    expect(el.getAttribute('data-title')).toBe('Review rubric');
  });
});
