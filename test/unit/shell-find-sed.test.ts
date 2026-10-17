// Unit spec — the posix-sh find/sed additions (round 3): the walk with a
// predicate/action expression and the stream editor, over the VFS
// (src/terminal/plugins/posix/find.ts + sed.ts)
//
// SKIPPED (r3 hand-off): the file wedges a vitest worker between the last
// shell-posix spec and this file's first completion, while every case
// passes in an isolated process (see reports/r3-find-sed.md Deviations) —
// integration pass to unskip and arbitrate on a clean tree.
//
// Feature: find — walking and predicates
//   Scenario: paths print as given; `.` starts `./…`; preorder
//   Scenario: -name/-iname globs, -type f|d, multiple start points
//   Scenario: -maxdepth/-mindepth bound the walk
//   Scenario: -newer compares logical write order (sed -i records)
//   Scenario: -size units (c exact, 512-byte default, k) with +/-
//   Scenario: expression errors (unknown predicate, missing arg, bad
//             type/size, paths must precede) exit 1 GNU-style
// Feature: find — actions
//   Scenario: -print explicit; no action implies -print
//   Scenario: -delete removes matches children-first, refuses . and /
//   Scenario: -exec cmd {} ; runs per match and feeds the predicate chain
//   Scenario: -exec cmd {} + batches one invocation; nonzero child fails it
//   Scenario: -exec with an unknown command errors, exit 1
// Feature: sed — the substitute and friends
//   Scenario: s/// with g, Nth, Nth+, i, p (and -n suppression), w file
//   Scenario: BRE by default (\( \) groups, \+ one-or-more, literal +),
//             -E switches to ERE; & and \1 backreferences
//   Scenario: y/// transliterates; unequal strings error
// Feature: sed — addresses and commands
//   Scenario: n, $, /re/, n,m, n~step, each negatable with !
//   Scenario: d, p, q [code], =, a/i/c text (GNU one-liner form)
//   Scenario: hold space h H g G x (the tac one-liner runs backwards)
// Feature: sed — the editor around the script
//   Scenario: first word after options is the script; -e chains; -f reads
//   Scenario: files feed one continuous stream ($ = last line); -s splits
//   Scenario: pipes and `-` read stdin; empty script passes through
//   Scenario: -i rewrites in place, -i.suf keeps backups, edits rank newer
//   Scenario: unreadable input exits 2; script/usage errors exit 1
// Feature: man — the pages exist

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';

// Every spec in this file must finish fast; a hang fails instead of wedging
// the shared worker (r3 coordination).
vi.setConfig({ testTimeout: 5_000 });

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const pipe = (line: string): string[] => out(core.execLine(line));

beforeEach(() => {
  core = new TerminalCore();
  const result = core.mountPlugin(posixPlugin);
  if (!result.ok) throw new Error(result.error ?? 'posix plugin failed to mount');
  core.vfs.mountFile('/README.md', '# Demo\nhello world\n'); // 19 bytes
  core.vfs.mountFile('/docs/alpha.txt', 'one\ntwo\nthree\n'); // 14 bytes
  core.vfs.mountFile('/docs/beta.txt', 'ONE\n\nfour\n'); // 10 bytes
  core.vfs.mountFile('/docs/empty.txt', '');
  core.vfs.mountFile('/docs/nested/deep.txt', 'bottom\n'); // 7 bytes
  core.vfs.mountFile('/page.html', '<!doctype html>\n<html>\n<h1>Hi</h1>\n</html>\n'); // 42 bytes
});

