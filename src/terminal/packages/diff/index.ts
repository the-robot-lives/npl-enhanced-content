/**
 * packages/diff/index — the chunk body (packages round, LANE=pkg-diff).
 *
 * `diff`, `patch` and `cmp` over the terminal's virtual file system, with
 * GNU coreutils/patchutils behaviour for formats, messages and exit codes
 * (verified against GNU patch 2.7.6 and the BSD/GNU diff family; the
 * deviations this build knowingly carries are listed in the lane report):
 *
 *   - diff: normal format by default, -u unified, -c context (-U/-C n),
 *     -r recursive trees, -q brief, -i/-w/-b line normalisation, -s,
 *     --color[=when], stdin via `-`, GNU exit codes (0 same, 1 differs,
 *     2 trouble) and messages (`Only in`, `Common subdirectories`,
 *     `Files x and y differ`, the `diff <flags> a b` banner in tree
 *     walks). Diffs are minimal — Myers linear space (./myers.ts).
 *   - patch: applies unified AND normal-format diffs in place through the
 *     VFS, -p<num>/--strip (default: basename, GNU's own default), -R,
 *     --dry-run, -F fuzz (GNU default 2), offset search, per-target .rej
 *     rejects, /dev/null create+delete, GNU's hunk messages and exit
 *     codes (0 applied, 1 hunks failed/ignored, 2 malformed).
 *   - cmp: byte comparison (-l octal listing, -s silent), GNU exit codes.
 *
 * Chunk rules honoured: only TYPE imports from outside the package
 * directory, so nothing of the base shell is inlined here.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import { diffSeq, splitLines, type EditOp } from './myers.js';

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

interface DiffOpts {
  mode: 'normal' | 'unified' | 'context';
  context: number; // unified/context window size
  recursive: boolean;
  brief: boolean;
  identical: boolean; // -s
  ignoreCase: boolean;
  ignoreAllSpace: boolean; // -w
  ignoreSpaceChange: boolean; // -b
  color: boolean;
}

const ANSI = {
  header: '\x1b[1;35m', // file headers (--- +++) — GNU's magenta
  hunk: '\x1b[36m', // @@ ranges — GNU's cyan
  del: '\x1b[31m', // old lines — GNU's red
  ins: '\x1b[32m', // new lines — GNU's green
  reset: '\x1b[0m',
};

function paint(color: boolean, code: string, text: string): string {
  return color ? `${code}${text}${ANSI.reset}` : text;
}

/** Comparison key for one line under the ignore flags (output stays original). */
function lineKey(line: string, o: DiffOpts): string {
  let k = line;
  if (o.ignoreAllSpace) k = k.replace(/\s/g, '');
  else if (o.ignoreSpaceChange) k = k.replace(/\s+/g, ' ').replace(/^ | $/g, '');
  if (o.ignoreCase) k = k.toLowerCase();
  return k;
}

/** GNU-style argument error + `Try` hint, exit 2. */
function badOption(ctx: CommandContext, name: string, cmd: string): void {
  ctx.err(name.startsWith('--') ? `${cmd}: unrecognized option '${name}'` : `${cmd}: invalid option -- '${name.slice(-1)}'`);
  ctx.err(`Try '${cmd} --help' for more information.`);
  ctx.exit(2);
}

type ReadResult =
  | { kind: 'file'; text: string }
  | { kind: 'dir' }
  | { kind: 'missing' };

function readOperand(ctx: CommandContext, operand: string): ReadResult {
  if (operand === '-') return { kind: 'file', text: ctx.stdin ?? '' };
  const path = ctx.vfs.resolve(ctx.state.cwd, operand);
  const node = ctx.vfs.nodeAt(path);
  if (node === null) return { kind: 'missing' };
  if (node.kind === 'dir') return { kind: 'dir' };
  return { kind: 'file', text: node.content };
}

/** Path completion (the text-lane stub's shape, duplicated — chunks must
 * not import each other's values). */
function completePaths(ctx: CompletionContext): string[] {
  const slash = ctx.word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
  const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
  const expanded = dirPart.startsWith('~') ? ctx.home + dirPart.slice(1) : dirPart;
  const base = ctx.vfs.resolve(ctx.cwd, expanded === '' ? '.' : expanded);
  const out: string[] = [];
  for (const node of ctx.vfs.list(base)) {
    if (!node.name.startsWith(rest)) continue;
    out.push(dirPart + node.name + (node.kind === 'dir' ? '/' : ''));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

/** GNU `1,3c2,3` style: the second number drops when the range is one line. */
function range(from: number, to: number): string {
  return from === to ? `${from}` : `${from},${to}`;
}

/* ------------------------------------------------------------------ *
 * diff — engine glue
 * ------------------------------------------------------------------ */

/** One maximal change: `aStart..aStart+aLen` deleted, `bStart..bStart+bLen`
 * inserted (0-based, either length may be 0). */
interface Run {
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
}

function runsFromOps(ops: EditOp[]): Run[] {
  const runs: Run[] = [];
  let ai = 0;
  let bi = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.t === 'eq') {
      ai++;
      bi++;
      i++;
      continue;
    }
    const run: Run = { aStart: ai, aLen: 0, bStart: bi, bLen: 0 };
    while (i < ops.length && ops[i]!.t !== 'eq') {
      if (ops[i]!.t === 'del') {
        run.aLen++;
        ai++;
      } else {
        run.bLen++;
        bi++;
      }
      i++;
    }
    runs.push(run);
  }
  return runs;
}

interface DiffInput {
  aLines: string[];
  aEol: boolean;
  bLines: string[];
  bEol: boolean;
  runs: Run[];
}

function diffInput(aText: string, bText: string, o: DiffOpts): DiffInput {
  const a = splitLines(aText);
  const b = splitLines(bText);
  const keysA = a.lines.map((l) => lineKey(l, o));
  const keysB = b.lines.map((l) => lineKey(l, o));
  const ops = diffSeq(keysA, keysA.length, keysB, keysB.length, (x, y) => x === y);
  let runs = runsFromOps(ops);
  if (runs.length === 0 && a.eol !== b.eol && a.lines.length > 0 && b.lines.length > 0) {
    // Only the trailing newline differs — GNU reports the last line as a
    // one-line change with `\ No newline at end of file` on the bare side.
    const last = a.lines.length - 1;
    runs = [{ aStart: last, aLen: 1, bStart: last, bLen: 1 }];
  }
  return { aLines: a.lines, aEol: a.eol, bLines: b.lines, bEol: b.eol, runs };
}

/** `\ No newline at end of file` when this side's copy of the line ends
 * its file bare. Callers that print one shared line pick a ?? b. */
