/**
 * data/table — sem-data-source payloads: GFM table parsing and schema
 * inference. Pure string→data functions, no DOM: the reading tier
 * (src/reading/data.ts) and the Lit wrapper (src/lit/sem-data-visualizer.ts)
 * call these; the unit tier tests them directly (test/unit/data-visualizer.test.ts).
 *
 * Spec: spec/data-visualizer.md (phase 1 — inline Markdown table sources).
 *
 * The cell splitter mirrors src/md/parse.ts `cells()` (unescaped pipes split,
 * a pipe inside a code span is literal) but is kept local on purpose: the
 * Markdown renderer is its own distribution artifact (dist/semtext-md.js) and
 * the reading bundle must not pull it in (scripts/build.mjs budget).
 */

export type ColumnType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'null';

export interface ColumnSchema {
  /** Header text; an empty header cell synthesizes `col-<n>` (1-based). */
  name: string;
  /** Narrowest type every non-null cell in the column satisfies. */
  type: ColumnType;
  /** At least one body cell in the column is empty. */
  nullable: boolean;
}

export interface TableData {
  columns: string[];
  rows: string[][];
}

export type SourceParse =
  | { ok: true; table: TableData }
  | { ok: false; error: string };

/**
 * Delimiter-row shape the Markdown renderer accepts (GFM): `:?-+:?` cells
 * separated by `|`, with optional leading/trailing pipe and whitespace.
 * Validated by splitting (not a regex with nested `\s*` groups): a page's
 * table source is uncontrolled input and the nested form backtracks
 * super-linearly on adversarial runs of spaces (CodeQL js/polynomial-redos).
 */
const DELIM_CELL = /^:?-+:?$/;
function isDelimRow(s: string): boolean {
  let t = s.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  const parts = t.split('|');
  return parts.length > 0 && parts.every((p) => DELIM_CELL.test(p.trim()));
}
const INTEGER = /^[+-]?\d+$/;
/** ISO-8601 shaped: `YYYY-MM-DD` and `YYYY-MM-DDTHH:MM[:SS[.sss]][Z|±HH:MM]`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Strip the body's common leading indentation: the table is authored inside
 * an element, so every line usually starts with the markup's own indent.
 * Blank lines do not vote on the indent.
 */
export function dedent(src: string): string {
  const lines = src.split('\n');
  let margin = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    margin = Math.min(margin, (/^ */.exec(line) as RegExpExecArray)[0].length);
  }
  if (!isFinite(margin) || margin === 0) return src;
  return lines.map((l) => l.slice(margin)).join('\n');
}

