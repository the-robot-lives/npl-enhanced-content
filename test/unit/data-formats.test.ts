// @vitest-environment happy-dom
// Unit spec — sem-data-source payload formats, phase 2 (spec/data-visualizer.md §7)
//
// Feature: inline csv, yaml, json and sql payloads beyond the phase-1 table
//   Scenario: csv parses RFC 4180 (quotes, escapes, embedded commas/newlines, CRLF)
//   Scenario: csv data-header="false" synthesizes col-n names
//   Scenario: yaml subset parses block mappings/sequences, comments, quoting, typing
//   Scenario: yaml subset rejects out-of-scope constructs by name
//   Scenario: a yaml payload is rows; non-sequences error with the yaml-schema hint
//   Scenario: json arrays-of-objects and objects-of-arrays become tables; data-path extracts
//   Scenario: sql declarations expose the projection as a zero-row shape
//   Scenario: sql SELECT * mirrors the FROM bucket's columns, errors without one
//   Scenario: the enhance renders every format and errors clearly on unknown formats

import { describe, it, expect, beforeEach } from 'vitest';
import { parseCsv } from '../../src/data/csv.js';
import { parseYamlSubset, yamlToTable } from '../../src/data/yaml.js';
import { extractPath, jsonToTable } from '../../src/data/json.js';
import { parseSelectShape, tokenize } from '../../src/data/sql.js';
import { enhanceDataVisualizerElement } from '../../src/reading/data.js';

