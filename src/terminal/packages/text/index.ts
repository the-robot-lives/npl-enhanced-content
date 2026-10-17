/**
 * packages/text — the real text-tool implementations (round-4 LANE=pkg-text).
 *
 * This module is the package CHUNK: dynamic-imported by ./stub.ts on first
 * use, never part of the base shell bundle. Reference behaviour is GNU
 * coreutils / GNU grep; where the emulation knowingly differs the man page
 * below says so. Output is one line per ctx.out(); exit statuses are the
 * GNU ones (explicit ctx.exit wins over the runner's stderr default).
 *
 * Supersedes the posix plugin's simpler grep/wc/head/tail when the package
 * is mounted (see stub.ts — package-supersedes-base).
 *
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import { textStub } from './stub.js';

/* ------------------------------------------------------------------ *
 * shared helpers (chunk-local; candidates for the package contract)
 * ------------------------------------------------------------------ */

const usageOf = (name: string): string => textStub.commands.find((c) => c.name === name)!.usage;

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.slice(0, -1) : lines;
}

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
const charList = (text: string): string[] => [...text];

/**
 * Split clustered short flags. Value-taking letters keep their attached
 * value (`-k2,3` → ['-k','2,3']); others explode (`-ru` → ['-r','-u']).
 * `-`, `--`, `--long`, negative/numeric shorts (`-10`, the head/tail
 * legacy form) and everything after `--` pass through verbatim.
 */
function splitArgs(args: string[], valueLetters: string): string[] {
  const out: string[] = [];
  let endOfFlags = false;
  for (const a of args) {
    if (endOfFlags || a.length <= 2 || a[0] !== '-' || a[1] === '-' || /^-\d+$/.test(a)) {
      if (a === '--' && !endOfFlags) endOfFlags = true;
      out.push(a);
      continue;
    }
    if (valueLetters.includes(a[1]!)) {
      out.push('-' + a[1]!, a.slice(2));
    } else {
      for (const ch of a.slice(1)) out.push('-' + ch);
    }
  }
  return out;
}

interface Source {
  label: string | null;
  text: string;
}

/**
 * Read file operands (or piped stdin) GNU-cat style: `-` is stdin, several
 * files concatenate with labels kept for prefixing commands. Missing files
 * report `${cmd}: arg: No such file or directory` and are skipped; returns
 * null only when there is no input at all.
 */
function readSources(
  ctx: CommandContext,
  cmd: string,
  operands: string[],
  noInputCode = 1,
): Source[] | null {
  const sources: Source[] = [];
  let failed = false;
  if (operands.length === 0) {
    if (ctx.stdin === null) {
      ctx.err(`${cmd}: no input (pipe one in, or name a file)`);
      ctx.exit(noInputCode);
      return null;
    }
    sources.push({ label: null, text: ctx.stdin });
    return sources;
  }
  for (const arg of operands) {
    if (arg === '-') {
      sources.push({ label: null, text: ctx.stdin ?? '' });
      continue;
    }
    const path = ctx.vfs.resolve(ctx.state.cwd, arg);
    const node = ctx.vfs.nodeAt(path);
    if (!node) {
      ctx.err(`${cmd}: ${arg}: No such file or directory`);
      failed = true;
      continue;
    }
    if (node.kind === 'dir') {
      ctx.err(`${cmd}: ${arg}: Is a directory`);
      failed = true;
      continue;
    }
    sources.push({ label: arg, text: node.content });
  }
  if (failed) ctx.exit(1);
  return sources;
}

/** `1`-based comma list of N, N-, -M, N-M → sorted inclusive ranges. */
function parseRanges(spec: string): Array<[number, number]> | string {
  if (spec === '') return 'empty list';
  const ranges: Array<[number, number]> = [];
  for (const part of spec.split(',')) {
    let m = /^(\d+)$/.exec(part);
    if (m) {
      const n = Number(m[1]);
      if (n < 1) return part;
      ranges.push([n, n]);
      continue;
    }
    m = /^(\d+)-$/.exec(part);
    if (m) {
      const n = Number(m[1]);
      if (n < 1) return part;
      ranges.push([n, Infinity]);
      continue;
    }
    m = /^-(\d+)$/.exec(part);
    if (m) {
      const n = Number(m[1]);
      if (n < 1) return part;
      ranges.push([1, n]);
      continue;
    }
    m = /^(\d+)-(\d+)$/.exec(part);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 1 || b < a) return part;
      ranges.push([a, b]);
      continue;
    }
    return part;
  }
  ranges.sort((x, y) => x[0] - y[0]);
  return ranges;
}

const inRanges = (ranges: Array<[number, number]>, n: number): boolean =>
  ranges.some(([a, b]) => n >= a && n <= b);

/** Translate `\t \n \r \\ \a \b \f \v` escapes in a delimiter/set argument. */
function unescapeDelim(s: string): string {
  if (!s.includes('\\')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) {
      out += s[i];
      continue;
    }
    const e = s[++i]!;
    out += e === 't' ? '\t' : e === 'n' ? '\n' : e === 'r' ? '\r' : e === 'a' ? '\x07' : e === 'b' ? '\b' : e === 'f' ? '\f' : e === 'v' ? '\v' : e;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * grep
 * ------------------------------------------------------------------ */

interface GrepFlags {
  E: boolean;
  F: boolean;
  i: boolean;
  v: boolean;
  n: boolean;
  c: boolean;
  l: boolean;
  L: boolean;
  o: boolean;
  w: boolean;
  x: boolean;
  r: boolean;
  color: 'auto' | 'always' | 'never';
  after: number;
  before: number;
}

const GREP_RED = '\x1b[01;31m';
const GREP_GREEN = '\x1b[32m';
const GREP_MAGENTA = '\x1b[35m';
const GREP_CYAN = '\x1b[36m';
const GREP_RESET = '\x1b[0m';

/**
 * BRE → ERE: GNU BRE's escaped alternation/repetition (`\|` `\+` `\?` and
 * `\(...\)` `\{n,m\}`) becomes ERE syntax; bare ERE metacharacters become
 * literals. Bracket expressions are treated as opaque (a `]` closes them;
 * the `[]…]` leading-literal edge is not modelled).
 */
function breToEre(src: string): string {
  let out = '';
  let inBracket = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') {
      const next = src[++i];
      if (next === undefined) {
        out += '\\\\';
        break;
      }
      if (!inBracket && '|+?(){}'.includes(next)) out += next;
      else out += '\\' + next;
      continue;
    }
    if (inBracket) {
      out += ch;
      if (ch === ']') inBracket = false;
      continue;
    }
    if (ch === '[') {
      inBracket = true;
      out += ch;
      if (src[i + 1] === '^') {
        out += '^';
        i++;
      }
      continue;
    }
    if ('|+?(){}'.includes(ch)) out += '\\' + ch;
    else out += ch;
  }
  return out;
}

function compileGrep(flags: GrepFlags, pattern: string): RegExp | string {
  let src: string;
  if (flags.F) src = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  else if (flags.E) src = pattern;
  else src = breToEre(pattern);
  if (flags.x) src = `^(?:${src})$`;
  else if (flags.w) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, flags.i ? 'i' : '');
  } catch {
    return `grep: invalid pattern: ${pattern}`;
  }
}

