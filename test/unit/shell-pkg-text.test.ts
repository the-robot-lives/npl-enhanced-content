// Unit spec — the text package (src/terminal/packages/text/): GNU-style
// grep/sort/uniq/wc/head/tail/cut/tr/tee/xargs/nl/rev/paste/column/fold/expand
// plus the package contract (stub metadata, lazy load, supersede).
//
// Feature: grep
//   Scenario: plain/-i/-v/-n/-c/-l/-L/-o/-w/-x selection over files and pipes
//   Scenario: -E alternation, -F literals, BRE \\+ alternation-adjacent forms
//   Scenario: -r directory walks with ./ labels; dirs without -r error (exit 2)
//   Scenario: -A/-B/-C context groups separated by --; --color=always paints
//   Scenario: exit statuses 0 match, 1 none, 2 error (missing file, bad regex)
// Feature: sort
//   Scenario: plain/-r/-n/-u; -k2 with -t:; -h human sizes; -V version order
//   Scenario: keys tie-break on the whole line; -u dedupes by key only
// Feature: uniq — adjacent collapse, -c counts, -d/-u/-i
// Feature: wc — default l/w/c, -m chars vs -c bytes on multibyte, totals
// Feature: head/tail — -n/-N/-c, tail -n +N, multi-file headers, -c 0 empty
// Feature: cut — -d/-f lists, -c chars, delimiter-less passthrough, errors
// Feature: tr — translate with ranges/classes, -d delete, -s squeeze, errors
// Feature: tee — passthrough + write, -a append, several files, read-only, dir
// Feature: xargs — echo default, -n chunks, -I replace, -0 NUL, -r, exit 123/127
// Feature: nl/rev/paste/column/fold/expand — happy paths + flags + edge cases
// Feature: package contract
//   Scenario: stub entries match the chunk 1:1 (names + usage), manPages cover all
//   Scenario: the package registers over the posix same-named commands
//   Scenario: --help is answered from the stub before the chunk arrives;
//             once resident the chunk's specs own even --help
//   Scenario: an invocation that beats the fetch gets a retry hint; a
//             failed load names the chunk and exits 1; man pages swap

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import type { VfsBackend } from '../../src/terminal/vfs.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import type { PackageModule } from '../../src/terminal/packages/types.js';
import { textStub } from '../../src/terminal/packages/text/stub.js';

let core: TerminalCore;

/** Test loader: the source-tree chunk (production uses semtext-pkg-text.js). */
const chunkLoader = (): Promise<PackageModule> =>
  import('../../src/terminal/packages/text/index.js') as Promise<PackageModule>;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;

beforeEach(async () => {
  core = new TerminalCore();
  const mounted = core.mountPlugin(posixPlugin);
  if (!mounted.ok) throw new Error(mounted.error ?? 'posix plugin failed to mount');
  // Package-supersedes-base: the shell-side resolution of "the package
  // replaces the simpler posix grep/wc/head/tail" is a cross-lane open
  // question (mountPlugin rejects duplicate names atomically); tests
  // register via commands.set, which is what such a mount reduces to.
  const pkg = createLazyPackage(textStub, chunkLoader);
  await pkg.ensure();
  for (const spec of pkg.commands) core.commands.set(spec.name, spec);
  core.vfs.mountFile('/docs/alpha.txt', 'one\ntwo\nthree\n');
  core.vfs.mountFile('/docs/beta.txt', 'ONE\n\nfour\n');
  core.vfs.mountFile('/docs/nested/deep.txt', 'bottom\n');
  core.vfs.mountFile('/nums.txt', '10\n9\n10\n2\n');
  core.vfs.mountFile('/empty.txt', '');
  core.vfs.mountFile('/crlf.txt', 'one\r\ntwo\r\n');
});

const run = (line: string): ExecResult => core.execLine(line);

/* ------------------------------------------------------------------ */
/* grep                                                                */
/* ------------------------------------------------------------------ */

