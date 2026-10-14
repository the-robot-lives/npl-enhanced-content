/**
 * data/structure — declared structures for sem-data-source (phase 3).
 *
 * Spec: spec/data-visualizer.md §6. Two declarations:
 *
 *   data-type="rows"        + data-columns="name:string, port:integer, ready:boolean?"
 *   data-type="yaml-schema" + an OpenAPI-style YAML envelope (schema:/data:)
 *
 * Declared types OVERRIDE inference per column; inference still fills any
 * column the declaration omits. Validation is advisory: a cell that violates
 * its declared type produces a warning, never a dropped row. Pure, no DOM.
 */

import { inferSchema, type ColumnSchema, type ColumnType, type TableData } from './table.js';
import { cell, type YamlValue } from './yaml.js';

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'null']);

export interface ColDecl {
  name: string;
  type?: ColumnType;
  nullable?: boolean;
}

/**
 * Parse `name, port:integer, ready:boolean?` — comma-separated
 * `name[:type][?]`. Malformed segments are returned in `warnings` and
 * skipped: a typo hides a declaration, it never breaks the document.
 */
export function parseColumnDecl(decl: string | null): { cols: ColDecl[]; warnings: string[] } {
  const cols: ColDecl[] = [];
  const warnings: string[] = [];
  if (!decl) return { cols, warnings };
  for (const part of decl.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const nullable = seg.endsWith('?');
    const body = nullable ? seg.slice(0, -1).trim() : seg;
    const colon = body.indexOf(':');
    const name = (colon < 0 ? body : body.slice(0, colon)).trim();
    const typeName = colon < 0 ? null : body.slice(colon + 1).trim();
    if (!name) { warnings.push('data-columns: unnamed column declaration "' + seg + '" ignored'); continue; }
    if (typeName !== null && !TYPES.has(typeName)) {
      warnings.push('data-columns: unknown type "' + typeName + '" for column "' + name + '" ignored');
      cols.push({ name, nullable: nullable || undefined });
      continue;
    }
    cols.push({ name, type: (typeName as ColumnType) || undefined, nullable: nullable || undefined });
  }
  return { cols, warnings };
}

/**
 * Overlay declared columns onto the inferred schema. Declared types and
 * nullability win; omitted columns keep their inference; a declaration
 * naming a column the payload does not have warns. Also validates every
 * declared column's non-empty cells against the declared type (advisory).
 */
export function applyColumnDecl(
  table: TableData,
  decls: ColDecl[],
  schema: ColumnSchema[],
): { schema: ColumnSchema[]; warnings: string[] } {
  const warnings: string[] = [];
  const byName = new Map(schema.map((c) => [c.name.trim().toLowerCase(), c]));
  const declared = new Set<string>();
  for (const d of decls) {
    const col = byName.get(d.name.trim().toLowerCase());
    if (!col) { warnings.push('data-columns: "' + d.name + '" is declared but the payload has no such column'); continue; }
    declared.add(col.name);
    if (d.type) col.type = d.type;
    if (d.nullable !== undefined) col.nullable = d.nullable;
    // advisory cell validation for this declared column
    const k = schema.indexOf(col);
    const typeCheck: Record<string, (v: string) => boolean> = {
      integer: (v) => /^[+-]?\d+$/.test(v),
      number: (v) => isFinite(+v),
      boolean: (v) => v === 'true' || v === 'false',
      date: (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}/.test(v),
      null: (v) => false,
    };
    if (d.type && typeCheck[d.type]) {
      for (const row of table.rows) {
        const v = (row[k] ?? '').trim();
        if (v !== '' && !typeCheck[d.type](v)) {
          warnings.push('column "' + col.name + '": cell "' + v + '" does not match its declared type ' + d.type + ' (rendered as-is)');
        }
      }
    }
  }
  return { schema, warnings };
}

/* ------------------------------------------------------------------ *
 * data-type="yaml-schema" — the OpenAPI-style envelope (§6.2)
 * ------------------------------------------------------------------ */

interface PropSpec { type?: string; properties?: Record<string, PropSpec>; items?: PropSpec; format?: string }

/**
 * Flatten a `schema:`/`data:` envelope to rows. Nested object properties
 * flatten to dotted column paths; array properties serialize as JSON cells;
 * `required` drives nullability; columns in the data but not in the
 * declaration append, inferred. Cell/declared-type mismatches warn.
 */