const grep: CommandSpec = {
  name: 'grep',
  usage: usageOf('grep'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'ABC');
    const flags: GrepFlags = {
      E: false, F: false, i: false, v: false, n: false, c: false,
      l: false, L: false, o: false, w: false, x: false, r: false,
      // House convention (posix `ls --color`): colors are opt-in — the
      // default is `never`; `--color`/`=always` force paint, `=auto`
      // paints when the stage's stdout is the terminal (ctx.color).
      color: 'never', after: 0, before: 0,
    };
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const contextValue = (flag: 'A' | 'B' | 'C'): boolean => {
        const raw = args[++i];
        const n = Number(raw);
        if (raw === undefined || raw === '' || !Number.isInteger(n) || n < 0) {
          ctx.err(`grep: ${flag}: invalid context length argument`);
          ctx.exit(2);
          return false;
        }
        if (flag === 'A') flags.after = n;
        else if (flag === 'B') flags.before = n;
        else {
          flags.after = n;
          flags.before = n;
        }
        return true;
      };
      if (a === '-E' || a === '--extended-regexp') flags.E = true;
      else if (a === '-F' || a === '--fixed-strings') flags.F = true;
      else if (a === '-G' || a === '--basic-regexp') continue; // default mode
      else if (a === '-i' || a === '--ignore-case') flags.i = true;
      else if (a === '-v' || a === '--invert-match') flags.v = true;
      else if (a === '-n') flags.n = true;
      else if (a === '-c' || a === '--count') flags.c = true;
      else if (a === '-l' || a === '--files-with-matches') flags.l = true;
      else if (a === '-L' || a === '--files-without-match') flags.L = true;
      else if (a === '-o' || a === '--only-matching') flags.o = true;
      else if (a === '-w' || a === '--word-regexp') flags.w = true;
      else if (a === '-x' || a === '--line-regexp') flags.x = true;
      else if (a === '-r' || a === '-R' || a === '--recursive') flags.r = true;
      else if (a === '-A') {
        if (!contextValue('A')) return;
      } else if (a === '-B') {
        if (!contextValue('B')) return;
      } else if (a === '-C') {
        if (!contextValue('C')) return;
      } else if (a === '--color' || a === '--colour' || a.startsWith('--color=') || a.startsWith('--colour=')) {
        flags.color = (a.split('=')[1] ?? 'always') as GrepFlags['color'];
        if (!['auto', 'always', 'never'].includes(flags.color)) {
          ctx.err(`grep: invalid argument '${flags.color}' for '--color'`);
          ctx.exit(2);
          return;
        }
      } else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`grep: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`grep: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    const pattern = operands.shift();
    if (pattern === undefined || pattern === '') {
      ctx.err('grep: usage: grep [-EFivnclLowx] [-A|-B|-C N] [--color[=when]] PATTERN [file...]');
      ctx.exit(2);
      return;
    }
    const compiled = compileGrep(flags, pattern);
    if (typeof compiled === 'string') {
      ctx.err(compiled);
      ctx.exit(2);
      return;
    }
    const regex = compiled;
    const paint = flags.color === 'always' || (flags.color === 'auto' && ctx.color);

    const fileOperands = operands;
    const inputs: Source[] = [];
    let errored = false;
    if (fileOperands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('grep: no input (pipe one in, or name a file)');
        ctx.exit(2);
        return;
      }
      inputs.push({ label: null, text: ctx.stdin });
    } else {
      for (const arg of fileOperands) {
        const path = ctx.vfs.resolve(ctx.state.cwd, arg);
        const node = ctx.vfs.nodeAt(path);
        if (!node) {
          ctx.err(`grep: ${arg}: No such file or directory`);
          errored = true;
          continue;
        }
        if (node.kind === 'file') {
          inputs.push({ label: arg, text: node.content });
          continue;
        }
        if (!flags.r) {
          ctx.err(`grep: ${arg}: Is a directory`);
          errored = true;
          continue;
        }
        const walk = (dir: typeof node, base: string): void => {
          for (const child of [...dir.children].sort((a, b) => a.name.localeCompare(b.name))) {
            const childPath = `${base}/${child.name}`;
            if (child.kind === 'dir') walk(child, childPath);
            else inputs.push({ label: childPath, text: child.content });
          }
        };
        walk(node, arg.replace(/\/+$/, ''));
      }
    }

    const labelFiles = inputs.length > 1 || inputs.some((s) => s.label !== null);
    let anySelected = false;
    const globalRegex = new RegExp(regex.source, regex.flags + 'g');

    for (const input of inputs) {
      const lines = linesOf(input.text);
      const selected = lines.map((line) => {
        const hit = regex.test(line);
        return flags.v ? !hit : hit;
      });
      const fileHasMatch = selected.some(Boolean);
      if (fileHasMatch) anySelected = true;

      if (flags.l || flags.L) {
        if (flags.l === fileHasMatch) {
          ctx.out(input.label ?? '(standard input)');
        }
        continue;
      }
      if (flags.c) {
        const count = selected.filter(Boolean).length;
        ctx.out(labelFiles && input.label !== null ? `${input.label}:${count}` : String(count));
        continue;
      }

      const prefix = (lineNo: number, kind: 'match' | 'context'): string => {
        const bits: string[] = [];
        if (labelFiles && input.label !== null) {
          bits.push(paint ? GREP_MAGENTA + input.label + GREP_RESET : input.label);
        }
        if (flags.n) {
          const num = String(lineNo + 1);
          bits.push(paint ? (kind === 'match' ? GREP_GREEN : GREP_CYAN) + num + GREP_RESET : num);
        }
        const sep = kind === 'match' ? ':' : '-';
        return bits.length === 0 ? '' : bits.join(sep) + sep;
      };

      // -o: only the matched parts (context is not printed with -o).
      if (flags.o && !flags.v) {
        for (let i = 0; i < lines.length; i++) {
          if (!selected[i]) continue;
          globalRegex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = globalRegex.exec(lines[i]!)) !== null) {
            ctx.out(prefix(i, 'match') + (paint ? GREP_RED + m[0] + GREP_RESET : m[0]));
            if (m[0] === '') globalRegex.lastIndex++;
          }
        }
        continue;
      }
      if (flags.o) continue; // -o -v: nothing matches to show

      // Selected lines ± context, merged into disjoint groups.
      const groups: Array<Array<[number, 'match' | 'context']>> = [];
      for (let i = 0; i < lines.length; i++) {
        if (!selected[i]) continue;
        const lo = Math.max(0, i - flags.before);
        const hi = Math.min(lines.length - 1, i + flags.after);
        const last = groups[groups.length - 1];
        const lastHi = last === undefined ? -1 : last[last.length - 1]![0];
        if (last !== undefined && lo <= lastHi + 1) {
          for (let j = lastHi + 1; j <= hi; j++) {
            last.push([j, selected[j] ? 'match' : 'context']);
          }
        } else {
          const group: Array<[number, 'match' | 'context']> = [];
          for (let j = lo; j <= hi; j++) group.push([j, selected[j] ? 'match' : 'context']);
          groups.push(group);
        }
      }
      for (let g = 0; g < groups.length; g++) {
        if (g > 0) ctx.out(paint ? GREP_CYAN + '--' + GREP_RESET : '--');
        for (const [lineNo, kind] of groups[g]!) {
          const line = lines[lineNo]!;
          const body = paint && kind === 'match' ? line.replace(globalRegex, GREP_RED + '$&' + GREP_RESET) : line;
          ctx.out(prefix(lineNo, kind) + body);
        }
      }
    }
    if (errored) ctx.exit(2);
    else ctx.exit(anySelected ? 0 : 1);
  },
};

