// @vitest-environment happy-dom
// Unit spec — declared structures, phase 3 (spec/data-visualizer.md §6)
//
// Feature: data-type="rows" with data-columns, and data-type="yaml-schema"
//   Scenario: parseColumnDecl reads name[:type][?]; malformed segments skip with a warning
//   Scenario: applyColumnDecl overrides inferred type/nullability; omissions stay inferred
//   Scenario: declared-cell validation is advisory (warn, never drop)
//   Scenario: yaml-schema flattens nested objects to dotted paths; arrays serialize as json cells
//   Scenario: required drives nullability; missing required warns; extra keys append inferred
//   Scenario: the enhance exposes the declared schema and type in the schema json

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseColumnDecl, applyColumnDecl, flattenYamlSchema } from '../../src/data/structure.js';
import { parseGfmTable, inferSchema } from '../../src/data/table.js';
import { parseYamlSubset } from '../../src/data/yaml.js';
import { enhanceDataVisualizerElement } from '../../src/reading/data.js';

describe('parseColumnDecl', () => {
  it('reads name[:type][?] segments', () => {
    expect(parseColumnDecl('name:string, port:integer, ready:boolean?')).toEqual({
      cols: [
        { name: 'name', type: 'string', nullable: undefined },
        { name: 'port', type: 'integer', nullable: undefined },
        { name: 'ready', type: 'boolean', nullable: true },
      ],
      warnings: [],
    });
    expect(parseColumnDecl('just-a-name').cols).toEqual([{ name: 'just-a-name', type: undefined, nullable: undefined }]);
    expect(parseColumnDecl(null).cols).toEqual([]);
  });

  it('skips malformed segments with a warning', () => {
    const r = parseColumnDecl(':integer, good:string');
    expect(r.cols).toEqual([{ name: 'good', type: 'string', nullable: undefined }]);
    expect(r.warnings).toHaveLength(1);
    const u = parseColumnDecl('odd:wibble');
    expect(u.cols[0].type).toBeUndefined();
    expect(u.warnings[0]).toMatch(/unknown type/);
  });
});

describe('applyColumnDecl', () => {
  const table = (parseGfmTable('| Name | Port |\n| --- | --- |\n| alpha | 8080 |\n| beta | oops |') as { ok: true; table: never })['table'];
  const base = inferSchema(table);

  it('overrides type and nullability per declared column; omissions stay inferred', () => {
    const decl = parseColumnDecl('port:integer, name:string?');
    const r = applyColumnDecl(table, decl.cols, base.map((c) => ({ ...c })));
    expect(r.schema).toEqual([
      { name: 'Name', type: 'string', nullable: true },
      { name: 'Port', type: 'integer', nullable: false },
    ]);
    expect(r.warnings).toContain('column "Port": cell "oops" does not match its declared type integer (rendered as-is)');
  });

  it('warns on declarations naming absent columns', () => {
    const decl = parseColumnDecl('ghost:string');
    const r = applyColumnDecl(table, decl.cols, base.map((c) => ({ ...c })));
    expect(r.warnings[0]).toMatch(/no such column/);
  });
});