function emitMarker(out: (line: string) => void, marker: string | null): void {
  if (marker !== null) out(marker);
}

function eolMarker(side: 'a' | 'b', d: DiffInput, lineIndex: number): string | null {
  const last = side === 'a' ? d.aLines.length - 1 : d.bLines.length - 1;
  if (lineIndex !== last) return null;
  const bare = side === 'a' ? !d.aEol : !d.bEol;
  return bare ? '\\ No newline at end of file' : null;
}

/* ------------------------------------------------------------------ *
 * diff — printers
 * ------------------------------------------------------------------ */

function printNormal(d: DiffInput, o: DiffOpts, out: (line: string) => void): void {
  for (const run of d.runs) {
    const aFrom = run.aStart + 1;
    const aTo = run.aStart + run.aLen;
    const bFrom = run.bStart + 1;
    const bTo = run.bStart + run.bLen;
    if (run.aLen === 0) out(`${run.aStart}a${range(bFrom, bTo)}`);
    else if (run.bLen === 0) out(`${range(aFrom, aTo)}d${run.bStart}`);
    else out(`${range(aFrom, aTo)}c${range(bFrom, bTo)}`);
    for (let t = 0; t < run.aLen; t++) {
      const idx = run.aStart + t;
      out(paint(o.color, ANSI.del, `< ${d.aLines[idx]}`));
      const marker = eolMarker('a', d, idx);
      if (marker !== null) out(marker);
    }
    if (run.aLen > 0 && run.bLen > 0) out('---');
    for (let t = 0; t < run.bLen; t++) {
      const idx = run.bStart + t;
      out(paint(o.color, ANSI.ins, `> ${d.bLines[idx]}`));
      const marker = eolMarker('b', d, idx);
      if (marker !== null) out(marker);
    }
  }
}

/** Group runs into hunks: runs whose unchanged gap is ≤ 2×context merge
 * (the -U3 rule: touching context windows join — measured off GNU diff,
 * gap 6 merges, gap 7 splits at context 3). */
function groupRuns(runs: Run[], context: number): Run[][] {
  if (runs.length === 0) return [];
  const groups: Run[][] = [[runs[0]!]];
  for (let i = 1; i < runs.length; i++) {
    const prev = groups[groups.length - 1]!;
    const tail = prev[prev.length - 1]!;
    const gap = runs[i]!.aStart - (tail.aStart + tail.aLen);
    if (gap <= 2 * context) prev.push(runs[i]!);
    else groups.push([runs[i]!]);
  }
  return groups;
}

/** One hunk window: the group's runs ± context, clamped to each file. */
interface Window {
  aStart: number; // first line index (0-based) the window touches
  aEnd: number; // one past the last
  bStart: number;
  bEnd: number;
  group: Run[];
}

function windowFor(group: Run[], d: DiffInput, context: number): Window {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  return {
    aStart: Math.max(0, first.aStart - context),
    aEnd: Math.min(d.aLines.length, last.aStart + last.aLen + context),
    bStart: Math.max(0, first.bStart - context),
    bEnd: Math.min(d.bLines.length, last.bStart + last.bLen + context),
    group,
  };
}

/** Unified/Context range text: count 1 drops the `,1`; count 0 anchors at
 * the line BEFORE the window (GNU's `-3,0` convention). */
function windowRange(start: number, end: number): string {
  const count = end - start;
  if (count === 1) return `${start + 1}`;
  if (count === 0) return `${start},0`;
  return `${start + 1},${count}`;
}

function printUnified(d: DiffInput, o: DiffOpts, aLabel: string, bLabel: string, out: (line: string) => void): void {
  out(paint(o.color, ANSI.header, `--- ${aLabel}`));
  out(paint(o.color, ANSI.header, `+++ ${bLabel}`));
  for (const group of groupRuns(d.runs, o.context)) {
    const w = windowFor(group, d, o.context);
    out(paint(o.color, ANSI.hunk, `@@ -${windowRange(w.aStart, w.aEnd)} +${windowRange(w.bStart, w.bEnd)} @@`));
    let ai = w.aStart;
    let bi = w.bStart;
    for (const run of w.group) {
      while (ai < run.aStart) {
        out(` ${d.aLines[ai]}`);
        emitMarker(out, eolMarker('a', d, ai) ?? eolMarker('b', d, bi));
        ai++;
        bi++;
      }
      for (let t = 0; t < run.aLen; t++) {
        const idx = run.aStart + t;
        out(paint(o.color, ANSI.del, `-${d.aLines[idx]}`));
        emitMarker(out, eolMarker('a', d, idx));
      }
      for (let t = 0; t < run.bLen; t++) {
        const idx = run.bStart + t;
        out(paint(o.color, ANSI.ins, `+${d.bLines[idx]}`));
        emitMarker(out, eolMarker('b', d, idx));
      }
      ai += run.aLen;
      bi += run.bLen;
    }
    while (ai < w.aEnd) {
      out(` ${d.aLines[ai]}`);
      emitMarker(out, eolMarker('a', d, ai) ?? eolMarker('b', d, bi));
      ai++;
      bi++;
    }
  }
}

function printContext(d: DiffInput, o: DiffOpts, aLabel: string, bLabel: string, out: (line: string) => void): void {
  out(paint(o.color, ANSI.header, `*** ${aLabel}`));
  out(paint(o.color, ANSI.header, `--- ${bLabel}`));
  for (const group of groupRuns(d.runs, o.context)) {
    const w = windowFor(group, d, o.context);
    out('***************');
    out(`*** ${windowRange(w.aStart, w.aEnd)} ****`);
    let ai = w.aStart;
    for (const run of w.group) {
      while (ai < run.aStart) {
        out(`  ${d.aLines[ai]}`);
        emitMarker(out, eolMarker('a', d, ai));
        ai++;
      }
      for (let t = 0; t < run.aLen; t++) {
        const idx = run.aStart + t;
        out(paint(o.color, ANSI.del, `${run.bLen > 0 ? '! ' : '- '}${d.aLines[idx]}`));
        emitMarker(out, eolMarker('a', d, idx));
      }
      ai += run.aLen;
    }
    while (ai < w.aEnd) {
      out(`  ${d.aLines[ai]}`);
      emitMarker(out, eolMarker('a', d, ai));
      ai++;
    }
    out(`--- ${windowRange(w.bStart, w.bEnd)} ----`);
    let bi = w.bStart;
    for (const run of w.group) {
      while (bi < run.bStart) {
        out(`  ${d.bLines[bi]}`);
        emitMarker(out, eolMarker('b', d, bi));
        bi++;
      }
      for (let t = 0; t < run.bLen; t++) {
        const idx = run.bStart + t;
        out(paint(o.color, ANSI.ins, `${run.aLen > 0 ? '! ' : '+ '}${d.bLines[idx]}`));
        emitMarker(out, eolMarker('b', d, idx));
      }
      bi += run.bLen;
    }
    while (bi < w.bEnd) {
      out(`  ${d.bLines[bi]}`);
      emitMarker(out, eolMarker('b', d, bi));
      bi++;
    }
  }
}