/* ------------------------------------------------------------------ *
 * sort
 * ------------------------------------------------------------------ */

interface SortKeySpec {
  from: number;
  fromChar?: number;
  to?: number;
  toChar?: number;
  n?: boolean;
  r?: boolean;
  h?: boolean;
}

interface SortFlags {
  numeric: boolean;
  reverse: boolean;
  unique: boolean;
  human: boolean;
  version: boolean;
  tab: string | null;
  keys: SortKeySpec[];
}

function parseKeySpec(spec: string): SortKeySpec | string {
  const parseEnd = (part: string): { field: number; char?: number; mods: string } | string => {
    const m = /^(\d+)(?:\.(\d+))?([nrbh]*)$/.exec(part);
    if (!m) return part;
    return { field: Number(m[1]), char: m[2] === undefined ? undefined : Number(m[2]), mods: m[3] ?? '' };
  };
  const [startPart, endPart] = spec.split(',');
  if (endPart !== undefined && spec.split(',').length > 2) return spec;
  const start = parseEnd(startPart ?? '');
  if (typeof start === 'string' || start.field < 1) return spec;
  const key: SortKeySpec = { from: start.field, fromChar: start.char };
  key.n = start.mods.includes('n') || undefined;
  key.r = start.mods.includes('r') || undefined;
  key.h = start.mods.includes('h') || undefined;
  if (endPart !== undefined) {
    const end = parseEnd(endPart);
    if (typeof end === 'string' || end.field < 1) return spec;
    key.to = end.field;
    key.toChar = end.char;
    key.n = key.n || end.mods.includes('n') || undefined;
    key.r = key.r || end.mods.includes('r') || undefined;
    key.h = key.h || end.mods.includes('h') || undefined;
  }
  return key;
}

const fieldsOf = (line: string, tab: string | null): string[] => {
  if (tab !== null) return line.split(tab);
  const trimmed = line.trim();
  return trimmed === '' ? [''] : trimmed.split(/\s+/);
};

/**
 * The key text for one line: fields from..to joined (from-field to end of
 * line when there is no `,to`), then sliced by the .C character offsets
 * (single-field keys only for the to-offset). Field indexing is 1-based;
 * the default separator treats blank runs as boundaries (trimmed).
 */
function sortKeyString(line: string, key: SortKeySpec, tab: string | null): string {
  const fields = fieldsOf(line, tab);
  const fromIdx = Math.min(key.from, fields.length) - 1;
  let fieldText: string;
  if (key.to === undefined) {
    fieldText = fields.slice(fromIdx).join(tab ?? ' ');
  } else {
    const toIdx = Math.min(key.to, fields.length) - 1;
    fieldText = fields.slice(fromIdx, toIdx + 1).join(tab ?? ' ');
  }
  if (key.fromChar !== undefined && key.fromChar > 0) {
    fieldText = charList(fieldText).slice(key.fromChar - 1).join('');
  } else if (key.toChar !== undefined && key.toChar > 0 && key.to !== undefined && key.to === key.from) {
    fieldText = charList(fieldText).slice(0, key.toChar).join('');
  }
  return fieldText;
}

const NUMERIC_PREFIX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function numericValue(s: string): number {
  const m = NUMERIC_PREFIX.exec(s.trim());
  return m === null ? 0 : Number(m[0]);
}

const HUMAN_SUFFIX: Record<string, number> = { K: 1, M: 2, G: 3, T: 4, P: 5, E: 6 };

function humanValue(s: string): number {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([kKMGTPPE]?)/.exec(s.trim());
  if (m === null) return 0;
  const exp = HUMAN_SUFFIX[(m[2] ?? '').toUpperCase()] ?? 0;
  return Number(m[1]) * 1024 ** exp;
}

function versionChunks(s: string): Array<{ num: number | null; text: string }> {
  const parts = s.match(/\d+|\D+/g) ?? [];
  return parts.map((p) => (/^\d+$/.test(p) ? { num: Number(p), text: p } : { num: null, text: p }));
}

function compareVersion(a: string, b: string): number {
  const ac = versionChunks(a);
  const bc = versionChunks(b);
  for (let i = 0; i < Math.max(ac.length, bc.length); i++) {
    const x = ac[i];
    const y = bc[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x.num !== null && y.num !== null) {
      if (x.num !== y.num) return x.num < y.num ? -1 : 1;
    } else if (x.text !== y.text) {
      return x.text < y.text ? -1 : 1;
    }
  }
  return 0;
}

type SortMode = 'plain' | 'numeric' | 'human' | 'version';