/** Split a table row on unescaped pipes; a pipe inside a code span is literal. */
function cells(line: string): string[] {
  const t = line.trim();
  const out: string[] = [];
  let cur = '';
  let tick = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') {
      const run = /^`+/.exec(t.slice(i)) as RegExpExecArray;
      tick = tick === 0 ? run[0].length : tick === run[0].length ? 0 : tick;
      cur += run[0];
      i += run[0].length - 1;
      continue;
    }
    if (c === '|' && !tick) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  if (t[0] === '|') out.shift();
  if (out.length && t[t.length - 1] === '|' && t[t.length - 2] !== '\\') out.pop();
  return out.map((p) => p.trim());
}

/**
 * Parse the first GFM table in `src`. Errors clearly and specifically when the
 * body is not a table (no leading pipe, missing/mismatched delimiter row) —
 * the reading tier renders that message; it never guesses. Ragged rows follow
 * the Markdown renderer: missing cells are empty (inferred null), extra cells
 * are dropped. Header + delimiter with no body rows is a valid empty table.
 */
export function parseGfmTable(src: string): SourceParse {
  const lines = dedent(src).split('\n').map((l) => l.trimEnd());
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) {
    return { ok: false, error: 'no data found: the source body is empty' };
  }
  const head = lines[i];
  if (head.indexOf('|') < 0) {
    return { ok: false, error: 'not a table: the first line carries no "|" cell separator' };
  }
  const delim = lines[i + 1];
  if (delim === undefined || !isDelimRow(delim)) {
    return { ok: false, error: 'not a table: no delimiter row (| --- | --- |) follows the header' };
  }
  const columns = cells(head);
  const aligns = cells(delim);
  if (columns.length !== aligns.length) {
    return {
      ok: false,
      error: 'malformed table: the header has ' + columns.length +
        ' column(s) but the delimiter row has ' + aligns.length,
    };
  }
  const rows: string[][] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim() || line.indexOf('|') < 0) break;
    const cs = cells(line);
    // ragged rows: missing cells render empty (inferred null), extras dropped
    rows.push(columns.map((_, k) => cs[k] ?? ''));
  }
  return {
    ok: true,
    table: { columns: columns.map((c, k) => c || 'col-' + (k + 1)), rows },
  };
}

/** The narrowest type a single non-empty cell satisfies. */
function narrowest(v: string): ColumnType {
  if (INTEGER.test(v)) return 'integer';
  if (v === 'true' || v === 'false') return 'boolean';
  if (ISO_DATE.test(v) && !isNaN(Date.parse(v))) return 'date';
  if (isFinite(+v)) return 'number';
  return 'string';
}

/**
 * Infer one ColumnSchema per column. An empty cell is null. A column of only
 * empty cells — or a table with no body rows — infers type `null`, nullable.
 * integer + number mix narrows to number; any other mix widens to string.
 * Only literal `true`/`false` reads boolean (`yes`/`no` stay string); only
 * ISO-8601 shaped values that parse read date.
 */
export function inferSchema(table: TableData): ColumnSchema[] {
  return table.columns.map((name, k) => {
    const values = table.rows.map((r) => (r[k] ?? '').trim()).filter((v) => v !== '');
    const nullable = values.length < table.rows.length;
    if (values.length === 0) return { name, type: 'null' as ColumnType, nullable: true };
    const kinds = new Set(values.map(narrowest));
    let type: ColumnType = 'string';
    if (kinds.size === 1) {
      type = kinds.values().next().value as ColumnType;
    } else if (kinds.size === 2 && kinds.has('integer') && kinds.has('number')) {
      type = 'number';
    }
    return { name, type, nullable };
  });
}

/* ------------------------------------------------------------------ *
 * Views — data-views / data-view (phase 1: parsing + column selection)
 * ------------------------------------------------------------------ */

export interface ViewSpec {
  name: string;
  /** `*` = every column; else the named columns, in declaration order. */
  columns: string[] | '*';
}

/**
 * Parse `data-views="name=col-a,col-b; other=*"`. Segments are `;`-separated,
 * each `name=column-list` (`*` or comma-separated names). A segment without a
 * usable `name=` form is skipped, not an error — an authoring typo hides a
 * view, it never breaks the document.
 */
export function parseViews(spec: string | null): ViewSpec[] {
  if (!spec) return [];
  const out: ViewSpec[] = [];
  for (const part of spec.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    const cols = seg.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      columns: cols === '' || cols === '*'
        ? '*'
        : cols.split(',').map((c) => c.trim()).filter(Boolean),
    });
  }
  return out;
}

/**
 * The view a source shows first: `data-view` by name, else the first declared
 * view, else an implicit show-everything view.
 */
export function resolveView(views: ViewSpec[], defaultName: string | null): ViewSpec {
  if (defaultName) {
    const hit = views.find((v) => v.name === defaultName);
    if (hit) return hit;
  }
  return views[0] ?? { name: 'all', columns: '*' };
}

/**
 * Per-column visibility for a view. Column references match case-insensitively
 * against the header names (headers are human-written prose; `max-uses` and
 * `Max uses` name the same column), view names match exactly.
 */
export function visibleColumns(view: ViewSpec, columns: string[]): boolean[] {
  if (view.columns === '*') return columns.map(() => true);
  const wanted = new Set(view.columns.map((c) => c.trim().toLowerCase()));
  return columns.map((c) => wanted.has(c.trim().toLowerCase()));
}