export function flattenYamlSchema(value: YamlValue):
  | { ok: true; table: TableData; schema: ColumnSchema[]; warnings: string[] }
  | { ok: false; error: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'a yaml-schema payload must be a mapping with schema: and data: keys' };
  }
  const doc = value as { schema?: PropSpec & { required?: YamlValue }; data?: YamlValue };
  const root = doc.schema ?? {};
  const shape = root.type === 'array' ? root.items ?? {} : root;
  const props = shape.properties ?? {};
  const required = new Set(
    Array.isArray(root.required) ? (root.required as string[]) : typeof root.required === 'string' ? [root.required] : [],
  );
  const warnings: string[] = [];
  for (const name of required) {
    if (!(name in props)) warnings.push('yaml-schema: required property "' + name + '" is not declared in properties');
  }

  // Column plan: dotted paths from the declaration, depth-first.
  const plan: { path: string; spec: PropSpec; req: boolean }[] = [];
  const walk = (prefix: string, properties: Record<string, PropSpec>, parentRequired: boolean) => {
    for (const [name, spec] of Object.entries(properties)) {
      const path = prefix ? prefix + '.' + name : name;
      const req = parentRequired && required.has(name);
      if (spec.type === 'object' && spec.properties) {
        walk(path, spec.properties, req);
      } else {
        plan.push({ path, spec, req });
      }
    }
  };
  walk('', props, true);

  const records = Array.isArray(doc.data) ? doc.data : doc.data !== undefined ? [doc.data] : [];
  if (records.length === 0) return { ok: false, error: 'no data found: the yaml-schema payload has no data: records' };
  if (!records.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
    return { ok: false, error: 'yaml-schema: every data: record must be a mapping' };
  }
  const recs = records as { [key: string]: YamlValue }[];

  for (const p of plan) {
    if (!p.req) continue;
    for (const r of recs) {
      const v = lookupPath(r, p.path);
      if (v === null || v === undefined) {
        warnings.push('yaml-schema: required property "' + p.path + '" is missing from a data record (cell is null)');
      }
    }
  }

  const columns = plan.map((p) => p.path);
  for (const r of recs) {
    for (const key of Object.keys(r)) {
      if (!columns.some((c) => c === key || c.startsWith(key + '.'))) columns.push(key);
    }
  }

  const rows = recs.map((r) =>
    columns.map((path) => {
      const declaredProp = plan.find((p) => p.path === path);
      const v = declaredProp ? lookupPath(r, path) : r[path];
      return cell(v ?? null);
    }),
  );

  const table: TableData = { columns, rows };
  const inferred = inferSchema(table);
  const schema: ColumnSchema[] = columns.map((path, k) => {
    const p = plan.find((x) => x.path === path);
    const base = inferred[k];
    if (!p) return base; // undeclared column: inferred
    const declaredType = mapType(p.spec.type, p.spec.items?.type);
    if (p.spec.type && !declaredType) {
      warnings.push('yaml-schema: property "' + path + '" declares unknown type "' + p.spec.type + '" — inferred ' + base.type + ' instead');
    }
    return {
      name: path,
      type: declaredType ?? base.type,
      nullable: !p.req && base.nullable,
    };
  });
  // advisory: declared leaf types validated against values
  for (const p of plan) {
    const declaredType = mapType(p.spec.type, p.spec.items?.type);
    const k = columns.indexOf(p.path);
    if (!declaredType || k < 0) continue;
    const check = cellCheck(declaredType);
    if (!check) continue;
    for (const r of recs) {
      const v = lookupPath(r, p.path);
      if (v === null || v === undefined) continue;
      const text = cell(v);
      if (text !== '' && !check(text)) {
        warnings.push('yaml-schema: "' + p.path + '" value "' + text + '" does not match its declared type ' + declaredType + ' (rendered as-is)');
      }
    }
  }
  return { ok: true, table, schema, warnings };
}

/** `a.b.c` lookup through nested mappings. */
function lookupPath(rec: { [key: string]: YamlValue }, path: string): YamlValue {
  let cur: YamlValue = rec;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as { [key: string]: YamlValue })[seg] ?? null;
  }
  return cur;
}

/** Declared (OpenAPI-ish) type → the §4 ColumnType set; null = unknown. */
function mapType(type?: string, itemType?: string): ColumnType | null {
  const t = type === 'array' ? itemType : type;
  if (!t) return null;
  return (TYPES.has(t) ? t : null) as ColumnType | null;
}

/** A per-type text predicate for advisory validation (shared shape with applyColumnDecl). */
function cellCheck(type: ColumnType): ((v: string) => boolean) | null {
  switch (type) {
    case 'integer': return (v) => /^[+-]?\d+$/.test(v);
    case 'number': return (v) => isFinite(+v);
    case 'boolean': return (v) => v === 'true' || v === 'false';
    case 'date': return (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}/.test(v);
    default: return null;
  }
}