function compareValues(a: string, b: string, mode: SortMode): number {
  if (mode === 'numeric') {
    const x = numericValue(a);
    const y = numericValue(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (mode === 'human') {
    const x = humanValue(a);
    const y = humanValue(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (mode === 'version') return compareVersion(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

interface SortRow {
  line: string;
  keys: string[];
}

const sort: CommandSpec = {
  name: 'sort',
  usage: usageOf('sort'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'kt');
    const flags: SortFlags = { numeric: false, reverse: false, unique: false, human: false, version: false, tab: null, keys: [] };
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-n') flags.numeric = true;
      else if (a === '-r') flags.reverse = true;
      else if (a === '-u') flags.unique = true;
      else if (a === '-h') flags.human = true;
      else if (a === '-V') flags.version = true;
      else if (a === '-t') {
        const raw = args[++i];
        if (raw === undefined || raw === '') {
          ctx.err('sort: option -t requires an argument');
          ctx.exit(2);
          return;
        }
        const sep = unescapeDelim(raw);
        if (charList(sep).length !== 1) {
          ctx.err('sort: multi-character tab');
          ctx.exit(2);
          return;
        }
        flags.tab = sep;
      } else if (a === '-k') {
        const spec = args[++i];
        if (spec === undefined || spec === '') {
          ctx.err('sort: option -k requires an argument');
          ctx.exit(2);
          return;
        }
        const key = parseKeySpec(spec);
        if (typeof key === 'string') {
          ctx.err(`sort: invalid specification '${key}'`);
          ctx.exit(2);
          return;
        }
        flags.keys.push(key);
      } else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`sort: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`sort: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, 'sort', operands, 2);
    if (sources === null) return;
    const lines: string[] = [];
    for (const source of sources) lines.push(...linesOf(source.text));

    const mode: SortMode = flags.numeric ? 'numeric' : flags.human ? 'human' : flags.version ? 'version' : 'plain';
    const decorated: SortRow[] = lines.map((line) => ({
      line,
      keys: flags.keys.map((key) => sortKeyString(line, key, flags.tab)),
    }));

    const keyMode = (key: SortKeySpec): SortMode => (key.n ? 'numeric' : key.h ? 'human' : mode);

    decorated.sort((a, b) => {
      for (let i = 0; i < flags.keys.length; i++) {
        const key = flags.keys[i]!;
        const result = compareValues(a.keys[i]!, b.keys[i]!, keyMode(key));
        if (result !== 0) return (key.r ?? flags.reverse) ? -result : result;
      }
      // GNU default: tied keys fall back to a whole-line comparison
      // (also under -u — the sort order includes it; -u dedupes after).
      const result = compareValues(a.line, b.line, mode);
      if (result !== 0) return flags.reverse ? -result : result;
      return 0;
    });

    let outLines = decorated.map((d) => d.line);
    if (flags.unique) {
      // -u dedupes by the KEY comparison only (not the last-resort whole line)
      const keyEqual = (a: string, b: string): boolean => {
        for (let i = 0; i < flags.keys.length; i++) {
          const key = flags.keys[i]!;
          if (compareValues(sortKeyString(a, key, flags.tab), sortKeyString(b, key, flags.tab), keyMode(key)) !== 0) {
            return false;
          }
        }
        if (flags.keys.length > 0) return true;
        return compareValues(a, b, mode) === 0;
      };
      const kept: string[] = [];
      for (const line of outLines) {
        if (kept.length > 0 && keyEqual(kept[kept.length - 1]!, line)) continue;
        kept.push(line);
      }
      outLines = kept;
    }
    for (const line of outLines) ctx.out(line);
  },
};

/* ------------------------------------------------------------------ *
 * uniq
 * ------------------------------------------------------------------ */

const uniq: CommandSpec = {
  name: 'uniq',
  usage: usageOf('uniq'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    const flags = { c: false, d: false, u: false, i: false };
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-c' || a === '--count') flags.c = true;
      else if (a === '-d' || a === '--repeated') flags.d = true;
      else if (a === '-u' || a === '--unique') flags.u = true;
      else if (a === '-i' || a === '--ignore-case') flags.i = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`uniq: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`uniq: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, 'uniq', operands);
    if (sources === null) return;
    const lines: string[] = [];
    for (const source of sources) lines.push(...linesOf(source.text));

    const key = (line: string): string => (flags.i ? line.toLowerCase() : line);
    let index = 0;
    while (index < lines.length) {
      let count = 1;
      while (index + count < lines.length && key(lines[index + count]!) === key(lines[index]!)) count++;
      const show = (!flags.d && !flags.u) || (flags.d && count > 1) || (flags.u && count === 1);
      if (show) ctx.out(flags.c ? `${String(count).padStart(7)} ${lines[index]}` : lines[index]!);
      index += count;
    }
  },
};

/* ------------------------------------------------------------------ *
 * wc
 * ------------------------------------------------------------------ */

const wc: CommandSpec = {
  name: 'wc',
  usage: usageOf('wc'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    const want = { l: false, w: false, c: false, m: false };
    const operands: string[] = [];
    for (const a of args) {
      if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`wc: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        for (const ch of a.slice(1)) {
          if (ch === 'l') want.l = true;
          else if (ch === 'w') want.w = true;
          else if (ch === 'c') want.c = true;
          else if (ch === 'm') want.m = true;
          else {
            ctx.err(`wc: invalid option -- '${ch}'`);
            ctx.exit(2);
            return;
          }
        }
      } else operands.push(a);
    }
    const any = want.l || want.w || want.c || want.m;
    // GNU column order: lines words chars bytes
    const columns: Array<'l' | 'w' | 'm' | 'c'> = any
      ? (['l', 'w', 'm', 'c'] as const).filter((k) => want[k])
      : ['l', 'w', 'c'];
    const sources = readSources(ctx, 'wc', operands);
    if (sources === null) return;
    const total = { l: 0, w: 0, m: 0, c: 0 };
    for (const source of sources) {
      const counts = {
        l: linesOf(source.text).length,
        w: source.text.trim() === '' ? 0 : source.text.trim().split(/\s+/).length,
        m: charList(source.text).length,
        c: byteLength(source.text),
      };
      total.l += counts.l;
      total.w += counts.w;
      total.m += counts.m;
      total.c += counts.c;
      const body = columns.map((k) => String(counts[k]).padStart(7)).join('');
      ctx.out(source.label === null ? body : `${body} ${source.label}`); // GNU pads stdin too
    }
    if (sources.length > 1) {
      const body = columns.map((k) => String(total[k]).padStart(7)).join('');
      ctx.out(`${body} total`);
    }
  },
};

/* ------------------------------------------------------------------ *
 * head · tail
 * ------------------------------------------------------------------ */

/** Byte-faithful slice (multibyte chars split like real head/tail -c). */
function byteSlice(text: string, start: number, end: number): string {
  const bytes = encoder.encode(text);
  const sliced = bytes.slice(start, end);
  return new TextDecoder('utf-8', { fatal: false }).decode(sliced);
}

function parseSliceCount(raw: string, cmd: string, unit: 'lines' | 'bytes'): number | string {
  if (raw === '' || /[^0-9]/.test(raw)) {
    return `${cmd}: invalid number of ${unit}: '${raw}'`;
  }
  return Number(raw);
}

function headOrTail(isTail: boolean): (ctx: CommandContext) => void {
  const cmd = isTail ? 'tail' : 'head';
  return (ctx: CommandContext) => {
    const args = splitArgs(ctx.args, 'nc');
    let lines = 10;
    let bytes: number | null = null;
    let fromLine = false; // tail -n +N
    let fromByte = false; // tail -c +N
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const readCount = (unit: 'lines' | 'bytes', raw: string | undefined): number | null => {
        if (raw === undefined) {
          ctx.err(`${cmd}: option -${unit === 'lines' ? 'n' : 'c'} requires an argument`);
          ctx.exit(1);
          return null;
        }
        let positive = raw;
        let from = false;
        if (isTail && positive.startsWith('+')) {
          from = true;
          positive = positive.slice(1);
        } else if (!isTail && positive.startsWith('+')) {
          positive = positive.slice(1); // head -n +N behaves like -n N
        }
        const n = parseSliceCount(positive, cmd, unit);
        if (typeof n === 'string') {
          ctx.err(n);
          ctx.exit(1);
          return null;
        }
        if (unit === 'lines') {
          lines = n;
          fromLine = from;
        } else {
          bytes = n;
          fromByte = from;
        }
        return n;
      };
      if (a === '-n') {
        if (readCount('lines', args[++i]) === null) return;
      } else if (a === '-c') {
        if (readCount('bytes', args[++i]) === null) return;
      } else if (/^-\d+$/.test(a)) {
        const n = parseSliceCount(a.slice(1), cmd, 'lines');
        if (typeof n === 'string') {
          ctx.err(n);
          ctx.exit(1);
          return;
        }
        lines = n;
      } else if (a === '-f') {
        // simulated: prints the slice and returns (no VFS watch API yet)
      } else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`${cmd}: unrecognized option '${a}'`);
        ctx.exit(1);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`${cmd}: invalid option -- '${a[1]}'`);
        ctx.exit(1);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, cmd, operands);
    if (sources === null) return;
    for (let f = 0; f < sources.length; f++) {
      const source = sources[f]!;
      if (sources.length > 1) {
        if (f > 0) ctx.out('');
        ctx.out(`==> ${source.label} <==`);
      }
      if (bytes !== null) {
        const sliced = isTail
          ? fromByte
            ? byteSlice(source.text, bytes - 1, Infinity)
            : byteSlice(source.text, Math.max(0, byteLength(source.text) - bytes), Infinity)
          : byteSlice(source.text, 0, bytes);
        if (sliced === '') continue;
        for (const line of sliced.replace(/\n$/, '').split('\n')) ctx.out(line);
        continue;
      }
      const all = linesOf(source.text);
      const slice = isTail
        ? fromLine
          ? all.slice(Math.max(0, lines - 1))
          : lines === 0
            ? []
            : all.slice(-lines)
        : all.slice(0, lines);
      for (const line of slice) ctx.out(line);
    }
  };
}

const head: CommandSpec = { name: 'head', usage: usageOf('head'), run: headOrTail(false) };
const tail: CommandSpec = { name: 'tail', usage: usageOf('tail'), run: headOrTail(true) };

/* ------------------------------------------------------------------ *
 * cut
 * ------------------------------------------------------------------ */

const cut: CommandSpec = {
  name: 'cut',
  usage: usageOf('cut'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'dfc');
    let delim = '\t';
    let fieldsSpec: string | null = null;
    let charsSpec: string | null = null;
    let delimGiven = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-d') {
        const raw = args[++i];
        if (raw === undefined) {
          ctx.err('cut: option -d requires an argument');
          ctx.exit(1);
          return;
        }
        delimGiven = true;
        delim = unescapeDelim(raw);
        if (charList(delim).length !== 1) {
          ctx.err('cut: the delimiter must be a single character');
          ctx.exit(1);
          return;
        }
      } else if (a === '-f') {
        const raw = args[++i];
        if (raw === undefined) {
          ctx.err('cut: option -f requires an argument');
          ctx.exit(1);
          return;
        }
        fieldsSpec = raw;
      } else if (a === '-c') {
        const raw = args[++i];
        if (raw === undefined) {
          ctx.err('cut: option -c requires an argument');
          ctx.exit(1);
          return;
        }
        charsSpec = raw;
      } else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`cut: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`cut: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    if ((fieldsSpec !== null) === (charsSpec !== null)) {
      ctx.err(
        fieldsSpec !== null
          ? 'cut: only one type of list may be specified'
          : 'cut: you must specify a list of bytes, characters, or fields',
      );
      ctx.exit(1);
      return;
    }
    if (charsSpec !== null && delimGiven) {
      ctx.err('cut: an input delimiter may be specified only when operating on fields');
      ctx.exit(1);
      return;
    }
    const spec = fieldsSpec ?? charsSpec!;
    const ranges = parseRanges(spec);
    if (typeof ranges === 'string') {
      ctx.err(`cut: invalid range: ${ranges}`);
      ctx.exit(1);
      return;
    }
    const sources = readSources(ctx, 'cut', operands);
    if (sources === null) return;
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        if (fieldsSpec !== null) {
          if (!line.includes(delim)) {
            ctx.out(line); // delimiter-less lines pass through whole
            continue;
          }
          const fields = line.split(delim);
          const parts: string[] = [];
          for (let f = 1; f <= fields.length; f++) {
            if (inRanges(ranges, f)) parts.push(fields[f - 1]!);
          }
          ctx.out(parts.join(delim));
        } else {
          const chars = charList(line);
          let out = '';
          for (let cIdx = 1; cIdx <= chars.length; cIdx++) {
            if (inRanges(ranges, cIdx)) out += chars[cIdx - 1];
          }
          ctx.out(out);
        }
      }
    }
  },
};

/* ------------------------------------------------------------------ *
 * tr
 * ------------------------------------------------------------------ */

const TR_CLASSES: Record<string, (code: number) => boolean> = {
  upper: (c) => c >= 65 && c <= 90,
  lower: (c) => c >= 97 && c <= 122,
  digit: (c) => c >= 48 && c <= 57,
  alpha: (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
  alnum: (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57),
  space: (c) => c === 32 || (c >= 9 && c <= 13),
  blank: (c) => c === 32 || c === 9,
  punct: (c) => c >= 33 && c <= 47,
  xdigit: (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
  cntrl: (c) => (c >= 0 && c <= 31) || c === 127,
  print: (c) => c >= 32 && c <= 126,
  graph: (c) => c >= 33 && c <= 126,
};

/** Expand a tr set: escapes, a-z ranges, [:class:] character classes. */
function expandSet(raw: string): string[] | string {
  const chars: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('[:', i)) {
      const end = raw.indexOf(':]', i + 2);
      if (end === -1) return raw.slice(i);
      const name = raw.slice(i + 2, end);
      const test = TR_CLASSES[name];
      if (!test) return `[:${name}:]`;
      for (let code = 0; code <= 0x17f; code++) {
        if (test(code)) chars.push(String.fromCodePoint(code));
      }
      i = end + 2;
      continue;
    }
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length) {
      chars.push(unescapeDelim(raw.slice(i, i + 2)));
      i += 2;
      continue;
    }
    const next = raw[i + 1];
    if (next === '-' && i + 2 < raw.length && raw[i + 2] !== ']') {
      const hiRaw = raw[i + 2]!;
      const hi = hiRaw === '\\' ? unescapeDelim(raw.slice(i + 2, i + 4)) : hiRaw;
      const lo = ch.codePointAt(0)!;
      const hiCode = hi.codePointAt(0)!;
      if (hi === '' || hiCode < lo) return `${ch}-${hiRaw}`;
      for (let code = lo; code <= hiCode; code++) chars.push(String.fromCodePoint(code));
      i += hiRaw === '\\' ? 4 : 3;
      continue;
    }
    chars.push(ch);
    i++;
  }
  return chars;
}

const tr: CommandSpec = {
  name: 'tr',
  usage: usageOf('tr'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    const flags = { d: false, s: false, c: false };
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-d') flags.d = true;
      else if (a === '-s' || a === '--squeeze-repeats') flags.s = true;
      else if (a === '-c' || a === '-C' || a === '--complement') flags.c = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`tr: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`tr: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    if (operands.length === 0) {
      ctx.err('usage: tr [-cds] SET1 [SET2]');
      ctx.exit(2);
      return;
    }
    if (!flags.d && !flags.s && operands.length < 2) {
      ctx.err(`tr: missing operand after '${operands[0]}'`);
      ctx.exit(1);
      return;
    }
    if (operands.length > 2 || (flags.d && operands.length > 1)) {
      ctx.err(`tr: extra operand '${operands[flags.d ? 1 : 2] ?? ''}'`);
      ctx.exit(1);
      return;
    }
    if (flags.c && !flags.d && !flags.s) {
      ctx.err('tr: -c is only supported with -d or -s in this emulation');
      ctx.exit(1);
      return;
    }
    const set1raw = expandSet(operands[0]!);
    if (typeof set1raw === 'string') {
      ctx.err(`tr: invalid character class or range '${set1raw}'`);
      ctx.exit(1);
      return;
    }
    const set1 = set1raw;
    let set2: string[] = [];
    if (!flags.d && operands.length >= 2) {
      const set2raw = expandSet(operands[1]!);
      if (typeof set2raw === 'string') {
        ctx.err(`tr: invalid character class or range '${set2raw}'`);
        ctx.exit(1);
        return;
      }
      set2 = set2raw;
      if (!flags.c && set2.length > set1.length) {
        ctx.err(`tr: extra operand '${set2[set1.length]}'`);
        ctx.exit(1);
        return;
      }
    }
    if (ctx.stdin === null) {
      ctx.err('tr: no input (pipe one in)');
      ctx.exit(1);
      return;
    }

    const map = new Map<string, string>();
    if (!flags.d && operands.length >= 2) {
      for (let i = 0; i < set1.length; i++) {
        // GNU: SET2's last character repeats to fill
        map.set(set1[i]!, set2[Math.min(i, set2.length - 1)]!);
      }
    }
    const inSet1 = (ch: string): boolean => (flags.c ? !set1.includes(ch) : set1.includes(ch));

    let text = ctx.stdin;
    if (flags.d) {
      text = charList(text)
        .filter((ch) => !inSet1(ch))
        .join('');
    } else {
      text = charList(text)
        .map((ch) => map.get(ch) ?? ch)
        .join('');
    }
    if (flags.s) {
      // Squeeze set: SET2 in translate mode, SET1 (complemented with -c)
      // in delete / squeeze-only mode (`tr -s ' '`).
      const shouldSqueeze = (ch: string): boolean =>
        flags.d || operands.length < 2 || flags.c ? inSet1(ch) : set2.includes(ch);
      let out = '';
      for (const ch of charList(text)) {
        if (ch === out[out.length - 1] && shouldSqueeze(ch)) continue;
        out += ch;
      }
      text = out;
    }
    if (text === '') return;
    for (const line of text.replace(/\n$/, '').split('\n')) ctx.out(line);
  },
};

/* ------------------------------------------------------------------ *
 * tee
 * ------------------------------------------------------------------ */

const tee: CommandSpec = {
  name: 'tee',
  usage: usageOf('tee'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    let append = false;
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-a' || a === '--append') append = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`tee: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`tee: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    if (ctx.stdin === null) {
      ctx.err('tee: no input (pipe one in)');
      ctx.exit(1);
      return;
    }
    for (const line of linesOf(ctx.stdin)) ctx.out(line);
    let failed = false;
    for (const arg of operands) {
      const path = ctx.vfs.resolve(ctx.state.cwd, arg);
      const backend = ctx.vfs.backendFor(path);
      if (backend !== null && !backend.writable) {
        ctx.err(`tee: ${arg}: Read-only file system`);
        failed = true;
        continue;
      }
      const target = ctx.vfs.nodeAt(path);
      if (target?.kind === 'dir') {
        ctx.err(`tee: ${arg}: Is a directory`);
        failed = true;
        continue;
      }
      try {
        const previous = append && target?.kind === 'file' ? target.content : '';
        ctx.vfs.mountFile(path, previous + ctx.stdin);
      } catch (cause) {
        ctx.err(`tee: ${arg}: ${cause instanceof Error ? cause.message : String(cause)}`);
        failed = true;
      }
    }
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * xargs
 * ------------------------------------------------------------------ */

const xargs: CommandSpec = {
  name: 'xargs',
  usage: usageOf('xargs'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'nI');
    const opts = { zero: false, max: null as number | null, repl: null as string | null, noRunIfEmpty: false };
    const words: string[] = [];
    let endOfFlags = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (endOfFlags) {
        words.push(a);
        continue;
      }
      if (a === '--') {
        endOfFlags = true;
      } else if (a === '-0') opts.zero = true;
      else if (a === '-r' || a === '--no-run-if-empty') opts.noRunIfEmpty = true;
      else if (a === '-n') {
        const n = Number(args[++i]);
        if (!Number.isInteger(n) || n < 1) {
          ctx.err('xargs: invalid number for -n');
          ctx.exit(1);
          return;
        }
        opts.max = n;
      } else if (a === '-I') {
        const s = args[++i];
        if (s === undefined || s === '') {
          ctx.err('xargs: option -I requires an argument');
          ctx.exit(1);
          return;
        }
        opts.repl = s;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`xargs: invalid option -- '${a[1]}'`);
        ctx.exit(1);
        return;
      } else words.push(a);
    }
    if (ctx.stdin === null) {
      ctx.err('xargs: no input (pipe one in)');
      ctx.exit(1);
      return;
    }
    // The pipe hands text over line-framed; drop the one framing newline
    // so a trailing NUL-terminated item doesn't gain a stray "\n" field.
    const payload = ctx.stdin.endsWith('\n') ? ctx.stdin.slice(0, -1) : ctx.stdin;
    const items = opts.zero
      ? payload.split('\0').filter((s) => s !== '')
      : payload.trim() === ''
        ? []
        : payload.trim().split(/\s+/);
    const cmd = words[0] ?? 'echo';
    const initial = words.slice(1);
    const spec = ctx.commands.get(cmd);
    if (!spec) {
      ctx.err(`xargs: ${cmd}: No such file or directory`);
      ctx.exit(127);
      return;
    }

    let anyFailed = false;
    const runOne = (argv: string[]): void => {
      let childStatus = 0;
      let stderrCount = 0;
      const child: CommandContext = {
        args: argv.slice(1),
        stdin: null,
        vfs: ctx.vfs,
        state: ctx.state,
        color: false,
        commands: ctx.commands,
        out: (text) => ctx.out(text),
        err: (text) => {
          stderrCount++;
          ctx.err(text);
        },
        emit: (action) => ctx.emit(action),
        exit: (code) => {
          childStatus = code;
        },
      };
      try {
        spec.run(child); // never spawns full-screen apps
      } catch (cause) {
        ctx.err(`xargs: ${cmd}: ${cause instanceof Error ? cause.message : String(cause)}`);
        childStatus = 1;
      }
      const effective = childStatus !== 0 ? childStatus : stderrCount > 0 ? 1 : 0;
      if (effective >= 1 && effective <= 125) anyFailed = true;
    };

    if (items.length === 0) {
      if (opts.noRunIfEmpty) return;
      runOne([cmd, ...initial]);
    } else if (opts.repl !== null) {
      for (const item of items) {
        runOne([cmd, ...initial.map((w) => w.split(opts.repl!).join(item))]);
      }
    } else {
      const size = opts.max ?? items.length;
      for (let i = 0; i < items.length; i += size) {
        runOne([cmd, ...initial, ...items.slice(i, i + size)]);
      }
    }
    ctx.exit(anyFailed ? 123 : 0);
  },
};

/* ------------------------------------------------------------------ *
 * nl · rev · paste · column · fold · expand
 * ------------------------------------------------------------------ */

const nl: CommandSpec = {
  name: 'nl',
  usage: usageOf('nl'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'bws');
    let style: 'a' | 't' = 't';
    let width = 6;
    let sep = '\t';
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-b') {
        const s = args[++i] ?? 't';
        if (s !== 'a' && s !== 't') {
          ctx.err(`nl: invalid body numbering style: '${s}'`);
          ctx.exit(1);
          return;
        }
        style = s;
      } else if (a === '-w') {
        const n = Number(args[++i]);
        if (!Number.isInteger(n) || n < 1) {
          ctx.err('nl: invalid line number width');
          ctx.exit(1);
          return;
        }
        width = n;
      } else if (a === '-s') {
        const s = args[++i];
        if (s === undefined) {
          ctx.err('nl: option -s requires an argument');
          ctx.exit(1);
          return;
        }
        sep = unescapeDelim(s);
      } else if (a.startsWith('-') && a !== '-' && a !== '--') {
        ctx.err(`nl: invalid option -- '${a[1]}'`);
        ctx.exit(1);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, 'nl', operands);
    if (sources === null) return;
    let n = 0;
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        const numberIt = style === 'a' || line !== '';
        if (numberIt) n++;
        ctx.out(numberIt ? `${String(n).padStart(width)}${sep}${line}` : line);
      }
    }
  },
};

const rev: CommandSpec = {
  name: 'rev',
  usage: usageOf('rev'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    const operands: string[] = [];
    for (const a of args) {
      if (a.startsWith('-') && a !== '-' && a !== '--') {
        ctx.err(`rev: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      }
      if (a !== '--') operands.push(a);
    }
    const sources = readSources(ctx, 'rev', operands);
    if (sources === null) return;
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        ctx.out(charList(line).reverse().join(''));
      }
    }
  },
};

