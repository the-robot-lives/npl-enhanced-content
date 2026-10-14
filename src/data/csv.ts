/**
 * data/csv — RFC 4180 CSV parsing for sem-data-source (phase 2).
 *
 * Spec: spec/data-visualizer.md §7.2. Pure string→data, no DOM; the reading
 * tier (src/reading/data.ts) calls this for `data-format="csv"` payloads
 * (inline or fetched). Produces the same TableData shape as the Markdown
 * table parser so views, inference, and rendering stay shared.
 */

import { dedent } from './table.js';
import type { SourceParse, TableData } from './table.js';

/**
 * Parse one CSV document. In scope (RFC 4180): quoted fields, `""` escapes,
 * embedded commas and newlines, CRLF line endings. The first record is the
 * header unless `header` is false (then columns synthesize `col-<n>`).
 * HTML-indented bodies parse like the table format: the common left margin
 * is dedented and blank lines surrounding the payload are dropped (only
 * when the document stays flush-started between quoted newlines — same
 * rule the table parser's dedent follows). Ragged rows pad/drop like the
 * table parser: missing cells are empty, extras dropped. An empty payload
 * is a clear error.
 */
export function parseCsv(src: string, header = true): SourceParse {
  const records = splitRecords(dedent(src));
  while (records.length > 1 && records[0].every((f) => f.trim() === '')) records.shift();
  while (records.length > 1 && records[records.length - 1].every((f) => f.trim() === '')) records.pop();
  const blank = records.every((r) => r.every((f) => f.trim() === ''));
  if (records.length === 0 || blank) {
    return { ok: false, error: 'no data found: the csv payload is empty' };
  }
  let columns: string[];
  let rows: string[][];
  if (header) {
    columns = records[0].map((c, k) => c.trim() || 'col-' + (k + 1));
    rows = records.slice(1);
  } else {
    const width = Math.max(...records.map((r) => r.length));
    columns = Array.from({ length: width }, (_, k) => 'col-' + (k + 1));
    rows = records;
  }
  rows = rows.map((r) => columns.map((_, k) => r[k] ?? ''));
  return { ok: true, table: { columns, rows } as TableData };
}

/** Split a CSV document into records (arrays of field strings). */
function splitRecords(src: string): string[][] {
  const out: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"' && field === '') { quoted = true; continue; }
    if (c === ',') { record.push(field); field = ''; continue; }
    if (c === '\r') { if (src[i + 1] === '\n') i++; record.push(field); out.push(record); field = ''; record = []; continue; }
    if (c === '\n') { record.push(field); out.push(record); field = ''; record = []; continue; }
    field += c;
  }
  if (field !== '' || record.length > 0) { record.push(field); out.push(record); }
  // Drop trailing fully-empty records (the newline after the last row) but
  // keep a single all-empty record for a payload of only blank lines — that
  // is "no data", reported by the caller.
  while (out.length > 1 && out[out.length - 1].every((f) => f === '')) out.pop();
  return out;
}
