// Unit spec — the diff package (src/terminal/packages/diff/): Myers diff,
// GNU diff formats (normal/unified/context), recursive trees, patch apply
// (unified + normal, offset/fuzz/rejects, -R/--dry-run/-p), cmp, and the
// package contract (stub metadata, lazy load, man swap).
//
// Feature: myers.ts — the engine
//   Scenario: valid scripts (forward walk, sequential indexes, apply = b)
//   Scenario: minimal against brute-force LCS — seeded random + exhaustive
//             small alphabets, odd and even delta
//   Scenario: dels-before-inss run normalisation
//   Scenario: splitLines models eol as a flag; '' is zero lines
// Feature: diff — formats
//   Scenario: normal default (NaB/NcN/NdN, < / --- / >), add/delete forms
//   Scenario: -u unified (@@ ranges, count-1 omission, context merge)
//   Scenario: -c context (*** /*** headers, ! / - / + sections)
//   Scenario: `\ No newline at end of file` in all three formats
//   Scenario: --color[=when] paints headers/hunks/del/ins; auto respects tty
// Feature: diff — selection and operands
//   Scenario: exit codes 0/1/2; -q brief; -s identical; -i/-w/-b keys
//   Scenario: stdin via `-` through a pipe; missing operand → exit 2
//   Scenario: dir-vs-dir (-r recursion, Only in, Common subdirectories,
//             type mismatch exit 2), dir-vs-file basename lookup
//   Scenario: --help from the chunk; bad options GNU-style exit 2
//   Scenario: unicode + CRLF content diff as bytes-inside-lines
// Feature: patch — apply
//   Scenario: round-trip diff -u > file, patch file; stdin patch operand
//   Scenario: offset search message; fuzz application (GNU default 2)
//   Scenario: .rej rejects + exit 1; --dry-run changes nothing
//   Scenario: -R reverse restores; -p strip and GNU's basename default
//   Scenario: /dev/null create + delete; create-onto-existing skips
//   Scenario: normal-format patches; missing target guidance block
//   Scenario: malformed patch exit 2; garbage-only exit 2; no-EOL round trip
// Feature: cmp
//   Scenario: identical exit 0; first difference (byte, line); EOF side
//   Scenario: -l octal listing; -s silent; stdin operand; missing exit 2
// Feature: package contract
//   Scenario: stub entries match the chunk 1:1 (names + usage), manPages cover all
//   Scenario: --help before load from the stub; retry hint; failed load names
//             the chunk; delegation once resident; kick at creation; man swap

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage, type LazyPackage } from '../../src/terminal/packages/lazy.js';
import type { PackageModule } from '../../src/terminal/packages/types.js';
import { diffStub } from '../../src/terminal/packages/diff/stub.js';
import { diffSeq, splitLines, type EditOp } from '../../src/terminal/packages/diff/myers.js';
import * as diffChunk from '../../src/terminal/packages/diff/index.js';

vi.setConfig({ testTimeout: 5_000 });

let core: TerminalCore;

/** Test loader: the source-tree chunk (production uses semtext-pkg-diff.js). */
const chunkLoader = (): Promise<PackageModule> =>
  import('../../src/terminal/packages/diff/index.js') as Promise<PackageModule>;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const pipe = (line: string): string[] => out(core.execLine(line));
const code = (line: string): number => core.execLine(line).state.lastStatus;

const A = 'alpha\nbeta\ngamma\n';
const B = 'alpha\ndelta\ngamma\n';

beforeEach(() => {
  core = new TerminalCore();
  const mounted = core.mountPlugin(posixPlugin);
  if (!mounted.ok) throw new Error(mounted.error ?? 'posix plugin failed to mount');
  // Register the resident chunk's specs directly (the lazy behaviour gets its
  // own createLazyPackage section below).
  for (const spec of diffChunk.commands) core.commands.set(spec.name, spec);
  core.vfs.mountFile('/a.txt', A);
  core.vfs.mountFile('/b.txt', B);
  core.vfs.mountFile('/a2.txt', A); // identical twin
  core.vfs.mountFile('/empty.txt', '');
  core.vfs.mountFile('/one-two.txt', 'one\ntwo\n');
  core.vfs.mountFile('/noeol.txt', 'x\ny');
  core.vfs.mountFile('/eol.txt', 'x\ny\n');
  core.vfs.mountFile('/up.txt', 'Hello\n');
  core.vfs.mountFile('/lo.txt', 'hello\n');
  core.vfs.mountFile('/ws1.txt', 'a b\n');
  core.vfs.mountFile('/ws2.txt', 'ab\n');
  core.vfs.mountFile('/sp1.txt', 'a  b\n');
  core.vfs.mountFile('/sp2.txt', 'a b\n');
  core.vfs.mountFile('/u1.txt', 'héllo\nwörld\n');
  core.vfs.mountFile('/u2.txt', 'héllo\nwörld!\n');
  core.vfs.mountFile('/c1.txt', 'a\r\nb\r\n');
  core.vfs.mountFile('/c2.txt', 'a\r\nB\r\n');
});