const paste: CommandSpec = {
  name: 'paste',
  usage: usageOf('paste'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'd');
    let delims: string[] = ['\t'];
    let serial = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-d') {
        const raw = args[++i];
        if (raw === undefined) {
          ctx.err('paste: option -d requires an argument');
          ctx.exit(1);
          return;
        }
        delims = charList(unescapeDelim(raw));
        if (delims.length === 0) delims = ['\t'];
      } else if (a === '-s' || a === '--serial') serial = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`paste: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`paste: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    if (operands.length === 0 && ctx.stdin === null) {
      ctx.err('paste: no input (pipe one in, or name a file)');
      ctx.exit(1);
      return;
    }
    const columns: string[][] = [];
    const addSource = (text: string): void => {
      columns.push(linesOf(text));
    };
    if (operands.length === 0) {
      addSource(ctx.stdin!);
    } else {
      for (const arg of operands) {
        if (arg === '-') {
          addSource(ctx.stdin ?? '');
          continue;
        }
        const path = ctx.vfs.resolve(ctx.state.cwd, arg);
        const node = ctx.vfs.nodeAt(path);
        if (!node || node.kind === 'dir') {
          ctx.err(`paste: ${arg}: ${node ? 'Is a directory' : 'No such file or directory'}`);
          continue;
        }
        addSource(node.content);
      }
    }
    const delimAt = (junction: number): string => delims[junction % delims.length]!;
    if (serial) {
      for (const col of columns) {
        let out = '';
        for (let i = 0; i < col.length; i++) {
          if (i > 0) out += delimAt(i - 1);
          out += col[i];
        }
        ctx.out(out);
      }
      return;
    }
    const rows = columns.length === 0 ? 0 : Math.max(...columns.map((c) => c.length));
    for (let i = 0; i < rows; i++) {
      let out = '';
      for (let c = 0; c < columns.length; c++) {
        if (c > 0) out += delimAt(c - 1);
        out += columns[c]![i] ?? '';
      }
      ctx.out(out);
    }
  },
};

