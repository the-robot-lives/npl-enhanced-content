/**
 * data/query — the read-only SQL subset engine (phase 5).
 *
 * Spec: spec/data-visualizer.md §8. Grammar:
 *
 *   SELECT <column-list | *> FROM <bucket>
 *     [WHERE <condition>] [ORDER BY <column> [ASC|DESC]] [LIMIT <n>]
 *
 * WHERE: <column> <op> <literal> (= != <> < <= > >=), IS [NOT] NULL, combined
 * with AND / OR (AND binds tighter; parentheses are out of scope). Literals:
 * 'strings' (‘’ escape), numbers, true/false/null.
 *
 * Out of scope by design (each rejects with a clear error): JOIN/UNION/
 * subqueries (joins are declarative sem-data-join elements), GROUP BY and
 * aggregates, DISTINCT, OFFSET, IN/BETWEEN/LIKE, functions, arithmetic,
 * aliases, multi-statement queries, and every mutating statement.
 * Pure, no DOM. Queries evaluate in memory over page buckets.
 */

import { normalizeRef } from './names.js';
import { tokenize, type Tok } from './sql.js';
import type { TableData } from './table.js';

export type Scalar = string | number | boolean | null;

export type Cond =
  | { kind: 'and' | 'or'; terms: Cond[] }
  | { kind: 'cmp'; column: string; op: string; value: Scalar }
  | { kind: 'isnull'; column: string; negated: boolean };

export interface QueryAst {
  columns: string[] | '*';
  from: string;
  where?: Cond;
  orderBy?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
}

const MUTATING = /^(insert|update|delete|create|drop|alter|truncate|merge|grant|revoke|replace)$/;

class QueryError extends Error {}

function kw(tok: Tok | undefined, word: string): boolean {
  return !!tok && tok.kind === 'ident' && tok.text.toLowerCase() === word;
}

class Parser {
  i = 0;
  constructor(public toks: Tok[]) {}

  peek(): Tok | undefined { return this.toks[this.i]; }
  next(): Tok | undefined { return this.toks[this.i++]; }
  expectIdent(what: string): string {
    const t = this.next();
    if (!t || t.kind !== 'ident') throw new QueryError('expected ' + what);
    return t.text;
  }

  parse(): QueryAst {
    const head = this.next();
    if (!head || head.kind !== 'ident') throw new QueryError('a query starts with SELECT');
    if (MUTATING.test(head.text.toLowerCase())) {
      throw new QueryError('"' + head.text.toUpperCase() + '" is not allowed — queries are read-only SELECT statements');
    }
    if (head.text.toLowerCase() !== 'select') {
      throw new QueryError('a query starts with SELECT (got "' + head.text + '")');
    }
    let columns: string[] | '*';
    if (this.peek()?.kind === 'op' && (this.peek() as Tok).text === '*') {
      this.next();
      columns = '*';
    } else {
      const cols: string[] = [this.expectIdent('a column name in the SELECT projection')];
      while (this.peek()?.kind === 'op' && (this.peek() as Tok).text === ',') {
        this.next();
        cols.push(this.expectIdent('a column name after ","'));
      }
      columns = cols;
    }
    if (!kw(this.next(), 'from')) throw new QueryError('FROM <bucket> is required');
    const from = this.expectIdent('a bucket name after FROM');

    const ast: QueryAst = { columns, from };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (kw(t, 'where')) { this.next(); ast.where = this.parseOr(); continue; }
      if (kw(t, 'order')) {
        this.next();
        if (!kw(this.next(), 'by')) throw new QueryError('ORDER BY <column>');
        const column = this.expectIdent('a column name after ORDER BY');
        let direction: 'asc' | 'desc' = 'asc';
        if (kw(this.peek(), 'asc')) { this.next(); }
        else if (kw(this.peek(), 'desc')) { this.next(); direction = 'desc'; }
        ast.orderBy = { column, direction };
        continue;
      }
      if (kw(t, 'limit')) {
        this.next();
        const n = this.next();
        if (!n || n.kind !== 'number') throw new QueryError('LIMIT takes a non-negative integer');
        ast.limit = Math.max(0, Math.trunc(+n.text));
        continue;
      }
      if (t.kind === 'ident' && /^(join|inner|left|right|outer|union|group|distinct|offset)$/i.test(t.text)) {
        throw new QueryError('"' + t.text.toUpperCase() + '" is out of scope — the query language is SELECT/WHERE/ORDER BY/LIMIT over one bucket' +
          (t.text.toLowerCase() === 'join' || t.text.toLowerCase() === 'inner' ? ' (joins are declarative: sem-data-join elements)' : ''));
      }
      throw new QueryError('unexpected "' + t.text + '" — supported clauses are WHERE, ORDER BY and LIMIT');
    }
    return ast;
  }

  private parseOr(): Cond {
    const terms = [this.parseAnd()];
    while (kw(this.peek(), 'or')) { this.next(); terms.push(this.parseAnd()); }
    return terms.length === 1 ? terms[0] : { kind: 'or', terms };
  }

  private parseAnd(): Cond {
    const terms = [this.parsePrimary()];
    while (kw(this.peek(), 'and')) { this.next(); terms.push(this.parsePrimary()); }
    return terms.length === 1 ? terms[0] : { kind: 'and', terms };
  }

  private parsePrimary(): Cond {
    const column = this.expectIdent('a column name in the WHERE condition');
    if (kw(this.peek(), 'is')) {
      this.next();
      let negated = false;
      if (kw(this.peek(), 'not')) { this.next(); negated = true; }
      if (!kw(this.next(), 'null')) throw new QueryError('IS [NOT] NULL');
      return { kind: 'isnull', column, negated };
    }
    const op = this.next();
    if (!op || op.kind !== 'op' || !['=', '!=', '<>', '<', '<=', '>', '>='].includes(op.text)) {
      throw new QueryError('expected a comparison (= != <> < <= > >=) or IS [NOT] NULL after "' + column + '"');
    }
    return { kind: 'cmp', column, op: op.text === '<>' ? '!=' : op.text, value: this.parseLiteral() };
  }

  private parseLiteral(): Scalar {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      const n = this.next();
      if (!n || n.kind !== 'number') throw new QueryError('a signed literal needs a number');
      return (t.text === '-' ? -1 : 1) * +n.text;
    }
    if (!t) throw new QueryError('expected a literal (‘string’, number, true/false/null)');
    if (t.kind === 'string' || t.kind === 'number') { this.next(); return t.kind === 'number' ? +t.text : t.text; }
    if (t.kind === 'ident') {
      const low = t.text.toLowerCase();
      if (low === 'true') { this.next(); return true; }
      if (low === 'false') { this.next(); return false; }
      if (low === 'null') { this.next(); return null; }
    }
    throw new QueryError('expected a literal (‘string’, number, true/false/null), got "' + t.text + '"');
  }
}

