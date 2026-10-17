/**
 * packages/jq/jq-json — JSON text handling (packages round, LANE=pkg-jq).
 *
 * jq reads SEQUENCES of whitespace-separated JSON values from a file or a
 * pipe (`{"a":1} {"a":2}` is two inputs), which JSON.parse cannot do alone.
 * The scanner finds each top-level value's extent (bracket depth with
 * string awareness) and hands the slice to JSON.parse, so parsing stays
 * native and errors carry an offset.
 *
 * Also home to the CLI's printer choices and the JSON-doc parse error type.
 */

import type { JVal } from './jq-eval.js';
import { jEncode, pretty } from './jq-eval.js';

/** Malformed JSON text: message plus the character offset it died at. */
export class JqJsonError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'JqJsonError';
  }
}

const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * Parse every JSON value in `text`, in order. Throws `JqJsonError` on the
 * first malformed value (with its offset); values before it were already
 * yielded, which is exactly the streaming behaviour jq's per-input error
 * handling wants.
 */
export function* scanJson(text: string): Generator<JVal> {
  const n = text.length;
  let pos = 0;
  for (;;) {
    while (pos < n && isWs(text[pos]!)) pos++;
    if (pos >= n) return;
    const start = pos;
    const end = valueEnd(text, pos);
    yield parseSlice(text, start, end);
    pos = end;
  }
}

/** Parse JSON text that must be exactly ONE value (fromjson, --argjson). */
export function parseOneJson(text: string): JVal {
  const n = text.length;
  let pos = 0;
  while (pos < n && isWs(text[pos]!)) pos++;
  if (pos >= n) throw new JqJsonError('empty JSON text (offset 0)', 0);
  const start = pos;
  const end = valueEnd(text, pos);
  const value = parseSlice(text, start, end);
  let rest = end;
  while (rest < n && isWs(text[rest]!)) rest++;
  if (rest < n) throw new JqJsonError(`extra data after JSON value (offset ${rest})`, rest);
  return value;
}

function parseSlice(text: string, start: number, end: number): JVal {
  try {
    return JSON.parse(text.slice(start, end)) as JVal;
  } catch (e) {
    const detail = (e as Error).message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '');
    throw new JqJsonError(`${detail} (offset ${start})`, start);
  }
}

/** Index just past the top-level value starting at `start`. */
function valueEnd(text: string, start: number): number {
  const c = text[start]!;
  const n = text.length;
  if (c === '{' || c === '[') {
    let depth = 0;
    let i = start;
    let inStr = false;
    while (i < n) {
      const ch = text[i]!;
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new JqJsonError(`unterminated ${c === '{' ? 'object' : 'array'} (offset ${start})`, start);
  }
  if (c === '"') {
    let i = start + 1;
    while (i < n) {
      const ch = text[i]!;
      if (ch === '\\') i++;
      else if (ch === '"') return i + 1;
      i++;
    }
    throw new JqJsonError(`unterminated string (offset ${start})`, start);
  }
  // number / true / false / null — run to the next delimiter-ish char
  let i = start;
  while (i < n && !isWs(text[i]!) && text[i] !== ',' && text[i] !== ']' && text[i] !== '}') i++;
  return i;
}

/**
 * Render one output value the way the CLI should print it: `compact` gives
 * jq -c form, otherwise jq's pretty layout; `raw` prints strings bare
 * (jq -r). Returns the full block WITH no trailing newline (callers split).
 */
export function renderValue(v: JVal, opts: { compact: boolean; raw: boolean }): string {
  if (opts.raw && typeof v === 'string') return v;
  return opts.compact ? jEncode(v) : pretty(v);
}
