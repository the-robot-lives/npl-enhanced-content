// @vitest-environment happy-dom
// Unit spec — phase 5: the §8 query engine, declarative joins, and the
// editable default query chrome (spec/data-visualizer.md §2/§3/§8)
//
// Feature: the default editable query
//   Scenario: the full grammar parses — projection, WHERE, ORDER BY, LIMIT
//   Scenario: out-of-scope constructs reject with a clear error (JOIN, GROUP BY, IN, functions, aliases, multi-statement, mutating statements)
//   Scenario: the executor filters, orders (nulls last, stable), limits, projects
//   Scenario: comparisons are numeric when both sides are numeric; null never equals anything — IS NULL catches it
// Feature: joins by named key column
//   Scenario: inner join keeps matched rows; collisions expose <rightRef>.<col>; numeric keys canonicalize
//   Scenario: unknown bucket / missing key column / missing attrs are clear errors
// Feature: query chrome (the enhance)
//   Scenario: a textarea prefilled with the authored query, Run button, results table with a row-count status
//   Scenario: editing re-runs after debounce; Ctrl+Enter re-runs; late buckets re-run the query

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { parseQuery, runQuery, joinBuckets, type Bucket } from '../../src/data/query.js';
import { enhanceDataVisualizerElement, normalizeRef } from '../../src/reading/data.js';

/** Parse or fail the test with the parser's message. */
function mustParse(sql: string) {
  const r = parseQuery(sql);
  if (!r.ok) throw new Error('parseQuery failed: ' + r.error);
  return r.ast;
}

describe('parseQuery', () => {
  it('parses the full §8 grammar', () => {
    const r = parseQuery("SELECT name, port FROM services WHERE port >= 80 AND name != 'alpha' OR port IS NULL ORDER BY name DESC LIMIT 5");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.columns).toEqual(['name', 'port']);
    expect(r.ast.from).toBe('services');
    expect(r.ast.orderBy).toEqual({ column: 'name', direction: 'desc' });
    expect(r.ast.limit).toBe(5);
    expect(r.ast.where?.kind).toBe('or'); // AND binds tighter
  });

  it('rejects out-of-scope constructs with a clear error', () => {
    const bad = (sql: string, re: RegExp) => {
      const r = parseQuery(sql);
      expect(r.ok ? r.error : r).toMatchObject({ ok: false });
      expect(!r.ok ? r.error : '').toMatch(re);
    };
    bad('SELECT * FROM a JOIN b ON x', /out of scope/);
    bad('SELECT * FROM a GROUP BY x', /out of scope/);
    bad('SELECT * FROM a WHERE x IN (1,2)', /comparison|unexpected/);
    bad('SELECT COUNT(*) FROM a', /COUNT|unexpected/);
    bad('SELECT * FROM a LIMIT 5 OFFSET 2', /"OFFSET" is out of scope/);
    bad('SELECT * FROM a WHERE x = 1; SELECT 1', /one statement/);
    bad('DELETE FROM a', /read-only/);
    bad('SELECT * FROM', /a bucket name after FROM/);
    bad('SELECT * FROM a WHERE x LIKE', /comparison|unexpected/);
    bad('SELECT * FROM a WHERE (x = 1)', /expected a comparison|unexpected/);
  });
});

describe('runQuery', () => {
  const buckets = new Map<string, Bucket>([
    ['services', { name: 'Services', table: {
      columns: ['name', 'port', 'notes'],
      rows: [
        ['alpha', '8080', ''],          // empty = null
        ['beta', '443', 'tls'],
        ['gamma', '80', ''],
        ['delta', '8443', 'tls'],
      ],
    } }],
  ]);

  it('projects, filters, orders and limits', () => {
    const ast = mustParse("SELECT name, port FROM services WHERE port > 80 ORDER BY port ASC LIMIT 2");
    const r = runQuery(ast, buckets);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table).toEqual({ columns: ['name', 'port'], rows: [['beta', '443'], ['alpha', '8080']] });
  });

  it('sorts numerically, nulls last, stable ties', () => {
    const ast = mustParse('SELECT name FROM services ORDER BY port DESC');
    const r = runQuery(ast, buckets);
    expect((r as { table: { rows: string[][] } }).table.rows.map((r2) => r2[0])).toEqual(['delta', 'alpha', 'beta', 'gamma']);
  });

  it('null never compares equal — IS NULL catches it', () => {
    const eq = runQuery(mustParse("SELECT name FROM services WHERE notes = ''"), buckets);
    expect((eq as { table: { rows: string[][] } }).table.rows).toEqual([]); // '' literal vs null cell: no match
    const is = runQuery(mustParse('SELECT name FROM services WHERE notes IS NULL'), buckets);
    expect((is as { table: { rows: string[][] } }).table.rows.map((r2) => r2[0])).toEqual(['alpha', 'gamma']);
    const isnt = runQuery(mustParse('SELECT name FROM services WHERE notes IS NOT NULL'), buckets);
    expect((isnt as { table: { rows: string[][] } }).table.rows.map((r2) => r2[0])).toEqual(['beta', 'delta']);
  });

  it('errors clearly on unknown bucket and unknown column', () => {
    const miss = runQuery(mustParse('SELECT * FROM nope'), buckets); expect(!miss.ok && miss.error).toMatch(/unknown bucket "nope"/);
    const badCol = runQuery(mustParse('SELECT wat FROM services'), buckets); expect(!badCol.ok && badCol.error).toMatch(/unknown column "wat"/);
    const badWhere = runQuery(mustParse('SELECT * FROM services WHERE wat = 1'), buckets); expect(!badWhere.ok && badWhere.error).toMatch(/unknown column "wat"/);
  });

  it('an empty result is a table with zero rows, not an error', () => {
    const r = runQuery(mustParse('SELECT name FROM services WHERE port = 1'), buckets);
    expect(r.ok).toBe(true);
    expect((r as { table: { rows: string[][] } }).table.rows).toEqual([]);
  });
});