const column: CommandSpec = {
  name: 'column',
  usage: usageOf('column'),
  run(ctx) {
    const args = splitArgs(ctx.args, '');
    let table = false;
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-t' || a === '--table') table = true;
      else if (a === '--') continue;
      else if (a.startsWith('-') && a !== '-') {
        ctx.err(`column: unsupported option '${a}' (only -t)`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    if (!table) {
      ctx.err('column: only -t is supported in this emulation');
      ctx.exit(2);
      return;
    }
    const sources = readSources(ctx, 'column', operands);
    if (sources === null) return;
    const rows: string[][] = [];
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        const trimmed = line.trim();
        rows.push(trimmed === '' ? [] : trimmed.split(/\s+/));
      }
    }
    const width = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.length));
    const colWidths: number[] = [];
    for (let c = 0; c < width; c++) {
      let max = 0;
      for (const row of rows) {
        if (row[c] !== undefined) max = Math.max(max, charList(row[c]!).length);
      }
      colWidths.push(max);
    }
    for (const row of rows) {
      if (row.length === 0) {
        ctx.out('');
        continue;
      }
      let out = '';
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]!;
        out += cell;
        if (c < row.length - 1) {
          out += ' '.repeat(Math.max(2, colWidths[c]! - charList(cell).length + 2));
        }
      }
      ctx.out(out);
    }
  },
};

