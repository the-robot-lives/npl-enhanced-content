/**
 * packages/jq/jq-eval — the jq evaluator (packages round, LANE=pkg-jq).
 *
 * Stream semantics the way jq has them: every filter maps its input value
 * to a GENERATOR of output values, so `.[]`, `range`, `//`, `if` with a
 * multi-output condition, interpolation holes and function arguments all
 * compose without special cases. Values are plain JS values (JVal); the
 * environment is an immutable linked list of `$var` bindings.
 *
 * jq's total value order (null < false < true < numbers < strings <
 * arrays < objects) drives comparisons, `sort`/`group_by`/`unique` and
 * friends, so it lives here once (`cmp`). Errors are `JqError` with a jq
 * value payload — `try`/`catch` and `?` catch them, `//` does not (jq 1.6
 * behaviour).
 */

import type { Ast } from './jq-parse.js';

/* ── values ──────────────────────────────────────────────────────────── */

export type JVal = null | boolean | number | string | JVal[] | { [key: string]: JVal };

export type ObjV = { [key: string]: JVal };

export const isObj = (v: JVal): v is ObjV => typeof v === 'object' && v !== null && !Array.isArray(v);

export function typeName(v: JVal): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  return 'object';
}

/** truthiness: only `false` and `null` are false, like jq. */
export const truthy = (v: JVal): boolean => v !== null && v !== false;