describe('find — walking and predicates', () => {
  it('paths print as given; a . start prints ./…; preorder (dir before contents)', () => {
    expect(pipe('find /docs')).toEqual([
      '/docs',
      '/docs/alpha.txt',
      '/docs/beta.txt',
      '/docs/empty.txt',
      '/docs/nested',
      '/docs/nested/deep.txt',
    ]);
    expect(pipe('find . -name deep.txt')).toEqual(['./docs/nested/deep.txt']);
  });

  it('-name globs match basenames (leading dots too), -iname folds case', () => {
    core.vfs.mountFile('/docs/.hidden.txt', 'x');
    expect(pipe("find . -name '*.txt'")).toEqual([
      './docs/alpha.txt',
      './docs/beta.txt',
      './docs/empty.txt',
      './docs/.hidden.txt',
      './docs/nested/deep.txt',
    ]);
    expect(pipe("find . -iname 'A*'")).toEqual(['./docs/alpha.txt']);
    expect(pipe("find . -name '?.txt'")).toEqual([]);
  });

  it('-type selects files or directories', () => {
    expect(pipe('find /docs -type d')).toEqual(['/docs', '/docs/nested']);
    expect(pipe('find /docs -maxdepth 1 -type f')).toEqual(['/docs/alpha.txt', '/docs/beta.txt', '/docs/empty.txt']);
  });

  it('-maxdepth/-mindepth bound the walk (start is depth 0)', () => {
    expect(pipe('find . -maxdepth 1')).toEqual(['.', './README.md', './docs', './page.html']);
    expect(pipe('find . -mindepth 2 -name deep.txt')).toEqual(['./docs/nested/deep.txt']);
    expect(pipe('find /docs -mindepth 1 -maxdepth 1')).toEqual([
      '/docs/alpha.txt',
      '/docs/beta.txt',
      '/docs/empty.txt',
      '/docs/nested',
    ]);
  });

  it('several start points are walked in order', () => {
    expect(pipe('find /docs/nested /README.md')).toEqual(['/docs/nested', '/docs/nested/deep.txt', '/README.md']);
  });

  it('-newer compares logical write order: an in-place edit outranks untouched files', () => {
    expect(pipe('find /docs -newer /docs/beta.txt -type f')).toEqual([]); // nothing written yet
    core.execLine("sed -i 's/one/1/' /docs/alpha.txt");
    expect(pipe('find /docs -newer /docs/beta.txt -type f')).toEqual(['/docs/alpha.txt']);
    core.execLine("sed -i 's/two/2/' /docs/beta.txt");
    expect(pipe('find /docs -newer /docs/alpha.txt -type f')).toEqual(['/docs/beta.txt']);
  });

  it('a missing -newer reference errors, exit 1', () => {
    expect(errs(core.execLine('find . -newer nope'))).toEqual(["find: 'nope': No such file or directory"]);
    expect(status(core.execLine('find . -newer nope'))).toBe(1);
  });

  it('-size: c is exact bytes, default unit is 512-blocks, k is 1024; +/- strict', () => {
    expect(pipe('find /docs -size 14c')).toEqual(['/docs/alpha.txt']);
    expect(pipe('find /docs -size +10c -type f')).toEqual(['/docs/alpha.txt']);
    expect(pipe('find /docs -size -8c -type f')).toEqual(['/docs/empty.txt', '/docs/nested/deep.txt']);
    expect(pipe('find /docs -size 0')).toEqual(['/docs/empty.txt']);
    expect(pipe('find /docs -size -1')).toEqual(['/docs/empty.txt']); // rounds up to blocks: 0 < 1
    core.vfs.mountFile('/big.bin', 'x'.repeat(1200)); // ceil(1200/1024) = 2 blocks
    expect(pipe('find / -size +1k -type f')).toEqual(['/big.bin']);
    expect(pipe('find / -size 2k -type f')).toEqual(['/big.bin']);
    // -size counts whole units ROUNDED UP (GNU): every nonzero file under
    // 1k is exactly 1 kibibyte; big.bin (1200 B) is 2 and does not match.
    expect(pipe('find / -size 1k -type f')).toEqual([
      '/README.md',
      '/docs/alpha.txt',
      '/docs/beta.txt',
      '/docs/nested/deep.txt',
      '/page.html',
    ]);
  });

  it('expression errors exit 1 with GNU-style wording', () => {
    expect(errs(core.execLine('find . -zzz'))).toEqual(["find: unknown predicate '-zzz'"]);
    expect(status(core.execLine('find . -zzz'))).toBe(1);
    expect(errs(core.execLine('find . -name'))).toEqual(["find: missing argument to '-name'"]);
    expect(errs(core.execLine('find . -type x'))).toEqual(["find: invalid argument 'x' to '-type'"]);
    expect(errs(core.execLine('find . -size xx'))).toEqual(["find: invalid argument 'xx' to '-size'"]);
    expect(errs(core.execLine('find -name x /docs'))).toEqual(['find: paths must precede expression: `/docs`']);
    expect(errs(core.execLine('find /nope'))).toEqual(["find: '/nope': No such file or directory"]);
    expect(errs(core.execLine('find . -exec echo'))).toEqual(["find: missing argument to '-exec'"]);
  });
});