/* ------------------------------------------------------------------ */
/* myers.ts — the engine                                               */
/* ------------------------------------------------------------------ */

/** Apply an edit script forward; asserts the structural invariants (the
 * a-indexes walk 0..na in order, b-inserts pull from b) and returns b. */
function applyOps<T>(a: T[], b: T[], ops: EditOp[]): T[] {
  const res: T[] = [];
  let ai = 0;
  for (const op of ops) {
    if (op.t === 'ins') {
      res.push(b[op.bi]!);
    } else {
      expect(op.ai).toBe(ai); // eq/del consume a strictly in order
      ai++;
      if (op.t === 'eq') res.push(a[op.ai]!);
    }
  }
  expect(ai).toBe(a.length);
  return res;
}

/** Reference minimal edit count: na + nb − 2·LCS (classic DP). */
function refEdits(a: readonly string[], b: readonly string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return a.length + b.length - 2 * dp[a.length]![b.length]!;
}

/** dels precede inss inside every change run (printer/applier contract). */
function normalized(ops: EditOp[]): boolean {
  for (let i = 1; i < ops.length; i++) {
    if (ops[i]!.t === 'del' && ops[i - 1]!.t === 'ins') return false;
  }
  return true;
}

function checkPair(a: string[], b: string[]): void {
  const ops = diffSeq(a, a.length, b, b.length, (x, y) => x === y);
  expect(normalized(ops)).toBe(true);
  expect(applyOps(a, b, ops)).toEqual(b);
  const real = ops.filter((o) => o.t !== 'eq').length;
  expect(real).toBe(refEdits(a, b));
}

describe('myers — the engine', () => {
  it('produces valid, minimal, normalized scripts on seeded random pairs', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alpha = ['x', 'y', 'z'];
    for (let t = 0; t < 400; t++) {
      const na = Math.floor(rnd() * 9);
      const nb = Math.floor(rnd() * 9);
      const a = Array.from({ length: na }, () => alpha[Math.floor(rnd() * 3)]!);
      const b = Array.from({ length: nb }, () => alpha[Math.floor(rnd() * 3)]!);
      checkPair(a, b);
    }
  });

  it('exhaustive over tiny alphabets, including empty inputs and odd/even delta', () => {
    const words: string[][] = [[]];
    for (let n = 1; n <= 3; n++) {
      for (const bits of [0, 1, 2, 3, 4, 5, 6, 7]) {
        words.push(Array.from({ length: n }, (_, i) => ((bits >> i) & 1) === 0 ? 'x' : 'y'));
      }
    }
    for (const a of words) for (const b of words) checkPair(a, b);
    // Explicit odd/even-delta shapes the middle-snake overlap logic cares about.
    checkPair(['1', '2', '3'], ['1', '3']);
    checkPair(['1', '2', '3', '4'], ['2', '3', '4']);
    checkPair(['1'], ['1', '2', '3']);
    checkPair(['a', 'b', 'c', 'd', 'e'], ['b', 'a', 'c', 'e', 'd']);
  });

  it('splitLines models the trailing newline as a flag, never a line', () => {
    expect(splitLines('')).toEqual({ lines: [], eol: true });
    expect(splitLines('a')).toEqual({ lines: ['a'], eol: false });
    expect(splitLines('a\n')).toEqual({ lines: ['a'], eol: true });
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], eol: false });
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], eol: true });
  });
});

/* ------------------------------------------------------------------ */
/* diff — formats                                                      */
/* ------------------------------------------------------------------ */

describe('diff — normal format (default)', () => {
  it('prints the change form for a modified line, exit 1', () => {
    expect(pipe('diff /a.txt /b.txt')).toEqual(['2c2', '< beta', '---', '> delta']);
    expect(code('diff /a.txt /b.txt')).toBe(1);
  });

  it('prints the add and delete forms with zero-length sides', () => {
    expect(pipe('diff /empty.txt /one-two.txt')).toEqual(['0a1,2', '> one', '> two']);
    expect(code('diff /empty.txt /one-two.txt')).toBe(1);
    expect(pipe('diff /one-two.txt /empty.txt')).toEqual(['1,2d0', '< one', '< two']);
  });

  it('reports a bare last line with the no-newline marker', () => {
    expect(pipe('diff /noeol.txt /eol.txt')).toEqual([
      '2c2',
      '< y',
      '\\ No newline at end of file',
      '---',
      '> y',
    ]);
  });
});