const fold: CommandSpec = {
  name: 'fold',
  usage: usageOf('fold'),
  run(ctx) {
    const args = splitArgs(ctx.args, 'w');
    let width = 80;
    let atSpaces = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-w') {
        const n = Number(args[++i]);
        if (!Number.isInteger(n) || n < 1) {
          ctx.err('fold: invalid width');
          ctx.exit(1);
          return;
        }
        width = n;
      } else if (a === '-s' || a === '--spaces') atSpaces = true;
      else if (a.startsWith('-') && a !== '-' && a !== '--') {
        ctx.err(`fold: invalid option -- '${a[1]}'`);
        ctx.exit(1);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, 'fold', operands);
    if (sources === null) return;
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        const chars = charList(line);
        let start = 0;
        while (chars.length - start > width) {
          let cut = start + width;
          if (atSpaces) {
            let lastBlank = -1;
            for (let i = start; i < start + width; i++) {
              if (chars[i] === ' ' || chars[i] === '\t') lastBlank = i;
            }
            if (lastBlank >= start + 1) cut = lastBlank + 1; // break after the blank
          }
          ctx.out(chars.slice(start, cut).join(''));
          start = cut;
        }
        if (start < chars.length) ctx.out(chars.slice(start).join(''));
      }
    }
  },
};

const expand: CommandSpec = {
  name: 'expand',
  usage: usageOf('expand'),
  run(ctx) {
    const args = splitArgs(ctx.args, 't');
    let stops: number[] | null = null;
    const operands: string[] = [];
    const parseStops = (raw: string): boolean => {
      const parts = raw.split(/[,\s]+/).filter((p) => p !== '');
      const list = parts.map((p) => Number(p));
      if (list.length === 0 || list.some((n) => !Number.isInteger(n) || n < 1)) {
        ctx.err('expand: tab sizes must be positive integers');
        return false;
      }
      for (let i = 1; i < list.length; i++) {
        if (list[i]! <= list[i - 1]!) {
          ctx.err('expand: tab sizes must be ascending');
          return false;
        }
      }
      stops = list;
      return true;
    };
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-t' || a === '--tabs') {
        const raw = args[++i];
        if (raw === undefined) {
          ctx.err('expand: option -t requires an argument');
          ctx.exit(1);
          return;
        }
        if (!parseStops(raw)) return;
      } else if (/^--tabs=/.test(a)) {
        if (!parseStops(a.slice('--tabs='.length))) return;
      } else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`expand: unrecognized option '${a}'`);
        ctx.exit(1);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        ctx.err(`expand: invalid option -- '${a[1]}'`);
        ctx.exit(1);
        return;
      } else operands.push(a);
    }
    const sources = readSources(ctx, 'expand', operands);
    if (sources === null) return;
    const nextStop = (col: number): number => {
      if (stops === null || stops.length === 1) {
        const size = stops?.[0] ?? 8;
        return (Math.floor(col / size) + 1) * size;
      }
      for (const s of stops) {
        if (s > col) return s;
      }
      // beyond the list: repeat the last interval (util-linux behaviour)
      const last = stops[stops.length - 1]!;
      const step = last - stops[stops.length - 2]!;
      return last + (Math.floor((col - last) / step) + 1) * step;
    };
    for (const source of sources) {
      for (const line of linesOf(source.text)) {
        let out = '';
        let col = 0;
        for (const ch of charList(line)) {
          if (ch === '\t') {
            const target = nextStop(col);
            out += ' '.repeat(Math.max(1, target - col));
            col = target;
          } else {
            out += ch;
            col++;
          }
        }
        ctx.out(out);
      }
    }
  },
};

/* ------------------------------------------------------------------ *
 * exports — commands (the chunk payload) + man pages
 * ------------------------------------------------------------------ */

/**
 * Once the chunk is resident these specs own even `--help` (lazy.ts), so
 * every command answers it here. `-h` means help everywhere except sort,
 * whose -h is human-numeric sort.
 */