/** Compact JSON encoding (jq's tojson); key order is insertion order. */
export function jEncode(v: JVal): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jEncode).join(',')}]`;
  return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${jEncode(x!)}`).join(',')}}`;
}

/** jq's tostring: strings pass through, everything else compact JSON. */
export function toText(v: JVal): string {
  return typeof v === 'string' ? v : jEncode(v);
}

/** jq pretty-printing (2-space indent, `{}`/`[]` stay on one line). */
export function pretty(v: JVal, indent = 2): string {
  const pad = (d: number) => ' '.repeat(indent * d);
  const go = (x: JVal, d: number): string => {
    if (Array.isArray(x)) {
      if (x.length === 0) return '[]';
      return `[\n${x.map((e) => `${pad(d + 1)}${go(e, d + 1)}`).join(',\n')}\n${pad(d)}]`;
    }
    if (isObj(x)) {
      const keys = Object.keys(x);
      if (keys.length === 0) return '{}';
      return `{\n${keys.map((k) => `${pad(d + 1)}${JSON.stringify(k)}: ${go(x[k]!, d + 1)}`).join(',\n')}\n${pad(d)}}`;
    }
    return jEncode(x);
  };
  return go(v, 0);
}

/**
 * jq's total order: null < false < true < numbers < strings < arrays <
 * objects. Arrays compare element-wise; objects by sorted key list first,
 * then values in that key order.
 */
export function cmp(a: JVal, b: JVal): number {
  const rank = (v: JVal): number =>
    v === null ? 0 : typeof v === 'boolean' ? (v ? 2 : 1) : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : Array.isArray(v) ? 5 : 6;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (ra) {
    case 0:
    case 1:
    case 2:
      return 0;
    case 3:
      return a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
    case 4:
      return a === b ? 0 : (a as string) < (b as string) ? -1 : 1;
    case 5: {
      const xa = a as JVal[];
      const xb = b as JVal[];
      const n = Math.min(xa.length, xb.length);
      for (let i = 0; i < n; i++) {
        const c = cmp(xa[i]!, xb[i]!);
        if (c !== 0) return c;
      }
      return xa.length === xb.length ? 0 : xa.length < xb.length ? -1 : 1;
    }
    default: {
      const xa = Object.keys(a as ObjV).sort();
      const xb = Object.keys(b as ObjV).sort();
      const kc = cmp(xa as unknown as JVal, xb as unknown as JVal);
      if (kc !== 0) return kc;
      const oa = a as ObjV;
      const ob = b as ObjV;
      for (const k of xa) {
        const c = cmp(oa[k]!, ob[k]!);
        if (c !== 0) return c;
      }
      return 0;
    }
  }
}

/* ── errors + environment ────────────────────────────────────────────── */

/** A jq runtime error; `value` is what `catch` sees (jq passes the value). */
export class JqError extends Error {
  constructor(
    readonly value: JVal,
    readonly jqMessage: string,
  ) {
    super(jqMessage);
    this.name = 'JqError';
  }
}

const jqerr = (value: JVal, message: string): JqError => new JqError(value, message);

export type Env = { readonly name: string; readonly value: JVal; readonly parent: Env } | null;

const bind = (env: Env, name: string, value: JVal): Env => ({ name, value, parent: env });

function lookup(env: Env, name: string): JVal {
  for (let e = env; e !== null; e = e.parent) {
    if (e.name === name) return e.value;
  }
  throw jqerr(name, `$${name} is not defined (pass --arg ${name} <value> or --argjson ${name} <json>)`);
}

/* ── arithmetic ──────────────────────────────────────────────────────── */

function deepMerge(a: ObjV, b: ObjV): ObjV {
  const out: ObjV = { ...a };
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k];
    out[k] = isObj(av) && isObj(bv) ? deepMerge(av, bv) : bv!;
  }
  return out;
}

function cant(a: JVal, b: JVal, verb: string): JqError {
  return jqerr(null, `${typeName(a)} (${jEncode(a)}) and ${typeName(b)} (${jEncode(b)}) cannot be ${verb}`);
}

function arith(op: '+' | '-' | '*' | '/' | '%', a: JVal, b: JVal): JVal {
  switch (op) {
    case '+':
      if (a === null) return b;
      if (b === null) return a;
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (isObj(a) && isObj(b)) return { ...a, ...b };
      throw cant(a, b, 'added');
    case '-':
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (Array.isArray(a) && Array.isArray(b)) return a.filter((x) => !b.some((y) => cmp(x, y) === 0));
      throw cant(a, b, 'subtracted');
    case '*': {
      if (typeof a === 'number' && typeof b === 'number') return a * b;
      const [s, n] = typeof a === 'string' && typeof b === 'number' ? [a, b] : typeof b === 'string' && typeof a === 'number' ? [b, a] : [null, 0];
      if (s !== null) {
        if (!Number.isInteger(n)) throw cant(a, b, 'multiplied');
        return n <= 0 ? null : s.repeat(n);
      }
      if (isObj(a) && isObj(b)) return deepMerge(a, b);
      throw cant(a, b, 'multiplied');
    }
    case '/':
      if (typeof a === 'number' && typeof b === 'number') {
        if (b === 0) throw jqerr(null, `${typeName(a)} (${jEncode(a)}) and ${typeName(b)} (${jEncode(b)}) cannot be divided because the divisor is zero`);
        return a / b;
      }
      if (typeof a === 'string' && typeof b === 'string') {
        if (b === '') throw jqerr(a, `cannot be split: "${a}" / "" (empty separator)`);
        return a.split(b);
      }
      throw cant(a, b, 'divided');
    case '%':
      if (typeof a === 'number' && typeof b === 'number') {
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw jqerr(null, `${typeName(a)} (${jEncode(a)}) and ${typeName(b)} (${jEncode(b)}) cannot be divided, because % requires integers`);
        if (b === 0) throw jqerr(null, `${typeName(a)} (${jEncode(a)}) and ${typeName(b)} (${jEncode(b)}) cannot be divided because the divisor is zero`);
        return a % b; // JS % is truncated toward zero, like jq/C
      }
      throw cant(a, b, 'divided');
  }
}

/* ── path/shape helpers (error text follows jq 1.6) ─────────────────── */

function indexValue(v: JVal, k: JVal): JVal {
  if (typeof k === 'string') {
    if (v === null) return null;
    if (isObj(v)) return v[k] ?? null;
    throw jqerr(k, `Cannot index ${typeName(v)} with "${k}"`);
  }
  if (typeof k === 'number') {
    if (v === null) return null;
    if (Array.isArray(v)) {
      if (!Number.isInteger(k)) throw jqerr(k, `Cannot index array with number (${jEncode(k)}) — array indices must be integers`);
      const i = k < 0 ? v.length + k : k;
      return i >= 0 && i < v.length ? v[i]! : null;
    }
    throw jqerr(k, `Cannot index ${typeName(v)} with number`);
  }
  throw jqerr(k, `Cannot index ${typeName(v)} with ${typeName(k)}`);
}

function sliceValue(v: JVal, lo: JVal | null, hi: JVal | null): JVal {
  if (v === null) return null;
  if (!Array.isArray(v) && typeof v !== 'string') throw jqerr(v, `Cannot slice ${typeName(v)} (${jEncode(v)})`);
  const num = (x: JVal | null, what: string): number | null => {
    if (x === null) return null;
    if (typeof x !== 'number') throw jqerr(x, `Slice ${what} must be a number, got ${typeName(x)}`);
    return Math.floor(x);
  };
  const len = v.length;
  let a = num(lo, 'start');
  let b = num(hi, 'end');
  if (a === null) a = 0;
  if (b === null) b = len;
  if (a < 0) a = Math.max(0, len + a);
  if (b < 0) b = Math.max(0, len + b);
  a = Math.min(a, len);
  b = Math.min(b, len);
  if (b <= a) return typeof v === 'string' ? '' : [];
  return v.slice(a, b);
}

function iterError(v: JVal): JqError {
  const detail = Array.isArray(v) || isObj(v) ? '' : ` (${jEncode(v)})`;
  return jqerr(v, `Cannot iterate over ${typeName(v)}${detail}`);
}

function* valuesOf(v: JVal): Generator<JVal> {
  if (Array.isArray(v)) yield* v;
  else if (isObj(v)) yield* Object.values(v);
  else throw iterError(v);
}

/** jq's `contains`: recursive containment (strings substring, arrays every
 *  element of b contained in some element of a, objects per key). */
function containsValue(a: JVal, b: JVal): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
  if (Array.isArray(a) && Array.isArray(b)) return b.every((y) => a.some((x) => containsValue(x, y)));
  if (isObj(a) && isObj(b)) return Object.entries(b).every(([k, bv]) => k in a && containsValue(a[k]!, bv));
  return cmp(a, b) === 0;
}

function requireArray(v: JVal, what: string): JVal[] {
  if (!Array.isArray(v)) throw jqerr(v, `${what} requires an array, got ${typeName(v)} (${jEncode(v)})`);
  return v;
}

function requireString(v: JVal, what: string): string {
  if (typeof v !== 'string') throw jqerr(v, `${what} requires a string, got ${typeName(v)} (${jEncode(v)})`);
  return v;
}

function requireNumber(v: JVal, what: string): number {
  if (typeof v !== 'number') throw jqerr(v, `${what} requires a number, got ${typeName(v)} (${jEncode(v)})`);
  return v;
}

/** All outputs of `f` on `v`, collected — jq's `[f]` keying for *_by fns. */
function keyOf(f: Ast, v: JVal, env: Env): JVal[] {
  return [...evalNode(f, v, env)];
}

/* ── base64 (pure, no Buffer/btoa — works in browser, worker, node) ──── */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2]!;
    out += B64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63]!;
  }
  return out;
}

function b64decode(text: string): string {
  const clean = text.replace(/[\s=]+/g, '');
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = B64_CHARS.indexOf(ch);
    if (idx === -1) throw jqerr(text, `${jEncode(text)} is not valid base64`);
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

/* ── @formats ────────────────────────────────────────────────────────── */

export function applyFormat(name: string, v: JVal): JVal {
  switch (name) {
    case 'text':
      return toText(v);
    case 'json':
      return jEncode(v);
    case 'base64':
      return b64encode(toText(v));
    case 'base64d':
      return b64decode(requireString(v, '@base64d'));
    case 'uri':
      return encodeURIComponent(toText(v));
    case 'html':
      return toText(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    case 'csv': {
      const arr = requireArray(v, '@csv');
      return arr
        .map((el) => {
          if (el === null) return '';
          if (typeof el === 'boolean') return el ? 'true' : 'false';
          if (typeof el === 'number') return String(el);
          if (typeof el === 'string') return `"${el.replace(/"/g, '""')}"`;
          throw jqerr(el, `@csv: cannot format ${typeName(el)} (${jEncode(el)})`);
        })
        .join(',');
    }
    case 'tsv': {
      const arr = requireArray(v, '@tsv');
      return arr
        .map((el) => {
          if (el === null) return '';
          if (typeof el === 'boolean') return el ? 'true' : 'false';
          if (typeof el === 'number') return String(el);
          if (typeof el === 'string') return el.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          throw jqerr(el, `@tsv: cannot format ${typeName(el)} (${jEncode(el)})`);
        })
        .join('\t');
    }
    default:
      throw jqerr(name, `@${name} is not a known format`);
  }
}

