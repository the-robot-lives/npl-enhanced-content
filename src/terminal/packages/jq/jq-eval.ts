/**
 * packages/jq/jq-eval — the jq evaluator (packages rounds 1–2, LANE=pkg-jq).
 *
 * Stream semantics the way jq has them: every filter maps its input value
 * to a GENERATOR of output values, so `.[]`, `range`, `//`, `if` with a
 * multi-output condition, interpolation holes and function arguments all
 * compose without special cases. Values are plain JS values (JVal); the
 * environment is an immutable linked list mixing `$var` bindings, user
 * function definitions (lexical, with call-by-value `$params` and
 * call-by-name filter closures) and `label` markers.
 *
 * jq's total value order (null < false < true < numbers < strings <
 * arrays < objects) drives comparisons, `sort`/`group_by`/`unique` and
 * friends, so it lives here once (`cmp`). Errors are `JqError` with a jq
 * value payload — `try`/`catch` and `?` catch them, `//` does NOT (jq 1.7
 * behaviour: plain `//` backtracks on falsy/empty, only `try` catches
 * errors — verified against jq 1.7.1 src/execute.c, FORK handler).
 *
 * Round 2 adds: user `def`s (recursion via late self-binding, depth-capped),
 * `foreach`/`label`/`break` (JqBreak signal), update assignment over a
 * path collector (`= |= += -= *= /= %= //=`), `input`/`inputs`/
 * `input_filename`/`env`/`$ENV` (module RunState the CLI fills in),
 * `halt`/`halt_error` (JqHalt signal), regex builtins (./jq-re.ts), path
 * builtins (`path/getpath/setpath/delpaths/indices/…`) and the jq-1.7
 * prelude (recurse, while/until/repeat, first/last(f), limit, walk, paths,
 * leaf_paths, del, type filters, any/all(f), add(f), splits, abs, ascii).
 */

import type { Ast, DefParam } from './jq-parse.js';
import { parseProgram } from './jq-parse.js';
import { captureObject, compileRegex, CpIndex, hasNamedGroups, matchIter, matchObject, regexSplit, type JqRegex, type RawMatch } from './jq-re.js';

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

/* ── errors, signals, environment ────────────────────────────────────── */

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

export const jqerr = (value: JVal, message: string): JqError => new JqError(value, message);

/** Unwinds to the matching `label`; `marker` identifies which one. */
export class JqBreak extends Error {
  constructor(
    readonly marker: object,
  ) {
    super('break');
    this.name = 'JqBreak';
  }
}

/** `halt`/`halt_error`: stops the whole run; the CLI turns this into exit. */
export class JqHalt extends Error {
  constructor(
    readonly code: number,
    readonly payload: JVal,
  ) {
    super('halt');
    this.name = 'JqHalt';
  }
}

export type Env =
  | null
  | { readonly k: 'var'; readonly name: string; readonly value: JVal; readonly parent: Env }
  | { readonly k: 'fn'; readonly name: string; readonly arity: number; readonly params: readonly DefParam[]; readonly body: Ast; readonly defEnv: Env; readonly parent: Env; readonly paramClosure?: boolean }
  | { readonly k: 'label'; readonly name: string; readonly marker: object; readonly parent: Env };

type FnNode = Extract<Env, { k: 'fn' }>;

const bind = (env: Env, name: string, value: JVal): Env => ({ k: 'var', name, value, parent: env });

const addFn = (env: Env, fn: Omit<FnNode, 'k' | 'parent'>): Env => ({ k: 'fn', ...fn, parent: env });

function lookup(env: Env, name: string): JVal {
  for (let e = env; e !== null; e = e.parent) {
    if (e.k === 'var' && e.name === name) return e.value;
  }
  throw jqerr(name, `$${name} is not defined (pass --arg ${name} <value> or --argjson ${name} <json>)`);
}

function findFn(env: Env, name: string, arity: number): FnNode | null {
  for (let e = env; e !== null; e = e.parent) {
    if (e.k === 'fn' && e.name === name && e.arity === arity) return e;
  }
  return null;
}

/* ── per-run state (the CLI fills this in before evaluating) ─────────── */

export interface RunState {
  /** Remaining input documents for `input`/`inputs` (null when exhausted). */
  nextInput: (() => JVal | null) | null;
  /** `input_filename` — file name of the document being evaluated. */
  filename: string | null;
  /** `env`/`$ENV` snapshot. */
  env: ObjV;
  /** Live user-function nesting (recursion cap). */
  depth: number;
}

export const runState: RunState = { nextInput: null, filename: null, env: {}, depth: 0 };

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
  const len = v.length;
  let a = numBound(lo, 'start', len);
  let b = numBound(hi, 'end', len);
  if (b <= a) return typeof v === 'string' ? '' : [];
  return v.slice(a, b);
}