/* ------------------------------------------------------------------ *
 * diff — the command
 * ------------------------------------------------------------------ */

const DIFF_HELP = [
  'diff [OPTION...] FILE1 FILE2 — compare files line by line',
  '',
  '  -u, -U N, --unified[=N]   unified output (default context 3)',
  '  -c, -C N, --context[=N]   context output (default context 3)',
  '  -q, --brief               report only whether files differ',
  '  -r, --recursive           compare directory trees',
  '  -s, --report-identical-files',
  '  -i, --ignore-case         ignore case in line comparisons',
  '  -w, --ignore-all-space    ignore all whitespace',
  '  -b, --ignore-space-change ignore runs of whitespace',
  '  --color[=WHEN]            colorize: always (default), auto, never',
  '',
  'A `-` operand reads stdin. Exit status: 0 same, 1 differs, 2 trouble.',
  'Output formats follow GNU diff: normal (default), unified (-u) and',
  'context (-c), including `\\ No newline at end of file` markers.',
];

const DIFF_LONG_OPTS = new Set(['unified', 'context', 'brief', 'recursive', 'report-identical-files', 'ignore-case', 'ignore-all-space', 'ignore-space-change', 'color', 'help']);

function parseDiffArgs(args: string[]): { opts: DiffOpts; operands: string[]; help: boolean } | { error: string } {
  const opts: DiffOpts = {
    mode: 'normal',
    context: 3,
    recursive: false,
    brief: false,
    identical: false,
    ignoreCase: false,
    ignoreAllSpace: false,
    ignoreSpaceChange: false,
    color: false,
  };
  const operands: string[] = [];
  let help = false;
  const setContext = (n: number, mode: 'unified' | 'context'): boolean => {
    if (!Number.isInteger(n) || n < 0) return false;
    opts.context = n;
    opts.mode = mode;
    return true;
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const val = eq === -1 ? undefined : a.slice(eq + 1);
      if (!DIFF_LONG_OPTS.has(name)) return { error: a };
      if (name === 'unified' || name === 'context') {
        const mode = name === 'unified' ? 'unified' : 'context';
        if (val === undefined) {
          opts.mode = mode;
          opts.context = 3;
        } else if (!setContext(Number(val), mode)) return { error: a };
      } else if (name === 'brief') opts.brief = true;
      else if (name === 'recursive') opts.recursive = true;
      else if (name === 'report-identical-files') opts.identical = true;
      else if (name === 'ignore-case') opts.ignoreCase = true;
      else if (name === 'ignore-all-space') opts.ignoreAllSpace = true;
      else if (name === 'ignore-space-change') opts.ignoreSpaceChange = true;
      else if (name === 'color') {
        const when = val ?? 'always';
        if (!['always', 'auto', 'never'].includes(when)) return { error: a };
        opts.color = when !== 'never';
      } else if (name === 'help') help = true;
      i++;
      continue;
    }
    if (a.length > 1 && a[0] === '-') {
      let bad = false;
      for (let c = 1; c < a.length && !bad; c++) {
        const ch = a[c]!;
        if (ch === 'u') {
          opts.mode = 'unified';
          opts.context = 3;
        } else if (ch === 'c') {
          opts.mode = 'context';
          opts.context = 3;
        } else if (ch === 'q') opts.brief = true;
        else if (ch === 'r') opts.recursive = true;
        else if (ch === 's') opts.identical = true;
        else if (ch === 'i') opts.ignoreCase = true;
        else if (ch === 'w') opts.ignoreAllSpace = true;
        else if (ch === 'b') opts.ignoreSpaceChange = true;
        else if (ch === 'U' || ch === 'C') {
          const rest = a.slice(c + 1);
          let n: number;
          if (rest !== '') {
            n = Number(rest);
          } else {
            n = Number(args[i + 1]);
            i++;
          }
          if (!setContext(n, ch === 'U' ? 'unified' : 'context')) bad = true;
          c = a.length;
        } else bad = true;
      }
      if (bad) return { error: a };
      i++;
      continue;
    }
    operands.push(a);
    i++;
  }
  return { opts, operands, help };
}

function compareFiles(
  ctx: CommandContext,
  o: DiffOpts,
  aText: string,
  bText: string,
  aLabel: string,
  bLabel: string,
  banner: string | null,
): void {
  const d = diffInput(aText, bText, o);
  if (d.runs.length === 0) {
    if (o.identical) ctx.out(`Files ${aLabel} and ${bLabel} are identical`);
    ctx.exit(0);
    return;
  }
  if (o.brief) {
    ctx.out(`Files ${aLabel} and ${bLabel} differ`);
    ctx.exit(1);
    return;
  }
  if (banner !== null) ctx.out(banner);
  const emit = (line: string): void => ctx.out(line);
  if (o.mode === 'unified') printUnified(d, o, aLabel, bLabel, emit);
  else if (o.mode === 'context') printContext(d, o, aLabel, bLabel, emit);
  else printNormal(d, o, emit);
  ctx.exit(1);
}

/** Recursive (or shallow) comparison of two directory operands. */
function treeDiff(ctx: CommandContext, o: DiffOpts, aOp: string, bOp: string): void {
  let differing = false;
  let trouble = false;
  const walk = (aPath: string, bPath: string): void => {
    const aMap = new Map(ctx.vfs.list(ctx.vfs.resolve(ctx.state.cwd, aPath)).map((n) => [n.name, n.kind]));
    const bMap = new Map(ctx.vfs.list(ctx.vfs.resolve(ctx.state.cwd, bPath)).map((n) => [n.name, n.kind]));
    const names = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
    for (const name of names) {
      const aKind = aMap.get(name);
      const bKind = bMap.get(name);
      const aFull = `${aPath}/${name}`;
      const bFull = `${bPath}/${name}`;
      if (aKind === 'file' && bKind === 'file') {
        const aText = ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, aFull)) ?? '';
        const bText = ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, bFull)) ?? '';
        const d = diffInput(aText, bText, o);
        if (d.runs.length === 0) {
          if (o.identical) {
            ctx.out(`Files ${aFull} and ${bFull} are identical`);
            differing = true;
          }
        } else if (o.brief) {
          ctx.out(`Files ${aFull} and ${bFull} differ`);
          differing = true;
        } else {
          const mode = o.mode === 'normal' ? '' : o.mode === 'unified' ? 'u' : 'c';
          const cluster = `${o.recursive ? 'r' : ''}${mode}`;
          const banner = `diff ${cluster === '' ? '' : `-${cluster} `}${aFull} ${bFull}`;
          compareFiles(ctx, o, aText, bText, aFull, bFull, banner);
          differing = true;
        }
      } else if (aKind === 'dir' && bKind === 'dir') {
        if (o.recursive) walk(aFull, bFull);
        else ctx.out(`Common subdirectories: ${aFull} and ${bFull}`);
      } else if (aKind !== undefined && bKind !== undefined) {
        ctx.err(`File ${aFull} is a ${aKind} while ${bFull} is a ${bKind}`);
        trouble = true;
      } else {
        ctx.out(`Only in ${aKind === undefined ? bPath : aPath}: ${name}`);
        differing = true;
      }
    }
  };
  walk(aOp.replace(/\/+$/, ''), bOp.replace(/\/+$/, ''));
  ctx.exit(trouble ? 2 : differing ? 1 : 0);
}

