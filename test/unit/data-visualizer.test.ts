// @vitest-environment happy-dom
// Unit spec — sem-data-visualizer phase 1 (spec/data-visualizer.md)
//
// Feature: a sem-data-source whose body is an inline Markdown table
//   Scenario: schema inference types each column (string, number, integer,
//             boolean, date, null) and flags nullable
//   Scenario: an empty table (header + delimiter, no rows) infers null columns
//   Scenario: ragged rows — missing cells are null, extra cells dropped
//   Scenario: a non-table body errors clearly, no table rendered
//   Scenario: data-views / data-view parse and select the default view's columns
//   Scenario: the enhance renders a native table, schema JSON, and sort

import { describe, it, expect, beforeEach } from 'vitest';
import {
  dedent,
  parseGfmTable,
  inferSchema,
  parseViews,
  resolveView,
  visibleColumns,
} from '../../src/data/table.js';
import { DATA_SOURCE, enhanceDataVisualizerElement } from '../../src/reading/data.js';

const TABLE = `
  | Name    | Port | Count | Ready | Updated    | Note      |
  | :------ | ---: | :---- | :---- | :--------- | :-------- |
  | alpha   | 8080 | 3     | true  | 2026-01-05 | hello     |
  | beta    | 9090 | 12    | false | 2026-02-14 | 4.5       |
  | gamma   | 7    |       | true  |            | 2026-01-05|
`;

describe('parseGfmTable', () => {
  it('parses header, delimiter and body rows, dedenting the authored indent', () => {
    const r = parseGfmTable(TABLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['Name', 'Port', 'Count', 'Ready', 'Updated', 'Note']);
    expect(r.table.rows).toHaveLength(3);
    expect(r.table.rows[0]).toEqual(['alpha', '8080', '3', 'true', '2026-01-05', 'hello']);
  });

  it('errors clearly on a non-table body', () => {
    const r = parseGfmTable('just some prose\nwith two lines');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not a table/);
  });

  it('errors clearly on a missing delimiter row', () => {
    const r = parseGfmTable('| a | b |\n| 1 | 2 |');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/delimiter/);
  });

  it('errors clearly on a header/delimiter width mismatch', () => {
    const r = parseGfmTable('| a | b |\n| --- | --- | --- |');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/malformed table/);
  });

  it('errors clearly on an empty body', () => {
    const r = parseGfmTable('   \n  ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/empty/);
  });

  it('accepts an empty table (header + delimiter, no rows)', () => {
    const r = parseGfmTable('| a | b |\n| --- | --- |');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.rows).toEqual([]);
  });

  it('handles ragged rows: missing cells are empty, extra cells dropped', () => {
    const r = parseGfmTable('| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.rows[0]).toEqual(['1', '', '']);
    expect(r.table.rows[1]).toEqual(['1', '2', '3']);
  });

  it('synthesizes names for empty header cells', () => {
    const r = parseGfmTable('|  | b |\n| --- | --- |\n| 1 | 2 |');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['col-1', 'b']);
  });

  it('dedent strips only the common margin', () => {
    expect(dedent('  a\n    b\n')).toBe('a\n  b\n');
  });
});

describe('inferSchema', () => {
  const schemaFor = (src: string) => {
    const r = parseGfmTable(src);
    if (!r.ok) throw new Error(r.error);
    return inferSchema(r.table);
  };

  it('types every column of the sample table', () => {
    expect(schemaFor(TABLE)).toEqual([
      { name: 'Name', type: 'string', nullable: false },
      { name: 'Port', type: 'integer', nullable: false },
      { name: 'Count', type: 'integer', nullable: true },
      { name: 'Ready', type: 'boolean', nullable: false },
      { name: 'Updated', type: 'date', nullable: true },
      { name: 'Note', type: 'string', nullable: false },
    ]);
  });

  it('narrows a mixed integer/number column to number', () => {
    expect(schemaFor('| v |\n| --- |\n| 1 |\n| 2.5 |')[0].type).toBe('number');
  });

  it('widens any other mix to string', () => {
    expect(schemaFor('| v |\n| --- |\n| 1 |\n| true |')[0].type).toBe('string');
    expect(schemaFor('| v |\n| --- |\n| 2026-01-05 |\n| nope |')[0].type).toBe('string');
  });

  it('reads only literal true/false as boolean', () => {
    expect(schemaFor('| v |\n| --- |\n| yes |\n| no |')[0].type).toBe('string');
  });

  it('reads only ISO-8601 shaped values as date', () => {
    expect(schemaFor('| v |\n| --- |\n| 2026-01-05 |\n| 01/05/2026 |')[0].type).toBe('string');
    expect(schemaFor('| v |\n| --- |\n| 2026-01-05T10:30:00Z |')[0].type).toBe('date');
  });

  it('infers a null-only column and a zero-row table', () => {
    expect(schemaFor('| a | b |\n| --- | --- |\n|   | x |')).toEqual([
      { name: 'a', type: 'null', nullable: true },
      { name: 'b', type: 'string', nullable: false },
    ]);
    const empty = schemaFor('| a | b |\n| --- | --- |');
    expect(empty).toEqual([
      { name: 'a', type: 'null', nullable: true },
      { name: 'b', type: 'null', nullable: true },
    ]);
  });
});