describe('flattenYamlSchema', () => {
  const ENVELOPE = `
schema:
  type: object
  properties:
    name:
      type: string
    port:
      type: integer
    address:
      type: object
      properties:
        city:
          type: string
    tags:
      type: array
      items:
        type: string
  required:
    - name
data:
  - name: alpha
    port: 8080
    address:
      city: Springfield
    tags:
      - core
      - edge
  - name: beta
    port: not-a-number
`;
  const flat = () => flattenYamlSchema(parseYamlSubset(ENVELOPE).ok ? (parseYamlSubset(ENVELOPE) as { ok: true; value: never })['value'] : null);

  it('flattens nested objects to dotted columns; arrays serialize as json cells', () => {
    const r = flat();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.columns).toEqual(['name', 'port', 'address.city', 'tags']);
    expect(r.table.rows[0]).toEqual(['alpha', '8080', 'Springfield', '["core","edge"]']);
    expect(r.table.rows[1]).toEqual(['beta', 'not-a-number', '', '']);
  });

  it('required drives nullability; mismatches and missing required warn; extra keys append inferred', () => {
    const r = flat();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema).toEqual([
      { name: 'name', type: 'string', nullable: false },
      { name: 'port', type: 'integer', nullable: false },
      { name: 'address.city', type: 'string', nullable: true },
      { name: 'tags', type: 'string', nullable: true },
    ]);
    expect(r.warnings.some((w) => w.includes('port') && w.includes('integer'))).toBe(true);
    // required=[name] is satisfied, so no required-missing warnings here
    expect(r.warnings.some((w) => w.includes('required property'))).toBe(false);
  });

  it('warns when a required property is missing from a record, or from the declaration', () => {
    const miss = parseYamlSubset(`
schema:
  type: object
  properties:
    name:
      type: string
  required:
    - name
    - ghost
data:
  - name: alpha
  - port: 1
`);
    expect(miss.ok).toBe(true);
    if (!miss.ok) return;
    const r = flattenYamlSchema(miss.value);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.includes('"ghost"') && w.includes('not declared'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('required property "name" is missing'))).toBe(true);
  });

  it('accepts the type: array + items: envelope', () => {
    const v2 = parseYamlSubset(`
schema:
  type: array
  items:
    type: object
    properties:
      id:
        type: integer
data:
  - id: 1
`);
    if (!v2.ok) throw new Error(v2.error);
    const r = flattenYamlSchema(v2.value);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema[0]).toEqual({ name: 'id', type: 'integer', nullable: false });
  });

  it('errors clearly on non-envelopes and non-mapping records', () => {
    expect(flattenYamlSchema('scalar').error ?? '').toMatch(/mapping with schema/);
    const v = parseYamlSubset('schema:\n  properties:\n    a:\n      type: string\ndata:\n  - ok\n');
    if (!v.ok) throw new Error(v.error);
    expect(flattenYamlSchema(v.value).error ?? '').toMatch(/must be a mapping/);
    const e = parseYamlSubset('schema:\n  type: object\n');
    if (!e.ok) throw new Error(e.error);
    expect(flattenYamlSchema(e.value).error ?? '').toMatch(/no data/);
  });
});

describe('enhanceDataVisualizerElement (phase 3 declarations)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s-rows" data-name="Rows" data-type="rows"
          data-columns="name:string, port:integer, ready:boolean?">
          | name | port | ready |
          | :--- | ---: | :---- |
          | alpha | 8080 | true |
          | beta | oops | |
        </sem-data-source>
        <sem-data-source id="s-yaml" data-name="Nested" data-format="yaml" data-type="yaml-schema">
schema:
  type: object
  properties:
    name:
      type: string
    address:
      type: object
      properties:
        city:
          type: string
data:
  - name: alpha
    address:
      city: Springfield
        </sem-data-source>
        <sem-data-source id="s-bad" data-name="Bad" data-format="csv" data-type="yaml-schema">a,b</sem-data-source>
      </sem-data-visualizer>`;
  });

  it('applies declared types and exposes them in the schema json with the declared structure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    const json = JSON.parse((document.querySelector('#s-rows .sem-data-schema') as HTMLScriptElement).textContent!);
    expect(json.type).toBe('rows');
    expect(json.columns).toEqual([
      { name: 'name', type: 'string', nullable: false },
      { name: 'port', type: 'integer', nullable: false },
      { name: 'ready', type: 'boolean', nullable: true },
    ]);
    expect(json.columns[1].type).toBe('integer'); // override of the inferred string ("oops")
    expect(warn.mock.calls.some((c) => String(c[0]).includes('does not match its declared type'))).toBe(true);
    warn.mockRestore();
  });

  it('renders yaml-schema payloads with dotted columns and the declared structure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    const heads = Array.from(document.querySelectorAll('#s-yaml thead th'), (th) => th.textContent);
    expect(heads).toEqual(['name', 'address.city']);
    const json = JSON.parse((document.querySelector('#s-yaml .sem-data-schema') as HTMLScriptElement).textContent!);
    expect(json.type).toBe('yaml-schema');
    expect(json.columns[1]).toEqual({ name: 'address.city', type: 'string', nullable: false }); // one record, no null cells
    warn.mockRestore();
  });

  it('errors when yaml-schema is declared on a non-yaml payload', () => {
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    expect(document.querySelector('#s-bad .sem-data-error')?.textContent).toMatch(/needs a yaml payload/);
  });
});