/* ── builtins ────────────────────────────────────────────────────────── */

type Builtin = (v: JVal, args: Ast[], env: Env) => Generator<JVal>;

/** One output (jq's `|=`, first-output argument conventions). */
function firstOf(f: Ast, v: JVal, env: Env): { ok: boolean; value: JVal } {
  for (const out of evalNode(f, v, env)) return { ok: true, value: out };
  return { ok: false, value: null };
}

function sortedByKey(v: JVal[], f: Ast, env: Env): Array<{ el: JVal; key: JVal[] }> {
  return v
    .map((el) => ({ el, key: keyOf(f, el, env) }))
    .sort((x, y) => cmp(x.key as unknown as JVal, y.key as unknown as JVal));
}

const BUILTINS = new Map<string, Builtin>();

function builtin(name: string, arity: number, fn: Builtin): void {
  BUILTINS.set(`${name}/${arity}`, fn);
}

builtin('empty', 0, function* () {});
builtin('error', 0, function* (v) {
  throw jqerr(v, toText(v));
});
builtin('error', 1, function* (v, [msg], env) {
  for (const m of evalNode(msg, v, env)) throw jqerr(m, toText(m));
  yield null; // unreachable: throwing generator never yields
});
builtin('not', 0, function* (v) {
  yield !truthy(v);
});
builtin('length', 0, function* (v) {
  if (v === null) yield 0;
  else if (typeof v === 'boolean') throw jqerr(v, `${typeName(v)} (${jEncode(v)}) has no length`);
  else if (typeof v === 'number') yield Math.abs(v);
  else if (typeof v === 'string') yield [...v].length; // code points, like jq
  else if (isObj(v)) yield Object.keys(v).length;
  else yield v.length;
});
builtin('utf8bytelength', 0, function* (v) {
  yield new TextEncoder().encode(requireString(v, 'utf8bytelength')).length;
});
builtin('keys', 0, function* (v) {
  if (isObj(v)) yield Object.keys(v).sort();
  else if (Array.isArray(v)) yield v.map((_, i) => i);
  else throw jqerr(v, `${typeName(v)} (${jEncode(v)}) has no keys`);
});
builtin('keys_unsorted', 0, function* (v) {
  if (isObj(v)) yield Object.keys(v);
  else if (Array.isArray(v)) yield v.map((_, i) => i);
  else throw jqerr(v, `${typeName(v)} (${jEncode(v)}) has no keys`);
});
builtin('values', 0, function* (v) {
  if (v !== null) yield v;
});
builtin('has', 1, function* (v, [k], env) {
  for (const key of evalNode(k, v, env)) {
    if (isObj(v)) yield typeof key === 'string' && key in v;
    else if (Array.isArray(v)) yield typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < v.length;
    else throw jqerr(key, `Cannot check whether ${typeName(v)} has a key of type ${typeName(key)}`);
  }
});
builtin('contains', 1, function* (v, [k], env) {
  for (const other of evalNode(k, v, env)) yield containsValue(v, other);
});
builtin('inside', 1, function* (v, [k], env) {
  for (const other of evalNode(k, v, env)) yield containsValue(other, v);
});
builtin('type', 0, function* (v) {
  yield typeName(v);
});
builtin('tostring', 0, function* (v) {
  yield toText(v);
});
builtin('tonumber', 0, function* (v) {
  if (typeof v === 'number') yield v;
  else if (typeof v === 'string') {
    const n = Number(v);
    if (v.trim() === '' || Number.isNaN(n)) throw jqerr(v, `Cannot parse '${v}' as number`);
    yield n;
  } else throw jqerr(v, `${typeName(v)} (${jEncode(v)}) cannot be parsed as a number`);
});
builtin('tojson', 0, function* (v) {
  yield jEncode(v);
});
builtin('fromjson', 0, function* (v) {
  const text = requireString(v, 'fromjson');
  try {
    yield parseSingleJson(text);
  } catch (e) {
    if (e instanceof JqError) throw e;
    throw jqerr(text, `${jEncode(text)} cannot be parsed as JSON: ${(e as Error).message}`);
  }
});
builtin('add', 0, function* (v) {
  let acc: JVal = null;
  for (const x of valuesOf(v)) acc = arith('+', acc, x);
  yield acc;
});
builtin('any', 0, function* (v) {
  let found = false;
  for (const x of valuesOf(v)) if (truthy(x)) found = true;
  yield found;
});
builtin('all', 0, function* (v) {
  let all = true;
  for (const x of valuesOf(v)) if (!truthy(x)) all = false;
  yield all;
});
builtin('range', 1, function* (v, [hi], env) {
  for (const h of evalNode(hi, v, env)) {
    const top = requireNumber(h, 'range');
    for (let i = 0; i < top; i++) yield i;
  }
});
builtin('range', 2, function* (v, [lo, hi], env) {
  for (const l of evalNode(lo, v, env))
    for (const h of evalNode(hi, v, env)) {
      const from = requireNumber(l, 'range');
      const top = requireNumber(h, 'range');
      for (let i = from; i < top; i++) yield i;
    }
});
builtin('range', 3, function* (v, [lo, hi, by], env) {
  for (const l of evalNode(lo, v, env))
    for (const h of evalNode(hi, v, env))
      for (const s of evalNode(by, v, env)) {
        const from = requireNumber(l, 'range');
        const top = requireNumber(h, 'range');
        const step = requireNumber(s, 'range');
        if (step === 0) throw jqerr(s, 'range with step 0');
        if (step > 0) for (let i = from; i < top; i += step) yield i;
        else for (let i = from; i > top; i += step) yield i;
      }
});
const math1 = (name: string, f: (n: number) => number): void =>
  builtin(name, 0, function* (v) {
    yield f(requireNumber(v, name));
  });