describe('views (data-views / data-view)', () => {
  it('parses semicolon-separated name=columns specs', () => {
    expect(parseViews('core=token,max-uses; all=*')).toEqual([
      { name: 'core', columns: ['token', 'max-uses'] },
      { name: 'all', columns: '*' },
    ]);
  });

  it('skips malformed segments instead of failing', () => {
    expect(parseViews('broken; core=a')).toEqual([{ name: 'core', columns: ['a'] }]);
    expect(parseViews(null)).toEqual([]);
  });

  it('resolves data-view by name, else the first view, else everything', () => {
    const views = parseViews('core=a,b; all=*');
    expect(resolveView(views, 'all').name).toBe('all');
    expect(resolveView(views, null).name).toBe('core');
    expect(resolveView(views, 'nope').name).toBe('core');
    expect(resolveView([], null)).toEqual({ name: 'all', columns: '*' });
  });

  it('selects columns case-insensitively, unknown refs hide their column', () => {
    const shown = visibleColumns({ name: 'core', columns: ['name', 'port'] }, ['Name', 'Port', 'Note']);
    expect(shown).toEqual([true, true, false]);
  });
});

describe('enhanceDataVisualizerElement (phase 1 render)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s1" data-name="Sample" data-format="table"
          data-views="core=name,port; all=*" data-view="all">
${TABLE}
        </sem-data-source>
        <sem-data-source id="s2">prose, not a table</sem-data-source>
        <sem-data-source id="s3" data-format="csv">a,b</sem-data-source>
      </sem-data-visualizer>`;
  });

  it('renders a native table with thead/tbody and hidden columns per the default view', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const table = dv.querySelector('#s1 .sem-data-body > table')!;
    expect(table.tagName).toBe('TABLE');
    const heads = Array.from(table.querySelectorAll('thead th'));
    expect(heads.map((h) => h.textContent)).toEqual(['Name', 'Port', 'Count', 'Ready', 'Updated', 'Note']);
    expect(heads.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    expect(table.querySelector('caption')?.textContent).toBe('Sample');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    // data-view="all" shows everything
    expect(table.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('hides columns of the selected named view with native hidden', () => {
    const dv = document.getElementById('dv')!;
    dv.querySelector('#s1')!.setAttribute('data-view', 'core');
    enhanceDataVisualizerElement(dv);
    const hidden = Array.from(document.querySelectorAll('#s1 thead th[hidden]'));
    expect(hidden.map((h) => h.textContent)).toEqual(['Count', 'Ready', 'Updated', 'Note']);
  });

  it('exposes the inferred schema as application/json', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const json = JSON.parse(
      (dv.querySelector('#s1 .sem-data-schema') as HTMLScriptElement).textContent!,
    );
    expect(json.format).toBe('table');
    expect(json.view).toBe('all');
    expect(json.views).toEqual(['core', 'all']);
    expect(json.columns).toEqual([
      { name: 'Name', type: 'string', nullable: false },
      { name: 'Port', type: 'integer', nullable: false },
      { name: 'Count', type: 'integer', nullable: true },
      { name: 'Ready', type: 'boolean', nullable: false },
      { name: 'Updated', type: 'date', nullable: true },
      { name: 'Note', type: 'string', nullable: false },
    ]);
  });

  it('errors clearly on a non-table body, rendering no table', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    expect(dv.querySelector('#s2 .sem-data-error')?.textContent).toMatch(/not a table/);
    expect(dv.querySelector('#s2 table')).toBeNull();
    // phase 2: the csv payload s3 now renders (spec/data-visualizer.md §7.2)
    expect(dv.querySelector('#s3 table')).not.toBeNull();
  });

  it('sorts per column on header click and restores order on the third click', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    const table = dv.querySelector('#s1 table')!;
    const ports = () =>
      Array.from(table.querySelectorAll('tbody tr')).map(
        (r) => (r as HTMLTableRowElement).cells[1].textContent,
      );
    const head = table.querySelector('thead th:nth-child(2)')! as HTMLElement;
    const btn = head.querySelector('button.sem-data-sort')!;
    (btn as HTMLButtonElement).click();
    expect(head.getAttribute('aria-sort')).toBe('ascending');
    expect(ports()).toEqual(['7', '8080', '9090']);
    (btn as HTMLButtonElement).click();
    expect(head.getAttribute('aria-sort')).toBe('descending');
    expect(ports()).toEqual(['9090', '8080', '7']);
    (btn as HTMLButtonElement).click();
    expect(head.getAttribute('aria-sort')).toBe('none');
    expect(ports()).toEqual(['8080', '9090', '7']); // authored order restored
  });

  it('is idempotent: a second enhance does not duplicate the table', () => {
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    enhanceDataVisualizerElement(dv);
    // s1 (table) + s3 (csv, since phase 2) each render exactly one body
    expect(document.querySelectorAll('#dv .sem-data-body')).toHaveLength(2);
    // one error per failing source (s2 prose), none duplicated
    expect(document.querySelectorAll('#dv .sem-data-error')).toHaveLength(1);
  });

  it('renders nothing when the container has no source children', () => {
    document.body.innerHTML = '<sem-data-visualizer id="empty"></sem-data-visualizer>';
    enhanceDataVisualizerElement(document.getElementById('empty')!);
    expect(document.querySelectorAll('.sem-data-body, .sem-data-error')).toHaveLength(0);
  });

  it('finds sources through the shared selector shape', () => {
    expect(DATA_SOURCE).toContain('sem-data-source');
  });
});
