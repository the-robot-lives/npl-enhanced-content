/**
 * packages/jq/jq-re — regex support for the jq builtins (packages round 2).
 *
 * jq uses Oniguruma; we compile to JS RegExp. What translates cleanly:
 * `(?<name>…)` groups, `i`, and jq's flag set g/i/x/n/s/m/p. jq's `m`/`p`
 * mean "dot matches newline" (Onig MULTILINE) → JS `s` (dotAll); jq's `s`
 * is Onig SINGLELINE, already jq's default, so it is a no-op here; `^`/`$`
 * stay string-anchored (JS without `m`). `x` strips whitespace and
 * `#`-comments outside classes; `[[:posix:]]` classes translate. `\A \z \Z`
 * map to their string-anchor equivalents. Offsets are CODEPOINT offsets
 * (what jq reports), so astral input needs a cp-index map.
 *
 * Match/capture output follows jq 1.7: `{offset,length,string,captures}`,
 * non-participating captures are `{offset:-1,length:0,string:null}`, and an
 * empty match ADVANCES one codepoint (jq 1.7 fixed empty-match looping).
 */

import { jqerr, type JVal, type ObjV } from './jq-eval.js';

export interface JqRegex {
  re: RegExp;
  global: boolean;
  nonEmpty: boolean;
  /** Group name per capture number (index 1 = first group); null = unnamed. */
  names: Array<string | null>;
}

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'A-Za-z',
  digit: '0-9',
  alnum: '0-9A-Za-z',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\r\\n\\x0b\\f',
  blank: ' \\t',
  punct: '!-/:-@\\[-`{-~',
  cntrl: '\\x00-\\x1f\\x7f',
  xdigit: '0-9A-Fa-f',
  word: '\\w',
};

/** Replace `[[:name:]]` with the JS-range equivalent, verbatim otherwise. */
function translatePosix(pattern: string): string {
  return pattern.replace(/\[:(\w+):\]/g, (whole, name: string) => {
    const range = POSIX_CLASSES[name];
    return range ?? whole;
  });
}

/** jq's x flag: drop whitespace and #-comments outside character classes. */
function stripExtended(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      out += c + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      continue;
    }
    if (c === '#') {
      while (i < pattern.length && pattern[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    out += c;
  }
  return out;
}

/** Map `\A \z \Z` (Onig string anchors) onto JS `^ $`. */
function translateAnchors(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\' && (pattern[i + 1] === 'A' || pattern[i + 1] === 'z' || pattern[i + 1] === 'Z')) {
      out += pattern[i + 1] === 'A' ? '^' : '$';
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/** Capture-group numbering walk: names per group, unnamed groups included. */
function collectGroupNames(pattern: string): Array<string | null> {
  const names: Array<string | null> = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c !== '(') continue;
    const rest = pattern.slice(i + 1);
    if (rest.startsWith('?')) {
      if (/^\?<([A-Za-z_][A-Za-z0-9_]*)>/.test(rest)) {
        const m = /^\?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(rest)!;
        names.push(m[1]!);
        i += m[0].length;
        continue;
      }
      continue; // (?: (?= (?! (?<= (?<! — not capturing
    }
    names.push(null);
  }
  return names;
}

/**
 * Compile a jq regex. `pattern`/`flags` are JVal callers checked upstream;
 * invalid flag letters raise jq's "not a valid modifier string" error.
 */
export function compileRegex(pattern: string, flags: string | null): JqRegex {
  let jsFlags = 'ud';
  let global = false;
  let nonEmpty = false;
  for (const ch of flags ?? '') {
    if (ch === 'g') global = true;
    else if (ch === 'i') jsFlags += 'i';
    else if (ch === 'x') {
      /* handled below */
    } else if (ch === 'm' || ch === 'p') jsFlags += 's';
    else if (ch === 's') {
      /* Onig SINGLELINE — already the default anchor behaviour */
    } else if (ch === 'n') nonEmpty = true;
    else throw jqerr(flags, `${flags === null ? '' : flags} is not a valid modifier string`);
  }
  let src = translateAnchors(translatePosix(pattern));
  if ((flags ?? '').includes('x')) src = stripExtended(src);
  let re: RegExp;
  try {
    re = new RegExp(src, jsFlags);
  } catch (e) {
    throw jqerr(pattern, `"${pattern}" is not a valid regex: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}`);
  }
  return { re, global, nonEmpty, names: collectGroupNames(pattern) };
}