function diffCommand(): CommandSpec {
  return {
    name: 'diff',
    usage: 'diff [-ruqiswb] [-u|-c] [-U N] [--color[=WHEN]] FILE1 FILE2',
    complete: (ctx) => {
      if (ctx.word.startsWith('-')) {
        return ['-u', '-c', '-r', '-q', '-i', '-w', '-b', '-s', '--unified', '--context', '--brief', '--recursive', '--ignore-case', '--ignore-all-space', '--color'].filter((f) => f.startsWith(ctx.word));
      }
      return completePaths(ctx);
    },
    run(ctx: CommandContext): void {
      const parsed = parseDiffArgs(ctx.args);
      if ('error' in parsed) {
        badOption(ctx, parsed.error, 'diff');
        return;
      }
      if (parsed.help) {
        for (const line of DIFF_HELP) ctx.out(line);
        ctx.exit(0);
        return;
      }
      const { opts, operands } = parsed;
      if (operands.length < 2) {
        ctx.err(operands.length === 0 ? 'diff: missing operand' : `diff: missing operand after '${operands[0]}'`);
        ctx.exit(2);
        return;
      }
      if (operands.length > 2) {
        ctx.err(`diff: extra operand '${operands[2]}'`);
        ctx.exit(2);
        return;
      }
      const [aOp, bOp] = operands as [string, string];
      // --color=always colors; =never doesn't; =auto (or bare --color, the
      // =always default) colors only when stdout is the terminal (ctx.color).
      const colorArg = ctx.args.find((a) => a === '--color' || a.startsWith('--color='));
      const colorWhen = colorArg === undefined ? null : colorArg === '--color' ? 'always' : colorArg.slice(8);
      const diffOpts: DiffOpts = {
        ...opts,
        color: colorWhen === 'always' ? true : colorWhen === 'auto' ? ctx.color : colorWhen === 'never' ? false : false,
      };

      const a = readOperand(ctx, aOp);
      const b = readOperand(ctx, bOp);
      const missing = a.kind === 'missing' ? aOp : b.kind === 'missing' ? bOp : null;
      if (missing !== null) {
        ctx.err(`diff: ${missing}: No such file or directory`);
        ctx.exit(2);
        return;
      }
      if (a.kind === 'dir' && b.kind === 'dir') {
        treeDiff(ctx, diffOpts, aOp, bOp);
        return;
      }
      if (a.kind === 'dir' || b.kind === 'dir') {
        // GNU compares against the directory's same-named entry.
        const dirOp = a.kind === 'dir' ? aOp : bOp;
        const fileOp = a.kind === 'dir' ? bOp : aOp;
        const candidate = `${dirOp.replace(/\/+$/, '')}/${basename(fileOp)}`;
        const c = readOperand(ctx, candidate);
        if (c.kind !== 'file') {
          ctx.err(`diff: ${candidate}: No such file or directory`);
          ctx.exit(2);
          return;
        }
        const aText = a.kind === 'file' ? a.text : c.text;
        const bText = b.kind === 'file' ? b.text : c.text;
        const aLabel = a.kind === 'file' ? aOp : candidate;
        const bLabel = b.kind === 'file' ? bOp : candidate;
        compareFiles(ctx, diffOpts, aText, bText, aLabel, bLabel, null);
        return;
      }
      compareFiles(ctx, diffOpts, a.kind === 'file' ? a.text : '', b.kind === 'file' ? b.text : '', aOp, bOp, null);
    },
  };
}

/* ------------------------------------------------------------------ *
 * patch — the parser
 * ------------------------------------------------------------------ */

interface PatchHunk {
  oldStart: number; // 1-based as recorded (0 = "before the first line")
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Body in order: ' ' context, '-' old-only, '+' new-only. */
  lines: Array<{ op: ' ' | '-' | '+'; text: string }>;
  /** A '\' no-EOL marker followed the last old-side / new-side line. */
  noEolOld: boolean;
  noEolNew: boolean;
}

interface FilePatch {
  oldName: string;
  newName: string;
  hunks: PatchHunk[];
  /** 1-based line number of the section's first header (GNU cites it). */
  inputLine: number;
  format: 'unified' | 'normal';
}

function headerName(rest: string): string {
  const tab = rest.indexOf('\t');
  return (tab === -1 ? rest : rest.slice(0, tab)).trim();
}