math1('floor', Math.floor);
math1('ceil', Math.ceil);
math1('round', Math.round);
math1('sqrt', (n) => (n < 0 ? NaN : Math.sqrt(n)));
math1('fabs', Math.abs);
builtin('min', 0, function* (v) {
  const arr = requireArray(v, 'min');
  if (arr.length === 0) yield null;
  else yield arr.reduce((m, x) => (cmp(x, m) < 0 ? x : m));
});
builtin('max', 0, function* (v) {
  const arr = requireArray(v, 'max');
  if (arr.length === 0) yield null;
  else yield arr.reduce((m, x) => (cmp(x, m) > 0 ? x : m));
});
builtin('min_by', 1, function* (v, [f], env) {
  const arr = requireArray(v, 'min_by');
  if (arr.length === 0) yield null;
  else yield arr.reduce((m, x) => (cmp(keyOf(f, x, env) as unknown as JVal, keyOf(f, m, env) as unknown as JVal) < 0 ? x : m));
});
builtin('max_by', 1, function* (v, [f], env) {
  const arr = requireArray(v, 'max_by');
  if (arr.length === 0) yield null;
  else yield arr.reduce((m, x) => (cmp(keyOf(f, x, env) as unknown as JVal, keyOf(f, m, env) as unknown as JVal) > 0 ? x : m));
});
builtin('sort', 0, function* (v) {
  yield [...requireArray(v, 'sort')].sort(cmp);
});
builtin('sort_by', 1, function* (v, [f], env) {
  yield sortedByKey(requireArray(v, 'sort_by'), f, env).map((e) => e.el);
});
builtin('group_by', 1, function* (v, [f], env) {
  const sorted = sortedByKey(requireArray(v, 'group_by'), f, env);
  const groups: JVal[][] = [];
  let cur: JVal[] | null = null;
  let curKey: JVal[] | null = null;
  for (const { el, key } of sorted) {
    if (cur === null || curKey === null || cmp(key as unknown as JVal, curKey as unknown as JVal) !== 0) {
      cur = [el];
      curKey = key;
      groups.push(cur);
    } else cur.push(el);
  }
  yield groups;
});
builtin('unique', 0, function* (v) {
  const sorted = [...requireArray(v, 'unique')].sort(cmp);
  const out: JVal[] = [];
  for (const x of sorted) if (out.length === 0 || cmp(out[out.length - 1]!, x) !== 0) out.push(x);
  yield out;
});
builtin('unique_by', 1, function* (v, [f], env) {
  const sorted = sortedByKey(requireArray(v, 'unique_by'), f, env);
  const out: JVal[] = [];
  let prevKey: JVal[] | null = null;
  for (const { el, key } of sorted) {
    if (prevKey === null || cmp(key as unknown as JVal, prevKey as unknown as JVal) !== 0) {
      out.push(el);
      prevKey = key;
    }
  }
  yield out;
});
builtin('reverse', 0, function* (v) {
  if (v === null) yield [];
  else if (Array.isArray(v)) yield [...v].reverse();
  else if (typeof v === 'string') yield [...v].reverse().join('');
  else throw jqerr(v, `Cannot reverse ${typeName(v)} (${jEncode(v)})`);
});
builtin('flatten', 0, function* (v) {
  yield flattenArr(v, Infinity, 'flatten');
});
builtin('flatten', 1, function* (v, [d], env) {
  for (const depth of evalNode(d, v, env)) yield flattenArr(v, requireNumber(depth, 'flatten'), 'flatten');
});
function flattenArr(v: JVal, depth: number, what: string): JVal {
  const arr = requireArray(v, what);
  if (depth < 0) return arr;
  const out: JVal[] = [];
  for (const el of arr) {
    if (Array.isArray(el) && depth > 0) out.push(...(flattenArr(el, depth - 1, what) as JVal[]));
    else out.push(el);
  }
  return out;
}
builtin('first', 0, function* (v) {
  yield indexValue(v, 0);
});
builtin('last', 0, function* (v) {
  yield indexValue(v, -1);
});
builtin('join', 1, function* (v, [sep], env) {
  const arr = requireArray(v, 'join');
  for (const s of evalNode(sep, v, env)) {
    const glue = toText(s);
    yield arr
      .map((el) => {
        if (el === null) return '';
        if (typeof el === 'string') return el;
        if (typeof el === 'boolean' || typeof el === 'number') return toText(el);
        throw jqerr(el, `Cannot join with ${typeName(el)} (${jEncode(el)})`);
      })
      .join(glue);
  }
});
builtin('split', 1, function* (v, [sep], env) {
  const text = requireString(v, 'split');
  for (const s of evalNode(sep, v, env)) {
    const glue = requireString(s, 'split');
    if (glue === '') throw jqerr(glue, 'split input and separator must not be empty');
    yield text.split(glue); // '' splits to one empty field, like jq
  }
});
builtin('ltrimstr', 1, function* (v, [p], env) {
  if (typeof v !== 'string') yield v;
  else
    for (const pre of evalNode(p, v, env)) {
      yield typeof pre === 'string' && v.startsWith(pre) ? v.slice(pre.length) : v;
    }
});
builtin('rtrimstr', 1, function* (v, [p], env) {
  if (typeof v !== 'string') yield v;
  else
    for (const suf of evalNode(p, v, env)) {
      yield typeof suf === 'string' && suf !== '' && v.endsWith(suf) ? v.slice(0, v.length - suf.length) : v;
    }
});
builtin('startswith', 1, function* (v, [p], env) {
  const text = requireString(v, 'startswith');
  for (const pre of evalNode(p, v, env)) yield text.startsWith(requireString(pre, 'startswith'));
});
builtin('endswith', 1, function* (v, [p], env) {
  const text = requireString(v, 'endswith');
  for (const suf of evalNode(p, v, env)) yield text.endsWith(requireString(suf, 'endswith'));
});
builtin('ascii_downcase', 0, function* (v) {
  yield requireString(v, 'ascii_downcase').replace(/[A-Z]/g, (c) => c.toLowerCase());
});
builtin('ascii_upcase', 0, function* (v) {
  yield requireString(v, 'ascii_upcase').replace(/[a-z]/g, (c) => c.toUpperCase());
});
builtin('to_entries', 0, function* (v) {
  if (!isObj(v)) throw jqerr(v, `to_entries requires an object, got ${typeName(v)} (${jEncode(v)})`);
  yield Object.entries(v).map(([key, value]) => ({ key, value: value! }));
});
builtin('from_entries', 0, function* (v) {
  const arr = requireArray(v, 'from_entries');
  const out: ObjV = {};
  for (const e of arr) {
    if (!isObj(e)) throw jqerr(e, `from_entries: entry ${jEncode(e)} is not an object`);
    const rawKey = ('key' in e ? e.key : 'k' in e ? e.k : 'name' in e ? e.name : 'Name' in e ? e.Name : null) ?? null;
    if (rawKey === null) throw jqerr(e, `from_entries: entry ${jEncode(e)} has no key`);
    const key = typeof rawKey === 'string' ? rawKey : toText(rawKey);
    out[key] = 'value' in e ? e.value! : 'v' in e ? e.v! : null;
  }
  yield out;
});
builtin('with_entries', 1, function* (v, [f], env) {
  if (!isObj(v)) throw jqerr(v, `with_entries requires an object, got ${typeName(v)} (${jEncode(v)})`);
  const entries = Object.entries(v).map(([key, value]) => ({ key, value: value! }));
  const mapped: JVal[] = [];
  for (const e of entries) for (const out of evalNode(f, e as unknown as JVal, env)) mapped.push(out);
  const result: ObjV = {};
  for (const e of mapped) {
    if (!isObj(e)) throw jqerr(e, `with_entries: mapped entry ${jEncode(e)} is not an object`);
    const rawKey = ('key' in e ? e.key : 'k' in e ? e.k : 'name' in e ? e.name : null) ?? null;
    if (rawKey === null) throw jqerr(e, `with_entries: mapped entry ${jEncode(e)} has no key`);
    result[typeof rawKey === 'string' ? rawKey : toText(rawKey)] = 'value' in e ? e.value! : null;
  }
  yield result;
});
builtin('select', 1, function* (v, [f], env) {
  for (const ok of evalNode(f, v, env)) if (truthy(ok)) yield v;
});
builtin('map', 1, function* (v, [f], env) {
  const out: JVal[] = [];
  for (const el of valuesOf(v)) for (const mapped of evalNode(f, el, env)) out.push(mapped);
  yield out;
});
builtin('map_values', 1, function* (v, [f], env) {
  if (Array.isArray(v)) {
    const out: JVal[] = [];
    for (const el of v) {
      const r = firstOf(f, el, env);
      if (r.ok) out.push(r.value);
    }
    yield out;
  } else if (isObj(v)) {
    const out: ObjV = {};
    for (const [k, el] of Object.entries(v)) {
      const r = firstOf(f, el!, env);
      if (r.ok) out[k] = r.value;
    }
    yield out;
  } else throw iterError(v);
});
builtin('paths', 0, function* () {
  throw jqerr(null, 'paths is not supported by this jq build');
});
builtin('env', 0, function* () {
  throw jqerr(null, 'env is not supported by this jq build (use --arg to pass values)');
});
builtin('input', 0, function* () {
  throw jqerr(null, 'input is not supported by this jq build (use -s to slurp all inputs)');
});
builtin('inputs', 0, function* () {
  throw jqerr(null, 'inputs is not supported by this jq build (use -s to slurp all inputs)');
});