/** Normalize one slice bound (jq clamps negatives/fractions like this). */
function numBound(x: JVal | null, what: string, len: number): number {
  if (x === null) return what === 'start' ? 0 : len;
  if (typeof x !== 'number') throw jqerr(x, `Slice ${what} must be a number, got ${typeName(x)}`);
  let n = Math.floor(x);
  if (n < 0) n = Math.max(0, len + n);
  return Math.min(n, len);
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

/** jq's wording for test/match input checks. */
function requireMatchable(v: JVal): string {
  if (typeof v !== 'string') throw jqerr(v, `${jEncode(v)} (${typeName(v)}) cannot be matched, as it is not a string`);
  return v;
}

/** All outputs of `f` on `v`, collected — jq's `[f]` keying for *_by fns. */
function keyOf(f: Ast, v: JVal, env: Env): JVal[] {
  return [...evalNode(f, v, env)];
}

/* ── path expressions (collector + get/set/del) ──────────────────────── */

/** One path segment: object key, array index, or a slice {start,end}. */
export type PathSeg = string | number | { start: number | null; end: number | null };

/** Read the value at `segs` (jq path semantics: missing → null). */
function getPathVal(v: JVal, segs: readonly PathSeg[]): JVal {
  let cur = v;
  for (const s of segs) {
    if (typeof s === 'string' || typeof s === 'number') cur = indexValue(cur, s);
    else cur = sliceValue(cur, s.start, s.end);
  }
  return cur;
}

/** Validate an argument-shaped path (`getpath`/`delpaths`/`setpath`). */
function requireSegs(p: JVal): PathSeg[] {
  const arr = requireArray(p, 'path');
  return arr.map((s) => {
    if (typeof s === 'string') return s;
    if (typeof s === 'number') return s;
    if (isObj(s) && ('start' in s || 'end' in s)) {
      const st = s.start ?? null;
      const en = s.end ?? null;
      if (st !== null && typeof st !== 'number') throw jqerr(p, 'Invalid path');
      if (en !== null && typeof en !== 'number') throw jqerr(p, 'Invalid path');
      return { start: st, end: en };
    }
    throw jqerr(p, 'Invalid path');
  });
}

/** jq's setpath: structural update; null grows into objects/arrays. */
function setPathValue(v: JVal, segs: readonly PathSeg[], x: JVal): JVal {
  if (segs.length === 0) return x;
  const s = segs[0]!;
  const rest = segs.slice(1);
  if (typeof s === 'string') {
    let base = v;
    if (base === null) base = {};
    if (!isObj(base)) throw jqerr(s, `Cannot index ${typeName(base)} with "${s}"`);
    return { ...base, [s]: setPathValue(base[s] ?? null, rest, x) };
  }
  if (typeof s === 'number') {
    let base = v;
    if (base === null) base = [];
    if (!Array.isArray(base)) throw jqerr(s, `Cannot index ${typeName(base)} with number`);
    if (!Number.isInteger(s)) throw jqerr(s, `Cannot index array with number (${jEncode(s)}) — array indices must be integers`);
    const i = s < 0 ? base.length + s : s;
    if (i < 0) throw jqerr(s, 'Out of bounds negative array index');
    const out = base.slice();
    while (out.length < i) out.push(null);
    out[i] = setPathValue(out[i] ?? null, rest, x);
    return out;
  }
  // slice segment: only meaningful as the final step
  let base = v;
  if (base === null) base = [];
  if (!Array.isArray(base)) throw jqerr(v, `Cannot slice ${typeName(v)} (${jEncode(v)})`);
  if (rest.length > 0) throw jqerr(null, 'Invalid path expression');
  if (!Array.isArray(x)) throw jqerr(x, 'A slice of an array can only be assigned another array');
  const lo = numBound(s.start, 'start', base.length);
  const hi = numBound(s.end, 'end', base.length);
  return [...base.slice(0, lo), ...x, ...base.slice(hi)];
}

/** jq's delpath: removing an absent path is a no-op; deleting [] → null. */
function delPathValue(v: JVal, segs: readonly PathSeg[]): JVal {
  if (segs.length === 0) return null;
  const s = segs[0]!;
  if (segs.length === 1) {
    if (typeof s === 'string') {
      if (!isObj(v) || !(s in v)) return v;
      const { [s]: _drop, ...rest } = v;
      return rest;
    }
    if (typeof s === 'number') {
      if (!Array.isArray(v)) return v;
      if (!Number.isInteger(s)) return v;
      const i = s < 0 ? v.length + s : s;
      if (i < 0 || i >= v.length) return v;
      return [...v.slice(0, i), ...v.slice(i + 1)];
    }
    if (!Array.isArray(v)) return v;
    const lo = numBound(s.start, 'start', v.length);
    const hi = numBound(s.end, 'end', v.length);
    if (hi <= lo) return v;
    return [...v.slice(0, lo), ...v.slice(hi)];
  }
  const child = typeof s === 'string' || typeof s === 'number' ? indexValue(v, s) : sliceValue(v, s.start, s.end);
  const newChild = delPathValue(child, segs.slice(1));
  if (newChild === child) return v; // nothing deeper changed
  if (typeof s === 'string') return { ...(v as ObjV), [s]: newChild };
  if (typeof s === 'number') {
    const base = v as JVal[];
    const i = s < 0 ? base.length + s : s;
    const out = base.slice();
    while (out.length < i) out.push(null);
    out[i] = newChild;
    return out;
  }
  return v; // slice segments never nest deeper
}

/** The core of `path(f)`/`del(f)`/update-assignment: walk `ast` as a path. */
function* collectPaths(ast: Ast, val: JVal, env: Env, path: PathSeg[]): Generator<PathSeg[]> {
  switch (ast.t) {
    case 'id':
      yield [...path];
      return;
    case 'field': {
      checkFieldPath(val, ast.name);
      yield [...path, ast.name];
      return;
    }
    case 'index':
      for (const k of evalNode(ast.key, val, env)) {
        checkIndexPath(val, k);
        yield [...path, k as string | number];
      }
      return;
    case 'slice':
      for (const lo of ast.lo !== null ? evalNode(ast.lo, val, env) : single(null))
        for (const hi of ast.hi !== null ? evalNode(ast.hi, val, env) : single(null)) {
          if (val !== null && !Array.isArray(val) && typeof val !== 'string') throw jqerr(val, `Cannot slice ${typeName(val)} (${jEncode(val)})`);
          yield [...path, { start: segBound(lo), end: segBound(hi) }];
        }
      return;
    case 'iter': {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) yield [...path, i];
      } else if (isObj(val)) {
        for (const k of Object.keys(val)) yield [...path, k];
      } else throw iterError(val);
      return;
    }
    case 'pipe':
      for (const p of collectPaths(ast.l, val, env, path)) {
        const child = getPathVal(val, p.slice(path.length));
        yield* collectPaths(ast.r, child, env, p);
      }
      return;
    case 'comma':
      yield* collectPaths(ast.l, val, env, path);
      yield* collectPaths(ast.r, val, env, path);
      return;
    case 'try':
      try {
        yield* collectPaths(ast.body, val, env, path);
      } catch (e) {
        if (!(e instanceof JqError)) throw e;
      }
      return;
    case 'if':
      yield* collectIf(ast.clauses, ast.els, 0, val, env, path);
      return;
    case 'call': {
      if (ast.name === 'select' && ast.args.length === 1) {
        for (const ok of evalNode(ast.args[0]!, val, env)) if (truthy(ok)) yield [...path];
        return;
      }
      if (ast.name === 'empty' && ast.args.length === 0) return;
      if (ast.name === 'recurse' && ast.args.length === 0) {
        yield* collectRecurse(val, path);
        return;
      }
      if (ast.name === 'getpath' && ast.args.length === 1) {
        for (const p of evalNode(ast.args[0]!, val, env)) yield [...path, ...requireSegs(p)];
        return;
      }
      // a user/prelude def whose body is itself a path expression
      // (`def del(f): delpaths([path(f)])` — `f` is a param call here)
      const fn = findFn(env, ast.name, ast.args.length);
      if (fn !== null) {
        yield* bindPathParams(fn, 0, ast.args, val, env, fn.paramClosure === true ? fn.defEnv : addFn(fn.defEnv, fn), path);
        return;
      }
      throw jqerr(null, 'Invalid path expression');
    }
    default:
      throw jqerr(null, 'Invalid path expression');
  }
}

