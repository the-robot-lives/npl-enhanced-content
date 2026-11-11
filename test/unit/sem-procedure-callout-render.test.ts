// @vitest-environment happy-dom
// Unit spec — enhanced renders for sem-procedure / sem-step / sem-tldr / sem-summary
//
// Feature: graduated claim stubs render attribute-level chrome; authored content is never moved
//   Scenario: the procedure prepends a progress line and flags a blocked procedure
//   Scenario: the progress line follows status changes (bind hydration path)
//   Scenario: steps get positional data-ordinal and aria-current on the current step
//   Scenario: the progress line is extraction chrome — records equal JS-off
//   Scenario: tldr / summary become labelled notes; authored role / aria-label win

import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/lit/sem-procedure.js';
import { SemStep } from '../../src/lit/sem-step.js';
import '../../src/lit/sem-tldr.js';
import '../../src/lit/sem-summary.js';
import { extractRecords } from '../../src/extract/records.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const PROC = `<sem-procedure kind="runbook" role="list">
  <sem-step role="listitem" status="done">provision</sem-step>
  <sem-step role="listitem" status="current">port-forward</sem-step>
  <sem-step role="listitem">migrate</sem-step>
  <sem-step role="listitem" status="blocked">release</sem-step>
</sem-procedure>`;

async function mount(html: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.className = 'sem-enhanced-document';
  host.innerHTML = html;
  document.body.appendChild(host);
  host.querySelectorAll('*').forEach((el) => customElements.upgrade(el));
  for (let i = 0; i < 3; i++) await tick();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('sem-procedure / sem-step', () => {
  it('prepends a progress line and flags a blocked procedure', async () => {
    const host = await mount(PROC);
    const proc = host.querySelector('sem-procedure')!;
    const meta = proc.firstElementChild!;
    expect(meta.className).toBe('sem-procedure-meta');
    expect(meta.textContent).toBe('1 of 4 done · 1 blocked');
    expect(proc.hasAttribute('data-blocked')).toBe(true);
    expect(proc.querySelectorAll(':scope > sem-step')).toHaveLength(4);
  });

  it('follows status changes', async () => {
    const host = await mount(PROC);
    const proc = host.querySelector('sem-procedure')!;
    const steps = proc.querySelectorAll('sem-step');
    steps[3].setAttribute('status', 'done');
    steps[2].setAttribute('data-status', 'done');
    await tick();
    expect(proc.querySelector('.sem-procedure-meta')!.textContent).toBe('3 of 4 done');
    expect(proc.hasAttribute('data-blocked')).toBe(false);
    expect(proc.querySelectorAll('.sem-procedure-meta')).toHaveLength(1);
  });

  it('numbers steps positionally and marks the current one', async () => {
    const host = await mount(PROC);
    const steps = Array.from(host.querySelectorAll<HTMLElement>('sem-step'));
    expect(steps[0]).toBeInstanceOf(SemStep);
    expect(steps.map((s) => s.getAttribute('data-ordinal'))).toEqual(['1', '2', '3', '4']);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
    steps[1].setAttribute('status', 'done');
    steps[2].setAttribute('status', 'current');
    await tick();
    await (steps[2] as SemStep).updateComplete;
    expect(steps[1].hasAttribute('aria-current')).toBe(false);
    expect(steps[2].getAttribute('aria-current')).toBe('step');
  });

  it('keeps extraction equal to the JS-off records', async () => {
    const host = await mount(PROC);
    const records = extractRecords(host);
    const proc = records.find((r) => r.type === 'sem-procedure');
    expect(proc).toBeTruthy();
    expect(JSON.stringify(records)).not.toContain('of 4 done');
  });
});

describe('sem-tldr / sem-summary callouts', () => {
  it('label the block as a note; authored attributes win', async () => {
    const host = await mount(`
      <sem-tldr><p>Short.</p></sem-tldr>
      <sem-summary kind="executive"><p>Longer.</p></sem-summary>
      <sem-summary><p>Plain.</p></sem-summary>
      <sem-tldr role="region" aria-label="Gist"><p>Mine.</p></sem-tldr>`);
    const [t, s1, s2, t2] = Array.from(host.children);
    expect(t.getAttribute('role')).toBe('note');
    expect(t.getAttribute('aria-label')).toBe('TL;DR');
    expect(s1.getAttribute('aria-label')).toBe('Summary · executive');
    expect(s2.getAttribute('aria-label')).toBe('Summary');
    expect(t2.getAttribute('role')).toBe('region');
    expect(t2.getAttribute('aria-label')).toBe('Gist');
    expect(t.children).toHaveLength(1); // authored content untouched
    expect(t.textContent!.trim()).toBe('Short.');
  });
});