/* ── the evaluator ───────────────────────────────────────────────────── */

export function* evalNode(ast: Ast, v: JVal, env: Env): Generator<JVal> {
  switch (ast.t) {
    case 'id':
      yield v;
      return;
    case 'lit':
      yield ast.v;
      return;
    case 'str':
      yield* evalString(ast.parts, 0, '', v, env);
      return;
    case 'field': {
      if (v === null) yield null;
      else if (isObj(v)) yield v[ast.name] ?? null;
      else throw jqerr(ast.name, `Cannot index ${typeName(v)} with "${ast.name}"`);
      return;
    }
    case 'index':
      for (const k of evalNode(ast.key, v, env)) yield indexValue(v, k);
      return;
    case 'slice':
      for (const lo of ast.lo !== null ? evalNode(ast.lo, v, env) : single(null))
        for (const hi of ast.hi !== null ? evalNode(ast.hi, v, env) : single(null)) yield sliceValue(v, lo, hi);
      return;
    case 'iter':
      yield* valuesOf(v);
      return;
    case 'pipe':
      for (const mid of evalNode(ast.l, v, env)) yield* evalNode(ast.r, mid, env);
      return;
    case 'comma':
      yield* evalNode(ast.l, v, env);
      yield* evalNode(ast.r, v, env);
      return;
    case 'alt': {
      let found = false;
      for (const out of evalNode(ast.l, v, env)) {
        if (truthy(out)) {
          found = true;
          yield out;
        }
      }
      if (!found) yield* evalNode(ast.r, v, env);
      return;
    }
    case 'or':
      for (const a of evalNode(ast.l, v, env)) {
        if (truthy(a)) yield true;
        else for (const b of evalNode(ast.r, v, env)) yield truthy(b);
      }
      return;
    case 'and':
      for (const a of evalNode(ast.l, v, env)) {
        if (!truthy(a)) yield false;
        else for (const b of evalNode(ast.r, v, env)) yield truthy(b);
      }
      return;
    case 'binop': {
      const { op } = ast;
      if (op === '==' || op === '!=') {
        for (const b of evalNode(ast.r, v, env))
          for (const a of evalNode(ast.l, v, env)) yield op === '==' ? cmp(a, b) === 0 : cmp(a, b) !== 0;
        return;
      }
      if (op === '<' || op === '<=' || op === '>' || op === '>=') {
        for (const b of evalNode(ast.r, v, env))
          for (const a of evalNode(ast.l, v, env)) {
            const c = cmp(a, b);
            yield op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
          }
        return;
      }
      for (const b of evalNode(ast.r, v, env)) for (const a of evalNode(ast.l, v, env)) yield arith(op, a, b);
      return;
    }
    case 'neg':
      for (const x of evalNode(ast.e, v, env)) {
        if (typeof x !== 'number') throw jqerr(x, `${typeName(x)} (${jEncode(x)}) cannot be negated`);
        yield -x;
      }
      return;
    case 'try': {
      if (ast.catch_ === null) {
        try {
          yield* evalNode(ast.body, v, env);
        } catch (e) {
          if (!(e instanceof JqError)) throw e;
        }
        return;
      }
      const it = evalNode(ast.body, v, env);
      for (;;) {
        let out: IteratorResult<JVal>;
        try {
          out = it.next();
        } catch (e) {
          if (!(e instanceof JqError)) throw e;
          yield* evalNode(ast.catch_, e.value, env);
          return;
        }
        if (out.done) return;
        yield out.value;
      }
    }
    case 'if':
      yield* evalIf(ast.clauses, ast.els, 0, v, env);
      return;
    case 'reduce': {
      for (const init of evalNode(ast.init, v, env)) {
        let acc = init;
        for (const x of evalNode(ast.src, v, env)) {
          const env2 = bind(env, ast.name, x);
          let last: JVal | undefined;
          for (const out of evalNode(ast.update, acc, env2)) last = out;
          if (last !== undefined) acc = last; // empty update keeps the accumulator
        }
        yield acc;
      }
      return;
    }
    case 'as':
      for (const s of evalNode(ast.src, v, env)) yield* evalNode(ast.body, v, bind(env, ast.name, s));
      return;
    case 'var':
      yield lookup(env, ast.name);
      return;
    case 'call': {
      const fn = BUILTINS.get(`${ast.name}/${ast.args.length}`);
      if (fn === undefined) {
        const anyArity = [...BUILTINS.keys()].some((k) => k.startsWith(`${ast.name}/`));
        throw jqerr(ast.name, `${ast.name}/${ast.args.length} is not defined${anyArity ? ` (only ${ast.name} with a different arity exists)` : ''}`);
      }
      yield* fn(v, ast.args, env);
      return;
    }
    case 'array':
      yield ast.body === null ? [] : [...evalNode(ast.body, v, env)];
      return;
    case 'object':
      yield* buildObject(ast.entries, 0, {}, v, env);
      return;
    case 'format':
      yield applyFormat(ast.name, v);
      return;
  }
}