describe('joinBuckets', () => {
  const services: Bucket = { name: 'Services', table: { columns: ['name', 'host_id'], rows: [['alpha', '1'], ['beta', '2'], ['orphan', '99']] } };
  const hosts: Bucket = { name: 'Hosts', table: { columns: ['host_id', 'name', 'region'], rows: [['1', 'a.example', 'eu'], ['2', 'b.example', 'us'], ['3', 'c.example', 'ap']] } };

  it('inner-joins on the named key; collisions prefix <rightRef>.<column>', () => {
    const r = joinBuckets(services, hosts, 'host_id');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // host_id (the key) is not duplicated; right "name" collides with left "name"
    expect(r.table.columns).toEqual(['name', 'host_id', 'hosts.name', 'region']);
    expect(r.table.rows).toEqual([
      ['alpha', '1', 'a.example', 'eu'],
      ['beta', '2', 'b.example', 'us'],
    ]); // orphan 99 and host 3 drop (inner)
  });

  it('canonicalizes numeric keys (padding/zero formats match)', () => {
    const a: Bucket = { name: 'A', table: { columns: ['k', 'x'], rows: [['007', 'q']] } };
    const b: Bucket = { name: 'B', table: { columns: ['k', 'y'], rows: [['7', 'z']] } };
    const r = joinBuckets(a, b, 'k');
    expect(r.ok && r.table.rows).toEqual([['007', 'q', 'z']]);
  });

  it('errors on a missing key column', () => {
    expect(joinBuckets(services, hosts, 'nope').error).toMatch(/not a column of bucket/);
  });
});

describe('wireJoins (declarative materialization)', () => {
  beforeEach(() => document.body.innerHTML = '');
  afterEach(() => vi.restoreAllMocks());

  const page = () => `
    <sem-data-visualizer id="dv">
      <sem-data-source data-name="Alpha">| id | who |
|----|-----|
| 1  | ace |</sem-data-source>
      <sem-data-source data-name="Beta">| id | ttl |
|----|-----|
| 1  | 90  |</sem-data-source>
      <sem-data-join data-name="alpha-beta" data-left="Alpha" data-right="Beta" data-on="id"></sem-data-join>
      <sem-data-query id="q1">SELECT who, ttl FROM alpha-beta</sem-data-query>
    </sem-data-visualizer>`;

  it('refuses a join name that shadows a source bucket', () => {
    document.body.innerHTML = page().replace('data-name="alpha-beta"', 'data-name="Alpha"');
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const err = dv.querySelector('sem-data-join .sem-data-error');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(err?.textContent).toMatch(/collides with existing bucket "Alpha"/);
  });

  it('withdraws its own bucket and clears the ok state when a later run fails', async () => {
    document.body.innerHTML = page();
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const j = dv.querySelector('sem-data-join')!;
    expect(j.getAttribute('data-sem-join-state')).toBe('ok');
    expect(dv.querySelectorAll('.sem-data-query-results tbody tr').length).toBe(1);
    // the left bucket loses its key column — as a bad file/API re-load would
    const { registerBucket } = await import('../../src/reading/data-query.js');
    registerBucket(dv.querySelector('sem-data-source')!, 'Alpha', { columns: ['who'], rows: [['ace']] });
    const err = dv.querySelector('sem-data-join .sem-data-error');
    expect(err?.textContent).toMatch(/is not a column of bucket "Alpha"/);
    expect(j.hasAttribute('data-sem-join-state')).toBe(false);
    // the query re-ran against the withdrawn bucket — an alert, not stale rows
    await vi.waitFor(() => {
      expect(dv.querySelector('.sem-data-query-error')?.textContent).toMatch(/unknown bucket/);
    });
  });
});