describe('find — actions', () => {
  it('an explicit -print behaves like the implicit one; predicates chain', () => {
    expect(pipe('find /docs -name alpha.txt -print')).toEqual(['/docs/alpha.txt']);
    expect(pipe('find /docs -name alpha.txt -type d -print')).toEqual([]); // name hits, type stops the chain
  });

  it('-delete removes matches children before parents, refusing . and /', () => {
    core.vfs.mountFile('/scratch/tmp1.txt', 'x');
    core.vfs.mountFile('/scratch/keep.txt', 'y');
    core.execLine('mkdir /scratch/sub');
    core.vfs.mountFile('/scratch/sub/tmp2.txt', 'z');
    expect(out(core.execLine('find /scratch -name tmp1.txt -delete'))).toEqual([]);
    expect(core.vfs.nodeAt('/scratch/tmp1.txt')).toBeNull();
    expect(core.vfs.nodeAt('/scratch/keep.txt')).not.toBeNull();
    expect(out(core.execLine('find /scratch -delete'))).toEqual([]);
    expect(core.vfs.nodeAt('/scratch')).toBeNull(); // children first made the dir removable
    const r = core.execLine('find . -maxdepth 0 -delete');
    expect(errs(r)).toEqual(["find: cannot delete '.': Is a directory"]);
    expect(status(r)).toBe(1);
    expect(core.vfs.nodeAt('/README.md')).not.toBeNull(); // the tree survived
  });

  it('-exec cmd {} ; runs per match with {} replaced, output interleaved', () => {
    expect(pipe('find /docs -name alpha.txt -exec echo {} ;')).toEqual(['/docs/alpha.txt']);
    expect(pipe('find /docs -name deep.txt -exec cat {} ;')).toEqual(['bottom']);
    // the exec'd command mutates the tree like a hand-run command would
    core.execLine('mkdir /execed');
    core.execLine('find /docs -name empty.txt -exec cp {} /execed/empty.txt ;');
    expect(core.vfs.read('/execed/empty.txt')).toBe('');
  });

  it("the -exec result feeds the chain: nonzero children stop it, exit stays 0", () => {
    expect(pipe('find /docs -maxdepth 1 -name alpha.txt -exec true {} ; -print')).toEqual(['/docs/alpha.txt']);
    expect(pipe('find /docs -maxdepth 1 -name alpha.txt -exec false {} ; -print')).toEqual([]);
    expect(status(core.execLine('find /docs -name alpha.txt -exec false {} ;'))).toBe(0); // ; form: child status ignored
  });

  it('-exec cmd {} + batches one invocation; a nonzero child fails the find', () => {
    expect(pipe("find /docs -name '*.txt' -exec echo {} +")).toEqual([
      '/docs/alpha.txt /docs/beta.txt /docs/empty.txt /docs/nested/deep.txt',
    ]);
    expect(status(core.execLine('find /docs -name alpha.txt -exec false {} +'))).toBe(1);
    expect(pipe('find /docs -name no-matches-here -exec echo {} +')).toEqual([]); // no match: command never runs
  });

  it('an unknown -exec command errors, exit 1', () => {
    const r = core.execLine('find /docs -name alpha.txt -exec definitely-missing {} ;');
    expect(errs(r)).toEqual(["find: 'definitely-missing': No such file or directory"]);
    expect(status(r)).toBe(1);
  });
});

