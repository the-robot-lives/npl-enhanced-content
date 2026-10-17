/**
 * awk — the evaluator: values, fields, arrays, builtins, user functions,
 * control flow (LANE=pkg-awk, package `src/terminal/packages/awk/`).
 *
 * Values are `{v, sn}` cells: `v` is a number, string, or undefined
 * (uninitialized), `sn` marks numeric STRINGS (field/split/-v data) so
 * comparisons go numeric per POSIX. Scalars and arrays live in one name
 * space with kinds — mixing them is a fatal error, as in one-true-awk.
 * Control flow (`next`, `nextfile`, `break`, `exit`, `return`) rides tiny
 * signal objects; output redirection buffers per file and flushes to the
 * VFS when the program ends (or `close()` runs), matching awk's handle
 * semantics. Fatal runtime errors print `awk: <message>` and exit 2.
 */

import type { Vfs } from '../../vfs.js';
import type { AwkProgram, Expr, Stmt } from './awk-parse.js';
import { BUILTINS } from './awk-parse.js';

/* ------------------------------------------------------------------ *
 * errors + control signals
 * ------------------------------------------------------------------ */

/** Fatal runtime error — printed as `awk: <message>`, exit status 2. */
export class AwkFatal extends Error {}

class BreakSig {}
class ContinueSig {}
class NextSig {}
class NextfileSig {}
class ReturnSig {
  constructor(readonly value: Cell) {}
}
class ExitSig {
  constructor(readonly code: number | null) {}
}

/* ------------------------------------------------------------------ *
 * values
 * ------------------------------------------------------------------ */

export interface Cell {
  /** number | string | undefined (uninitialized). */
  v: number | string | undefined;
  /** Numeric string (from input fields / split / -v): compares numerically. */
  sn: boolean;
}

const NUM = (n: number): Cell => ({ v: n, sn: false });
const STR = (s: string): Cell => ({ v: s, sn: false });
const UNINIT: Cell = { v: undefined, sn: false };

type AwkArray = Map<string, Cell>;

const NUMERIC_RE = /^[ \t\n]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[ \t\n]*$/;
const HEX_RE = /^[ \t\n]*[+-]?0[xX][0-9a-fA-F]+[ \t\n]*$/;

function looksNumeric(s: string): boolean {
  return NUMERIC_RE.test(s) || HEX_RE.test(s);
}

/** strtod-style prefix parse — leading numeric run, junk ignored, junk-only → 0. */
function strToNum(s: string): number {
  const m = /^[ \t\n]*[+-]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isNaN(n) ? 0 : n;
}

/* ---- number → string formatting (%g / %d semantics) ---- */