describe('diff — unified (-u) and context (-c)', () => {
  it('-u emits headers, @@ range and context', () => {
    expect(pipe('diff -u /a.txt /b.txt')).toEqual([
      '--- /a.txt',
      '+++ /b.txt',
      '@@ -1,3 +1,3 @@',
      ' alpha',
      '-beta',
      '+delta',
      ' gamma',
    ]);
    expect(pipe('diff -U 3 /a.txt /b.txt')).toEqual(pipe('diff -u /a.txt /b.txt'));
  });

  it('-u drops ,1 for one-line ranges and anchors zero-count ranges before', () => {
    core.vfs.mountFile('/one.txt', 'only\n');
    core.vfs.mountFile('/one-b.txt', 'only\nmore\n');
    expect(pipe('diff -u /one.txt /one-b.txt')).toEqual([
      '--- /one.txt',
      '+++ /one-b.txt',
      '@@ -1 +1,2 @@',
      ' only',
      '+more',
    ]);
    // Empty old file: the 0-line old side is anchored `-0,0` before line 1.
    core.vfs.mountFile('/pre.txt', 'top\nonly\n');
    core.vfs.mountFile('/empty.txt', '');
    expect(pipe('diff -u /empty.txt /pre.txt')).toEqual([
      '--- /empty.txt',
      '+++ /pre.txt',
      '@@ -0,0 +1,2 @@',
      '+top',
      '+only',
    ]);
  });

  it('-c emits the *** / --- header pair and both change sections', () => {
    expect(pipe('diff -c /a.txt /b.txt')).toEqual([
      '*** /a.txt',
      '--- /b.txt',
      '***************',
      '*** 1,3 ****',
      '  alpha',
      '! beta',
      '  gamma',
      '--- 1,3 ----',
      '  alpha',
      '! delta',
      '  gamma',
    ]);
    expect(pipe('diff -C 3 /a.txt /b.txt')).toEqual(pipe('diff -c /a.txt /b.txt'));
  });

  it('runs closer than 2×context merge into one hunk, farther split', () => {
    // gap 6 = 2×3: one hunk; gap 7: two hunks (GNU -U3 rule).
    const mk = (gap: number): { a: string; b: string } => {
      const fill = (n: number): string => Array.from({ length: n }, (_, i) => `f${i + 1}`).join('\n');
      return { a: `x\n${fill(gap)}\ny\n`, b: `X\n${fill(gap)}\nY\n` };
    };
    for (const gap of [6, 7]) {
      const { a, b } = mk(gap);
      core.vfs.mountFile('/g1.txt', a);
      core.vfs.mountFile('/g2.txt', b);
      const hunks = pipe('diff -u /g1.txt /g2.txt').filter((l) => l.startsWith('@@'));
      expect(hunks.length).toBe(gap === 6 ? 1 : 2);
    }
  });

  it('marks the bare side inside unified and context hunks', () => {
    expect(pipe('diff -u /noeol.txt /eol.txt')).toEqual([
      '--- /noeol.txt',
      '+++ /eol.txt',
      '@@ -1,2 +1,2 @@',
      ' x',
      '-y',
      '\\ No newline at end of file',
      '+y',
    ]);
    expect(pipe('diff -c /noeol.txt /eol.txt')).toEqual([
      '*** /noeol.txt',
      '--- /eol.txt',
      '***************',
      '*** 1,2 ****',
      '  x',
      '! y',
      '\\ No newline at end of file',
      '--- 1,2 ----',
      '  x',
      '! y',
    ]);
  });
});

describe('diff — color', () => {
  it('--color paints headers, hunk ranges, dels and inses', () => {
    expect(pipe('diff --color -u /a.txt /b.txt')).toEqual([
      '\x1b[1;35m--- /a.txt\x1b[0m',
      '\x1b[1;35m+++ /b.txt\x1b[0m',
      '\x1b[36m@@ -1,3 +1,3 @@\x1b[0m',
      ' alpha',
      '\x1b[31m-beta\x1b[0m',
      '\x1b[32m+delta\x1b[0m',
      ' gamma',
    ]);
  });

  it('--color=auto follows the tty flag (on for a plain command, off mid-pipeline); =never forces off', () => {
    // A final, unredirected stage IS the tty in this core, so auto paints…
    expect(pipe('diff --color=auto -u /a.txt /b.txt')).toEqual(pipe('diff --color=always -u /a.txt /b.txt'));
    // …and mid-pipeline the stage is not a tty, so auto stays plain…
    expect(pipe('diff --color=auto -u /a.txt /b.txt | cat')).toEqual(pipe('diff -u /a.txt /b.txt | cat'));
    // …while =never forces plain everywhere.
    expect(pipe('diff --color=never -u /a.txt /b.txt')).toEqual(pipe('diff -u /a.txt /b.txt'));
  });
});