/** collectPaths counterpart of bindParams: bind the call, walk the body. */
function* bindPathParams(
  fn: FnNode,
  i: number,
  args: Ast[],
  val: JVal,
  callEnv: Env,
  env2: Env,
  path: PathSeg[],
): Generator<PathSeg[]> {
  if (i === fn.params.length) {
    yield* collectPaths(fn.body, val, env2, path);
    return;
  }
  const p = fn.params[i]!;
  if (p.dollar) {
    for (const v of evalNode(args[i]!, val, callEnv)) yield* bindPathParams(fn, i + 1, args, val, callEnv, bind(env2, p.name, v), path);
  } else {
    yield* bindPathParams(fn, i + 1, args, val, callEnv, addFn(env2, { name: p.name, arity: 0, params: [], body: args[i]!, defEnv: callEnv, paramClosure: true }), path);
  }
}

function* collectIf(
  clauses: Array<{ cond: Ast; then: Ast }>,
  els: Ast | null,
  i: number,
  val: JVal,
  env: Env,
  path: PathSeg[],
): Generator<PathSeg[]> {
  if (i === clauses.length) {
    if (els !== null) yield* collectPaths(els, val, env, path);
    else yield [...path]; // omitted else is identity
    return;
  }
  const { cond, then } = clauses[i]!;
  for (const c of evalNode(cond, val, env)) {
    if (truthy(c)) yield* collectPaths(then, val, env, path);
    else yield* collectIf(clauses, els, i + 1, val, env, path);
  }
}

/** `..` — pre-order DFS over arrays/objects; scalars stop (recurse(.[]?)). */
function* collectRecurse(val: JVal, path: PathSeg[]): Generator<PathSeg[]> {
  yield [...path];
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) yield* collectRecurse(val[i]!, [...path, i]);
  } else if (isObj(val)) {
    for (const k of Object.keys(val)) yield* collectRecurse(val[k]!, [...path, k]);
  }
}

function checkFieldPath(v: JVal, name: string): void {
  if (v === null || isObj(v)) return;
  throw jqerr(name, `Cannot index ${typeName(v)} with "${name}"`);
}