describe('grep', () => {
  it('matches lines in a file and from a pipe, exit 0', () => {
    expect(out(run('grep two /docs/alpha.txt'))).toEqual(['/docs/alpha.txt:two']);
    expect(status(run('grep two /docs/alpha.txt'))).toBe(0);
    expect(out(run('cat /docs/alpha.txt | grep two'))).toEqual(['two']);
  });

  it('exit 1 on no match, exit 2 on missing file and bad regex', () => {
    expect(status(run('grep zz /docs/alpha.txt'))).toBe(1);
    expect(out(run('grep zz /docs/alpha.txt'))).toEqual([]);
    expect(status(run('grep x /missing.txt'))).toBe(2);
    expect(errs(run('grep x /missing.txt'))).toEqual(['grep: /missing.txt: No such file or directory']);
    expect(status(run("grep '[' /docs/alpha.txt"))).toBe(2);
  });

  it('-i ignores case', () => {
    expect(out(run('grep -i one /docs/beta.txt'))).toEqual(['/docs/beta.txt:ONE']);
  });

  it('-v inverts the selection', () => {
    expect(out(run('grep -v t /docs/alpha.txt'))).toEqual(['/docs/alpha.txt:one']);
  });

  it('-n prefixes line numbers', () => {
    expect(out(run('grep -n three /docs/alpha.txt'))).toEqual(['/docs/alpha.txt:3:three']);
  });

  it('-c counts per file and bare on stdin', () => {
    expect(out(run('grep -c t /docs/alpha.txt /docs/beta.txt'))).toEqual(['/docs/alpha.txt:2', '/docs/beta.txt:0']);
    expect(out(run('cat /docs/alpha.txt | grep -c t'))).toEqual(['2']);
  });

  it('-l lists files with matches, -L without', () => {
    expect(out(run('grep -l four /docs/alpha.txt /docs/beta.txt'))).toEqual(['/docs/beta.txt']);
    expect(out(run('grep -L four /docs/alpha.txt /docs/beta.txt'))).toEqual(['/docs/alpha.txt']);
  });

  it('-o prints only the matched parts (file labels kept)', () => {
    core.vfs.mountFile('/o.txt', 'abc abd\nxyz\n');
    expect(out(run("grep -o 'ab.' /o.txt"))).toEqual(['/o.txt:abc', '/o.txt:abd']);
    expect(out(run('cat /o.txt | grep -o "ab."'))).toEqual(['abc', 'abd']);
  });

  it('-w requires a word boundary, -x a whole line', () => {
    core.vfs.mountFile('/w.txt', 'cat catalog\ncat\n');
    expect(out(run('grep -w cat /w.txt'))).toEqual(['/w.txt:cat catalog', '/w.txt:cat']);
    expect(out(run('grep -x cat /w.txt'))).toEqual(['/w.txt:cat']);
  });

  it('-E takes alternation, -F takes literals, default BRE handles \\+', () => {
    core.vfs.mountFile('/pets.txt', 'cat\ndog\nfox\n');
    expect(out(run('grep -E "cat|dog" /pets.txt'))).toEqual(['/pets.txt:cat', '/pets.txt:dog']);
    core.vfs.mountFile('/lit.txt', 'a.c\nabc\n');
    expect(out(run('grep -F "a.c" /lit.txt'))).toEqual(['/lit.txt:a.c']);
    expect(out(run("grep 'o\\+' /docs/alpha.txt"))).toEqual(['/docs/alpha.txt:one', '/docs/alpha.txt:two']);
  });

  it('-r walks directories; a bare dir errors', () => {
    expect(out(run('grep -r bottom /docs'))).toEqual(['/docs/nested/deep.txt:bottom']);
    expect(status(run('grep bottom /docs'))).toBe(2);
    expect(errs(run('grep bottom /docs'))).toEqual(['grep: /docs: Is a directory']);
  });

  it('-A/-B/-C print context; groups separate with -- only across a gap', () => {
    core.vfs.mountFile('/ctx.txt', 'a\nb\nc\nd\ne\n');
    expect(out(run('grep -n -A1 b /ctx.txt'))).toEqual(['/ctx.txt:2:b', '/ctx.txt-3-c']);
    expect(out(run('grep -n -B1 d /ctx.txt'))).toEqual(['/ctx.txt-3-c', '/ctx.txt:4:d']);
    expect(out(run('grep -n -C1 b /ctx.txt'))).toEqual(['/ctx.txt-1-a', '/ctx.txt:2:b', '/ctx.txt-3-c']);
    // b and d are one line apart with -A1 — the context overlaps, so GNU
    // prints ONE contiguous group without a -- separator.
    expect(out(run('grep -n -A1 -E "b|d" /ctx.txt'))).toEqual([
      '/ctx.txt:2:b', '/ctx.txt-3-c', '/ctx.txt:4:d', '/ctx.txt-5-e',
    ]);
    // a real gap produces the separator
    core.vfs.mountFile('/gap.txt', 'a\nb\nc\nx\ny\nd\ne\n');
    expect(out(run('grep -n -A1 -E "b|d" /gap.txt'))).toEqual([
      '/gap.txt:2:b', '/gap.txt-3-c', '--', '/gap.txt:6:d', '/gap.txt-7-e',
    ]);
  });

  it('--color paints label and match (opt-in; =auto follows the tty flag)', () => {
    const lines = out(run('grep --color=always two /docs/alpha.txt'));
    expect(lines[0]).toBe('\x1b[35m/docs/alpha.txt\x1b[0m:\x1b[01;31mtwo\x1b[0m');
    expect(out(run('grep --color two /docs/alpha.txt'))).toEqual(lines);
    expect(out(run('grep --color=auto two /docs/alpha.txt'))).toEqual(lines); // execLine stage is the tty
    expect(out(run('grep --color=never two /docs/alpha.txt'))).toEqual(['/docs/alpha.txt:two']);
  });

  it('handles CRLF content and unicode lines', () => {
    expect(out(run('grep two /crlf.txt'))).toEqual(['/crlf.txt:two\r']);
    core.vfs.mountFile('/emoji.txt', 'plain\n👍 ok\n');
    expect(out(run('grep 👍 /emoji.txt'))).toEqual(['/emoji.txt:👍 ok']);
  });

  it('empty input selects nothing with exit 1', () => {
    expect(status(run('grep x /empty.txt'))).toBe(1);
    expect(out(run('grep x /empty.txt'))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* sort                                                                */
/* ------------------------------------------------------------------ */

describe('sort', () => {
  it('sorts by code point, -r reverses, -n sorts numerically', () => {
    expect(out(run('sort /nums.txt'))).toEqual(['10', '10', '2', '9']);
    expect(out(run('sort -n /nums.txt'))).toEqual(['2', '9', '10', '10']);
    expect(out(run('sort -rn /nums.txt'))).toEqual(['10', '10', '9', '2']);
    expect(out(run('sort -u /nums.txt'))).toEqual(['10', '2', '9']);
  });

  it('clustered flags work (-rn)', () => {
    expect(out(run('sort -nu /nums.txt'))).toEqual(['2', '9', '10']);
  });

  it('-k2 with -t: sorts by field as text, -k2n numerically', () => {
    core.vfs.mountFile('/kv.txt', 'b:2\na:10\nc:1\n');
    expect(out(run('sort -t: -k2 /kv.txt'))).toEqual(['c:1', 'a:10', 'b:2']); // '1' < '10' < '2'
    expect(out(run('sort -t: -k2n /kv.txt'))).toEqual(['c:1', 'b:2', 'a:10']);
  });

  it('-h orders human sizes, -V orders versions', () => {
    core.vfs.mountFile('/sizes.txt', '1M\n512\n1K\n');
    expect(out(run('sort -h /sizes.txt'))).toEqual(['512', '1K', '1M']);
    core.vfs.mountFile('/vers.txt', '1.10\n1.9\n1.2\n');
    expect(out(run('sort -V /vers.txt'))).toEqual(['1.2', '1.9', '1.10']);
  });

  it('tied keys fall back to the whole line; -u dedupes by key only', () => {
    core.vfs.mountFile('/ties.txt', 'b x\na x\nb w\n');
    expect(out(run('sort -k2 /ties.txt'))).toEqual(['b w', 'a x', 'b x']);
    expect(out(run('sort -k2 -u /ties.txt'))).toEqual(['b w', 'a x']);
  });

  it('sorts stdin and empty input produces nothing', () => {
    expect(out(run('cat /docs/alpha.txt | sort'))).toEqual(['one', 'three', 'two']);
    expect(out(run('cat /empty.txt | sort'))).toEqual([]);
  });

  it('sorts unicode by code point', () => {
    core.vfs.mountFile('/u.txt', '😀\n👍\n');
    expect(out(run('sort /u.txt'))).toEqual(['👍', '😀']);
  });
});

/* ------------------------------------------------------------------ */
/* uniq                                                                */
/* ------------------------------------------------------------------ */

describe('uniq', () => {
  it('collapses adjacent duplicates only', () => {
    core.vfs.mountFile('/dup.txt', 'a\na\nb\na\n');
    expect(out(run('uniq /dup.txt'))).toEqual(['a', 'b', 'a']);
  });

  it('-c prefixes padded counts', () => {
    core.vfs.mountFile('/dup.txt', 'a\na\nb\n');
    expect(out(run('uniq -c /dup.txt'))).toEqual(['      2 a', '      1 b']);
  });

  it('-d keeps repeated, -u keeps singletons, -i ignores case', () => {
    core.vfs.mountFile('/dup.txt', 'a\nA\nb\nc\n');
    expect(out(run('uniq -d /dup.txt'))).toEqual([]); // a and A differ case-sensitively
    expect(out(run('uniq -u /dup.txt'))).toEqual(['a', 'A', 'b', 'c']);
    expect(out(run('uniq -d -i /dup.txt'))).toEqual(['a']);
    expect(out(run('uniq -du /dup.txt'))).toEqual(['a', 'A', 'b', 'c']); // -d and -u union
  });

  it('empty input yields nothing', () => {
    expect(out(run('cat /empty.txt | uniq'))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* wc                                                                  */
/* ------------------------------------------------------------------ */

describe('wc', () => {
  it('defaults to lines, words, bytes', () => {
    expect(out(run('wc /docs/alpha.txt'))).toEqual(['      3      3     14 /docs/alpha.txt']);
  });

  it('-l -w -c select columns, -m counts characters', () => {
    expect(out(run('wc -l /docs/alpha.txt'))).toEqual(['      3 /docs/alpha.txt']);
    core.vfs.mountFile('/accent.txt', 'hé\n');
    expect(out(run('wc -c /accent.txt'))).toEqual(['      4 /accent.txt']); // é is two UTF-8 bytes
    expect(out(run('wc -m /accent.txt'))).toEqual(['      3 /accent.txt']);
  });

  it('several files add a total line', () => {
    const lines = out(run('wc -l /docs/alpha.txt /docs/beta.txt'));
    expect(lines).toEqual(['      3 /docs/alpha.txt', '      3 /docs/beta.txt', '      6 total']);
  });

  it('counts stdin and an empty file', () => {
    expect(out(run('cat /docs/alpha.txt | wc'))).toEqual(['      3      3     14']);
    expect(out(run('wc /empty.txt'))).toEqual(['      0      0      0 /empty.txt']);
  });
  it('counts a final line without a trailing newline', () => {
    core.vfs.mountFile('/noeol.txt', 'a\nb');
    expect(out(run('wc -l /noeol.txt'))).toEqual(['      2 /noeol.txt']);
  });
});

/* ------------------------------------------------------------------ */
/* head / tail                                                         */
/* ------------------------------------------------------------------ */

describe('head / tail', () => {
  it('head defaults to 10, honours -n, -N legacy and -c bytes', () => {
    core.vfs.mountFile('/lines.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n');
    expect(out(run('head /lines.txt')).length).toBe(10);
    expect(out(run('head -n 2 /lines.txt'))).toEqual(['1', '2']);
    expect(out(run('head -3 /lines.txt'))).toEqual(['1', '2', '3']);
    expect(out(run('head -c 4 /lines.txt'))).toEqual(['1', '2']);
    expect(out(run('head -c 0 /lines.txt'))).toEqual([]);
  });

  it('head -c splits multibyte characters like the real tool', () => {
    core.vfs.mountFile('/accent.txt', 'hé\n');
    expect(out(run('head -c 2 /accent.txt'))).toEqual(['h�']);
  });

  it('tail defaults to 10, honours -n, and -n +N starts at line N', () => {
    core.vfs.mountFile('/lines.txt', '1\n2\n3\n');
    expect(out(run('tail -n 2 /lines.txt'))).toEqual(['2', '3']);
    expect(out(run('tail -n +2 /lines.txt'))).toEqual(['2', '3']);
    expect(out(run('tail -2 /lines.txt'))).toEqual(['2', '3']);
    expect(out(run('tail -c 0 /lines.txt'))).toEqual([]);
  });

  it('several files get ==> headers', () => {
    expect(out(run('head -n 1 /docs/alpha.txt /docs/beta.txt'))).toEqual([
      '==> /docs/alpha.txt <==',
      'one',
      '',
      '==> /docs/beta.txt <==',
      'ONE',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* cut                                                                 */
/* ------------------------------------------------------------------ */

describe('cut', () => {
  it('-d/-f selects fields and joins with the delimiter', () => {
    core.vfs.mountFile('/passwd.txt', 'root:x:0:0\nbin:x:1:1\n');
    expect(out(run('cut -d: -f1 /passwd.txt'))).toEqual(['root', 'bin']);
    expect(out(run('cut -d: -f1,3 /passwd.txt'))).toEqual(['root:0', 'bin:1']);
    expect(out(run('cut -d: -f2- /passwd.txt'))).toEqual(['x:0:0', 'x:1:1']);
  });

  it('-c selects characters (code points)', () => {
    core.vfs.mountFile('/accent.txt', 'héllo\n');
    expect(out(run('cut -c1-2 /accent.txt'))).toEqual(['hé']);
    expect(out(run('cut -c1,3 /accent.txt'))).toEqual(['hl']);
  });

  it('lines without the delimiter pass through whole', () => {
    core.vfs.mountFile('/mixed.txt', 'a:b\nplain\n');
    expect(out(run('cut -d: -f1 /mixed.txt'))).toEqual(['a', 'plain']);
  });

  it('errors: both -c and -f, multi-char delimiter, invalid range', () => {
    core.vfs.mountFile('/mixed.txt', 'a:b\nplain\n');
    expect(status(run('cut -d: -f1 -c1 /mixed.txt'))).toBe(1);
    expect(errs(run('cut -d: -f1 -c1 /mixed.txt'))).toEqual(['cut: only one type of list may be specified']);
    expect(errs(run('cut -d::- -f1 /mixed.txt'))).toEqual(['cut: the delimiter must be a single character']);
    expect(status(run('cut -d: -f0 /mixed.txt'))).toBe(1);
    const good = run('cut -d: -f1 /mixed.txt');
    expect(out(good)).toEqual(['a', 'plain']); // normal run still works
  });
});

/* ------------------------------------------------------------------ */
/* tr                                                                  */
/* ------------------------------------------------------------------ */

describe('tr', () => {
  it('translates characters, ranges and classes', () => {
    expect(out(run('echo hello | tr a-z A-Z'))).toEqual(['HELLO']);
    expect(out(run('echo abc 123 | tr "[:lower:]" "[:digit:]"'))).toEqual(['012 123']);
    expect(out(run('echo héllo | tr é e'))).toEqual(['hello']);
  });

  it('-d deletes, -s squeezes', () => {
    expect(out(run('echo a1b2 | tr -d 0-9'))).toEqual(['ab']);
    expect(out(run('echo aa  bb | tr -s " "'))).toEqual(['aa bb']);
    expect(out(run('echo aabbcc | tr -s abc'))).toEqual(['abc']);
  });

  it('SET2 repeats its last character; escapes work in sets', () => {
    expect(out(run('echo abc | tr ab XY'))).toEqual(['XYc']);
    expect(out(run('printf "a\\tb\\n" | tr "\\t" " "'))).toEqual(['a b']);
  });

  it('reads stdin only; file operands and missing SET2 error', () => {
    expect(status(run('tr a b /docs/alpha.txt'))).toBe(1);
    expect(errs(run('tr a b /docs/alpha.txt'))).toEqual(["tr: extra operand '/docs/alpha.txt'"]);
    expect(status(run('echo x | tr a'))).toBe(1);
  });

  it('strips CR from CRLF text', () => {
    expect(out(run('cat /crlf.txt | tr -d "\\r"'))).toEqual(['one', 'two']);
  });
});

/* ------------------------------------------------------------------ */
/* tee                                                                 */
/* ------------------------------------------------------------------ */

describe('tee', () => {
  it('writes files while passing stdin through', () => {
    expect(out(run('echo hi | tee /tee.txt'))).toEqual(['hi']);
    expect(out(run('cat /tee.txt'))).toEqual(['hi']);
  });

  it('-a appends; several files all get the text', () => {
    core.vfs.mountFile('/log.txt', 'old\n');
    run('echo new | tee -a /log.txt');
    expect(out(run('cat /log.txt'))).toEqual(['old', 'new']);
    expect(out(run('echo both | tee /t1.txt /t2.txt'))).toEqual(['both']);
    expect(out(run('cat /t1.txt /t2.txt'))).toEqual(['both', 'both']);
  });

  it('a directory target errors without breaking the passthrough', () => {
    const r = run('echo hi | tee /docs');
    expect(out(r)).toEqual(['hi']);
    expect(errs(r)).toEqual(['tee: /docs: Is a directory']);
    expect(status(r)).toBe(1);
  });

  it('a read-only mount reports Read-only file system', () => {
    const ro: VfsBackend = {
      id: 'ro',
      writable: false,
      mountpoint: '/ro',
      stat: async () => null,
      read: async () => null,
      write: async () => {},
      mkdirp: async () => {},
      rm: async () => {},
      rename: async () => {},
      list: async () => [],
    };
    core.vfs.attachBackend(ro);
    const r = run('echo hi | tee /ro/x.txt');
    expect(out(r)).toEqual(['hi']);
    expect(errs(r)).toEqual(['tee: /ro/x.txt: Read-only file system']);
    expect(status(r)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* xargs                                                               */
/* ------------------------------------------------------------------ */

describe('xargs', () => {
  it('runs echo by default over whitespace-split items', () => {
    expect(out(run("printf 'a b\\nc d\\n' | xargs"))).toEqual(['a b c d']);
  });

  it('-n chunks items per invocation', () => {
    expect(out(run("printf 'a b c d\\n' | xargs -n 2"))).toEqual(['a b', 'c d']);
  });

  it('-I replaces the token once per item', () => {
    expect(out(run("printf '1\\n2\\n' | xargs -I{} echo v={}"))).toEqual(['v=1', 'v=2']);
  });

  it('-0 splits on NUL bytes', () => {
    core.vfs.mountFile('/nul.bin', 'a\0b\0');
    expect(out(run('cat /nul.bin | xargs -0'))).toEqual(['a b']);
  });

  it('-r skips the run on empty input; the default still runs once', () => {
    const r = run('cat /empty.txt | xargs -r echo');
    expect(out(r)).toEqual([]);
    expect(status(r)).toBe(0);
    expect(out(run('cat /empty.txt | xargs echo'))).toEqual(['']);
  });

  it('exit 123 when a child fails, 127 when the command is missing', () => {
    expect(status(run('cat /docs/alpha.txt | xargs -n1 cat /missing.txt'))).toBe(123);
    expect(status(run('echo x | xargs totally-not-a-command'))).toBe(127);
  });
});

/* ------------------------------------------------------------------ */
/* nl · rev · paste · column · fold · expand                           */
/* ------------------------------------------------------------------ */

describe('nl', () => {
  it('numbers non-empty lines by default; -b a numbers all', () => {
    core.vfs.mountFile('/nl.txt', 'a\n\nb\n');
    expect(out(run('nl /nl.txt'))).toEqual(['     1\ta', '', '     2\tb']);
    expect(out(run('nl -b a /nl.txt'))).toEqual(['     1\ta', '     2\t', '     3\tb']);
  });

  it('-w sets the width, -s the separator (escapes honoured)', () => {
    core.vfs.mountFile('/nl.txt', 'a\nb\n');
    expect(out(run('nl -w 3 -s ": " /nl.txt'))).toEqual(['  1: a', '  2: b']);
  });
});

describe('rev', () => {
  it('reverses each line by code point', () => {
    expect(out(run('echo hello | rev'))).toEqual(['olleh']);
    expect(out(run('echo "👍a" | rev'))).toEqual(['a👍']);
    expect(out(run('cat /empty.txt | rev'))).toEqual([]);
  });
});

describe('paste', () => {
  it('joins files side by side, padding short columns', () => {
    expect(out(run('paste /docs/alpha.txt /docs/beta.txt'))).toEqual(['one\tONE', 'two\t', 'three\tfour']);
  });

  it('-s serialises each file onto one line; -d cycles delimiters', () => {
    core.vfs.mountFile('/p.txt', 'a\nb\nc\n');
    expect(out(run('paste -s -d, /p.txt'))).toEqual(['a,b,c']);
    expect(out(run('paste -s -d ",;" /p.txt'))).toEqual(['a,b;c']);
    expect(out(run('paste -d, /docs/alpha.txt /docs/beta.txt'))).toEqual(['one,ONE', 'two,', 'three,four']);
  });

  it('- reads stdin as a column', () => {
    expect(out(run('echo x | paste - /docs/beta.txt'))).toEqual(['x\tONE', '\t', '\tfour']);
  });
});

describe('column', () => {
  it('-t aligns columns to the widest cell', () => {
    core.vfs.mountFile('/table.txt', 'name age\nbob 5\nal 100\n');
    expect(out(run('column -t /table.txt'))).toEqual(['name  age', 'bob   5', 'al    100']);
  });

  it('non-table mode is refused', () => {
    expect(status(run('column /table.txt'))).toBe(2);
  });
});

describe('fold', () => {
  it('wraps at the width, -s prefers breaking after a blank', () => {
    core.vfs.mountFile('/long.txt', 'abcdefgh\n');
    expect(out(run('fold -w 5 /long.txt'))).toEqual(['abcde', 'fgh']);
    core.vfs.mountFile('/words.txt', 'ab cd efgh\n');
    expect(out(run('fold -w 5 -s /words.txt'))).toEqual(['ab ', 'cd ', 'efgh']);
  });

  it('default width is 80', () => {
    core.vfs.mountFile('/long.txt', `${'x'.repeat(100)}\n`);
    const lines = out(run('fold /long.txt'));
    expect(lines.length).toBe(2);
    expect(lines[0]!.length).toBe(80);
  });
});

describe('expand', () => {
  it('expands tabs at every 8 columns by default', () => {
    expect(out(run('printf "\\ta\\n" | expand'))).toEqual(['        a']);
  });

  it('-t takes a size or an ascending list; past the list it repeats the interval', () => {
    expect(out(run('printf "\\ta\\n" | expand -t 4'))).toEqual(['    a']);
    expect(out(run('printf "\\t\\ta\\n" | expand -t 4,8'))).toEqual(['        a']);
    core.vfs.mountFile('/tabs.txt', '       \tx\n'); // col 7, stops 4,6 → next 8
    expect(out(run('expand -t 4,6 /tabs.txt'))).toEqual(['        x']);
  });
});

/* ------------------------------------------------------------------ */
/* package contract                                                    */
/* ------------------------------------------------------------------ */

describe('text package contract', () => {
  it('stub entries match the chunk commands 1:1, same usage strings', async () => {
    const chunk = await import('../../src/terminal/packages/text/index.js');
    expect(textStub.name).toBe('text');
    expect(textStub.commands).toHaveLength(16);
    expect(chunk.commands).toHaveLength(16);
    for (const entry of textStub.commands) {
      const spec = chunk.commands.find((c) => c.name === entry.name);
      expect(spec, entry.name).toBeDefined();
      expect(spec!.usage, entry.name).toBe(entry.usage);
    }
    expect(Object.keys(chunk.manPages).sort()).toEqual(textStub.commands.map((c) => c.name).sort());
  });

  it('every command carries a short stub man page', () => {
    for (const entry of textStub.commands) {
      expect(Array.isArray(entry.man) && entry.man.length! > 0, entry.name).toBe(true);
    }
  });

  it('registers over the posix same-named commands (supersedes)', () => {
    // beforeEach already set the package specs over posix's — grep -o and
    // wc -m are package-only features and both answer.
    const r = run('grep -o t /docs/alpha.txt');
    expect(out(r)).toEqual(['/docs/alpha.txt:t', '/docs/alpha.txt:t']);
    expect(status(r)).toBe(0);
    core.vfs.mountFile('/accent.txt', 'hé\n');
    expect(out(run('wc -m /accent.txt'))).toEqual(['      3 /accent.txt']);
  });

  it('the resident chunk owns --help (name — summary + usage)', () => {
    expect(out(run('sort --help'))).toEqual([
      'sort — sort lines of text',
      'usage: sort [-nruhV] [-k POS[,POS]] [-t C] [file...]',
    ]);
    expect(out(run('grep --help'))[0]).toContain('grep — print lines matching a pattern');
  });
});

describe('text package lazy surfaces', () => {
  const never = (): Promise<PackageModule> => new Promise(() => {});

  const freshCore = (pkg: ReturnType<typeof createLazyPackage>): TerminalCore => {
    const c = new TerminalCore();
    for (const spec of pkg.commands) c.commands.set(spec.name, spec);
    return c;
  };

  it('help is answered from the stub before the chunk arrives', () => {
    const pkg = createLazyPackage(textStub, never);
    const lazy = freshCore(pkg);
    expect(out(lazy.execLine('sort --help'))).toEqual(['sort [-nruhV] [-k POS[,POS]] [-t C] [file...]']);
    expect(out(lazy.execLine('grep --help'))).toEqual(['grep [-EFivnclLowx] [-A|-B|-C N] [--color[=when]] PATTERN [file...]']);
  });

  it('an invocation that beats the fetch gets the retry hint', () => {
    const pkg = createLazyPackage(textStub, never);
    const lazy = freshCore(pkg);
    lazy.vfs.mountFile('/a.txt', 'b\na\n');
    const r = lazy.execLine('sort /a.txt');
    expect(errs(r)).toEqual(['sort: chunk still loading — try again']);
    expect(status(r)).toBe(1);
  });

  it('a failed chunk load reports the chunk file and exits 1', async () => {
    const pkg = createLazyPackage(textStub, () => Promise.reject(new Error('404')));
    expect(await pkg.ensure()).toBe(false);
    const lazy = freshCore(pkg);
    const r = lazy.execLine('grep x /docs/alpha.txt');
    expect(errs(r)).toEqual(['grep: package chunk failed to load (semtext-pkg-text.js)']);
    expect(status(r)).toBe(1);
    expect(pkg.loaded()).toBe(false);
  });

  it('ensure() resolves true and man pages swap to the chunk once resident', async () => {
    const pkg = createLazyPackage(textStub, chunkLoader);
    expect(await pkg.ensure()).toBe(true);
    expect(pkg.loaded()).toBe(true);
    expect(pkg.manNames().size).toBe(16);
    const page = pkg.manPage('grep');
    expect(page).not.toBeNull();
    expect(page![0]).toBe('grep — print lines matching a pattern'); // chunk page, not the stub's GREP(1)
  });
});