/* ------------------------------------------------------------------ */
/* diff — selection and operands                                       */
/* ------------------------------------------------------------------ */

describe('diff — exit codes, brief/identical, ignore flags', () => {
  it('exit 0 identical (silent without -s), 1 differs, 2 trouble', () => {
    expect(code('diff /a.txt /a2.txt')).toBe(0);
    expect(pipe('diff /a.txt /a2.txt')).toEqual([]);
    expect(code('diff /a.txt /b.txt')).toBe(1);
    expect(code('diff /a.txt /nope.txt')).toBe(2);
  });

  it('-q brief reports differ/identical without a diff body', () => {
    expect(pipe('diff -q /a.txt /b.txt')).toEqual(['Files /a.txt and /b.txt differ']);
    expect(code('diff -q /a.txt /b.txt')).toBe(1);
    expect(pipe('diff -q /a.txt /a2.txt')).toEqual([]);
    expect(code('diff -q /a.txt /a2.txt')).toBe(0);
  });

  it('-s reports identical files', () => {
    expect(pipe('diff -s /a.txt /a2.txt')).toEqual(['Files /a.txt and /a2.txt are identical']);
    expect(code('diff -s /a.txt /a2.txt')).toBe(0);
    expect(pipe('diff -s /a.txt /b.txt')).toEqual(pipe('diff /a.txt /b.txt'));
  });

  it('-i folds case for comparison but prints original lines', () => {
    expect(code('diff /up.txt /lo.txt')).toBe(1);
    expect(code('diff -i /up.txt /lo.txt')).toBe(0);
  });

  it('-w ignores all whitespace, -b collapses runs (edges kept)', () => {
    expect(code('diff -w /ws1.txt /ws2.txt')).toBe(0);
    expect(code('diff -b /ws1.txt /ws2.txt')).toBe(1); // 'a b' vs 'ab' still differ
    expect(code('diff -b /sp1.txt /sp2.txt')).toBe(0);
  });

  it('- reads stdin through a pipe, labelled `-`', () => {
    expect(pipe('cat /b.txt | diff /a.txt -')).toEqual(['2c2', '< beta', '---', '> delta']);
    expect(pipe('cat /a.txt | diff - /a2.txt')).toEqual([]);
  });

  it('missing files, missing operands and bad options exit 2 GNU-style', () => {
    expect(errs(core.execLine('diff /a.txt /nope.txt'))).toEqual(['diff: /nope.txt: No such file or directory']);
    expect(errs(core.execLine('diff /a.txt'))).toEqual(["diff: missing operand after '/a.txt'"]);
    expect(code('diff')).toBe(2);
    expect(errs(core.execLine('diff -Z /a.txt /b.txt'))).toEqual([
      "diff: invalid option -- 'Z'",
      "Try 'diff --help' for more information.",
    ]);
    expect(errs(core.execLine('diff --frob /a.txt /b.txt'))).toEqual([
      "diff: unrecognized option '--frob'",
      "Try 'diff --help' for more information.",
    ]);
    expect(code('diff --color=bogus /a.txt /b.txt')).toBe(2);
  });

  it('--help prints the full usage from the chunk, exit 0', () => {
    const help = pipe('diff --help');
    expect(help[0]).toContain('diff [OPTION...]');
    expect(help.join('\n')).toContain('Exit status: 0 same, 1 differs, 2 trouble');
    expect(code('diff --help')).toBe(0);
  });

  it('unicode and CRLF content diff as bytes inside lines', () => {
    expect(pipe('diff /u1.txt /u2.txt')).toEqual(['2c2', '< wörld', '---', '> wörld!']);
    expect(pipe('diff /c1.txt /c2.txt')).toEqual(['2c2', '< b\r', '---', '> B\r']);
  });
});