function checkIndexPath(v: JVal, k: JVal): void {
  if (v === null) return;
  if (typeof k === 'string' && !isObj(v)) throw jqerr(k, `Cannot index ${typeName(v)} with "${k}"`);
  if (typeof k === 'number' && !Array.isArray(v)) throw jqerr(k, `Cannot index ${typeName(v)} with number`);
}

function segBound(x: JVal): number | null {
  if (x === null) return null;
  if (typeof x !== 'number') throw jqerr(x, 'Slice boundaries must be numbers in a path expression');
  return Math.floor(x);
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
  for (const m of evalNode(msg, v, env)) throw jqerr(m, toText(m)); // empty arg stream → empty output, like jq
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
builtin('first', 1, function* (v, [f], env) {
  // native, not the jq `label $out | (f, break $out)` prelude def: a
  // pull-driven comma drains f before reaching the break, but jq stops
  // after the FIRST output.
  for (const out of evalNode(f, v, env)) {
    yield out;
    return;
  }
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
      const r = firstOf(f, el!, env);
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

/* ── round-2 builtins: paths, regex, streams, control ────────────────── */

builtin('path', 1, function* (v, [f], env) {
  for (const p of collectPaths(f, v, env, [])) yield p as unknown as JVal;
});
builtin('getpath', 1, function* (v, [p], env) {
  for (const path of evalNode(p, v, env)) yield getPathVal(v, requireSegs(path));
});
builtin('setpath', 2, function* (v, [p, xf], env) {
  for (const path of evalNode(p, v, env)) {
    const segs = requireSegs(path);
    for (const x of evalNode(xf, v, env)) yield setPathValue(v, segs, x);
  }
});
builtin('delpaths', 1, function* (v, [ps], env) {
  for (const list of evalNode(ps, v, env)) {
    const arr = requireArray(list, 'delpaths');
    // delete deepest/last paths first so earlier deletions keep indices valid
    const sorted = [...arr].sort((a, b) => cmp(b as unknown as JVal, a as unknown as JVal));
    let cur = v;
    for (const p of sorted) cur = delPathValue(cur, requireSegs(p));
    yield cur;
  }
});

builtin('indices', 1, function* (v, [x], env) {
  for (const needle of evalNode(x, v, env)) {
    if (v === null) {
      yield null;
      continue;
    }
    if (typeof v === 'string') {
      if (typeof needle !== 'string') throw jqerr(needle, `Cannot get indices of ${typeName(needle)} in string`);
      yield needle === '' ? [] : stringIndices(v, needle);
    } else if (Array.isArray(v)) {
      const ndl = Array.isArray(needle) ? needle : [needle];
      if (ndl.length === 0) {
        yield null;
        continue;
      }
      const out: number[] = [];
      for (let i = 0; i + ndl.length <= v.length; i++) {
        let ok = true;
        for (let j = 0; j < ndl.length; j++)
          if (cmp(v[i + j]!, ndl[j]!) !== 0) {
            ok = false;
            break;
          }
        if (ok) out.push(i);
      }
      yield out;
    } else throw jqerr(needle, `Cannot get indices of ${typeName(v)}`);
  }
});
function stringIndices(text: string, needle: string): number[] {
  const cp = new CpIndex(text);
  const out: number[] = [];
  let at = 0;
  for (;;) {
    const i = text.indexOf(needle, at);
    if (i === -1) return out;
    out.push(cp.cp(i));
    at = i + needle.length;
  }
}
builtin('index', 1, function* (v, [x], env) {
  for (const arr of indexLists(v, x, env)) yield Array.isArray(arr) && arr.length > 0 ? arr[0]! : null;
});
builtin('rindex', 1, function* (v, [x], env) {
  for (const arr of indexLists(v, x, env)) yield Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1]! : null;
});
/** Shared body of index/rindex: the full indices list per needle output. */
function* indexLists(v: JVal, x: Ast, env: Env): Generator<JVal> {
  const it = BUILTINS.get('indices/1')!;
  yield* it(v, [x], env);
}

builtin('transpose', 0, function* (v) {
  const rows = requireArray(v, 'transpose');
  let cols = 0;
  for (const r of rows) {
    if (!Array.isArray(r)) throw iterError(r);
    if (r.length > cols) cols = r.length;
  }
  const out: JVal[][] = Array.from({ length: cols }, () => []);
  for (const r of rows) {
    const row = r as JVal[];
    for (let c = 0; c < cols; c++) out[c]!.push(c < row.length ? row[c]! : null);
  }
  yield out;
});
builtin('explode', 0, function* (v) {
  yield [...requireString(v, 'explode')].map((ch) => ch.codePointAt(0)!);
});
builtin('implode', 0, function* (v) {
  const arr = requireArray(v, 'implode');
  let out = '';
  for (const el of arr) {
    if (typeof el !== 'number' || !Number.isInteger(el)) throw jqerr(el, `implode input must be an array of numbers (${jEncode(el)} given)`);
    if (el < 0 || el > 0x10ffff || (el >= 0xd800 && el <= 0xdfff)) throw jqerr(el, `${el} is not a valid codepoint for implode`);
    out += String.fromCodePoint(el);
  }
  yield out;
});
builtin('ascii', 0, function* (v) {
  // not in stock jq 1.7; requested by the lane brief — [.] | implode
  const n = requireNumber(v, 'ascii');
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) throw jqerr(v, `${n} is not a valid codepoint for ascii`);
  yield String.fromCodePoint(n);
});

builtin('env', 0, function* () {
  yield { ...runState.env };
});
builtin('input', 0, function* () {
  if (runState.nextInput === null) throw jqerr(null, 'No more inputs');
  const next = runState.nextInput();
  if (next === null) throw jqerr(null, 'No more inputs');
  yield next;
});
builtin('inputs', 0, function* () {
  if (runState.nextInput === null) throw jqerr(null, 'No more inputs');
  for (;;) {
    const next = runState.nextInput();
    if (next === null) return;
    yield next;
  }
});
builtin('input_filename', 0, function* () {
  yield runState.filename;
});
builtin('halt', 0, function* () {
  throw new JqHalt(0, null);
});
builtin('halt_error', 0, function* (v) {
  throw new JqHalt(5, v);
});
builtin('halt_error', 1, function* (v, [code], env) {
  for (const c of evalNode(code, v, env)) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 255) throw jqerr(c, 'halt_error/1: number between 0 and 255 required');
    throw new JqHalt(c, v);
  }
});