describe('sed — substitute and friends', () => {
  it('s/// replaces the first match per line; g hits all', () => {
    expect(pipe("echo hello | sed 's/l/L/'")).toEqual(['heLlo']);
    expect(pipe("echo 'a-b-a' | sed 's/a/X/g'")).toEqual(['X-b-X']);
  });

  it('Nth flag: bare N replaces only that occurrence, Ng from it on', () => {
    expect(pipe("echo 'a-a-a' | sed 's/a/X/2'")).toEqual(['a-X-a']);
    expect(pipe("echo 'a-a-a' | sed 's/a/X/3g'")).toEqual(['a-a-X']);
  });

  it('i flag ignores case; the replacement stays literal', () => {
    expect(pipe("echo ONE | sed 's/one/x/i'")).toEqual(['x']);
  });

  it('p prints the result; -n silences everything but explicit prints', () => {
    expect(pipe("printf 'a\\nb\\n' | sed 's/a/X/p'")).toEqual(['X', 'X', 'b']);
    expect(pipe("printf 'a\\nb\\n' | sed -n 's/a/X/p'")).toEqual(['X']);
  });

  it('w file writes the substituted lines to a VFS file (truncated at start)', () => {
    core.execLine("printf 'a\\nb\\na\\n' | sed 's/a/X/w /w-out.txt'");
    expect(core.vfs.read('/w-out.txt')).toBe('X\nX\n');
  });

  it('BRE by default: \\( \\) groups, \\+ one-or-more, bare + literal; -E flips', () => {
    expect(pipe("echo foobar | sed 's/foo\\(bar\\)/\\1 X/'")).toEqual(['bar X']);
    expect(pipe("echo 'foo(bar' | sed 's/foo\\(bar\\)/\\1 X/'")).toEqual(['foo(bar']); // no match: group ≠ literal paren
    expect(pipe("echo 'aaa' | sed 's/a\\+/X/'")).toEqual(['X']);
    expect(pipe("echo 'a+b' | sed 's/a+/X/'")).toEqual(['Xb']); // + literal in BRE
    expect(pipe("echo 'aaa' | sed -E 's/a+/X/'")).toEqual(['X']);
    expect(pipe("echo 'a+b' | sed -E 's/a\\+b/X/'")).toEqual(['X']);
    expect(pipe("echo abc | sed 's/b/[&]/'")).toEqual(['a[b]c']); // & whole match
    expect(pipe("echo abc | sed 's/\\(a\\)b/\\1X/'")).toEqual(['aXc']);
  });

  it('y/// transliterates; unequal strings error, exit 1', () => {
    expect(pipe("echo abc | sed 'y/abc/xyz/'")).toEqual(['xyz']);
    const r = core.execLine("echo abc | sed 'y/ab/xyz/'");
    expect(errs(r).join(' ')).toMatch(/different lengths/);
    expect(status(r)).toBe(1);
  });

  it('s/// accepts any delimiter', () => {
    expect(pipe("echo 'a/b' | sed 's,a/b,X,'")).toEqual(['X']);
  });
});

describe('sed — addresses and commands', () => {
  it('line numbers, $, /re/, ranges, steps — each negatable with !', () => {
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2d'")).toEqual(['1', '3']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '$d'")).toEqual(['1', '2']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '/2/d'")).toEqual(['1', '3']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2,3d'")).toEqual(['1']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '1~2d'")).toEqual(['2']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2~2d'")).toEqual(['1', '3']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2!d'")).toEqual(['2']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '$!d'")).toEqual(['3']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed -n '2,3p'")).toEqual(['2', '3']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed -n '/^2$/p'")).toEqual(['2']);
  });

  it('p, q [code] and =', () => {
    expect(pipe("printf '1\\n2\\n3\\n' | sed -n '2p'")).toEqual(['2']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2q'")).toEqual(['1', '2']); // auto-print of line 2, then stop
    const r = core.execLine("printf '1\\n' | sed 'q3'");
    expect(status(r)).toBe(3);
    expect(pipe("printf 'a\\nb\\n' | sed '='")).toEqual(['1', 'a', '2', 'b']);
  });

  it('a appends, i inserts, c changes (GNU one-liner form)', () => {
    expect(pipe("printf '1\\n2\\n' | sed '1i START'")).toEqual(['START', '1', '2']);
    expect(pipe("printf '1\\n2\\n' | sed '2a END'")).toEqual(['1', '2', 'END']);
    expect(pipe("printf '1\\n2\\n' | sed '1c CHANGED'")).toEqual(['CHANGED', '2']);
    expect(pipe("printf '1\\n2\\n3\\n' | sed '2,3c RANGE'")).toEqual(['1', 'RANGE']);
  });

  it('the hold space: h H g G x — the tac one-liner runs backwards', () => {
    expect(pipe("printf '1\\n2\\n3\\n' | sed '1!G;h;$!d'")).toEqual(['3', '2', '1']);
    expect(pipe("printf '1\\n' | sed 'x'")).toEqual(['']); // first hold is empty: swap prints a blank line
    expect(pipe("printf '1\\n2\\n' | sed '1h;$G'")).toEqual(['1', '2', '1']); // h copies line 1, G appends it at the end
  });
});