/**
 * `if/elif/else/end`: every output of a condition drives the branch
 * independently (jq semantics); an omitted `else` defaults to identity.
 */
function* evalIf(
  clauses: Array<{ cond: Ast; then: Ast }>,
  els: Ast | null,
  i: number,
  v: JVal,
  env: Env,
): Generator<JVal> {
  if (i === clauses.length) {
    if (els !== null) yield* evalNode(els, v, env);
    else yield v;
    return;
  }
  const { cond, then } = clauses[i]!;
  for (const c of evalNode(cond, v, env)) {
    if (truthy(c)) yield* evalNode(then, v, env);
    else yield* evalIf(clauses, els, i + 1, v, env);
  }
}

/** String interpolation: cartesian over the hole outputs, jq order. */
function* evalString(parts: Array<string | Ast>, i: number, acc: string, v: JVal, env: Env): Generator<string> {
  if (i === parts.length) {
    yield acc;
    return;
  }
  const part = parts[i]!;
  if (typeof part === 'string') {
    yield* evalString(parts, i + 1, acc + part, v, env);
    return;
  }
  for (const out of evalNode(part, v, env)) yield* evalString(parts, i + 1, acc + toText(out), v, env);
}

function* buildObject(entries: Array<{ key: Ast; val: Ast | null }>, i: number, acc: ObjV, v: JVal, env: Env): Generator<JVal> {
  if (i === entries.length) {
    yield { ...acc };
    return;
  }
  const { key, val } = entries[i]!;
  for (const k of evalNode(key, v, env)) {
    if (typeof k !== 'string') throw jqerr(k, `Object keys must be strings (${jEncode(k)} given)`);
    if (val === null) {
      // `{key}` shorthand — value is `.key` of the input
      const sh = v === null ? null : isObj(v) ? (v[k] ?? null) : null;
      if (v !== null && !isObj(v)) throw jqerr(v, `Cannot index ${typeName(v)} with "${k}"`);
      yield* buildObject(entries, i + 1, { ...acc, [k]: sh }, v, env);
      continue;
    }
    for (const value of evalNode(val, v, env)) yield* buildObject(entries, i + 1, { ...acc, [k]: value }, v, env);
  }
}