/* ── regex builtins (Oniguruma→JS via ./jq-re.ts) ────────────────────── */

/** Compile one pattern/flags argument pair (both may be streams). */
function* compileArgs(v: JVal, pattern: Ast, flags: Ast | null, env: Env): Generator<JqRegex> {
  for (const pv of evalNode(pattern, v, env)) {
    const pat = requireMatchable(pv);
    if (flags === null) {
      yield compileRegex(pat, null);
      continue;
    }
    for (const fv of evalNode(flags, v, env)) {
      if (fv !== null && typeof fv !== 'string') throw jqerr(fv, `${jEncode(fv)} is not a valid modifier string`);
      yield compileRegex(pat, fv);
    }
  }
}

builtin('test', 1, function* (v, [re], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, null, env)) yield matchIter(text, rx).next().done !== true;
});
builtin('test', 2, function* (v, [re, fl], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, fl, env)) yield matchIter(text, rx).next().done !== true;
});
builtin('match', 1, function* (v, [re], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, null, env)) yield* emitMatches(text, rx);
});
builtin('match', 2, function* (v, [re, fl], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, fl, env)) yield* emitMatches(text, rx);
});
function* emitMatches(text: string, rx: JqRegex): Generator<JVal> {
  for (const raw of matchIter(text, rx)) yield matchObject(text, raw, rx);
}
builtin('capture', 1, function* (v, [re], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, null, env))
    for (const raw of matchIter(text, rx)) yield captureObject(raw, rx);
});
builtin('capture', 2, function* (v, [re, fl], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, fl, env))
    for (const raw of matchIter(text, rx)) yield captureObject(raw, rx);
});
builtin('scan', 1, function* (v, [re], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, null, env))
    // always global, like jq
    for (const raw of matchIter(text, { ...rx, global: true })) yield hasNamedGroups(rx) ? captureObject(raw, rx) : raw.m[0];
});
builtin('scan', 2, function* (v, [re, fl], env) {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, re, fl, env))
    for (const raw of matchIter(text, { ...rx, global: true })) yield hasNamedGroups(rx) ? captureObject(raw, rx) : raw.m[0];
});
builtin('split', 2, function* (v, [re, fl], env) {
  const text = requireString(v, 'split');
  for (const rx of compileArgs(v, re, fl, env)) yield regexSplit(text, rx);
});
builtin('splits', 2, function* (v, [re, fl], env) {
  const text = requireString(v, 'splits');
  for (const rx of compileArgs(v, re, fl, env)) yield* regexSplit(text, rx);
});

/** sub/gsub body: cartesian over replacement-filter outputs per match. */
function* subGen(v: JVal, pattern: Ast, flags: Ast | null, repl: Ast, env: Env, forceAll: boolean): Generator<JVal> {
  const text = requireMatchable(v);
  for (const rx of compileArgs(v, pattern, flags, env)) {
    const all = forceAll || rx.global;
    const matches = [...matchIter(text, { ...rx, global: true })];
    const use = all ? matches : matches.slice(0, 1);
    yield* subWalk(text, use, 0, 0, '', repl, env, rx);
  }
}
function* subWalk(text: string, matches: RawMatch[], i: number, from: number, acc: string, repl: Ast, env: Env, rx: JqRegex): Generator<string> {
  if (i === matches.length) {
    yield acc + text.slice(from);
    return;
  }
  const { m, cp } = matches[i]!;
  const pre = text.slice(from, m.index);
  const caps = captureObject({ m, cp }, rx);
  for (const r of evalNode(repl, caps, env)) {
    if (typeof r !== 'string') throw jqerr(r, `sub/gsub replacement must be a string (${jEncode(r)} given)`);
    yield* subWalk(text, matches, i + 1, m.index + m[0].length, acc + pre + r, repl, env, rx);
  }
}
builtin('sub', 2, function* (v, [re, rp], env) {
  yield* subGen(v, re, null, rp, env, false);
});
builtin('sub', 3, function* (v, [re, rp, fl], env) {
  yield* subGen(v, re, fl, rp, env, false);
});
builtin('gsub', 2, function* (v, [re, rp], env) {
  yield* subGen(v, re, null, rp, env, true);
});
builtin('gsub', 3, function* (v, [re, rp, fl], env) {
  yield* subGen(v, re, fl, rp, env, true);
});