const withHelp = (spec: CommandSpec): CommandSpec => ({
  ...spec,
  run(ctx) {
    if (ctx.args.includes('--help') || (ctx.args.includes('-h') && spec.name !== 'sort')) {
      const entry = textStub.commands.find((c) => c.name === spec.name)!;
      ctx.out(`${spec.name} — ${entry.summary}`);
      ctx.out(`usage: ${entry.usage}`);
      return;
    }
    spec.run(ctx);
  },
});

export const commands: CommandSpec[] = [
  grep,
  sort,
  uniq,
  wc,
  head,
  tail,
  cut,
  tr,
  tee,
  xargs,
  nl,
  rev,
  paste,
  column,
  fold,
  expand,
].map(withHelp);

export default commands;

export const manPages: Record<string, string[]> = {
  grep: [
    'grep — print lines matching a pattern',
    '',
    'SYNOPSIS',
    '  grep [-EFivnclLowx] [-A|-B|-C N] [--color[=when]] PATTERN [file...]',
    '',
    'Patterns are basic regular expressions by default (GNU BRE: \\| \\+ \\?',
    '\\(...\\) \\{n,m\\} are the special forms), extended with -E, or fixed',
    'strings with -F. -i ignores case, -v selects non-matching lines, -n',
    'numbers them, -c counts them, -o prints only the matched parts, -w',
    'requires a whole-word match, -x a whole-line match. -l lists files',
    'with matches, -L without. -r walks directories (`./x` labels).',
    '-A/-B/-C N print N lines of after/before/both context; groups are',
    'separated by `--`. --color=always|never|auto colors matches (auto:',
    'only when the output is a terminal). Exit status: 0 match, 1 none,',
    '2 error.',
  ],
  sort: [
    'sort — sort lines of text',
    '',
    'SYNOPSIS',
    '  sort [-nruhV] [-k POS[,POS]] [-t C] [file...]',
    '',
    '-n compares by numeric prefix, -h human-numeric (1K < 1M < 1G), -V',
    'version order, -r reverses (including the last-resort whole-line',
    'comparison), -u drops lines equal under the key comparison. -k',
    'selects keys F[.C][,F[.C]] with per-key n/r/h modifiers; several',
    '-k keys compare in order. -t picks the field separator (default:',
    'blank runs). Lines are compared by code points (the C locale).',
  ],
  uniq: [
    'uniq — drop adjacent duplicate lines',
    '',
    'SYNOPSIS',
    '  uniq [-cdui] [file...]',
    '',
    'Only ADJACENT duplicates collapse — pipe through sort first unless',
    'the order matters. -c prefixes counts `%7d `, -d keeps repeated',
    'lines only, -u non-repeated only, -i compares case-insensitively.',
  ],
  wc: [
    'wc — count lines, words, chars, bytes',
    '',
    'SYNOPSIS',
    '  wc [-l | -w | -c | -m] [file...]',
    '',
    'Default prints lines, words and bytes. -c counts UTF-8 bytes, -m',
    'characters (code points). Several files add a `total` line.',
  ],
  head: [
    'head — print the first lines or bytes',
    '',
    'SYNOPSIS',
    '  head [-n N | -N] [-c N] [file...]',
    '',
    'Default 10 lines. -c N counts bytes (a multibyte character split by',
    'the cut decodes with a replacement marker, like the real tool).',
    'Several files get `==> f <==` headers.',
  ],
  tail: [
    'tail — print the last lines or bytes',
    '',
    'SYNOPSIS',
    '  tail [-n N | -N | -n +N] [-c N] [-f] [file...]',
    '',
    '`-n +N` starts at line N. -f is SIMULATED: it prints the slice and',
    'returns — the VFS has no change-watch API yet, so nothing follows.',
  ],
  cut: [
    'cut — select fields or characters per line',
    '',
    'SYNOPSIS',
    '  cut (-d C -f LIST | -c LIST) [file...]',
    '',
    'LIST is a comma list of N, N-, -M, N-M (1-based). Fields split on',
    'the -d delimiter (default TAB; selected fields are joined with it).',
    'Lines without the delimiter pass through whole (there is no -s).',
    '-c counts characters (code points).',
  ],
  tr: [
    'tr — translate, squeeze, delete characters',
    '',
    'SYNOPSIS',
    '  tr [-cds] SET1 [SET2]',
    '',
    'Reads stdin only (file operands are `extra operand` errors, like',
    'GNU). Sets accept a-z ranges, \\n \\t \\\\ escapes and [:upper:]',
    '[:lower:] [:digit:] [:alpha:] [:space:] [:alnum:] classes. A short',
    'SET2 repeats its last character; -d deletes SET1, -s squeezes',
    'repeats (of SET2 in translate mode, SET1 with -d), -c complements',
    'SET1 (with -d/-s only in this emulation).',
  ],
  tee: [
    'tee — copy stdin to files and stdout',
    '',
    'SYNOPSIS',
    '  tee [-a] [file...]',
    '',
    '-a appends instead of truncating. Read-only mounts report',
    '`Read-only file system`; one bad file does not stop the others.',
  ],
  xargs: [
    'xargs — build command lines from stdin',
    '',
    'SYNOPSIS',
    '  xargs [-0] [-n N] [-I STR] [-r] [CMD [ARG...]]',
    '',
    'Whitespace-separated stdin items are appended to CMD (default',
    'echo). -0 splits on NUL, -n N chunks items per invocation, -I STR',
    'replaces STR in the arguments once per item, -r skips the run on',
    'empty input (the default runs once, GNU-style). Exit 123 when any',
    'child invocation failed (1–125), 127 when CMD is missing.',
  ],
  nl: [
    'nl — number lines',
    '',
    'SYNOPSIS',
    '  nl [-b a|t] [-w N] [-s SEP] [file...]',
    '',
    '-b t (default) numbers non-empty lines only, -b a all. Numbers are',
    'right-aligned in -w columns (default 6) followed by the -s',
    'separator (default TAB).',
  ],
  rev: ['rev — reverse each line', '', 'SYNOPSIS', '  rev [file...]', '', 'Characters are reversed by code point (emoji survive).'],
  paste: [
    'paste — join files line-wise',
    '',
    'SYNOPSIS',
    '  paste [-d LIST] [-s] [file...]',
    '',
    'Parallel mode joins line i of every file (short files pad empty);',
    '-s pastes each file onto ONE line. -d LIST cycles delimiters per',
    'junction (default TAB); \\t \\n \\\\ escapes work. `-` reads stdin.',
  ],
  column: [
    'column — align whitespace-separated columns',
    '',
    'SYNOPSIS',
    '  column [-t] [file...]',
    '',
    'Only -t (table) is supported: input splits on blank runs and every',
    'column is padded to its widest cell (two spaces between columns).',
  ],
  fold: [
    'fold — wrap long lines',
    '',
    'SYNOPSIS',
    '  fold [-w N] [-s] [file...]',
    '',
    'Default width 80, counted in characters. -s breaks after the last',
    'blank in the window (the blank ends the segment, per the GNU',
    'implementation); without a blank the break is hard.',
  ],
  expand: [
    'expand — expand tabs to spaces',
    '',
    'SYNOPSIS',
    '  expand [-t N | -t LIST] [file...]',
    '',
    'Default tab stops every 8 columns. -t takes one size or an',
    'ascending comma list; tabs beyond the list repeat the last',
    'interval (util-linux behaviour). Unexpand lives in the fs lane.',
  ],
};
