/**
 * data/json — JSON payload shaping for sem-data-source (phase 2).
 *
 * Spec: spec/data-visualizer.md §7.4. In scope: array of objects (rows;
 * column union first-seen), object of arrays (columns), and `data-path`
 * extraction (dot segments + `[n]` indexes) for nested API responses.
 * Out of scope: JSONL, nested-object rows without a data-path.
 * Pure, no DOM. The reading tier parses with JSON.parse — never eval.
 */

import type { SourceParse, TableData } from './table.js';
import { cell, type YamlValue } from './yaml.js';

export function jsonToTable(value: unknown): SourceParse {
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: false, error: 'no data found: the json array is empty' };
    if (!value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
      return { ok: false, error: 'a json payload must be an array of objects (rows) — scalar or array items are not rows' };
    }
    const columns: string[] = [];
    for (const row of value as Record<string, unknown>[]) {
      for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }
    return {
      ok: true,
      table: { columns, rows: (value as Record<string, unknown>[]).map((r) => columns.map((c) => cell(r[c] as YamlValue))) } as TableData,
    };
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown[]>;
    const columns = Object.keys(obj);
    if (columns.length === 0) return { ok: false, error: 'no data found: the json object is empty' };
    if (!columns.every((c) => Array.isArray(obj[c]))) {
      return { ok: false, error: 'a json object payload must map every column name to an array of values; for a nested response use data-path' };
    }
    const height = Math.max(...columns.map((c) => (obj[c] as unknown[]).length));
    return {
      ok: true,
      table: {
        columns,
        rows: Array.from({ length: height }, (_, r) => columns.map((c) => cell((obj[c] as unknown[])[r] as YamlValue))),
      } as TableData,
    };
  }
  return { ok: false, error: 'a json payload must be an array of objects or an object of arrays' };
}

/**
 * Extract a `data-path` (`data.items`, `rows[2].entries`) from a parsed
 * response. Unknown keys and out-of-range indexes return undefined (the
 * caller errors clearly); a missing/empty path returns the value itself.
 */
export function extractPath(value: unknown, path: string | null): unknown {
  if (!path || !path.trim()) return value;
  let cur: unknown = value;
  for (const seg of path.trim().split('.')) {
    const m = /^([^\[\]]*)((\[\d+\])*)$/.exec(seg.trim());
    if (!m) return undefined;
    if (m[1]) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    }
    if (m[2]) {
      for (const idx of m[2].match(/\[(\d+)\]/g) as string[]) {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[+idx.slice(1, -1)];
      }
    }
  }
  return cur;
}