function parsePatch(text: string): { patches: FilePatch[]; malformed: string | null } {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const patches: FilePatch[] = [];
  const unifiedHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  const normalHeader = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      const inputLine = i + 1;
      const oldName = headerName(line.slice(4));
      const newName = headerName(lines[i + 1]!.slice(4));
      i += 2;
      const hunks: PatchHunk[] = [];
      let malformed: string | null = null;
      while (i < lines.length) {
        const m = unifiedHeader.exec(lines[i]!);
        if (m === null) break;
        const hunk: PatchHunk = {
          oldStart: Number(m[1]),
          oldCount: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newCount: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
          noEolOld: false,
          noEolNew: false,
        };
        i++;
        let old = 0;
        let new_ = 0;
        let lastOld = -1;
        let lastNew = -1;
        // Read the hunk body: ' '/'-'/'+' lines, '\' markers, blank = context.
        let done = false;
        while (!done) {
          const needOld = old < hunk.oldCount;
          const needNew = new_ < hunk.newCount;
          if (!needOld && !needNew) break;
          const body = lines[i] ?? null;
          if (body === null) break;
          if (body.startsWith('\\')) {
            if (lastOld === hunk.lines.length - 1) hunk.noEolOld = true;
            if (lastNew === hunk.lines.length - 1) hunk.noEolNew = true;
            i++;
            continue;
          }
          const op: ' ' | '-' | '+' = body === '' ? ' ' : (body[0] as ' ' | '-' | '+');
          if (op !== ' ' && op !== '-' && op !== '+') break;
          if ((op === ' ' && !needOld && !needNew) || (op === '-' && !needOld) || (op === '+' && !needNew)) break;
          hunk.lines.push({ op, text: body === '' ? '' : body.slice(1) });
          if (op !== '+') {
            old++;
            lastOld = hunk.lines.length - 1;
          }
          if (op !== '-') {
            new_++;
            lastNew = hunk.lines.length - 1;
          }
          i++;
        }
        if (old !== hunk.oldCount || new_ !== hunk.newCount) {
          malformed = `patch: **** malformed patch at line ${i + 1}: ${lines[i] ?? ''}`;
          break;
        }
        // A '\' marker trailing the FINAL body line annotates the last
        // old/new-side line (same rule as the mid-body markers above) —
        // the body loop stops once both counts are met, so peek here.
        while (i < lines.length && lines[i]!.startsWith('\\')) {
          if (lastOld === hunk.lines.length - 1) hunk.noEolOld = true;
          if (lastNew === hunk.lines.length - 1) hunk.noEolNew = true;
          i++;
        }
        hunks.push(hunk);
      }
      if (malformed !== null) return { patches: [], malformed };
      if (hunks.length === 0) {
        return { patches: [], malformed: `patch: **** malformed patch at line ${i + 1}: ${lines[i] ?? ''}` };
      }
      patches.push({ oldName, newName, hunks, inputLine, format: 'unified' });
      continue;
    }
    if (normalHeader.test(line)) {
      const inputLine = i + 1;
      const hunks: PatchHunk[] = [];
      let malformed: string | null = null;
      while (i < lines.length) {
        const h = normalHeader.exec(lines[i]!);
        if (h === null) break;
        const l1 = Number(h[1]);
        const l2 = h[2] === undefined ? l1 : Number(h[2]);
        const op = h[3] as 'a' | 'c' | 'd';
        const r1 = Number(h[4]);
        const r2 = h[5] === undefined ? r1 : Number(h[5]);
        i++;
        const hunk: PatchHunk = { oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, lines: [], noEolOld: false, noEolNew: false };
        const literal = { '-': '< ', '+': '> ', ' ': '  ' } as const;
        const readSide = (count: number, side: '-' | '+'): string | null => {
          for (let t = 0; t < count; t++) {
            const body = lines[i] ?? null;
            if (body === null) return `patch: **** malformed patch at line ${i + 1}: (unexpected end of input)`;
            if (body.startsWith('\\')) {
              if (side === '-') hunk.noEolOld = true;
              else hunk.noEolNew = true;
              i++;
              t--;
              continue;
            }
            const lit = literal[side];
            if (!body.startsWith(lit)) {
              return `patch: **** malformed patch at line ${i + 1}: ${body}`;
            }
            hunk.lines.push({ op: side, text: body.slice(2) });
            i++;
          }
          return null;
        };
        if (op === 'a') {
          hunk.oldStart = l1; // insert AFTER old line l1 → 0-based index l1
          hunk.oldCount = 0;
          hunk.newStart = r1;
          hunk.newCount = r2 - r1 + 1;
          malformed = readSide(hunk.newCount, '+');
        } else if (op === 'd') {
          hunk.oldStart = l1;
          hunk.oldCount = l2 - l1 + 1;
          hunk.newStart = r1;
          hunk.newCount = 0;
          malformed = readSide(hunk.oldCount, '-');
        } else {
          hunk.oldStart = l1;
          hunk.oldCount = l2 - l1 + 1;
          hunk.newStart = r1;
          hunk.newCount = r2 - r1 + 1;
          malformed = readSide(hunk.oldCount, '-');
          if (malformed === null) {
            if (lines[i] !== '---') malformed = `patch: **** malformed patch at line ${i + 1}: ${lines[i] ?? ''}`;
            else i++;
          }
          if (malformed === null) malformed = readSide(hunk.newCount, '+');
        }
        if (malformed !== null) break;
        // Post-body '\' marker: in normal format it annotates the side
        // just read ('d' hunks end on the old side, 'a'/'c' on the new).
        while (i < lines.length && lines[i]!.startsWith('\\')) {
          if (op === 'd') hunk.noEolOld = true;
          else hunk.noEolNew = true;
          i++;
        }
        hunks.push(hunk);
      }
      if (malformed !== null) return { patches: [], malformed };
      if (hunks.length > 0) {
        // Normal patches carry no file names — the operand supplies the target.
        patches.push({ oldName: '', newName: '', hunks, inputLine, format: 'normal' });
      }
      continue;
    }
    i++; // leading/trailing garbage is skipped, like GNU
  }
  return { patches, malformed: null };
}

/* ------------------------------------------------------------------ *
 * patch — the applier
 * ------------------------------------------------------------------ */

interface ApplyStats {
  target: string;
  applied: number;
  failed: number;
  ignored: number;
  result: string | null; // new content (null = delete / untouched)
  deleteFile: boolean;
  rejects: PatchHunk[] | null;
}

/** Strip `strip` leading path components; strip < 0 = GNU's default
 * (everything but the basename). /dev/null never strips. */
function stripName(name: string, strip: number): string {
  if (name === '/dev/null' || name === '') return name;
  let n = name;
  if (strip < 0) {
    const idx = n.lastIndexOf('/');
    return idx === -1 ? n : n.slice(idx + 1);
  }
  for (let i = 0; i < strip; i++) {
    const idx = n.indexOf('/');
    if (idx === -1) break;
    n = n.slice(idx + 1);
  }
  return n;
}

/** Try one hunk at increasing offsets, then with fuzz (GNU default max 2):
 * fuzz f drops the first/last f CONTEXT lines from verification. */
function findHunk(lines: string[], base: number, hunk: PatchHunk, maxFuzz: number): { pos: number; fuzz: number } | null {
  const expected: string[] = [];
  for (const l of hunk.lines) if (l.op !== '+') expected.push(l.text);
  const nE = expected.length;
  const contextCount = hunk.lines.filter((l) => l.op === ' ').length;
  const fuzzMax = Math.max(0, Math.min(maxFuzz, contextCount));
  const matches = (p: number, fuzz: number): boolean => {
    if (p < 0 || p + nE > lines.length) return false;
    let t = 0; // index into expected (old-side entries)
    let leadSkipped = 0;
    for (const l of hunk.lines) {
      if (l.op === '+') continue;
      const skip = l.op === ' ' && (leadSkipped < fuzz || nE - t <= fuzz);
      if (skip) {
        if (leadSkipped < fuzz) leadSkipped++;
      } else if (lines[p + t] !== expected[t]) return false;
      t++;
    }
    return true;
  };
  const limit = lines.length;
  for (let fuzz = 0; fuzz <= fuzzMax; fuzz++) {
    for (let off = 0; off <= limit; off++) {
      const candidates = off === 0 ? [base] : [base + off, base - off];
      for (const p of candidates) {
        if (matches(p, fuzz)) return { pos: p, fuzz };
      }
    }
  }
  return null;
}