/** UTF-16 width of the codepoint at `i` (surrogate pairs are 2). */
function cpWidth(text: string, i: number): number {
  const c = text.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? 2 : 1;
}

/** Codepoint-index map for one string, built lazily from UTF-16 offsets. */
export class CpIndex {
  private readonly marks: number[] = [];
  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; ) {
      this.marks.push(i);
      i += cpWidth(text, i);
    }
    this.marks.push(text.length);
  }
  /** Codepoint offset of a UTF-16 offset. */
  cp(utf16: number): number {
    let lo = 0;
    let hi = this.marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.marks[mid]! <= utf16) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  /** Codepoint length of a slice given its UTF-16 start and length. */
  cpLen(utf16Start: number, utf16Len: number): number {
    return this.cp(utf16Start + utf16Len) - this.cp(utf16Start);
  }
}

export interface RawMatch {
  m: RegExpExecArray;
  cp: CpIndex;
}

/**
 * Iterate regex matches over `text`. Honours g (global), n (skip empty
 * matches) and the jq-1.7 empty-match rule: an empty match advances one
 * codepoint instead of looping.
 */
export function* matchIter(text: string, rx: JqRegex): Generator<RawMatch> {
  const re = new RegExp(rx.re.source, rx.re.flags + (rx.global ? 'g' : ''));
  let at = 0;
  for (;;) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (m === null) return;
    const cp = new CpIndex(text);
    if (m[0] === '' && rx.nonEmpty) {
      const next = m.index + cpWidth(text, m.index);
      if (next > text.length) return;
      at = next;
      continue;
    }
    yield { m, cp };
    if (!rx.global) return; // without g, jq's match/capture yield at most one match
    at = m[0] === '' ? m.index + cpWidth(text, m.index) : m.index + m[0].length;
    if (at > text.length) return;
  }
}

/** The {offset,length,string,captures} object jq's `match` emits. */
export function matchObject(text: string, raw: RawMatch, rx: JqRegex): ObjV {
  const { m, cp } = raw;
  const indices = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices;
  const captures: JVal[] = [];
  for (let g = 1; g < m.length; g++) {
    const span = indices?.[g];
    const value = m[g];
    if (value === undefined || !span) {
      captures.push({ offset: -1, length: 0, string: null, name: rx.names[g - 1] ?? null });
      continue;
    }
    captures.push({
      offset: cp.cp(span[0]),
      length: cp.cpLen(span[0], span[1] - span[0]),
      string: value,
      name: rx.names[g - 1] ?? null,
    });
  }
  return { offset: cp.cp(m.index), length: cp.cpLen(m.index, m[0].length), string: m[0], captures };
}

/** The object jq's `capture` emits: named groups only (missing → null). */
export function captureObject(raw: RawMatch, rx: JqRegex): ObjV {
  const { m, cp } = raw;
  const indices = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices;
  const out: ObjV = {};
  for (let g = 1; g < m.length; g++) {
    const name = rx.names[g - 1];
    if (name === undefined || name === null) continue;
    const span = indices?.[g];
    out[name] = m[g] === undefined || !span ? null : m[g];
  }
  void cp;
  return out;
}

/** True when the pattern declares at least one named group. */
export function hasNamedGroups(rx: JqRegex): boolean {
  return rx.names.some((n) => n !== null);
}

/** `split(re; flags)` / `splits` field boundaries (empty-match aware). */
export function regexSplit(text: string, rx: JqRegex): string[] {
  const g: JqRegex = { ...rx, global: true }; // jq splits on every match, g or not
  const out: string[] = [];
  let from = 0;
  for (const { m } of matchIter(text, g)) {
    out.push(text.slice(from, m.index));
    from = m.index + m[0].length;
  }
  out.push(text.slice(from));
  return out;
}