function precisionFromFmt(fmt: string | undefined): number {
  if (fmt === undefined) return 6;
  const m = /^%[-+ 0#]*(\d+)?(?:\.\d+)?[eEfgG]$/.exec(fmt);
  if (!m) return 6;
  const p = m[1] === undefined ? 6 : Number(m[1]);
  return p >= 1 ? p : 1; // %g with precision 0 means 1
}

/** C `%.<prec>g`: mantissa zeros trimmed, e±NN with a two-digit exponent. */
function gFormat(n: number, prec: number): string {
  if (Number.isNaN(n)) return 'nan';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
  let s = n.toPrecision(prec);
  if (s.includes('e')) {
    let [m, e] = s.split('e') as [string, string];
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const en = parseInt(e, 10);
    const digits = Math.abs(en) < 10 ? '0' + Math.abs(en) : String(Math.abs(en));
    return `${m}e${en < 0 ? '-' : '+'}${digits}`;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Concatenation/print-of-a-number: integral stays plain, else CONVFMT (%.6g). */
function numToStrConv(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return gFormat(n, 6);
}

function toNumOf(c: Cell): number {
  const v = c.v;
  if (v === undefined) return 0;
  if (typeof v === 'number') return v;
  return strToNum(v);
}

function toStrOf(c: Cell): string {
  const v = c.v;
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return numToStrConv(v);
}

/** awk truth: nonzero number, or a string that is neither "" nor numeric-zero. */
function truthy(c: Cell): boolean {
  const v = c.v;
  if (v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (looksNumeric(v)) return strToNum(v) !== 0;
  return v !== '';
}

/** POSIX comparison: numeric when both sides can be numeric, else string. */
function compare(a: Cell, b: Cell): number {
  const aNum = a.v === undefined || typeof a.v === 'number' || a.sn;
  const bNum = b.v === undefined || typeof b.v === 'number' || b.sn;
  if (aNum && bNum) {
    const x = toNumOf(a);
    const y = toNumOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = toStrOf(a);
  const y = toStrOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * ERE → JS RegExp
 * ------------------------------------------------------------------ */

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', punct: '!-/:-@\\[-`{-~', xdigit: '0-9a-fA-F',
  blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
};

/** Translate POSIX bracket classes and `\/`; the rest passes to JS as-is. */
export function ereToJsSource(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\' && src[i + 1] === '/') {
      out += '/';
      i++;
      continue;
    }
    if (c === '[' && src[i + 1] === ':') {
      const end = src.indexOf(':]', i + 2);
      if (end !== -1) {
        const name = src.slice(i + 2, end);
        if (name in POSIX_CLASSES) {
          out += '[' + POSIX_CLASSES[name]! + ']';
          i = end + 1;
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}

function compileEre(src: string, global: boolean): RegExp {
  try {
    return new RegExp(ereToJsSource(src), global ? 'g' : '');
  } catch (cause) {
    throw new AwkFatal(`invalid regular expression /${src}/: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/* ------------------------------------------------------------------ *
 * record / field splitting
 * ------------------------------------------------------------------ */

/** Split file content into records under RS `rs` (captured at first read). */
export function splitRecords(content: string, rs: string): string[] {
  if (rs === '\n') {
    if (content === '') return [];
    const lines = content.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  if (rs === '') {
    // paragraph mode: leading/trailing blank lines ignored
    const trimmed = content.replace(/^[\n\r\f\v]+/, '').replace(/[\n\r\f\v]+$/, '');
    if (trimmed === '') return [];
    return trimmed.split(/\n[ \t\r\f\v]*(?:\n[ \t\r\f\v]*)+/);
  }
  if (rs.length === 1) {
    if (content === '') return [];
    const parts = content.split(rs);
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  // multi-char RS: gawk-style regular expression
  const re = compileEre(rs, true);
  const pieces: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    pieces.push(content.slice(last, m.index));
    last = re.lastIndex;
  }
  pieces.push(content.slice(last));
  if (pieces.length > 0 && pieces[pieces.length - 1] === '') pieces.pop();
  return pieces;
}

/** Split one record into fields under FS `fs` (the full FS semantics). */
export function splitFields(record: string, fs: string): string[] {
  if (fs === ' ') {
    const t = record.replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '');
    if (t === '') return [];
    return t.split(/[ \t\n]+/);
  }
  if (fs === '') return [...record]; // gawk: FS='' splits into characters
  if ([...fs].length === 1) {
    if (record === '') return [];
    return record.split(fs);
  }
  // regex FS: manual exec split (String.split would leak capture groups)
  const re = compileEre(fs, true);
  const fields: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(record)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    fields.push(record.slice(last, m.index));
    last = re.lastIndex;
  }
  fields.push(record.slice(last));
  return fields;
}

const fieldCell = (s: string): Cell => ({ v: s, sn: looksNumeric(s) });

/* ------------------------------------------------------------------ *
 * printf
 * ------------------------------------------------------------------ */

const INT64_MASK = (1n << 64n) - 1n;

/** The printf/sprintf engine: %[flags][width][.prec]conv over awk cells. */
export function awkSprintf(fmt: string, args: Cell[]): string {
  let out = '';
  let ai = 0;
  const nextArg = (): Cell => (ai < args.length ? args[ai++]! : UNINIT);
  const numArg = (): number => toNumOf(nextArg());
  const intOf = (n: number): bigint => {
    if (Number.isNaN(n)) return 0n;
    if (!Number.isFinite(n)) return n > 0 ? 9223372036854775807n : -9223372036854775808n;
    return BigInt(Math.trunc(n));
  };

  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]!;
    if (c !== '%') {
      out += c;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      continue;
    }
    let flags = '';
    while (fmt[i] !== undefined && '-+ 0#'.includes(fmt[i]!)) {
      flags += fmt[i]!;
      i++;
    }
    let width = 0;
    if (fmt[i] === '*') {
      width = Math.max(0, Math.trunc(numArg()));
      i++;
    } else {
      while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') {
        width = width * 10 + (fmt[i]!.charCodeAt(0) - 48);
        i++;
      }
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        prec = Math.max(0, Math.trunc(numArg()));
        i++;
      } else {
        prec = 0;
        while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') {
          prec = prec * 10 + (fmt[i]!.charCodeAt(0) - 48);
          i++;
        }
      }
    }
    const conv = fmt[i];
    if (conv === undefined) {
      out += '%';
      break;
    }
    let body: string;
    const pad: '-' | '0' | '' = flags.includes('-') ? '-' : flags.includes('0') ? '0' : '';
    const signed = (n: number, text: string): string =>
      (flags.includes('+') && n >= 0 ? '+' : flags.includes(' ') && n >= 0 ? ' ' : '') + text;
    switch (conv) {
      case 'd':
      case 'i': {
        const n = numArg();
        body = signed(n, (n < 0 ? '-' : '') + intOf(n).toString().replace('-', ''));
        break;
      }
      case 'u': {
        const n = numArg();
        body = (intOf(n) & INT64_MASK).toString();
        break;
      }
      case 'o': {
        const n = numArg();
        const raw = intOf(n);
        body = (flags.includes('#') && raw !== 0n ? '0' : '') + (raw & INT64_MASK).toString(8);
        break;
      }
      case 'x':
      case 'X': {
        const n = numArg();
        const raw = intOf(n);
        const digits = (raw & INT64_MASK).toString(16);
        const prefix = flags.includes('#') && raw !== 0n ? '0x' : '';
        body = prefix + (conv === 'X' ? digits.toUpperCase() : digits);
        break;
      }
      case 'c': {
        const a = nextArg();
        body = typeof a.v === 'number' ? String.fromCharCode(Math.abs(Math.trunc(a.v)) % 256) : toStrOf(a).charAt(0) || '';
        break;
      }
      case 's': {
        const s = toStrOf(nextArg());
        body = prec >= 0 ? s.slice(0, prec) : s;
        break;
      }
      case 'e':
      case 'E': {
        const n = numArg();
        body = n.toExponential(prec >= 0 ? prec : 6).replace(/e([+-])(\d)$/, 'e$10$2');
        if (conv === 'E') body = body.toUpperCase();
        body = signed(n, body);
        break;
      }
      case 'f':
      case 'F': {
        const n = numArg();
        body = signed(n, n.toFixed(prec >= 0 ? prec : 6));
        break;
      }
      case 'g':
      case 'G': {
        const n = numArg();
        body = signed(n, gFormat(n, prec >= 0 ? Math.max(prec, 1) : 6));
        if (conv === 'G') body = body.toUpperCase();
        break;
      }
      default:
        out += '%' + flags + (width ? String(width) : '') + (prec >= 0 ? '.' + prec : '') + conv;
        continue;
    }
    if (width > body.length) {
      if (pad === '-') body = body.padEnd(width, ' ');
      else if (pad === '0' && 'diuoxXeEfgG'.includes(conv)) {
        const sign = /^[+-]/.test(body) ? body[0]! : '';
        if (sign !== '') body = body.slice(1);
        const zeros = width - body.length - sign.length;
        body = sign + (zeros > 0 ? '0'.repeat(zeros) : '') + body;
      } else body = body.padStart(width, ' ');
    }
    out += body;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * input streams
 * ------------------------------------------------------------------ */

/** Records of one source under the RS frozen when the stream opens. */
class RecordStream {
  private records: string[] | null = null;
  private idx = 0;
  constructor(
    private readonly content: string,
    private readonly rs: string,
  ) {}
  next(): string | null {
    if (this.records === null) this.records = splitRecords(this.content, this.rs);
    return this.idx < this.records.length ? this.records[this.idx++]! : null;
  }
}

/* ------------------------------------------------------------------ *
 * the interpreter
 * ------------------------------------------------------------------ */

export interface AwkRunOpts {
  vfs: Vfs;
  cwd: string;
  /** Piped stdin text, or null when nothing is piped in. */
  stdin: string | null;
  /** File operands, already verified readable (the command wrapper checks). */
  files: string[];
  /** -v name=value assignments, applied before BEGIN (strnum-typed). */
  assigns: Array<[string, string]>;
  out(text: string): void;
  err(text: string): void;
}

const MAX_DEPTH = 800;

export function runProgram(program: AwkProgram, opts: AwkRunOpts): number {
  return new Interp(program, opts).run();
}

type Frame = { cells: Map<string, Cell>; arrays: Map<string, AwkArray> };
type MainItem = AwkProgram['items'][number];

class Interp {
  private readonly globals = new Map<string, Cell>();
  private readonly globalArrays = new Map<string, AwkArray>();
  private frames: Frame[] = [];
  private depth = 0;
  private status = 0;

  // fields
  private rec = '';
  private fields: Cell[] | null = null;
  private nfCell: Cell = NUM(0);
  private nr = 0;
  private fnr = 0;
  private filename = '';
  private rstart = 0;
  private rlength = -1;
  private subsep = '\x1c';

  // input / output
  private mainFeeder: (() => { rec: string; file: string } | null) | null = null;
  private inputHandles = new Map<string, RecordStream>();
  private outputHandles = new Map<string, { mode: '>' | '>>'; buf: string[] }>();

  // rand
  private randState = 1;
  private randSeed = 0;

  constructor(
    private readonly program: AwkProgram,
    private readonly opts: AwkRunOpts,
  ) {}

  /* ---------------- scope plumbing ---------------- */

  private scalarCell(name: string): Cell {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i]!;
      const got = frame.cells.get(name);
      if (got) return got;
      if (frame.arrays.has(name)) throw new AwkFatal(`attempt to use array '${name}' in a scalar context`);
    }
    const got = this.globals.get(name);
    if (got) return got;
    if (this.globalArrays.has(name)) throw new AwkFatal(`attempt to use array '${name}' in a scalar context`);
    const cell: Cell = { v: undefined, sn: false };
    const top = this.frames[this.frames.length - 1];
    if (top) top.cells.set(name, cell);
    else this.globals.set(name, cell);
    return cell;
  }

  private arrayFor(name: string): AwkArray {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i]!;
      const got = frame.arrays.get(name);
      if (got) return got;
      if (frame.cells.has(name)) throw new AwkFatal(`attempt to use scalar '${name}' as array`);
    }
    const got = this.globalArrays.get(name);
    if (got) return got;
    if (this.globals.has(name)) throw new AwkFatal(`attempt to use scalar '${name}' as array`);
    const arr: AwkArray = new Map();
    const top = this.frames[this.frames.length - 1];
    if (top) top.arrays.set(name, arr);
    else this.globalArrays.set(name, arr);
    return arr;
  }

  private isKnownArray(name: string): boolean {
    for (const frame of this.frames) {
      if (frame.arrays.has(name)) return true;
      if (frame.cells.has(name)) return false;
    }
    return this.globalArrays.has(name);
  }

  /* ---------------- special variables ---------------- */

  private specialGet(name: string): Cell | null {
    switch (name) {
      case 'NF':
        this.ensureFields(); // referencing NF splits the record, as in awk
        return this.nfCell;
      case 'NR': return NUM(this.nr);
      case 'FNR': return NUM(this.fnr);
      case 'FILENAME': return STR(this.filename);
      case 'RSTART': return NUM(this.rstart);
      case 'RLENGTH': return NUM(this.rlength);
      case 'SUBSEP': return STR(this.subsep);
      default: return null;
    }
  }

  private specialSet(name: string, value: Cell): boolean {
    switch (name) {
      case 'NF': {
        const n = Math.trunc(toNumOf(value));
        if (n < 0) throw new AwkFatal(`NF set to negative value ${n}`);
        this.ensureFields();
        while (this.fields!.length < n) this.fields!.push(UNINIT);
        this.fields!.length = n;
        this.nfCell = NUM(n);
        this.rebuildRecord();
        return true;
      }
      case 'NR': this.nr = Math.trunc(toNumOf(value)); return true;
      case 'FNR': this.fnr = Math.trunc(toNumOf(value)); return true;
      case 'FILENAME': this.filename = toStrOf(value); return true;
      case 'RSTART': this.rstart = Math.trunc(toNumOf(value)); return true;
      case 'RLENGTH': this.rlength = Math.trunc(toNumOf(value)); return true;
      case 'SUBSEP': this.subsep = toStrOf(value); return true;
      default: return false;
    }
  }

  /* ---------------- fields ---------------- */

  private globalStr(name: string, fallback: string): string {
    const cell = this.globals.get(name);
    return cell && cell.v !== undefined ? toStrOf(cell) : fallback;
  }

  private currentFs(): string {
    return this.globalStr('FS', ' ');
  }
  private currentOfs(): string {
    return this.globalStr('OFS', ' ');
  }
  private currentOrs(): string {
    return this.globalStr('ORS', '\n');
  }
  private currentRs(): string {
    return this.globalStr('RS', '\n');
  }

  private ensureFields(): void {
    if (this.fields === null) {
      this.fields = splitFields(this.rec, this.currentFs()).map(fieldCell);
      this.nfCell = NUM(this.fields.length);
    }
  }

  private invalidateFields(): void {
    this.fields = null;
    this.nfCell = NUM(0);
  }

  private rebuildRecord(): void {
    this.rec = this.fields!.map((f) => toStrOf(f)).join(this.currentOfs());
  }

  private getField(i: number): Cell {
    if (i === 0) return STR(this.rec);
    if (i < 0) return UNINIT;
    this.ensureFields();
    return this.fields![i - 1] ?? UNINIT;
  }

  private setField(i: number, value: Cell): void {
    if (i === 0) {
      this.rec = toStrOf(value);
      this.invalidateFields();
      return;
    }
    if (i < 0) throw new AwkFatal(`attempt to access field ${i}`);
    this.ensureFields();
    while (this.fields!.length < i) this.fields!.push(UNINIT);
    this.fields![i - 1] = value;
    this.nfCell = NUM(this.fields!.length);
    this.rebuildRecord();
  }

  private setRecord(text: string): void {
    this.rec = text;
    this.invalidateFields();
  }

  /** Advance record state (fields lazily split; FNR keyed on file change). */
  private consumeRecord(text: string, file: string): void {
    this.setRecord(text);
    this.fnr = file === this.filename ? this.fnr + 1 : 1;
    this.filename = file;
    this.nr++;
  }

  /* ---------------- arrays ---------------- */

  private arrayKey(args: Cell[]): string {
    return args.map((c) => toStrOf(c)).join(this.subsep);
  }

  /* ---------------- expression evaluation ---------------- */

  private eval(node: Expr): Cell {
    switch (node.k) {
      case 'num': return NUM(node.v);
      case 'str': return STR(node.v);
      case 'ere':
        // a bare /re/ in expression position: match against $0 → 1/0
        return NUM(compileEre(node.src, false).test(this.rec) ? 1 : 0);
      case 'var': {
        const special = this.specialGet(node.name);
        if (special) return special;
        return this.scalarCell(node.name);
      }
      case 'index': {
        const arr = this.arrayFor(node.name);
        const key = this.arrayKey(node.args.map((a) => this.eval(a)));
        // referencing a subscript creates it (gawk/one-true-awk behaviour)
        let cell = arr.get(key);
        if (!cell) {
          cell = { v: undefined, sn: false };
          arr.set(key, cell);
        }
        return cell;
      }
      case 'field': {
        const i = Math.trunc(toNumOf(this.eval(node.e)));
        return this.getField(i);
      }
      case 'call':
        return BUILTINS.has(node.name) ? this.callBuiltin(node) : this.callUser(node);
      case 'assign': return this.evalAssign(node);
      case 'ternary': return truthy(this.eval(node.c)) ? this.eval(node.a) : this.eval(node.b);
      case 'logic': {
        const a = truthy(this.eval(node.a));
        const b = node.op === '&&' ? a && truthy(this.eval(node.b)) : a || truthy(this.eval(node.b));
        return NUM(b ? 1 : 0);
      }
      case 'in': {
        const arr = this.arrayFor(node.name);
        const key = this.arrayKey(node.args.map((a) => this.eval(a)));
        return NUM(arr.has(key) ? 1 : 0);
      }
      case 'match': {
        const lhs = this.eval(node.a);
        const rhs = node.b;
        const re = rhs.k === 'ere' ? compileEre(rhs.src, false) : compileEre(toStrOf(this.eval(rhs)), false);
        const hit = re.test(toStrOf(lhs));
        return NUM(hit === !node.neg ? 1 : 0);
      }
      case 'cmp': {
        const r = compare(this.eval(node.a), this.eval(node.b));
        const hit =
          node.op === '<' ? r < 0 : node.op === '<=' ? r <= 0 : node.op === '>' ? r > 0
            : node.op === '>=' ? r >= 0 : node.op === '==' ? r === 0 : r !== 0;
        return NUM(hit ? 1 : 0);
      }
      case 'cat': return STR(toStrOf(this.eval(node.a)) + toStrOf(this.eval(node.b)));
      case 'bin': return this.evalBin(node);
      case 'neg': {
        const e = this.eval(node.e);
        if (node.op === '!') return NUM(truthy(e) ? 0 : 1);
        const n = toNumOf(e);
        return NUM(node.op === '-' ? -n : +n);
      }
      case 'pre': {
        const v = toNumOf(this.eval(node.e)) + (node.op === '++' ? 1 : -1);
        this.setLvalue(node.e, NUM(v));
        return NUM(v);
      }
      case 'post': {
        const old = toNumOf(this.eval(node.e));
        this.setLvalue(node.e, NUM(old + (node.op === '++' ? 1 : -1)));
        return NUM(old);
      }
      case 'group': {
        if (node.exprs.length !== 1) throw new AwkFatal('syntax error: (expr, expr) is only valid with `in`');
        return this.eval(node.exprs[0]!);
      }
      case 'getline': return this.evalGetline(node);
    }
  }

  private evalBin(node: Extract<Expr, { k: 'bin' }>): Cell {
    const a = toNumOf(this.eval(node.a));
    const b = toNumOf(this.eval(node.b));
    switch (node.op) {
      case '+': return NUM(a + b);
      case '-': return NUM(a - b);
      case '*': return NUM(a * b);
      case '/':
        if (b === 0) throw new AwkFatal('division by zero');
        return NUM(a / b);
      case '%':
        if (b === 0) throw new AwkFatal('division by zero in %');
        return NUM(a % b);
      case '^': return NUM(Math.pow(a, b));
    }
  }

  private evalAssign(node: Extract<Expr, { k: 'assign' }>): Cell {
    if (node.op === '=') {
      const value = this.eval(node.src);
      this.setLvalue(node.target, value);
      return value;
    }
    const cur = toNumOf(this.eval(node.target));
    const rhs = toNumOf(this.eval(node.src));
    let result: number;
    switch (node.op) {
      case '+=': result = cur + rhs; break;
      case '-=': result = cur - rhs; break;
      case '*=': result = cur * rhs; break;
      case '/=':
        if (rhs === 0) throw new AwkFatal('division by zero');
        result = cur / rhs;
        break;
      case '%=':
        if (rhs === 0) throw new AwkFatal('division by zero in %=');
        result = cur % rhs;
        break;
      case '^=': result = Math.pow(cur, rhs); break;
      default: throw new AwkFatal(`unknown assignment operator ${node.op}`);
    }
    const cell = NUM(result);
    this.setLvalue(node.target, cell);
    return cell;
  }

  private setLvalue(node: Expr, value: Cell): void {
    switch (node.k) {
      case 'var': {
        if (this.specialSet(node.name, value)) return;
        if (this.isKnownArray(node.name)) throw new AwkFatal(`attempt to use array '${node.name}' in a scalar context`);
        const cell = this.scalarCell(node.name);
        cell.v = value.v;
        cell.sn = value.sn;
        return;
      }
      case 'index': {
        const arr = this.arrayFor(node.name);
        const key = this.arrayKey(node.args.map((a) => this.eval(a)));
        arr.set(key, value);
        return;
      }
      case 'field': {
        const i = Math.trunc(toNumOf(this.eval(node.e)));
        this.setField(i, value);
        return;
      }
      default:
        throw new AwkFatal('assignment to a non-lvalue');
    }
  }

  /* ---------------- user functions ---------------- */

  private callUser(node: Extract<Expr, { k: 'call' }>): Cell {
    const fn = this.program.functions.get(node.name);
    if (!fn) throw new AwkFatal(`calling undefined function ${node.name}`);
    if (this.depth >= MAX_DEPTH) throw new AwkFatal(`function call nesting too deep at '${node.name}'`);
    // arguments evaluate in the caller's scope (array args pass by reference)
    const bindings: Array<{ name: string; cell?: Cell; arr?: AwkArray }> = [];
    for (let i = 0; i < fn.params.length; i++) {
      const pname = fn.params[i]!;
      const arg = node.args[i];
      if (arg === undefined) {
        bindings.push({ name: pname, cell: { v: undefined, sn: false } }); // spare params are locals
        continue;
      }
      if (arg.k === 'var' && this.isKnownArray(arg.name)) {
        bindings.push({ name: pname, arr: this.arrayFor(arg.name) });
      } else {
        // scalars pass BY VALUE — copy the cell so the caller's variable is untouched
        const got = this.eval(arg);
        bindings.push({ name: pname, cell: { v: got.v, sn: got.sn } });
      }
    }
    const frame: Frame = { cells: new Map(), arrays: new Map() };
    for (const b of bindings) {
      if (b.arr) frame.arrays.set(b.name, b.arr);
      else frame.cells.set(b.name, b.cell!);
    }
    this.frames.push(frame);
    this.depth++;
    try {
      this.execBody(fn.body);
      return UNINIT;
    } catch (signal) {
      if (signal instanceof ReturnSig) return signal.value;
      throw signal;
    } finally {
      this.depth--;
      this.frames.pop();
    }
  }

  /* ---------------- getline ---------------- */

  private evalGetline(node: Extract<Expr, { k: 'getline' }>): Cell {
    let record: string | null;
    let file: string;
    if (node.file !== null) {
      const path = this.opts.vfs.resolve(this.opts.cwd, toStrOf(this.eval(node.file)));
      let stream = this.inputHandles.get(path);
      if (!stream) {
        const content = this.opts.vfs.read(path);
        if (content === null) return NUM(-1); // awk convention: -1 = error, silent
        stream = new RecordStream(content, this.currentRs());
        this.inputHandles.set(path, stream);
      }
      record = stream.next();
      file = path;
    } else {
      const got = this.nextMainRecord();
      if (got === null) return NUM(0);
      record = got.rec;
      file = got.file;
    }
    if (record === null) return NUM(0);
    this.consumeRecord(record, file);
    if (node.target !== null) {
      this.setLvalue(node.target, fieldCell(this.rec));
    }
    return NUM(1);
  }

  /** The shared main input stream — the record loop and getline both draw it. */
  private nextMainRecord(): { rec: string; file: string } | null {
    if (this.mainFeeder === null) this.mainFeeder = this.makeMainFeeder();
    return this.mainFeeder();
  }

  private makeMainFeeder(): () => { rec: string; file: string } | null {
    const rs = this.currentRs();
    const sources: Array<{ content: string; file: string }> = this.opts.files.map((file) => {
      if (file === '-') return { content: this.opts.stdin ?? '', file: '-' };
      const path = this.opts.vfs.resolve(this.opts.cwd, file);
      return { content: this.opts.vfs.read(path) ?? '', file: path };
    });
    if (sources.length === 0 && this.opts.stdin !== null) {
      sources.push({ content: this.opts.stdin, file: '-' });
    }
    const streams = sources.map((s) => ({ stream: new RecordStream(s.content, rs), file: s.file }));
    let si = 0;
    return (): { rec: string; file: string } | null => {
      while (si < streams.length) {
        const rec = streams[si]!.stream.next();
        if (rec !== null) return { rec, file: streams[si]!.file };
        si++;
      }
      return null;
    };
  }

  /* ---------------- builtins ---------------- */

  private callBuiltin(node: Extract<Expr, { k: 'call' }>): Cell {
    const args = node.args;
    switch (node.name) {
      case 'length': {
        if (args.length === 0) return NUM([...this.rec].length);
        const first = args[0]!;
        if (first.k === 'var' && this.isKnownArray(first.name)) return NUM(this.arrayFor(first.name).size);
        return NUM([...toStrOf(this.eval(first))].length);
      }
      case 'substr': {
        const chars = [...toStrOf(this.eval(args[0]!))];
        const m = Math.trunc(toNumOf(this.eval(args[1]!)));
        if (args.length < 3) return STR(m < 1 ? chars.join('') : chars.slice(m - 1).join(''));
        const n = Math.trunc(toNumOf(this.eval(args[2]!)));
        if (n <= 0) return STR('');
        const start = Math.max(m, 1);
        const end = m + n; // chars before position 1 count toward n (POSIX)
        return STR(chars.slice(start - 1, end - 1).join(''));
      }
      case 'index': {
        const s = toStrOf(this.eval(args[0]!));
        const t = toStrOf(this.eval(args[1]!));
        if (t === '') return NUM(1);
        const idx = s.indexOf(t);
        return NUM(idx === -1 ? 0 : idx + 1);
      }
      case 'split': return this.builtinSplit(args);
      case 'sub':
      case 'gsub': return this.builtinSub(node.name === 'gsub', args);
      case 'match': {
        const s = toStrOf(this.eval(args[0]!));
        const reArg = args[1]!;
        const re = reArg.k === 'ere' ? compileEre(reArg.src, false) : compileEre(toStrOf(this.eval(reArg)), false);
        const m = re.exec(s);
        if (m === null) {
          this.rstart = 0;
          this.rlength = -1;
          return NUM(0);
        }
        this.rstart = m.index + 1;
        this.rlength = m[0].length;
        return NUM(this.rstart);
      }
      case 'sprintf': {
        const fmt = toStrOf(this.eval(args[0]!));
        return STR(awkSprintf(fmt, args.slice(1).map((a) => this.eval(a))));
      }
      case 'tolower': return STR(toStrOf(this.eval(args[0]!)).toLowerCase());
      case 'toupper': return STR(toStrOf(this.eval(args[0]!)).toUpperCase());
      case 'sin': return NUM(Math.sin(toNumOf(this.eval(args[0]!))));
      case 'cos': return NUM(Math.cos(toNumOf(this.eval(args[0]!))));
      case 'atan2': return NUM(Math.atan2(toNumOf(this.eval(args[0]!)), toNumOf(this.eval(args[1]!))));
      case 'exp': return NUM(Math.exp(toNumOf(this.eval(args[0]!))));
      case 'log': return NUM(Math.log(toNumOf(this.eval(args[0]!))));
      case 'sqrt': return NUM(Math.sqrt(toNumOf(this.eval(args[0]!))));
      case 'int': return NUM(Math.trunc(toNumOf(this.eval(args[0]!))));
      case 'rand': return NUM(this.nextRand());
      case 'srand': {
        const prev = this.randSeed;
        const seed = args.length === 0 ? Math.floor(Date.now() / 1000) : Math.trunc(toNumOf(this.eval(args[0]!)));
        this.randSeed = seed;
        this.randState = Math.abs(seed) % 2147483646 + 1;
        return NUM(prev);
      }
      case 'close': {
        const path = this.opts.vfs.resolve(this.opts.cwd, toStrOf(this.eval(args[0]!)));
        const out = this.outputHandles.get(path);
        if (out) {
          this.flushHandle(path, out);
          this.outputHandles.delete(path);
          return NUM(0);
        }
        if (this.inputHandles.has(path)) {
          this.inputHandles.delete(path);
          return NUM(0);
        }
        return NUM(-1);
      }
      case 'fflush': {
        for (const [path, handle] of this.outputHandles) this.flushHandle(path, handle);
        return NUM(0);
      }
      case 'system':
        throw new AwkFatal('system() is not supported by this awk');
      default:
        throw new AwkFatal(`calling undefined function ${node.name}`);
    }
  }

  /** classic C-rand LCG — deterministic after srand(n), per POSIX rand semantics */
  private nextRand(): number {
    this.randState = (Math.imul(1103515245, this.randState) + 12345) & 0x7fffffff;
    if (this.randState < 0) this.randState += 0x80000000;
    return this.randState / 0x80000000;
  }

  private builtinSplit(args: Expr[]): Cell {
    const s = toStrOf(this.eval(args[0]!));
    const target = args[1]!;
    if (target.k !== 'var' && target.k !== 'index') {
      throw new AwkFatal('split: second argument must be an array');
    }
    const arr = this.arrayFor(target.name);
    arr.clear();
    if (s === '') return NUM(0);
    // the FS argument may be a regex LITERAL (use its source, not a $0 match)
    const fsNode = args.length >= 3 ? args[2]! : null;
    const fs =
      fsNode === null ? this.currentFs() : fsNode.k === 'ere' ? fsNode.src : toStrOf(this.eval(fsNode));
    const parts = splitFields(s, fs);
    for (let i = 0; i < parts.length; i++) arr.set(String(i + 1), fieldCell(parts[i]!));
    return NUM(parts.length);
  }

  private builtinSub(global: boolean, args: Expr[]): Cell {
    if (args.length < 2) throw new AwkFatal('sub/gsub needs a pattern and a replacement');
    const targetNode: Expr = args.length >= 3 ? args[2]! : { k: 'field', e: { k: 'num', v: 0 } };
    const original = toStrOf(this.eval(targetNode));
    const reArg = args[0]!;
    const re = reArg.k === 'ere' ? compileEre(reArg.src, true) : compileEre(toStrOf(this.eval(reArg)), true);
    const replText = toStrOf(this.eval(args[1]!));
    re.lastIndex = 0;
    let out = '';
    let last = 0;
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(original)) !== null) {
      count++;
      out += original.slice(last, m.index) + this.expandRepl(replText, m);
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
      if (!global) break;
    }
    if (count === 0) return NUM(0);
    this.setLvalue(targetNode, STR(out + original.slice(last)));
    return NUM(global ? count : 1);
  }

  /** awk replacement text: `&` is the match; `\&`, `\\`, `\n`, `\t` escape. */
  private expandRepl(repl: string, m: RegExpExecArray): string {
    let out = '';
    for (let i = 0; i < repl.length; i++) {
      const c = repl[i]!;
      if (c === '\\' && i + 1 < repl.length) {
        const n = repl[++i]!;
        out += n === '&' ? '&' : n === '\\' ? '\\' : n === 'n' ? '\n' : n === 't' ? '\t' : n;
        continue;
      }
      out += c === '&' ? m[0] : c;
    }
    return out;
  }

  /* ---------------- statements ---------------- */

  private execBody(body: Stmt[]): void {
    for (const stmt of body) this.execStmt(stmt);
  }

  private execStmt(stmt: Stmt): void {
    switch (stmt.k) {
      case 'block': this.execBody(stmt.body); return;
      case 'print': this.doPrint(stmt.args, stmt.redir, 'print'); return;
      case 'printf': this.doPrint(stmt.args, stmt.redir, 'printf'); return;
      case 'if':
        if (truthy(this.eval(stmt.c))) this.execStmt(stmt.a);
        else if (stmt.b !== null) this.execStmt(stmt.b);
        return;
      case 'while':
        while (truthy(this.eval(stmt.c))) {
          try {
            this.execStmt(stmt.body);
          } catch (signal) {
            if (signal instanceof BreakSig) break;
            if (!(signal instanceof ContinueSig)) throw signal;
          }
        }
        return;
      case 'do':
        for (;;) {
          try {
            this.execStmt(stmt.body);
          } catch (signal) {
            if (signal instanceof BreakSig) break;
            if (!(signal instanceof ContinueSig)) throw signal;
          }
          if (!truthy(this.eval(stmt.c))) break;
        }
        return;
      case 'forC': {
        if (stmt.init !== null) this.eval(stmt.init);
        for (;;) {
          if (stmt.cond !== null && !truthy(this.eval(stmt.cond))) break;
          try {
            this.execStmt(stmt.body);
          } catch (signal) {
            if (signal instanceof BreakSig) break;
            if (!(signal instanceof ContinueSig)) throw signal;
          }
          if (stmt.step !== null) this.eval(stmt.step);
        }
        return;
      }
      case 'forIn': {
        const arr = this.arrayFor(stmt.arr);
        for (const key of [...arr.keys()]) {
          this.setNamedScalar(stmt.name, STR(key));
          try {
            this.execStmt(stmt.body);
          } catch (signal) {
            if (signal instanceof BreakSig) break;
            if (!(signal instanceof ContinueSig)) throw signal;
          }
        }
        return;
      }
      case 'break': throw new BreakSig();
      case 'continue': throw new ContinueSig();
      case 'next': throw new NextSig();
      case 'nextfile': throw new NextfileSig();
      case 'exit':
        throw new ExitSig(stmt.e === null ? null : Math.trunc(toNumOf(this.eval(stmt.e))));
      case 'return':
        throw new ReturnSig(stmt.e === null ? UNINIT : this.eval(stmt.e));
      case 'delete': {
        const arr = this.arrayFor(stmt.name);
        if (stmt.args === null) arr.clear();
        else arr.delete(this.arrayKey(stmt.args.map((a) => this.eval(a))));
        return;
      }
      case 'expr': this.eval(stmt.e); return;
    }
  }

  private setNamedScalar(name: string, value: Cell): void {
    if (this.isKnownArray(name)) throw new AwkFatal(`attempt to use array '${name}' in a scalar context`);
    const cell = this.scalarCell(name);
    cell.v = value.v;
    cell.sn = value.sn;
  }

  private doPrint(args: Expr[], redir: { op: '>' | '>>'; target: Expr } | null, kind: 'print' | 'printf'): void {
    let text: string;
    if (kind === 'printf') {
      if (args.length === 0) throw new AwkFatal('printf: no format string');
      const fmt = toStrOf(this.eval(args[0]!));
      text = awkSprintf(fmt, args.slice(1).map((a) => this.eval(a)));
    } else {
      text = args.map((a) => this.display(this.eval(a))).join(this.currentOfs()) + this.currentOrs();
    }
    if (redir === null) {
      this.opts.out(text);
      return;
    }
    const path = this.opts.vfs.resolve(this.opts.cwd, toStrOf(this.eval(redir.target)));
    let handle = this.outputHandles.get(path);
    if (!handle) {
      // `>>` on a fresh handle starts from the file's current content
      const seeded = redir.op === '>>' ? this.opts.vfs.read(path) ?? '' : '';
      handle = { mode: redir.op, buf: seeded === '' ? [] : [seeded] };
      this.outputHandles.set(path, handle);
    }
    handle.buf.push(text);
  }

  /** print's number form: OFMT for non-integral values (the POSIX print rule). */
  private display(c: Cell): string {
    if (typeof c.v === 'number' && !Number.isInteger(c.v)) {
      const cell = this.globals.get('OFMT');
      const prec = precisionFromFmt(cell && typeof cell.v === 'string' ? cell.v : undefined);
      return gFormat(c.v, prec);
    }
    return toStrOf(c);
  }

  private flushHandle(path: string, handle: { buf: string[] }): void {
    if (handle.buf.length === 0) return;
    const content = handle.buf.join('');
    handle.buf = [];
    try {
      this.opts.vfs.mountFile(path, content);
    } catch (cause) {
      throw new AwkFatal(`can't write to ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /* ---------------- the run ---------------- */

  run(): number {
    const { begins, mains, ends } = partitionItems(this.program);
    try {
      // -v assignments before BEGIN (strnum-typed like input data)
      for (const [name, raw] of this.opts.assigns) this.setNamedScalar(name, fieldCell(raw));
      for (const [name, fallback] of [
        ['FS', ' '], ['OFS', ' '], ['ORS', '\n'], ['RS', '\n'], ['SUBSEP', this.subsep],
        ['CONVFMT', '%.6g'], ['OFMT', '%.6g'],
      ] as const) {
        if (!this.globals.has(name)) this.globals.set(name, STR(fallback));
      }
      for (const item of begins) this.execBody(item.body);
      if (mains.length > 0) {
        if (this.opts.files.length === 0 && this.opts.stdin === null) {
          // gawk still runs END when there is nothing to read — so do we
          this.opts.err('awk: no input (pipe one in, or name a file)');
          this.runEnds(ends);
          this.flushAll();
          return 1;
        }
        this.runMain(mains);
      }
    } catch (signal) {
      if (signal instanceof ExitSig) {
        if (signal.code !== null) this.status = signal.code;
        this.runEnds(ends);
        this.flushAll();
        return this.status;
      }
      if (signal instanceof AwkFatal) {
        this.opts.err(`awk: ${signal.message}`);
        this.flushAll();
        return 2;
      }
      if (signal instanceof ReturnSig) throw new AwkFatal('return used outside of a function');
      if (signal instanceof NextSig) throw new AwkFatal('next used in BEGIN action');
      if (signal instanceof NextfileSig) throw new AwkFatal('nextfile used in BEGIN action');
      if (signal instanceof BreakSig || signal instanceof ContinueSig) {
        throw new AwkFatal('break/continue used outside of a loop');
      }
      throw signal;
    }
    this.runEnds(ends);
    this.flushAll();
    return this.status;
  }

  private runEnds(ends: MainItem[]): void {
    try {
      for (const item of ends) this.execBody(item.body);
    } catch (signal) {
      if (signal instanceof ExitSig) {
        if (signal.code !== null) this.status = signal.code;
        return;
      }
      if (signal instanceof AwkFatal) {
        this.opts.err(`awk: ${signal.message}`);
        this.status = 2;
        return;
      }
      if (signal instanceof NextSig) throw new AwkFatal('next used in END action');
      if (signal instanceof NextfileSig) throw new AwkFatal('nextfile used in END action');
      throw signal;
    }
  }

  private flushAll(): void {
    for (const [path, handle] of this.outputHandles) this.flushHandle(path, handle);
  }

  private runMain(mains: MainItem[]): void {
    if (this.mainFeeder === null) this.mainFeeder = this.makeMainFeeder();
    const feeder = this.mainFeeder;
    let pending = feeder();
    while (pending !== null) {
      const { rec, file } = pending;
      this.consumeRecord(rec, file);
      try {
        for (const item of mains) {
          if (item.pattern === null || truthy(this.eval(item.pattern))) {
            if (item.body.length === 0) this.opts.out(this.display(STR(this.rec)) + this.currentOrs());
            else this.execBody(item.body);
          }
        }
      } catch (signal) {
        if (signal instanceof NextSig) {
          pending = feeder();
          continue;
        }
        if (signal instanceof NextfileSig) {
          // skip the rest of THIS file; the first record of the next one is processed
          do {
            pending = feeder();
          } while (pending !== null && pending.file === file);
          continue;
        }
        throw signal;
      }
      pending = feeder();
    }
  }
}

function partitionItems(program: AwkProgram): {
  begins: MainItem[];
  mains: MainItem[];
  ends: MainItem[];
} {
  const begins: MainItem[] = [];
  const mains: MainItem[] = [];
  const ends: MainItem[] = [];
  for (const item of program.items) {
    if (item.kind === 'BEGIN') begins.push(item);
    else if (item.kind === 'END') ends.push(item);
    else mains.push(item);
  }
  return { begins, mains, ends };
}