/* ── the jq 1.7 prelude (user defs shadow every one of these) ────────── */

const PRELUDE_SRC = [
  'def recurse(f): def r: ., (f | r); r;',
  'def recurse: recurse(.[]?);',
  'def objects: select(type == "object");',
  'def arrays: select(type == "array");',
  'def booleans: select(type == "boolean");',
  'def numbers: select(type == "number");',
  'def strings: select(type == "string");',
  'def nulls: select(type == "null");',
  'def iterables: select(type == "array" or type == "object");',
  'def scalars: select(type != "array" and type != "object");',
  'def leaf_paths: paths(. != null and type != "array" and type != "object");',
  'def paths: path(..) | select(length > 0);',
  'def paths(node_filter): . as $in | paths | select(. as $p | $in | getpath($p) | node_filter);',
  'def del(path_filter): delpaths([path(path_filter)]);',
  'def walk(f): . as $in | if type == "object" then reduce keys_unsorted[] as $key ({}; . + {($key): ($in[$key] | walk(f))}) | f elif type == "array" then map(walk(f)) | f else f end;',
  // first(f) is a native builtin: the classic `label $out | (f, break $out)`
  // prelude def needs comma semantics jq's VM has (the break preempts f's
  // remaining outputs) that a pull-driven comma cannot reproduce.
  'def last(f): reduce f as $x (null; $x);',
  'def until(cond; update): def _until: if cond then . else (update | _until) end; _until;',
  'def while(cond; update): def _while: if cond then ., (update | _while) else empty end; _while;',
  'def repeat(f): def _repeat: f as $x | $x, ($x | _repeat); _repeat;',
  'def limit($n; f): if $n > 0 then label $out | foreach f as $item (0; . + 1; $item, if . >= $n then break $out else empty end) elif $n == 0 then empty else f end;',
  'def abs: if . < 0 then - . else . end;',
  'def toarray: if type == "array" then . else [.] end;',
  'def any(generator; condition): reduce (generator | condition) as $v (false; . or $v);',
  'def any(condition): any(.[]; condition);',
  'def all(generator; condition): reduce (generator | condition) as $v (true; . and $v);',
  'def all(condition): all(.[]; condition);',
  'def add(f): reduce f as $x (null; . + $x);',
  'def splits($re): splits($re; null);',
  'def ascii: [.] | implode;',
].join('\n');

/** Prelude defs, lexically scoped to each other, shadowable by users. */
const PRELUDE_ENV: Env = (() => {
  const ast = parseProgram(`${PRELUDE_SRC}\nempty`);
  const defs: FnNode[] = [];
  let node: Ast = ast;
  while (node.t === 'def') {
    defs.push({ k: 'fn', name: node.name, arity: node.params.length, params: node.params, body: node.body, defEnv: null, parent: null });
    node = node.rest;
  }
  // chain them; every def sees every other def (late binding, like jq)
  let chain: Env = null;
  for (let i = defs.length - 1; i >= 0; i--) {
    const d = defs[i]!;
    chain = { ...d, parent: chain };
    defs[i] = chain as FnNode;
  }
  for (const d of defs) (d as { defEnv: Env }).defEnv = chain;
  return chain;
})();

const PRELUDE_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (let e: Env = PRELUDE_ENV; e !== null && e.k === 'fn'; e = e.parent) keys.add(`${e.name}/${e.arity}`);
  return keys;
})();

const KNOWN_FNS = new Set<string>([...BUILTINS.keys(), ...PRELUDE_KEYS]);

/** Base scope for a CLI run: prelude defs, then $ENV, then user variables. */
export function makeBaseEnv(vars: Iterable<readonly [string, JVal]>, shellEnv: ObjV): Env {
  let env: Env = bind(PRELUDE_ENV, 'ENV', shellEnv);
  for (const [name, value] of vars) env = bind(env, name, value);
  return env;
}

/* ── user function calls ─────────────────────────────────────────────── */

const MAX_CALL_DEPTH = 400;

/** Call a user `def`: $params bind per output value; filters are closures. */
function* callUser(fn: FnNode, args: Ast[], input: JVal, callEnv: Env): Generator<JVal> {
  runState.depth++;
  if (runState.depth > MAX_CALL_DEPTH) {
    runState.depth--;
    throw jqerr(null, `jq recursion limit exceeded (over ${MAX_CALL_DEPTH} nested function calls)`);
  }
  try {
    // defs self-bind so they can recur by name; param closures must NOT (a
    // pass-through arg like `map(walk(f))` would otherwise resolve `f` to
    // itself forever — jq resolves it to the caller's outer binding).
    const env0 = fn.paramClosure === true ? fn.defEnv : addFn(fn.defEnv, fn);
    yield* bindParams(fn, 0, args, input, callEnv, env0);
  } finally {
    runState.depth--;
  }
}