describe('parseCsv', () => {
  it('parses quoted fields, "" escapes, embedded commas and newlines', () => {
    const r = parseCsv('name,note\nalpha,"has, comma"\nbeta,"has ""quotes"" and\nnewline"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['name', 'note']);
    expect(r.table.rows).toEqual([
      ['alpha', 'has, comma'],
      ['beta', 'has "quotes" and\nnewline'],
    ]);
  });

  it('tolerates CRLF and drops the trailing empty record', () => {
    const r = parseCsv('a,b\r\n1,2\r\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.rows).toEqual([['1', '2']]);
  });

  it('parses an HTML-indented body like the table format does', () => {
    const r = parseCsv('\n    a,b\n    1,2\n    3,4\n  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['a', 'b']);
    expect(r.table.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('synthesizes col-n headers when data-header="false"', () => {
    const r = parseCsv('1,2\n3,4', false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['col-1', 'col-2']);
    expect(r.table.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('pads ragged rows and errors on an empty payload', () => {
    const r = parseCsv('a,b,c\n1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.rows[0]).toEqual(['1', '', '']);
    expect(parseCsv('  \n ').ok).toBe(false);
  });
});

describe('parseYamlSubset', () => {
  it('parses block mappings, sequences, comments, quoting and scalar typing', () => {
    const r = parseYamlSubset(`
# service inventory
name: alpha          # trailing comment
port: 8080
ready: true
ratio: 0.5
missing: ~
label: 'it''s #quoted'
text: "line\\nbreak"
tags:
  - core
  - edge
address:
  city: Springfield
flow: [a, b]
`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: 'alpha',
      port: 8080,
      ready: true,
      ratio: 0.5,
      missing: null,
      label: "it's #quoted",
      text: 'line\nbreak',
      tags: ['core', 'edge'],
      address: { city: 'Springfield' },
      flow: ['a', 'b'],
    });
  });

  it('parses a sequence of compact mappings (rows)', () => {
    const r = parseYamlSubset(`
- name: alpha
  port: 8080
- name: beta
  port: 9090
`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      { name: 'alpha', port: 8080 },
      { name: 'beta', port: 9090 },
    ]);
  });

  it('rejects out-of-scope constructs by name', () => {
    expect(parseYamlSubset('a: {k: v}').error ?? '').toMatch(/flow mappings/);
    expect(parseYamlSubset('a: &anchor 1').error ?? '').toMatch(/anchors/);
    expect(parseYamlSubset('a: |\n  block').error ?? '').toMatch(/block scalars/);
    expect(parseYamlSubset('---\na: 1').error ?? '').toMatch(/multi-document/);
    expect(parseYamlSubset('a:\n\t- tabbed').error ?? '').toMatch(/tab indentation/);
    expect(parseYamlSubset('').error ?? '').toMatch(/empty/);
  });

  it('yamlToTable: a sequence of mappings is rows; nested values become json cells', () => {
    const y = parseYamlSubset('- name: a\n  tags:\n    - x\n- name: b\n  tags:\n    - y');
    expect(y.ok).toBe(true);
    if (!y.ok) return;
    const t = yamlToTable(y.value);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.table.columns).toEqual(['name', 'tags']);
    expect(t.table.rows).toEqual([['a', '["x"]'], ['b', '["y"]']]);
  });

  it('yamlToTable: non-sequences error with the yaml-schema hint', () => {
    const y = parseYamlSubset('name: a');
    expect(y.ok).toBe(true);
    if (!y.ok) return;
    expect(yamlToTable(y.value).error ?? '').toMatch(/yaml-schema/);
    expect(yamlToTable([]).error ?? '').toMatch(/empty/);
    expect(yamlToTable(['scalar']).error ?? '').toMatch(/mappings/);
  });
});

describe('jsonToTable / extractPath', () => {
  it('shapes an array of objects (column union first-seen)', () => {
    const a = jsonToTable([{ b: 1, a: 'x' }, { a: 'y', c: null }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.table.columns).toEqual(['b', 'a', 'c']);
    expect(a.table.rows).toEqual([['1', 'x', ''], ['', 'y', '']]);
  });

  it('object of arrays becomes columns', () => {
    const r = jsonToTable({ name: ['a', 'b'], port: [80, 443] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['name', 'port']);
    expect(r.table.rows).toEqual([['a', '80'], ['b', '443']]);
  });

  it('errors clearly on scalar arrays, empties and non-containers', () => {
    expect(jsonToTable([1, 2]).error ?? '').toMatch(/array of objects/);
    expect(jsonToTable([]).error ?? '').toMatch(/empty/);
    expect(jsonToTable({ a: 'not-an-array' }).error ?? '').toMatch(/data-path/);
    expect(jsonToTable('nope').error ?? '').toMatch(/array of objects or an object of arrays/);
  });

  it('extractPath walks dot segments and [n] indexes', () => {
    const doc = { data: { items: [{ name: 'a' }, { name: 'b' }] } };
    expect(extractPath(doc, 'data.items')).toEqual(doc.data.items);
    expect(extractPath(doc, 'data.items[1].name')).toBe('b');
    expect(extractPath(doc, 'data.items[9]')).toBeUndefined();
    expect(extractPath(doc, 'nope.here')).toBeUndefined();
    expect(extractPath(doc, null)).toBe(doc);
  });
});

describe('parseSelectShape (sql declarations)', () => {
  it('takes the projection as the result shape', () => {
    expect(parseSelectShape('SELECT name, port FROM services')).toEqual({
      ok: true,
      shape: { projection: ['name', 'port'], from: 'services' },
    });
    expect(parseSelectShape('select 1 from t').ok).toBe(false);
  });

  it('tokenizes strings, dotted idents and numbers', () => {
    expect(tokenize("SELECT a.b FROM t")).toEqual({
      ok: true,
      tokens: [
        { kind: 'ident', text: 'SELECT' },
        { kind: 'ident', text: 'a.b' },
        { kind: 'ident', text: 'FROM' },
        { kind: 'ident', text: 't' },
      ],
    });
  });

  it('refuses mutating statements, multi-statements and garbage', () => {
    expect(parseSelectShape('DELETE FROM t').error ?? '').toMatch(/read-only/);
    expect(parseSelectShape('SELECT a FROM t; DROP TABLE t').error ?? '').toMatch(/one statement/);
    expect(parseSelectShape('SELECT a WHERE x').error ?? '').toMatch(/FROM/);
    expect(parseSelectShape('SELECT a FROM t FROB').error ?? '').toMatch(/WHERE, ORDER BY and LIMIT/);
    expect(parseSelectShape('').error ?? '').toMatch(/empty/);
    expect(parseSelectShape("SELECT 'unterminated FROM t").error ?? '').toMatch(/unterminated/);
  });
});

describe('enhanceDataVisualizerElement (phase 2 formats)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s-csv" data-name="CSV" data-format="csv">name,port
alpha,8080
beta,9090</sem-data-source>
        <sem-data-source id="s-yaml" data-name="YAML" data-format="yaml">- name: gamma
  port: 7
- name: delta
  port: 443</sem-data-source>
        <sem-data-source id="s-json" data-name="JSON" data-format="json">[{"n":"eps","p":1},{"n":"zeta","p":2}]</sem-data-source>
        <sem-data-source id="s-sql" data-name="Shape" data-format="sql">SELECT name, port FROM CSV</sem-data-source>
        <sem-data-source id="s-star" data-name="Star" data-format="sql">SELECT * FROM csv</sem-data-source>
        <sem-data-source id="s-bad" data-name="Bad" data-format="tsv">a\tb</sem-data-source>
      </sem-data-visualizer>`;
  });

  const rowsOf = (id: string) =>
    Array.from(document.querySelectorAll(`#${id} tbody tr`)).map(
      (tr) => Array.from((tr as HTMLTableRowElement).cells, (td) => td.textContent),
    );

  it('renders csv, yaml and json payloads as native tables', () => {
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    expect(rowsOf('s-csv')).toEqual([['alpha', '8080'], ['beta', '9090']]);
    expect(rowsOf('s-yaml')).toEqual([['gamma', '7'], ['delta', '443']]);
    expect(rowsOf('s-json')).toEqual([['eps', '1'], ['zeta', '2']]);
  });

  it('renders sql declarations as zero-row shapes; * mirrors the FROM bucket', () => {
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    const heads = (id: string) =>
      Array.from(document.querySelectorAll(`#${id} thead th`), (th) => th.textContent);
    expect(heads('s-sql')).toEqual(['name', 'port']);
    expect(rowsOf('s-sql')).toEqual([]);
    expect(heads('s-star')).toEqual(['name', 'port']); // resolved from the csv sibling, case-insensitive
    expect(rowsOf('s-star')).toEqual([]);
  });

  it('errors clearly on unknown formats and unresolvable SELECT *', () => {
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    expect(document.querySelector('#s-bad .sem-data-error')?.textContent).toMatch(/unknown data-format/);
    expect(document.querySelector('#s-bad table')).toBeNull();
  });
});