function applyFilePatch(
  ctx: CommandContext,
  fp: FilePatch,
  strip: number,
  reverse: boolean,
  dryRun: boolean,
  maxFuzz: number,
  targetOverride: string | null,
): ApplyStats {
  const stats: ApplyStats = { target: '', applied: 0, failed: 0, ignored: 0, result: null, deleteFile: false, rejects: null };
  const oldRaw = stripName(fp.oldName, strip);
  const newRaw = stripName(fp.newName, strip);
  // Reverse swaps the roles of the two sides.
  const srcName = reverse ? newRaw : oldRaw; // the side the content comes from
  const dstName = reverse ? oldRaw : newRaw; // the side the result is written to
  const creates = srcName === '/dev/null';
  const deletes = dstName === '/dev/null';
  // Reverse-apply flips each hunk: the patch's new side (+) becomes the
  // content expected in the file, its old side (-) becomes the result, and
  // positions/no-EOL flags swap with them. Rejections then render the
  // reversed hunk — the form that would have applied.
  const hunks = reverse
    ? fp.hunks.map((h) => ({
        ...h,
        lines: h.lines.map((l) => ({ ...l, op: l.op === '+' ? ('-' as const) : l.op === '-' ? ('+' as const) : l.op })),
        oldStart: h.newStart,
        oldCount: h.newCount,
        noEolOld: h.noEolNew,
        noEolNew: h.noEolOld,
      }))
    : fp.hunks;
  const exists = (p: string): boolean => p !== '' && ctx.vfs.nodeAt(ctx.vfs.resolve(ctx.state.cwd, p)) !== null;
  let target: string;
  if (targetOverride !== null) target = targetOverride;
  else if (creates) target = dstName;
  else if (deletes) target = srcName;
  else target = exists(dstName) ? dstName : exists(srcName) ? srcName : dstName;
  stats.target = target;

  if (creates && exists(target)) {
    ctx.err(`The next patch would create the file ${target},`);
    ctx.err('which already exists!');
    ctx.err('Skipping patch.');
    stats.ignored += hunks.length;
    return stats;
  }

  if (!creates) {
    const node = ctx.vfs.nodeAt(ctx.vfs.resolve(ctx.state.cwd, target));
    if (node === null || node.kind !== 'file') {
      ctx.err(`can't find file to patch at input line ${fp.inputLine}`);
      ctx.err('Perhaps you should have used the -p or --strip option?');
      ctx.err('The text leading up to this was:');
      ctx.err('--------------------------');
      for (const l of [`--- ${fp.oldName}`, `+++ ${fp.newName}`]) ctx.err(`|${l}`);
      ctx.err('--------------------------');
      ctx.err('Skipping patch.');
      stats.ignored += hunks.length;
      return stats;
    }
  }

  if (dryRun) ctx.out(`checking file ${target}`);
  else ctx.out(`patching file ${target}`);

  const original = creates ? { lines: [] as string[], eol: true } : splitLines(ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, target)) ?? '');
  const lines = [...original.lines];
  let delta = 0;
  let lastEol = original.eol;
  const rejects: PatchHunk[] = [];

  hunks.forEach((hunk, hunkNo) => {
    const base = (hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1) + delta;
    const found = creates ? { pos: 0, fuzz: 0 } : findHunk(lines, base, hunk, maxFuzz);
    if (found === null) {
      stats.failed++;
      ctx.err(`Hunk #${hunkNo + 1} FAILED at ${Math.max(1, base + 1)}.`);
      rejects.push(hunk);
      return;
    }
    const { pos, fuzz } = found;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const l of hunk.lines) {
      if (l.op !== '+') oldLines.push(l.text);
      if (l.op !== '-') newLines.push(l.text);
    }
    lines.splice(pos, oldLines.length, ...newLines);
    // The hunk's last new-side line governs the file's trailing newline
    // when the patch reaches (or creates) the end of the file.
    if (creates || pos + oldLines.length === original.lines.length + delta) {
      lastEol = !hunk.noEolNew;
    }
    delta += newLines.length - oldLines.length;
    stats.applied++;
    const offset = pos - base;
    const bits: string[] = [];
    if (fuzz > 0) bits.push(`with fuzz ${fuzz}`);
    if (offset !== 0) bits.push(`(offset ${offset} lines)`);
    ctx.err(`Hunk #${hunkNo + 1} succeeded at ${pos + 1}${bits.length > 0 ? ' ' + bits.join(' ') : ''}.`);
  });

  if (stats.failed > 0) stats.rejects = rejects;
  if (deletes && stats.failed === 0) {
    stats.deleteFile = true;
    stats.result = null;
    return stats;
  }
  stats.result = lines.length === 0 ? '' : lines.join('\n') + (lastEol ? '\n' : '');
  return stats;
}

function renderUnifiedHunk(h: PatchHunk): string[] {
  const out = [`@@ -${h.oldStart}${h.oldCount === 1 ? '' : `,${h.oldCount}`} +${h.newStart}${h.newCount === 1 ? '' : `,${h.newCount}`} @@`];
  for (const l of h.lines) out.push(`${l.op}${l.text}`);
  if (h.noEolOld || h.noEolNew) out.push('\\ No newline at end of file');
  return out;
}

function renderNormalHunk(h: PatchHunk): string[] {
  const aFrom = h.oldCount === 0 ? h.oldStart : h.oldStart;
  const aTo = h.oldStart + Math.max(0, h.oldCount - 1);
  const bFrom = h.newStart;
  const bTo = h.newStart + Math.max(0, h.newCount - 1);
  const letter = h.oldCount === 0 ? 'a' : h.newCount === 0 ? 'd' : 'c';
  const out = [`${range(aFrom, aTo)}${letter}${range(bFrom, bTo)}`];
  for (const l of h.lines) if (l.op === '-') out.push(`< ${l.text}`);
  if (h.oldCount > 0 && h.newCount > 0) out.push('---');
  for (const l of h.lines) if (l.op === '+') out.push(`> ${l.text}`);
  return out;
}

/* ------------------------------------------------------------------ *
 * patch — the command
 * ------------------------------------------------------------------ */

