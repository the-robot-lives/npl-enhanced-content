// @vitest-environment happy-dom
// Unit spec — the authored payload's raw box and the source/join bucket
// guards (spec/schema/sem-data-source.md, sem-data-query.md,
// sem-data-join.md §Rendered form; reading/data.ts parkPayload).
//
// Feature: the authored payload must not echo above the generated table
//   Scenario: a successful render parks the payload in .sem-data-raw, marks
//     the source data-sem-upgraded, and textContent is byte-identical
//   Scenario: a failed render never parks — the authored text stays beside
//     the alert
//   Scenario: the query statement parks before its chrome wires; edits
//     rewrite the parked box, not the element's children
//   Scenario: extraction over the enhanced DOM is unchanged
//   Scenario: SELECT * still mirrors a parked sibling's columns
//   Scenario: re-enhance is idempotent (one box per element, one body)
//   Scenario: parkPayload is idempotent on its own
//   Scenario: a late source that would shadow a join-minted bucket errors
//     and the join's bucket survives

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enhanceDataVisualizerElement, parkPayload } from '../../src/reading/data.js';
import { extractRecords, extractText } from '../../src/extract/records.js';

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TOKENS = `| token | max | rotates |
|-------|----:|-------:|
| a     | 10  | true   |
| b     | 20  | false  |`;

const page = () => `
<sem-data-visualizer id="dv">
  <sem-data-source data-name="Tokens">${TOKENS}</sem-data-source>
  <sem-data-query id="q1">SELECT token FROM tokens</sem-data-query>
  <sem-note kind="note" id="n1">watch the sort</sem-note>
</sem-data-visualizer>`;

describe('parkPayload (the raw box)', () => {
  it('is idempotent and keeps textContent byte-identical', () => {
    const el = document.createElement('sem-data-source');
    el.textContent = TOKENS;
    parkPayload(el);
    parkPayload(el);
    expect(el.querySelectorAll(':scope > .sem-data-raw').length).toBe(1);
    expect(el.textContent).toBe(TOKENS);
  });
});

describe('the raw box on enhance', () => {
  beforeEach(() => {
    document.body.innerHTML = page();
  });

  it('parks the payload on a successful render; the source is upgraded', () => {
    const dv = document.getElementById('dv')!;
    const src = dv.querySelector('sem-data-source')!;
    const before = src.textContent;
    enhanceDataVisualizerElement(dv);
    const raw = src.querySelector(':scope > .sem-data-raw');
    expect(raw).not.toBeNull();
    expect(raw!.textContent).toBe(before);
    expect(src.getAttribute('data-sem-upgraded')).toBe('');
    expect(src.querySelector(':scope > .sem-data-body table')).not.toBeNull();
  });

  it('never parks on a failed render', () => {
    const dv = document.getElementById('dv')!;
    const src = dv.querySelector('sem-data-source')!;
    src.setAttribute('data-format', 'nope');
    enhanceDataVisualizerElement(dv);
    expect(src.querySelector(':scope > .sem-data-raw')).toBeNull();
    const err = src.querySelector('.sem-data-error');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(src.textContent).toContain('| token |');
  });

  it('parks the query statement; edits rewrite the parked box', async () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const q = dv.querySelector('#q1')!;
    const raw = q.querySelector(':scope > .sem-data-raw')!;
    expect(q.getAttribute('data-sem-upgraded')).toBe('');
    expect(raw.textContent!.trim()).toBe('SELECT token FROM tokens');
    const input = dv.querySelector('.sem-data-query-input') as HTMLTextAreaElement;
    expect(input.value).toBe('SELECT token FROM tokens');
    input.value = 'SELECT max FROM tokens';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400)); // the debounced rewrite
    expect(q.querySelector(':scope > .sem-data-raw')!.textContent!.trim()).toBe('SELECT max FROM tokens');
  });

  it('is idempotent across re-enhance', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    enhanceDataVisualizerElement(dv);
    expect(dv.querySelectorAll('.sem-data-raw').length).toBe(2); // source + query
    expect(dv.querySelectorAll('sem-data-source > .sem-data-body').length).toBe(1);
    expect(dv.querySelectorAll('.sem-data-query-chrome').length).toBe(1);
  });

  it('keeps extraction unchanged', () => {
    const dv = document.getElementById('dv')!;
    const authored = document.createElement('div');
    authored.innerHTML = page();
    enhanceDataVisualizerElement(dv);
    expect(extractRecords(document.body)).toEqual(extractRecords(authored));
    expect(extractText(document.body)).toBe(extractText(authored));
  });
});

describe('the raw box vs sibling mirroring', () => {
  it('SELECT * still mirrors a parked sibling', () => {
    document.body.innerHTML = `
<sem-data-visualizer id="dv">
  <sem-data-source data-name="Tokens">${TOKENS}</sem-data-source>
  <sem-data-source data-name="All" data-format="sql">SELECT * FROM tokens</sem-data-source>
</sem-data-visualizer>`;
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const all = dv.querySelectorAll('sem-data-source')[1];
    const headers = Array.from(all.querySelectorAll('.sem-data-body thead th')).map(
      (t) => t.textContent!.trim(),
    );
    expect(headers).toEqual(['token', 'max', 'rotates']);
  });
});

describe('source vs join-minted bucket (the reverse guard)', () => {
  it('a late file source colliding with a join bucket alerts and leaves the join intact', async () => {
    document.body.innerHTML = `
<sem-data-visualizer id="dv">
  <sem-data-source data-name="Users">| id | who |
|----|-----|
| 1  | ada |</sem-data-source>
  <sem-data-source data-name="Orders">| id | total |
|----|------:|
| 1  | 5 |</sem-data-source>
  <sem-data-join data-name="users-orders" data-left="Users" data-right="Orders" data-on="id"></sem-data-join>
  <sem-data-source data-name="users-orders" data-format="csv" source="late.csv"></sem-data-source>
  <sem-data-query id="q1">SELECT who FROM users-orders</sem-data-query>
</sem-data-visualizer>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('who\neve\n', { status: 200 })),
    );
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    // The join minted first (inline sources render sync, the file source is
    // still pending), so the late source's finishSource hits the guard.
    await vi.waitFor(() => {
      const err = dv.querySelectorAll('sem-data-source')[2].querySelector('.sem-data-error');
      expect(err?.getAttribute('role')).toBe('alert');
      expect(err?.textContent).toMatch(/collides with join bucket "users-orders"/);
    });
    // the join keeps its bucket and its ok state
    expect(dv.querySelector('sem-data-join')!.getAttribute('data-sem-join-state')).toBe('ok');
    // the failed source never parked
    expect(dv.querySelectorAll('sem-data-source')[2].querySelector('.sem-data-raw')).toBeNull();
  });
});