describe('diff — directories', () => {
  beforeEach(() => {
    core.vfs.mountFile('/t1/x.txt', 'one\ntwo\nthree\n');
    core.vfs.mountFile('/t1/solo.txt', 'just here\n');
    core.vfs.mountFile('/t1/sub/y.txt', 'same\n');
    core.vfs.mountFile('/t2/x.txt', 'one\nTWO\nthree\n');
    core.vfs.mountFile('/t2/sub/y.txt', 'same\n');
    core.vfs.mkdir('/m1/kind', { parents: true });
    core.vfs.mountFile('/m2/kind', 'file here\n');
  });

  it('-r walks trees: Only in, per-file banners with flags, exit 1', () => {
    expect(pipe('diff -r /t1 /t2')).toEqual([
      'Only in /t1: solo.txt',
      'diff -r /t1/x.txt /t2/x.txt',
      '2c2',
      '< two',
      '---',
      '> TWO',
    ]);
    expect(code('diff -r /t1 /t2')).toBe(1);
  });

  it('without -r, common subdirectories are announced, not walked', () => {
    expect(pipe('diff /t1 /t2')).toEqual([
      'Only in /t1: solo.txt',
      'Common subdirectories: /t1/sub and /t2/sub',
      'diff /t1/x.txt /t2/x.txt',
      '2c2',
      '< two',
      '---',
      '> TWO',
    ]);
  });

  it('-q trees report file pairs briefly; -s names identical pairs', () => {
    expect(pipe('diff -q -r /t1 /t2')).toEqual(['Only in /t1: solo.txt', 'Files /t1/x.txt and /t2/x.txt differ']);
    expect(pipe('diff -s -r /t1 /t2')).toEqual([
      'Only in /t1: solo.txt',
      'Files /t1/sub/y.txt and /t2/sub/y.txt are identical',
      'diff -r /t1/x.txt /t2/x.txt',
      '2c2',
      '< two',
      '---',
      '> TWO',
    ]);
  });

  it('dir-vs-file operands look up the basename; tree kind mismatches exit 2', () => {
    expect(errs(core.execLine('diff /m1/kind /m2/kind'))).toEqual([
      'diff: /m1/kind/kind: No such file or directory',
    ]);
    expect(code('diff /m1/kind /m2/kind')).toBe(2);

    core.vfs.mountFile('/dir1/solo.txt', 'inside\n');
    core.vfs.mountFile('/solo.txt', 'outside\n');
    expect(pipe('diff /dir1 /solo.txt')).toEqual(['1c1', '< inside', '---', '> outside']);
    expect(code('diff /dir1 /solo.txt')).toBe(1);
    // A missing operand is reported before any dir-side lookup happens.
    expect(errs(core.execLine('diff /dir1 /nope.txt'))).toEqual(['diff: /nope.txt: No such file or directory']);
  });
});

/* ------------------------------------------------------------------ */
/* patch                                                               */
/* ------------------------------------------------------------------ */