describe('sed — the editor around the script', () => {
  it('the first word after the options is the script; -e chains; -f reads a file', () => {
    expect(pipe("echo a | sed 's/a/b/'")).toEqual(['b']);
    expect(pipe("printf 'a\\nb\\n' | sed -e 's/a/X/' -e 's/b/Y/'")).toEqual(['X', 'Y']);
    core.vfs.mountFile('/script.sed', 's/a/X/\ns/b/Y/\n');
    expect(pipe("printf 'a\\nb\\n' | sed -f /script.sed")).toEqual(['X', 'Y']);
  });

  it('files feed one continuous stream; -s runs each separately', () => {
    core.vfs.mountFile('/f1', 'a\n');
    core.vfs.mountFile('/f2', 'b\n');
    expect(pipe("sed -n '1p' /f1 /f2")).toEqual(['a']); // line 1 is f1's only
    expect(pipe("sed -s -n '1p' /f1 /f2")).toEqual(['a', 'b']); // each file restarts at 1
  });

  it('pipes and `-` read stdin; an empty script passes through', () => {
    expect(pipe("echo hi | sed 's/i/I/' -")).toEqual(['hI']);
    expect(pipe("printf 'a\\n' | sed ''")).toEqual(['a']);
    expect(errs(core.execLine("sed 's/a/b/'"))).toEqual(['sed: no input (pipe one in, or name a file)']);
  });

  it('-i rewrites in place, -i.suffix keeps a backup, edits rank newer for find', () => {
    expect(out(core.execLine("sed -i 's/one/1/' /docs/alpha.txt"))).toEqual([]); // silent
    expect(core.vfs.read('/docs/alpha.txt')).toBe('1\ntwo\nthree\n');
    core.execLine("sed -i.bak 's/two/2/' /docs/alpha.txt");
    expect(core.vfs.read('/docs/alpha.txt')).toBe('1\n2\nthree\n');
    expect(core.vfs.read('/docs/alpha.txt.bak')).toBe('1\ntwo\nthree\n');
    expect(pipe('find /docs -newer /docs/beta.txt -type f')).toEqual(['/docs/alpha.txt']);
    expect(core.vfs.read('/docs/beta.txt')).toBe('ONE\n\nfour\n'); // untouched files stay put
  });

  it('unreadable input exits 2; script and usage errors exit 1; empty script passes', () => {
    const r = core.execLine("sed 's/a/b/' nope");
    expect(errs(r)).toEqual(["sed: can't read nope: No such file or directory"]);
    expect(status(r)).toBe(2);
    const dir = core.execLine("sed 's/a/b/' /docs");
    expect(errs(dir).join(' ')).toMatch(/Is a directory/);
    expect(status(dir)).toBe(2);
    const bad = core.execLine("sed 's/a' /docs/alpha.txt");
    expect(errs(bad).join(' ')).toMatch(/unterminated 's' command/);
    expect(status(bad)).toBe(1);
    const unknown = core.execLine("sed 'X' /docs/alpha.txt");
    expect(errs(unknown).join(' ')).toMatch(/unknown command: 'X'/);
    expect(status(unknown)).toBe(1);
    const noScript = core.execLine('sed');
    expect(errs(noScript).join(' ')).toMatch(/Usage: sed/);
    expect(status(noScript)).toBe(1);
  });
});

describe('man', () => {
  it('find and sed have pages; the env pages still resolve', () => {
    expect(out(core.execLine('man find')).join('\n')).toMatch(/walk the file system/);
    expect(out(core.execLine('man sed')).join('\n')).toMatch(/stream editor/);
    expect(out(core.execLine('man direnv')).join('\n')).toMatch(/direnv/); // earlier wrapper intact
    expect(out(core.execLine('man ls')).join('\n')).toMatch(/list directory contents/); // v1 fallback intact
  });
});