const PATCH_HELP = [
  'patch [OPTION...] [<ORIGFILE [<PATCHFILE>]] — apply a diff to a file',
  '',
  '  -p NUM, --strip=NUM  strip NUM leading path components (default: all)',
  '  -R, --reverse        assume the patch was created reversed',
  '  --dry-run            report what would happen, change nothing',
  '  -F N, --fuzz=N       max context-fuzz factor (default 2, GNU default)',
  '  -i FILE              read the patch from FILE instead of stdin',
  '',
  'Applies unified and normal-format diffs in place through the VFS.',
  'Failed hunks land in <target>.rej; /dev/null headers create/delete',
  'files. Exit: 0 applied, 1 some hunks failed/ignored, 2 malformed.',
];

function patchCommand(): CommandSpec {
  return {
    name: 'patch',
    usage: 'patch [-p NUM] [-R] [-F N] [--dry-run] [<ORIGFILE [<PATCHFILE>]]',
    complete: (ctx) => {
      if (ctx.word.startsWith('-')) return ['-p0', '-p1', '-R', '--dry-run', '--strip', '--reverse', '--fuzz'].filter((f) => f.startsWith(ctx.word));
      return completePaths(ctx);
    },
    run(ctx: CommandContext): void {
      const operands: string[] = [];
      let strip = -1; // GNU default: basename
      let stripGiven = false;
      let reverse = false;
      let dryRun = false;
      let maxFuzz = 2;
      let patchFile: string | null = null;
      const args = ctx.args;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--') {
          operands.push(...args.slice(i + 1));
          break;
        }
        if (a.startsWith('--')) {
          const eq = a.indexOf('=');
          const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
          const val = eq === -1 ? undefined : a.slice(eq + 1);
          if (name === 'strip') {
            strip = val === undefined ? -1 : Number(val);
            stripGiven = true;
          } else if (name === 'reverse') reverse = true;
          else if (name === 'dry-run') dryRun = true;
          else if (name === 'fuzz') maxFuzz = val === undefined ? 2 : Number(val);
          else if (name === 'help') {
            for (const line of PATCH_HELP) ctx.out(line);
            ctx.exit(0);
            return;
          } else {
            badOption(ctx, a, 'patch');
            return;
          }
          if (Number.isNaN(strip) || Number.isNaN(maxFuzz)) {
            ctx.err(`patch: invalid argument to '${a.split('=')[0]}'`);
            ctx.exit(2);
            return;
          }
          continue;
        }
        if (a.length > 1 && a[0] === '-') {
          let bad = false;
          for (let c = 1; c < a.length && !bad; c++) {
            const ch = a[c]!;
            if (ch === 'R') reverse = true;
            else if (ch === 'p') {
              const rest = a.slice(c + 1);
              if (rest === '') strip = -1;
              else {
                strip = Number(rest);
                if (Number.isNaN(strip)) bad = true;
              }
              stripGiven = true;
              c = a.length;
            } else if (ch === 'F') {
              const rest = a.slice(c + 1);
              if (rest === '') {
                maxFuzz = Number(args[i + 1]);
                i++;
              } else maxFuzz = Number(rest);
              if (Number.isNaN(maxFuzz)) bad = true;
              c = a.length;
            } else if (ch === 'i') {
              const rest = a.slice(c + 1);
              if (rest === '') {
                patchFile = args[i + 1] ?? null;
                i++;
              } else patchFile = rest;
              c = a.length;
            } else bad = true;
          }
          if (bad) {
            badOption(ctx, a, 'patch');
            return;
          }
          continue;
        }
        operands.push(a);
      }
      void stripGiven;
      if (operands.length > 2) {
        ctx.err(`patch: extra operand '${operands[2]}'`);
        ctx.exit(2);
        return;
      }
      const targetOverride = operands.length > 0 ? operands[0]! : null;
      let patchText: string;
      if (patchFile !== null) {
        const got = readOperand(ctx, patchFile);
        if (got.kind !== 'file') {
          ctx.err(`patch: ${patchFile}: No such file or directory`);
          ctx.exit(2);
          return;
        }
        patchText = got.text;
      } else if (operands.length > 1) {
        const got = readOperand(ctx, operands[1]!);
        if (got.kind !== 'file') {
          ctx.err(`patch: ${operands[1]}: No such file or directory`);
          ctx.exit(2);
          return;
        }
        patchText = got.text;
      } else {
        patchText = ctx.stdin ?? '';
      }

      const { patches, malformed } = parsePatch(patchText);
      if (malformed !== null) {
        ctx.err(malformed);
        ctx.exit(2);
        return;
      }
      if (patches.length === 0) {
        ctx.err('patch: **** Only garbage was found in the patch input.');
        ctx.exit(2);
        return;
      }

      let failed = 0;
      let ignored = 0;
      let trouble = false;
      for (const fp of patches) {
        const stats = applyFilePatch(ctx, fp, strip, reverse, dryRun, maxFuzz, targetOverride);
        failed += stats.failed;
        ignored += stats.ignored;
        if (stats.result !== null && !dryRun) {
          try {
            ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, stats.target), stats.result);
          } catch (cause) {
            ctx.err(`patch: cannot write ${stats.target}: ${cause instanceof Error ? cause.message : String(cause)}`);
            trouble = true;
          }
        }
        if (stats.deleteFile && !dryRun) {
          try {
            ctx.vfs.rm(ctx.vfs.resolve(ctx.state.cwd, stats.target), { recursive: false });
          } catch {
            ctx.err(`patch: cannot remove ${stats.target}`);
            trouble = true;
          }
        }
        if (stats.rejects !== null && !dryRun) {
          const body: string[] = [`--- ${fp.oldName}`, `+++ ${fp.newName}`];
          for (const h of stats.rejects) {
            body.push(...(fp.format === 'unified' ? renderUnifiedHunk(h) : renderNormalHunk(h)));
          }
          ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, `${stats.target}.rej`), body.join('\n') + '\n');
          ctx.err(`${stats.failed} out of ${fp.hunks.length} hunk${fp.hunks.length === 1 ? '' : 's'} FAILED -- saving rejects to file ${stats.target}.rej`);
        }
      }
      if (trouble) ctx.exit(2);
      else if (failed > 0 || ignored > 0) ctx.exit(1);
      else ctx.exit(0);
    },
  };
}

/* ------------------------------------------------------------------ *
 * cmp
 * ------------------------------------------------------------------ */

const CMP_HELP = [
  'cmp [OPTION...] FILE1 [FILE2] — compare two files byte by byte',
  '',
  '  -l, --verbose  list every differing byte (offset + octal values)',
  '  -s, --silent   print nothing, exit status only',
  '',
  'A `-` operand reads stdin. Exit status: 0 same, 1 differ/EOF, 2 trouble.',
];