/** Parse one §8 query. Throws-free shape: { ok, ast } | { ok, error }. */
export function parseQuery(sql: string): { ok: true; ast: QueryAst } | { ok: false; error: string } {
  if (!sql.trim()) return { ok: false, error: 'the query is empty' };
  const t = tokenize(sql);
  if (!t.ok) return { ok: false, error: t.error };
  try {
    return { ok: true, ast: new Parser(t.tokens).parse() };
  } catch (e) {
    return { ok: false, error: (e as QueryError).message };
  }
}

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

export interface Bucket { name: string; table: TableData }
export type BucketSet = Map<string, Bucket>;

/** Numeric-coercible text compares numerically; everything else as text. */
function isNum(v: string): boolean {
  return v.trim() !== '' && isFinite(+v);
}

function compareCells(a: string, b: string): number {
  if (isNum(a) && isNum(b)) return +a - +b;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function cellEquals(cell: string, literal: Scalar): boolean {
  if (typeof literal === 'boolean') return cell.trim() === String(literal);
  if (typeof literal === 'number') return isNum(cell) && +cell === literal;
  return cell === String(literal);
}

function evalCond(cond: Cond, row: string[], colIndex: (name: string) => number): boolean {
  switch (cond.kind) {
    case 'and': return cond.terms.every((t) => evalCond(t, row, colIndex));
    case 'or': return cond.terms.some((t) => evalCond(t, row, colIndex));
    case 'isnull': {
      const v = row[colIndex(cond.column)] ?? '';
      return (v.trim() === '') !== cond.negated;
    }
    case 'cmp': {
      const cell = row[colIndex(cond.column)] ?? '';
      if (cell.trim() === '') return false; // null never compares equal/ordered; use IS NULL
      switch (cond.op) {
        case '=': return cellEquals(cell, cond.value);
        case '!=': return !cellEquals(cell, cond.value);
        default: {
          const lit = typeof cond.value === 'boolean' ? String(cond.value) : cond.value;
          const c = compareCells(cell, String(lit));
          return cond.op === '<' ? c < 0 : cond.op === '<=' ? c <= 0 : cond.op === '>' ? c > 0 : c >= 0;
        }
      }
    }
  }
}

/**
 * Run a parsed query over the visualizer's buckets (keyed by §5 normalized
 * reference). Read-only by construction: it maps/filters in-memory rows and
 * touches nothing else.
 */
export function runQuery(ast: QueryAst, buckets: BucketSet):
  { ok: true; table: TableData } | { ok: false; error: string } {
  const bucket = buckets.get(normalizeRef(ast.from));
  if (!bucket) {
    const names = Array.from(buckets.values(), (b) => b.name).join(', ');
    return { ok: false, error: 'unknown bucket "' + ast.from + '"' + (names ? ' — buckets in this visualizer: ' + names : ' — this visualizer has no named buckets') };
  }
  const { columns, rows } = bucket.table;
  const lower = columns.map((c) => c.trim().toLowerCase());

  const resolve = (name: string): number => {
    const k = columns.indexOf(name);
    if (k >= 0) return k;
    const ci = lower.indexOf(name.trim().toLowerCase());
    if (ci >= 0) return ci;
    return -1;
  };

  let selected: number[];
  if (ast.columns === '*') {
    selected = columns.map((_, k) => k);
  } else {
    selected = [];
    for (const name of ast.columns) {
      const k = resolve(name);
      if (k < 0) return { ok: false, error: 'unknown column "' + name + '" in bucket "' + bucket.name + '"' };
      selected.push(k);
    }
  }

  let out = rows;
  if (ast.where) {
    const colIndex = (name: string): number => {
      const k = resolve(name);
      if (k < 0) throw new QueryError('unknown column "' + name + '" in bucket "' + bucket.name + '"');
      return k;
    };
    let filtered: string[][];
    try {
      filtered = rows.filter((row) => evalCond(ast.where as Cond, row, colIndex));
    } catch (e) {
      return { ok: false, error: (e as QueryError).message };
    }
    out = filtered;
  }

  if (ast.orderBy) {
    const k = resolve(ast.orderBy.column);
    if (k < 0) return { ok: false, error: 'unknown column "' + ast.orderBy.column + '" in ORDER BY for bucket "' + bucket.name + '"' };
    const sign = ast.orderBy.direction === 'desc' ? -1 : 1;
    const stamped = out.map((row, i) => ({ row, i }));
    // stable: authored order breaks ties; nulls (empty cells) sort last either way
    stamped.sort((p, q) => {
      const a = (p.row[k] ?? '').trim();
      const b = (q.row[k] ?? '').trim();
      if (a === '' && b === '') return p.i - q.i;
      if (a === '') return 1;
      if (b === '') return -1;
      return sign * compareCells(a, b) || p.i - q.i;
    });
    out = stamped.map((s) => s.row);
  }

  if (ast.limit !== undefined) out = out.slice(0, ast.limit);

  return {
    ok: true,
    table: { columns: selected.map((k) => columns[k]), rows: out.map((row) => selected.map((k) => row[k] ?? '')) },
  };
}

/* ------------------------------------------------------------------ *
 * Declarative joins (sem-data-join) — inner join on one named key column
 * ------------------------------------------------------------------ */

/** Join-key canonical form: numeric keys compare canonicalized, else trimmed text. */
function canonicalKey(v: string): string {
  const t = v.trim();
  return t !== '' && isFinite(+t) ? String(+t) : t;
}

/**
 * Inner join two buckets on a named key column (case-insensitive). Result =
 * left columns + right columns minus the key; a right column whose name
 * collides with a left column is exposed as `<rightRef>.<column>`. Each left
 * row matched by n right rows yields n result rows; unmatched left rows drop.
 */
export function joinBuckets(left: Bucket, right: Bucket, on: string):
  { ok: true; table: TableData } | { ok: false; error: string } {
  const findCol = (b: Bucket, name: string): number => {
    const k = b.table.columns.indexOf(name);
    if (k >= 0) return k;
    return b.table.columns.findIndex((c) => c.trim().toLowerCase() === name.trim().toLowerCase());
  };
  const lk = findCol(left, on);
  if (lk < 0) return { ok: false, error: 'join key "' + on + '" is not a column of bucket "' + left.name + '"' };
  const rk = findCol(right, on);
  if (rk < 0) return { ok: false, error: 'join key "' + on + '" is not a column of bucket "' + right.name + '"' };

  const prefix = normalizeRef(right.name);
  const rightCols = right.table.columns.map((c, k) => ({ name: c, k }))
    .filter((c) => c.k !== rk);
  const outColumns = [...left.table.columns];
  const outSource: ({ side: 'left'; k: number } | { side: 'right'; k: number; name: string })[] =
    left.table.columns.map((_, k) => ({ side: 'left' as const, k }));
  for (const c of rightCols) {
    const collides = left.table.columns.some((l) => l.trim().toLowerCase() === c.name.trim().toLowerCase());
    const name = collides ? prefix + '.' + c.name : c.name;
    outColumns.push(name);
    outSource.push({ side: 'right', k: c.k, name });
  }

  const index = new Map<string, string[][]>();
  for (const row of right.table.rows) {
    const key = canonicalKey(row[rk] ?? '');
    const list = index.get(key) ?? [];
    list.push(row);
    index.set(key, list);
  }

  const rows: string[][] = [];
  for (const row of left.table.rows) {
    const matches = index.get(canonicalKey(row[lk] ?? ''));
    if (!matches) continue;
    for (const m of matches) {
      rows.push(outSource.map((src) => (src.side === 'left' ? row[src.k] ?? '' : m[src.k] ?? '')));
    }
  }
  return { ok: true, table: { columns: outColumns, rows } };
}