describe('patch — apply', () => {
  it('round-trips diff -u output through a file and back', () => {
    expect(code('diff -u /a.txt /b.txt > /fix.diff')).toBe(1); // diff exits 1, redirect succeeds
    expect(core.vfs.read('/fix.diff')).toContain('@@ -1,3 +1,3 @@');
    const r = core.execLine('patch /a.txt /fix.diff');
    expect(out(r)).toEqual(['patching file /a.txt']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/a.txt')).toBe(B);
  });

  it('takes the patch on stdin and the target as the operand', () => {
    expect(code('diff -u /a.txt /b.txt > /fix.diff')).toBe(1);
    const r = core.execLine('cat /fix.diff | patch /a.txt');
    expect(out(r)).toEqual(['patching file /a.txt']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/a.txt')).toBe(B);
  });

  it('targets from ---/+++ headers when no operand is given', () => {
    core.vfs.mountFile('/orig.txt', A);
    core.vfs.mountFile('/hdr.diff', `--- /orig.txt\n+++ /orig.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+delta\n gamma\n`);
    const r2 = core.execLine('cat /hdr.diff | patch');
    expect(out(r2)).toEqual(['patching file orig.txt']); // default strips to the basename
    expect(status(r2)).toBe(0);
    expect(core.vfs.read('/orig.txt')).toBe(B);
  });

  it('searches offsets and reports them GNU-style', () => {
    core.vfs.mountFile('/off2.txt', '0\n1\n2\n3\n4\n5\n');
    core.vfs.mountFile(
      '/off.diff',
      '--- /off1.txt\n+++ /off1.txt\n@@ -1,3 +1,3 @@\n 1\n 2\n-3\n+X\n',
    );
    const r = core.execLine('patch /off2.txt /off.diff');
    expect(errs(r)).toEqual(['Hunk #1 succeeded at 2 (offset 1 lines).']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/off2.txt')).toBe('0\n1\n2\nX\n4\n5\n');
  });

  it('applies with fuzz up to the GNU default 2, reporting it', () => {
    core.vfs.mountFile('/fz.txt', 'z\nb\nc\nd\ne\n');
    core.vfs.mountFile(
      '/fz.diff',
      '--- /fzA.txt\n+++ /fzB.txt\n@@ -1,5 +1,5 @@\n a\n b\n-c\n+X\n d\n e\n',
    );
    const r = core.execLine('patch /fz.txt /fz.diff');
    expect(errs(r)).toEqual(['Hunk #1 succeeded at 1 with fuzz 1.']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/fz.txt')).toBe('a\nb\nX\nd\ne\n');
  });

  it('fails hunks that match nowhere, writes .rej and exits 1', () => {
    core.vfs.mountFile('/rj.txt', 'q\n');
    core.vfs.mountFile(
      '/rj.diff',
      '--- /rj.txt\n+++ /rj.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+delta\n gamma\n',
    );
    const r = core.execLine('patch /rj.txt /rj.diff');
    expect(out(r)).toEqual(['patching file /rj.txt']);
    expect(errs(r)).toEqual([
      'Hunk #1 FAILED at 1.',
      '1 out of 1 hunk FAILED -- saving rejects to file /rj.txt.rej',
    ]);
    expect(status(r)).toBe(1);
    expect(core.vfs.read('/rj.txt')).toBe('q\n'); // untouched
    expect(core.vfs.read('/rj.txt.rej')).toBe(
      '--- /rj.txt\n+++ /rj.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+delta\n gamma\n',
    );
  });

  it('--dry-run reports without changing anything, exit 0', () => {
    expect(code('diff -u /a.txt /b.txt > /fix.diff')).toBe(1);
    const r = core.execLine('patch --dry-run /a.txt /fix.diff');
    expect(out(r)).toEqual(['checking file /a.txt']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/a.txt')).toBe(A);
    expect(core.vfs.nodeAt('/a.txt.rej')).toBeNull();
  });

  it('-R applies the patch backwards', () => {
    core.vfs.mountFile('/rv.txt', B);
    core.vfs.mountFile(
      '/rv.diff',
      '--- /rv.txt\n+++ /rv.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+delta\n gamma\n',
    );
    const r = core.execLine('patch -R /rv.txt /rv.diff');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/rv.txt')).toBe(A);
  });

  it('-p strips path components; the GNU default strips to the basename', () => {
    core.vfs.mountFile('/f.txt', 'one\ntwo\nthree\n');
    core.vfs.mountFile(
      '/deep.diff',
      '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n',
    );
    const r = core.execLine('patch -p1 /f.txt /deep.diff');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/f.txt')).toBe('one\nTWO\nthree\n');

    core.vfs.mountFile('/g.txt', 'one\ntwo\nthree\n');
    const r2 = core.execLine('patch /g.txt /deep.diff'); // default: basename
    expect(status(r2)).toBe(0);
    expect(core.vfs.read('/g.txt')).toBe('one\nTWO\nthree\n');
  });

  it('/dev/null headers create files; onto-existing skips with GNU wording', () => {
    core.vfs.mountFile('/create.diff', '--- /dev/null\n+++ /created.txt\n@@ -0,0 +1 @@\n+fresh\n');
    const r = core.execLine('cat /create.diff | patch');
    expect(out(r)).toEqual(['patching file created.txt']); // default strips to the basename
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/created.txt')).toBe('fresh\n');

    const r2 = core.execLine('cat /create.diff | patch');
    expect(errs(r2)).toEqual([
      'The next patch would create the file created.txt,',
      'which already exists!',
      'Skipping patch.',
    ]);
    expect(status(r2)).toBe(1);
    expect(core.vfs.read('/created.txt')).toBe('fresh\n');
  });

  it('/dev/null on the new side deletes the file', () => {
    core.vfs.mountFile('/gone.txt', 'bye\n');
    core.vfs.mountFile('/delete.diff', '--- /gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n');
    const r = core.execLine('cat /delete.diff | patch');
    expect(status(r)).toBe(0);
    expect(core.vfs.nodeAt('/gone.txt')).toBeNull();
  });

  it('normal-format patches apply to the operand target', () => {
    core.vfs.mountFile('/nf.txt', 'one\ntwo\nthree\n');
    core.vfs.mountFile('/nf.diff', '2c2\n< two\n---\n> TWO\n');
    const r = core.execLine('cat /nf.diff | patch /nf.txt');
    expect(out(r)).toEqual(['patching file /nf.txt']);
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/nf.txt')).toBe('one\nTWO\nthree\n');
  });

  it('missing targets print the -p/--strip guidance block, exit 1', () => {
    core.vfs.mountFile('/miss.diff', '--- /absent.txt\n+++ /absent.txt\n@@ -1 +1 @@\n-a\n+b\n');
    const r = core.execLine('cat /miss.diff | patch');
    expect(errs(r)).toEqual([
      "can't find file to patch at input line 1",
      'Perhaps you should have used the -p or --strip option?',
      'The text leading up to this was:',
      '--------------------------',
      '|--- /absent.txt',
      '|+++ /absent.txt',
      '--------------------------',
      'Skipping patch.',
    ]);
    expect(status(r)).toBe(1);
  });

  it('malformed patches exit 2 with the GNU line report', () => {
    core.vfs.mountFile('/bad.diff', '--- /x.txt\n+++ /x.txt\n@@ -1,2 +1,2 @@\n a\n-b\n');
    const r = core.execLine('cat /bad.diff | patch');
    expect(errs(r)).toEqual(['patch: **** malformed patch at line 6: ']);
    expect(status(r)).toBe(2);
  });

  it('patch input with no recognizable sections is garbage, exit 2', () => {
    core.vfs.mountFile('/junk.txt', 'hello world\nnothing to see\n');
    const r = core.execLine('patch /junk.txt');
    expect(errs(r)).toEqual(['patch: **** Only garbage was found in the patch input.']);
    expect(status(r)).toBe(2);
  });

  it('round-trips a no-trailing-newline file without adding one', () => {
    core.vfs.mountFile('/n1.txt', 'x\ny'); // bare last line
    core.vfs.mountFile('/n2.txt', 'x\nY');
    expect(code('diff -u /n1.txt /n2.txt > /n.diff')).toBe(1);
    expect(core.vfs.read('/n.diff')).toContain('\\ No newline at end of file');
    const r = core.execLine('patch /n1.txt /n.diff');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/n1.txt')).toBe('x\nY'); // still bare

    const r2 = core.execLine('patch -R /n1.txt /n.diff');
    expect(status(r2)).toBe(0);
    expect(core.vfs.read('/n1.txt')).toBe('x\ny');
  });

  it('multiple hunks apply in order with tracked positions', () => {
    core.vfs.mountFile('/multi.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
    core.vfs.mountFile('/multi.diff', [
      '--- /multi.txt',
      '+++ /multi.txt',
      '@@ -1,2 +1,2 @@',
      '-1',
      '+ONE',
      ' 2',
      '@@ -9,2 +9,3 @@',
      ' 9',
      '+9b',
      ' 10',
      '',
    ].join('\n'));
    const r = core.execLine('patch /multi.txt /multi.diff');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/multi.txt')).toBe('ONE\n2\n3\n4\n5\n6\n7\n8\n9\n9b\n10\n');
  });
});

describe('cmp', () => {
  it('identical files exit 0 silently', () => {
    expect(pipe('cmp /a.txt /a2.txt')).toEqual([]);
    expect(code('cmp /a.txt /a2.txt')).toBe(0);
  });

  it('the first differing byte is reported with its line, exit 1', () => {
    core.vfs.mountFile('/x1.txt', 'a\n');
    core.vfs.mountFile('/x2.txt', 'ax\n');
    expect(pipe('cmp /x1.txt /x2.txt')).toEqual(['/x1.txt /x2.txt differ: byte 2, line 1']);
    expect(code('cmp /x1.txt /x2.txt')).toBe(1);
  });

  it('line numbers count newlines before the difference', () => {
    core.vfs.mountFile('/l1.txt', 'one\ntwo\nthree\n');
    core.vfs.mountFile('/l2.txt', 'one\ntwo\nTHREE\n');
    expect(pipe('cmp /l1.txt /l2.txt')).toEqual(['/l1.txt /l2.txt differ: byte 9, line 3']);
  });

  it('a prefix file reports EOF on the short side', () => {
    core.vfs.mountFile('/p1.txt', 'a\n');
    core.vfs.mountFile('/p2.txt', 'a\nb\n');
    expect(pipe('cmp /p1.txt /p2.txt')).toEqual(['cmp: EOF on /p1.txt']);
    expect(pipe('cmp /p2.txt /p1.txt')).toEqual(['cmp: EOF on /p1.txt']);
    expect(code('cmp /p1.txt /p2.txt')).toBe(1);
  });

  it('-l lists every differing byte in octal; -s prints nothing', () => {
    core.vfs.mountFile('/x1.txt', 'a\n');
    core.vfs.mountFile('/x2.txt', 'ax\n');
    expect(pipe('cmp -l /x1.txt /x2.txt')).toEqual(['2 12 170']);
    expect(code('cmp -l /x1.txt /x2.txt')).toBe(1);
    expect(pipe('cmp -s /x1.txt /x2.txt')).toEqual([]);
    expect(code('cmp -s /x1.txt /x2.txt')).toBe(1);
    expect(code('cmp -s /a.txt /a2.txt')).toBe(0);
  });

  it('stdin works as either operand; multibyte compares as UTF-8 bytes', () => {
    expect(pipe('cat /a.txt | cmp - /a2.txt')).toEqual([]);
    core.vfs.mountFile('/m1.txt', 'é\n');
    core.vfs.mountFile('/m2.txt', 'e\n');
    expect(pipe('cmp /m1.txt /m2.txt')).toEqual(['/m1.txt /m2.txt differ: byte 1, line 1']);
  });

  it('missing files and missing operands exit 2', () => {
    expect(errs(core.execLine('cmp /a.txt /nope.txt'))).toEqual(['cmp: /nope.txt: No such file or directory']);
    expect(code('cmp /a.txt /nope.txt')).toBe(2);
    expect(errs(core.execLine('cmp'))).toEqual(['cmp: missing operand']);
    expect(code('cmp')).toBe(2);
  });

  it('--help exits 0', () => {
    expect(code('cmp --help')).toBe(0);
    expect(pipe('cmp --help').join('\n')).toContain('byte by byte');
  });
});

/* ------------------------------------------------------------------ */
/* package contract                                                    */
/* ------------------------------------------------------------------ */

describe('diff package contract', () => {
  it('stub entries match the chunk 1:1 in name and usage; manPages cover all', () => {
    const stubNames = diffStub.commands.map((c) => c.name);
    const chunkNames = diffChunk.commands.map((c) => c.name);
    expect(stubNames).toEqual(['diff', 'patch', 'cmp']);
    expect(chunkNames).toEqual(stubNames);
    for (const s of diffStub.commands) {
      const c = diffChunk.commands.find((x) => x.name === s.name)!;
      expect(c.usage).toBe(s.usage);
    }
    for (const name of stubNames) {
      expect(diffChunk.manPages?.[name]?.length ?? 0).toBeGreaterThan(3);
      expect(diffStub.commands.find((c) => c.name === name)?.man?.length ?? 0).toBeGreaterThan(3);
    }
  });

  it('answers --help from the stub without loading the chunk', () => {
    const pkg: LazyPackage = createLazyPackage(diffStub, () => new Promise(() => {}));
    const fresh = new TerminalCore();
    for (const spec of pkg.commands) fresh.commands.set(spec.name, spec);
    const ctxArgs = ['--help'];
    void ctxArgs;
    const r = fresh.execLine('patch --help');
    expect(r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text)).toEqual([diffStub.commands[1]!.usage]);
    expect(r.state.lastStatus).toBe(0);
    expect(pkg.loaded()).toBe(false);
  });

  it('an invocation that beats the fetch gets the retry hint, exit 1', () => {
    const pkg = createLazyPackage(diffStub, () => new Promise(() => {}));
    const fresh = new TerminalCore();
    for (const spec of pkg.commands) fresh.commands.set(spec.name, spec);
    const r = fresh.execLine('diff /a.txt /b.txt');
    expect(r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text)).toEqual(['diff: chunk still loading — try again']);
    expect(r.state.lastStatus).toBe(1);
  });

  it('a failed load names the chunk and exits 1; help still works', async () => {
    const pkg = createLazyPackage(
      diffStub,
      () => new Promise((_resolve, reject) => reject(new TypeError('failed to fetch'))),
    );
    await pkg.ensure();
    const fresh = new TerminalCore();
    for (const spec of pkg.commands) fresh.commands.set(spec.name, spec);
    const r = fresh.execLine('patch /a.txt /fix.diff');
    expect(r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text)).toEqual([
      'patch: package chunk failed to load (semtext-pkg-diff.js)',
    ]);
    expect(r.state.lastStatus).toBe(1);
    const h = fresh.execLine('cmp --help');
    expect(h.state.lastStatus).toBe(0);
  });

  it('delegates to the chunk once resident and kicks the loader at creation', () => {
    const loader = vi.fn(chunkLoader);
    const pkg = createLazyPackage(diffStub, loader);
    expect(loader).toHaveBeenCalledTimes(1); // boot-parallel preload
    return pkg.ensure().then((ok) => {
      expect(ok).toBe(true);
      expect(pkg.loaded()).toBe(true);
      const fresh = new TerminalCore();
      fresh.mountPlugin(posixPlugin);
      for (const spec of pkg.commands) fresh.commands.set(spec.name, spec);
      fresh.vfs.mountFile('/a.txt', A);
      fresh.vfs.mountFile('/b.txt', B);
      const r = fresh.execLine('diff /a.txt /b.txt');
      expect(r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text)).toEqual(['2c2', '< beta', '---', '> delta']);
      // man pages swap to the full chunk pages once resident.
      expect(pkg.manPage('diff')![0]).toBe('DIFF(1)                   semtext-sh manual');
      expect(pkg.manPage('patch')).toEqual(diffChunk.manPages!['patch']);
      expect(pkg.manPage('cmp')).toEqual(diffChunk.manPages!['cmp']);
    });
  });
});