function* bindParams(fn: FnNode, i: number, args: Ast[], input: JVal, callEnv: Env, env2: Env): Generator<JVal> {
  if (i === fn.params.length) {
    yield* evalNode(fn.body, input, env2);
    return;
  }
  const p = fn.params[i]!;
  if (p.dollar) {
    for (const val of evalNode(args[i]!, input, callEnv)) yield* bindParams(fn, i + 1, args, input, callEnv, bind(env2, p.name, val));
  } else {
    // filter parameter: a zero-arg closure evaluated in the CALLER's scope
    yield* bindParams(fn, i + 1, args, input, callEnv, addFn(env2, { name: p.name, arity: 0, params: [], body: args[i]!, defEnv: callEnv, paramClosure: true }));
  }
}

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
      yield* evalString(ast.parts, 0, '', v, env, toText);
      return;
    case 'fmtnstr':
      yield* evalString(ast.parts, 0, '', v, env, (out) => {
        const formatted = applyFormat(ast.name, out);
        return requireString(formatted, `@${ast.name}`);
      });
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
    case 'foreach': {
      // jq 1.7 (probe-verified): every update output emits its extract; the
      // accumulator becomes the LAST update output of each source item.
      for (const init of evalNode(ast.init, v, env)) {
        let acc = init;
        for (const x of evalNode(ast.src, v, env)) {
          const env2 = bind(env, ast.name, x);
          let last: JVal | undefined;
          for (const out of evalNode(ast.update, acc, env2)) {
            last = out;
            yield* evalNode(ast.extract ?? { t: 'id' }, out, env2);
          }
          if (last !== undefined) acc = last;
        }
      }
      return;
    }
    case 'as':
      for (const s of evalNode(ast.src, v, env)) yield* evalNode(ast.body, v, bind(env, ast.name, s));
      return;
    case 'def': {
      const fnEnv = addFn(env, { name: ast.name, arity: ast.params.length, params: ast.params, body: ast.body, defEnv: env });
      yield* evalNode(ast.rest, v, fnEnv);
      return;
    }
    case 'label': {
      const marker = {};
      const env2: Env = { k: 'label', name: ast.name, marker, parent: env };
      try {
        yield* evalNode(ast.body, v, env2);
      } catch (e) {
        if (e instanceof JqBreak && e.marker === marker) return; // break caught here
        throw e;
      }
      return;
    }
    case 'break': {
      for (let e = env; e !== null; e = e.parent) {
        if (e.k === 'label' && e.name === ast.name) throw new JqBreak(e.marker);
      }
      throw jqerr(null, `$*${ast.name} is not defined (break must be inside a matching label)`);
    }
    case 'assign': {
      const paths: PathSeg[][] = [];
      for (const p of collectPaths(ast.lhs, v, env, [])) paths.push(p);
      if (ast.op === '=') {
        for (const rv of evalNode(ast.rhs, v, env)) {
          let cur = v;
          for (const p of paths) cur = setPathValue(cur, p, rv);
          yield cur;
        }
        return;
      }
      if (ast.op === '|=') {
        // paths come from the ORIGINAL input; updates apply sequentially to
        // the evolving document; an empty update DELETES the path (jq 1.7).
        // DESCENDING order keeps array indices valid as deletions shift them.
        const desc = [...paths].sort((a, b) => cmp(b as unknown as JVal, a as unknown as JVal));
        let cur = v;
        for (const p of desc) {
          const old = getPathVal(cur, p);
          let nv: JVal | undefined;
          for (const o of evalNode(ast.rhs, old, env)) {
            nv = o;
            break;
          }
          cur = nv === undefined ? delPathValue(cur, p) : setPathValue(cur, p, nv);
        }
        yield cur;
        return;
      }
      const opMap: Record<string, '+' | '-' | '*' | '/' | '%'> = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%' };
      const arithOp = opMap[ast.op];
      for (const rv of evalNode(ast.rhs, v, env)) {
        let cur = v;
        for (const p of paths) {
          const old = getPathVal(cur, p);
          cur = setPathValue(cur, p, arithOp !== undefined ? arith(arithOp, old, rv) : truthy(old) ? old : rv); // //=
        }
        yield cur;
      }
      return;
    }
    case 'loc':
      yield { file: '<top-level>', line: ast.line };
      return;
    case 'var':
      yield lookup(env, ast.name);
      return;
    case 'call': {
      const fn = findFn(env, ast.name, ast.args.length);
      if (fn !== null) {
        yield* callUser(fn, ast.args, v, env);
        return;
      }
      const blt = BUILTINS.get(`${ast.name}/${ast.args.length}`);
      if (blt === undefined) {
        const anyArity = [...BUILTINS.keys(), ...PRELUDE_KEYS].some((k) => k.startsWith(`${ast.name}/`));
        throw jqerr(ast.name, `${ast.name}/${ast.args.length} is not defined${anyArity ? ` (only ${ast.name} with a different arity exists)` : ''}`);
      }
      yield* blt(v, ast.args, env);
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
function* evalString(
  parts: Array<string | Ast>,
  i: number,
  acc: string,
  v: JVal,
  env: Env,
  hole: (out: JVal) => string,
): Generator<string> {
  if (i === parts.length) {
    yield acc;
    return;
  }
  const part = parts[i]!;
  if (typeof part === 'string') {
    yield* evalString(parts, i + 1, acc + part, v, env, hole);
    return;
  }
  for (const out of evalNode(part, v, env)) yield* evalString(parts, i + 1, acc + hole(out), v, env, hole);
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
 * can exit 3 like real jq instead of 5. Scopes are the AST's: an
 * `as`/`reduce`/`foreach` binding covers only its own body, a `def` is
 * visible in its body (recursion) and everything after it, `break` needs an
 * enclosing `label`.
 */
export function validateProgram(ast: Ast, defined: ReadonlySet<string>): string | null {
  let failure: string | null = null;
  const visit = (a: Ast, vars: ReadonlySet<string>, fns: ReadonlySet<string>, labels: ReadonlySet<string>): void => {
    if (failure !== null) return;
    switch (a.t) {
      case 'var':
        if (!vars.has(a.name)) failure = `$${a.name} is not defined`;
        return;
      case 'call': {
        const key = `${a.name}/${a.args.length}`;
        if (!fns.has(key) && !KNOWN_FNS.has(key)) {
          const near = [...KNOWN_FNS].find((k) => k.startsWith(`${a.name}/`));
          failure = `${key} is not defined${near !== undefined ? ` (did you mean ${near}?)` : ''}`;
        }
        for (const arg of a.args) visit(arg, vars, fns, labels);
        return;
      }
      case 'as': {
        visit(a.src, vars, fns, labels);
        const inner = new Set(vars);
        inner.add(a.name);
        visit(a.body, inner, fns, labels);
        return;
      }
      case 'reduce': {
        visit(a.src, vars, fns, labels);
        visit(a.init, vars, fns, labels);
        const inner = new Set(vars);
        inner.add(a.name);
        visit(a.update, inner, fns, labels);
        return;
      }
      case 'foreach': {
        visit(a.src, vars, fns, labels);
        visit(a.init, vars, fns, labels);
        const inner = new Set(vars);
        inner.add(a.name);
        visit(a.update, inner, fns, labels);
        if (a.extract !== null) visit(a.extract, inner, fns, labels);
        return;
      }
      case 'def': {
        const innerFns = new Set(fns);
        innerFns.add(`${a.name}/${a.params.length}`);
        const bodyVars = new Set(vars);
        const bodyFns = new Set(innerFns);
        for (const p of a.params) {
          if (p.dollar) bodyVars.add(p.name);
          else bodyFns.add(`${p.name}/0`); // filter params are callable in the body
        }
        visit(a.body, bodyVars, bodyFns, labels);
        visit(a.rest, vars, innerFns, labels);
        return;
      }
      case 'label': {
        const innerLabels = new Set(labels);
        innerLabels.add(a.name);
        visit(a.body, vars, fns, innerLabels);
        return;
      }
      case 'break':
        if (!labels.has(a.name)) failure = `$*${a.name} is not defined (break must be inside a matching label)`;
        return;
      case 'assign':
        visit(a.lhs, vars, fns, labels);
        visit(a.rhs, vars, fns, labels);
        return;
      case 'pipe':
      case 'comma':
      case 'alt':
      case 'or':
      case 'and':
      case 'binop':
        visit(a.l, vars, fns, labels);
        visit(a.r, vars, fns, labels);
        return;
      case 'try':
        visit(a.body, vars, fns, labels);
        if (a.catch_ !== null) visit(a.catch_, vars, fns, labels);
        return;
      case 'if':
        for (const c of a.clauses) {
          visit(c.cond, vars, fns, labels);
          visit(c.then, vars, fns, labels);
        }
        if (a.els !== null) visit(a.els, vars, fns, labels);
        return;
      case 'neg':
        visit(a.e, vars, fns, labels);
        return;
      case 'index':
        visit(a.key, vars, fns, labels);
        return;
      case 'slice':
        if (a.lo !== null) visit(a.lo, vars, fns, labels);
        if (a.hi !== null) visit(a.hi, vars, fns, labels);
        return;
      case 'array':
        if (a.body !== null) visit(a.body, vars, fns, labels);
        return;
      case 'object':
        for (const e of a.entries) {
          visit(e.key, vars, fns, labels);
          if (e.val !== null) visit(e.val, vars, fns, labels);
        }
        return;
      case 'str':
        for (const p of a.parts) if (typeof p !== 'string') visit(p, vars, fns, labels);
        return;
      case 'fmtnstr':
        for (const p of a.parts) if (typeof p !== 'string') visit(p, vars, fns, labels);
        return;
      default:
        return; // id, lit, loc, format — nothing to check
    }
  };
  visit(ast, defined, new Set(), new Set());
  return failure;
}

/* ── single-JSON parse (for fromjson; the CLI uses the scanner) ──────── */

function parseSingleJson(text: string): JVal {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('empty JSON text');
  return JSON.parse(trimmed) as JVal;
}

/** A single-value generator (for omitted slice bounds). */
function* single(x: JVal | null): Generator<JVal> {
  yield x;
}