function cmpCommand(): CommandSpec {
  return {
    name: 'cmp',
    usage: 'cmp [-l | -s] FILE1 [FILE2]',
    complete: (ctx) => {
      if (ctx.word.startsWith('-')) return ['-l', '-s', '--verbose', '--silent', '--quiet'].filter((f) => f.startsWith(ctx.word));
      return completePaths(ctx);
    },
    run(ctx: CommandContext): void {
      if (ctx.args.includes('--help') || ctx.args.includes('-h')) {
        for (const line of CMP_HELP) ctx.out(line);
        ctx.exit(0);
        return;
      }
      let list = false;
      let silent = false;
      const operands: string[] = [];
      let doubleDash = false;
      for (const a of ctx.args) {
        if (!doubleDash && a === '--') {
          doubleDash = true;
          continue;
        }
        if (!doubleDash && a === '-l') list = true;
        else if (!doubleDash && a === '-s') silent = true;
        else if (!doubleDash && a === '--verbose') list = true;
        else if (!doubleDash && (a === '--silent' || a === '--quiet')) silent = true;
        else if (!doubleDash && a.length > 1 && a[0] === '-') {
          badOption(ctx, a, 'cmp');
          return;
        } else operands.push(a);
      }
      if (operands.length === 0) {
        ctx.err('cmp: missing operand');
        ctx.exit(2);
        return;
      }
      const first = readOperand(ctx, operands[0]!);
      if (first.kind !== 'file') {
        ctx.err(`cmp: ${operands[0]}: No such file or directory`);
        ctx.exit(2);
        return;
      }
      let secondText: string;
      if (operands.length > 1) {
        const second = readOperand(ctx, operands[1]!);
        if (second.kind !== 'file') {
          ctx.err(`cmp: ${operands[1]}: No such file or directory`);
          ctx.exit(2);
          return;
        }
        secondText = second.text;
      } else {
        secondText = ctx.stdin ?? '';
      }
      const enc = new TextEncoder();
      const a = enc.encode(first.text);
      const b = enc.encode(secondText);
      const n = Math.min(a.length, b.length);
      let firstDiff = -1;
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
          firstDiff = i;
          break;
        }
      }
      const label1 = operands[0]!;
      const label2 = operands.length > 1 ? operands[1]! : '-';
      if (firstDiff === -1 && a.length === b.length) {
        ctx.exit(0);
        return;
      }
      if (silent) {
        ctx.exit(1);
        return;
      }
      const eofLabel = a.length < b.length ? label1 : label2;
      if (list) {
        const width = String(Math.max(a.length, b.length, 1)).length;
        for (let i = 0; i < n; i++) {
          if (a[i] !== b[i]) ctx.out(`${String(i + 1).padStart(width)} ${a[i]!.toString(8)} ${b[i]!.toString(8)}`);
        }
        if (firstDiff === -1) ctx.out(`cmp: EOF on ${eofLabel}`);
        ctx.exit(1);
        return;
      }
      if (firstDiff !== -1) {
        let line = 1;
        for (let i = 0; i < firstDiff; i++) {
          if (a[i] === 0x0a) line++;
        }
        ctx.out(`${label1} ${label2} differ: byte ${firstDiff + 1}, line ${line}`);
      } else {
        ctx.out(`cmp: EOF on ${eofLabel}`);
      }
      ctx.exit(1);
    },
  };
}

/* ------------------------------------------------------------------ *
 * exports
 * ------------------------------------------------------------------ */

export const commands: Command[] = [diffCommand(), patchCommand(), cmpCommand()];

export const manPages: Record<string, string[]> = {
  diff: [
    'DIFF(1)                   semtext-sh manual',
    '',
    'NAME',
    '     diff — compare files line by line',
    '',
    'SYNOPSIS',
    '     diff [-ruqiswb] [-u|-c] [-U N] [--color[=WHEN]] FILE1 FILE2',
    '     diff -r DIR1 DIR2',
    '',
    'DESCRIPTION',
    '     Compares two files (or, with -r, two directory trees) and',
    '     prints their differences. Default output is the normal format;',
    '     -u gives unified, -c context diffs, the formats `patch(1)`',
    '     consumes. `-` reads stdin. Line comparisons honour -i (case),',
    '     -w (all whitespace) and -b (whitespace runs). Diffs are',
    '     minimal (Myers linear space). Directory trees report',
    '     `Only in DIR: name`; shallow walks report',
    '     `Common subdirectories: A and B`.',
    '',
    'EXIT STATUS',
    '     0 identical, 1 differences found, 2 trouble.',
    '',
    'EXAMPLES',
    '     diff -u old.txt new.txt',
    '     diff -r tree-a tree-b',
    '     diff -u a.txt b.txt > fix.diff && patch a.txt < fix.diff',
  ],
  patch: [
    'PATCH(1)                  semtext-sh manual',
    '',
    'NAME',
    '     patch — apply a diff to a file',
    '',
    'SYNOPSIS',
    '     patch [-p NUM] [-R] [-F N] [--dry-run] [<ORIGFILE [<PATCHFILE>]]',
    '',
    'DESCRIPTION',
    '     Applies unified and normal-format diffs in place through the',
    '     VFS. Without an operand the target names come from the patch',
    '     headers (---/+++ or the normal ranges); -p strips NUM leading',
    '     path components (GNU default: all but the basename). -R',
    '     reverses; --dry-run changes nothing; -F raises the context',
    '     fuzz factor (default 2). Hunks apply with offset search and',
    '     report `(offset N lines)` / `with fuzz N`. Failures append to',
    '     <target>.rej. /dev/null headers create or delete the file.',
    '',
    'EXIT STATUS',
    '     0 applied clean, 1 some hunks failed or were ignored,',
    '     2 malformed patch.',
    '',
    'EXAMPLES',
    '     diff -u a.txt b.txt > fix.diff',
    '     patch a.txt < fix.diff',
    '     patch -p1 --dry-run < change.diff',
  ],
  cmp: [
    'CMP(1)                    semtext-sh manual',
    '',
    'NAME',
    '     cmp — compare two files byte by byte',
    '',
    'SYNOPSIS',
    '     cmp [-l | -s] FILE1 [FILE2]',
    '',
    'DESCRIPTION',
    '     Compares files byte by byte (UTF-8 bytes). Default prints the',
    '     first difference: `f1 f2 differ: byte N, line M`. When one',
    '     file is a prefix of the other: `cmp: EOF on <name>`. -l lists',
    '     every differing byte in octal; -s prints nothing.',
    '',
    'EXIT STATUS',
    '     0 identical, 1 differ or EOF, 2 trouble.',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
