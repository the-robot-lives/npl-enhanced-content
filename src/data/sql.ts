/**
 * data/sql — the read-only SQL subset for sem-data (phase 2: shape
 * declarations; phase 5: the query engine).
 *
 * Spec: spec/data-visualizer.md §7.5/§8. A `data-format="sql"` source is a
 * single SELECT statement carried as DATA: the projection declares the result
 * shape, nothing executes. The same tokenizer backs the phase-5 query
 * engine (parseQuery/runQuery). Pure, no DOM.
 *
 * Out of scope by design (§8): JOIN/UNION/subqueries, GROUP BY/aggregates,
 * DISTINCT, OFFSET, IN/BETWEEN/LIKE, functions, arithmetic, aliases,
 * multi-statement queries, and every mutating statement.
 */

export type Tok =
  | { kind: 'ident'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'op'; text: string };

/** Statement keywords the engine must refuse outright. */
const MUTATING = new Set(['insert', 'update', 'delete', 'create', 'drop', 'alter', 'truncate', 'merge', 'grant', 'revoke', 'replace']);

export function tokenize(sql: string): { ok: true; tokens: Tok[] } | { ok: false; error: string } {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let text = '';
      i++;
      for (;;) {
        if (i >= sql.length) return { ok: false, error: "unterminated string literal (close it with '" };
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { text += "'"; i += 2; continue; }
          i++; break;
        }
        text += sql[i++];
      }
      tokens.push({ kind: 'string', text });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.\-]*/.exec(sql.slice(i)) as RegExpExecArray;
      tokens.push({ kind: 'ident', text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/\d/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(sql.slice(i)) as RegExpExecArray;
      tokens.push({ kind: 'number', text: m[0] });
      i += m[0].length;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
      tokens.push({ kind: 'op', text: two });
      i += 2;
      continue;
    }
    if (c === ',' || c === '=' || c === '<' || c === '>' || c === '*') {
      tokens.push({ kind: 'op', text: c });
      i++;
      continue;
    }
    if (c === ';') return { ok: false, error: 'a query is one statement — ";" (multiple statements) is out of scope' };
    return { ok: false, error: 'unexpected character "' + c + '" in query' };
  }
  return { ok: true, tokens };
}

export interface SelectShape {
  /** Projection columns, or `*` (resolve against the FROM bucket). */
  projection: string[] | '*';
  from: string;
}

/**
 * Parse a `data-format="sql"` declaration: the projection names the result
 * columns; `SELECT *` resolves against the FROM bucket at render time. No
 * execution, zero rows. Rejects non-SELECT statements, multiple statements,
 * and trailing garbage that is not a WHERE/ORDER BY/LIMIT clause head.
 */
export function parseSelectShape(sql: string):
  | { ok: true; shape: SelectShape }
  | { ok: false; error: string } {
  const t = tokenize(sql);
  if (!t.ok) return t;
  const toks = t.tokens;
  if (toks.length === 0) return { ok: false, error: 'no query found: the sql payload is empty' };
  const head = toks[0];
  if (head.kind !== 'ident') return { ok: false, error: 'a sql source holds one SELECT statement' };
  if (MUTATING.has(head.text.toLowerCase())) {
    return { ok: false, error: '"' + head.text.toUpperCase() + '" is not allowed — sql sources are read-only declarations of a SELECT shape' };
  }
  if (head.text.toLowerCase() !== 'select') {
    return { ok: false, error: 'a sql source holds one SELECT statement (got "' + head.text + '")' };
  }
  let i = 1;
  let projection: string[] | '*' ;
  if (toks[i] && toks[i].kind === 'op' && toks[i].text === '*') {
    projection = '*';
    i++;
  } else {
    const cols: string[] = [];
    for (;;) {
      const tok = toks[i];
      if (!tok || tok.kind !== 'ident') return { ok: false, error: 'the SELECT projection is "*" or a comma list of column names' };
      cols.push(tok.text);
      i++;
      if (toks[i] && toks[i].kind === 'op' && toks[i].text === ',') { i++; continue; }
      break;
    }
    projection = cols;
  }
  const from = toks[i];
  if (!from || from.kind !== 'ident' || from.text.toLowerCase() !== 'from') {
    return { ok: false, error: 'a sql declaration needs FROM <bucket> so the result shape has a source' };
  }
  i++;
  const bucket = toks[i];
  if (!bucket || bucket.kind !== 'ident') return { ok: false, error: 'FROM needs a bucket name' };
  i++;
  if (i < toks.length) {
    const next = toks[i];
    const kw = next.kind === 'ident' ? next.text.toLowerCase() : null;
    if (kw !== 'where' && kw !== 'order' && kw !== 'limit') {
      return { ok: false, error: 'unexpected "' + next.text + '" after FROM <bucket> — supported clauses are WHERE, ORDER BY and LIMIT' };
    }
  }
  return { ok: true, shape: { projection, from: bucket.text } };
}