/* ── compile-time validation ─────────────────────────────────────────── */

/**
 * Static check run before evaluation (jq compiles, we validate): unknown
 * function name/arity and unbound `$var` references fail here, so the CLI
 * can exit 3 like real jq instead of 5. Variable scope is the AST's: an
 * `as`/`reduce` binding covers only its own body.
 */
export function validateProgram(ast: Ast, defined: ReadonlySet<string>): string | null {
  let failure: string | null = null;
  const visit = (a: Ast, bound: ReadonlySet<string>): void => {
    if (failure !== null) return;
    switch (a.t) {
      case 'var':
        if (!bound.has(a.name)) failure = `$${a.name} is not defined`;
        return;
      case 'call': {
        if (!BUILTINS.has(`${a.name}/${a.args.length}`)) {
          const near = [...BUILTINS.keys()].find((k) => k.startsWith(`${a.name}/`));
          failure = `${a.name}/${a.args.length} is not defined${near !== undefined ? ` (did you mean ${near}?)` : ''}`;
        }
        for (const arg of a.args) visit(arg, bound);
        return;
      }
      case 'as': {
        visit(a.src, bound);
        const inner = new Set(bound);
        inner.add(a.name);
        visit(a.body, inner);
        return;
      }
      case 'reduce': {
        visit(a.src, bound);
        visit(a.init, bound);
        const inner = new Set(bound);
        inner.add(a.name);
        visit(a.update, inner);
        return;
      }
      case 'pipe':
      case 'comma':
      case 'alt':
      case 'or':
      case 'and':
      case 'binop':
        visit(a.l, bound);
        visit(a.r, bound);
        return;
      case 'try':
        visit(a.body, bound);
        if (a.catch_ !== null) visit(a.catch_, bound);
        return;
      case 'if':
        for (const c of a.clauses) {
          visit(c.cond, bound);
          visit(c.then, bound);
        }
        if (a.els !== null) visit(a.els, bound);
        return;
      case 'neg':
        visit(a.e, bound);
        return;
      case 'index':
        visit(a.key, bound);
        return;
      case 'slice':
        if (a.lo !== null) visit(a.lo, bound);
        if (a.hi !== null) visit(a.hi, bound);
        return;
      case 'array':
        if (a.body !== null) visit(a.body, bound);
        return;
      case 'object':
        for (const e of a.entries) {
          visit(e.key, bound);
          if (e.val !== null) visit(e.val, bound);
        }
        return;
      case 'str':
        for (const p of a.parts) if (typeof p !== 'string') visit(p, bound);
        return;
      default:
        return;
    }
  };
  visit(ast, defined);
  return failure;
}

/* ── single-JSON parse (for fromjson; the CLI uses the scanner) ──────── */

function parseSingleJson(text: string): JVal {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('empty JSON text');
  return JSON.parse(trimmed) as JVal;
}

/* Re-import guard removed — interpolation ASTs arrive pre-parsed. */

/** A single-value generator (for omitted slice bounds). */
function* single(x: JVal | null): Generator<JVal> {
  yield x;
}