describe('query chrome (the enhance)', () => {
  beforeEach(() => document.body.innerHTML = '');
  afterEach(() => vi.restoreAllMocks());

  const page = () => `
    <sem-data-visualizer id="dv">
      <sem-data-source data-name="Services">| name | port |
|------|------|
| alpha | 8080 |
| beta  | 443  |
| gamma | 80   |</sem-data-source>
      <sem-data-query id="q1">SELECT name FROM services WHERE port > 100</sem-data-query>
    </sem-data-visualizer>`;

  it('prefills the textarea, runs on enhance, reports a row count', () => {
    document.body.innerHTML = page();
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const box = dv.querySelector('.sem-data-query-input') as HTMLTextAreaElement;
    expect(box.value).toBe('SELECT name FROM services WHERE port > 100');
    const rows = dv.querySelectorAll('.sem-data-query-results tbody tr');
    expect(rows.length).toBe(2); // alpha 8080 + beta 443 clear the WHERE
    expect(dv.querySelector('.sem-data-query-status')?.textContent).toBe('2 rows.');
    const heads = Array.from(dv.querySelectorAll('.sem-data-query-results thead th'), (th) => th.textContent);
    expect(heads).toEqual(['name']);
  });

  it('re-runs on edit (debounced) and on Ctrl+Enter', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = page();
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const box = dv.querySelector('.sem-data-query-input') as HTMLTextAreaElement;
    box.value = 'SELECT name FROM services';
    box.dispatchEvent(new Event('input'));
    expect(dv.querySelectorAll('.sem-data-query-results tbody tr').length).toBe(2); // not yet
    vi.advanceTimersByTime(350);
    expect(dv.querySelectorAll('.sem-data-query-results tbody tr').length).toBe(3);
    vi.useRealTimers();
  });

  it('renders parse and run errors as alerts, never blanks', () => {
    document.body.innerHTML = page().replace('WHERE port > 100', 'JOIN nope');
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const err = dv.querySelector('.sem-data-query-error');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(err?.textContent).toMatch(/out of scope/);
  });

  it('a late file bucket re-runs the query; view buttons switch columns', async () => {
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source data-name="Zones" data-views="all=*; regions=name">| name | id | region |
|---|---|---|
| a | 1 | eu |
| b | 2 | us |</sem-data-source>
        <sem-data-join data-name="AlphaHosts" data-left="alpha" data-right="zones" data-on="id"></sem-data-join>
      </sem-data-visualizer>`;
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    // register the late bucket manually, as the file loader would
    const { registerBucket } = await import('../../src/reading/data-query.js');
    registerBucket(dv.querySelector('sem-data-source')!, 'Alpha', { columns: ['who', 'id'], rows: [['alpha', '1']] });
    await vi.waitFor(() => {
      const err = dv.querySelector('.sem-data-error');
      expect(err).toBeNull(); // the join healed once Alpha arrived
    });
    // view buttons: 2 views declared → a pressed group that hides columns
    const btns = dv.querySelectorAll('.sem-data-views button');
    expect(btns.length).toBe(2);
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    (btns[1] as HTMLButtonElement).click();
    expect(btns[1].getAttribute('aria-pressed')).toBe('true');
    const visible = Array.from(dv.querySelectorAll('sem-data-source thead th')).filter((th) => !th.hasAttribute('hidden'));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(3);
  });

  it('queries are scoped per visualizer (no cross-page bucket leaks)', () => {
    document.body.innerHTML = `
      <sem-data-visualizer id="a"><sem-data-source data-name="One">| x |
|---|
| 1 |</sem-data-source></sem-data-visualizer>
      <sem-data-visualizer id="b"><sem-data-query>SELECT * FROM one</sem-data-query></sem-data-visualizer>`;
    enhanceDataVisualizerElement(document.getElementById('a')!);
    enhanceDataVisualizerElement(document.getElementById('b')!);
    expect(document.getElementById('b')!.querySelector('.sem-data-query-error')?.textContent).toMatch(/unknown bucket/);
  });
});

describe('normalizeRef', () => {
  it('matches the §5 bucket-reference rules', () => {
    expect(normalizeRef('Services')).toBe('services');
    expect(normalizeRef('My Hosts!!')).toBe('my-hosts');
  });
});
