// Unit spec — the awk package (src/terminal/packages/awk/): POSIX awk through
// the LAZY PATH (stub registration → chunk source injected as the loader,
// exactly what the build bundles into semtext-pkg-awk.js).
//
// Feature: patterns and records
//   Scenario: default print, pattern-only rules, pattern{action}, BEGIN/END
//   Scenario: NR/FNR/FILENAME across files; multiple files and the pipe
// Feature: fields and FS
//   Scenario: $1..$NF, $(expr), $ beyond NF, default/char/empty/regex FS, -F
//   Scenario: assigning $i / NF rebuilds $0 with OFS
// Feature: RS — default, paragraph (""), single char, multi-char regex
// Feature: values
//   Scenario: strnum fields compare numerically; "0" is false; unset is ""
//   Scenario: integral/CONVFMT/OFMT number printing, -v typed like input
// Feature: print/printf — OFS join, redirection > >> with close(), formats
// Feature: arrays — in, delete (one/all), for-in, SUBSEP multikey, conflicts
// Feature: builtins — string fns (unicode length/substr), sub/gsub counts,
//          match/RSTART/RLENGTH, math fns, srand/rand determinism
// Feature: getline — main-stream share, var target, <file, EOF 0, open fail -1
// Feature: user functions — args by value/by-ref, locals, recursion, return
// Feature: control flow — break/continue/next/nextfile/exit (incl. END override)
// Feature: errors — parse errors with line numbers (exit 1), runtime fatals
//          (exit 2), missing files (exit 2), no-program usage (exit 1)
// Feature: package contract — stub answers pre-load, ensure() swaps man+run

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import { stub as awkStub } from '../../src/terminal/packages/awk/stub.js';

vi.setConfig({ testTimeout: 5_000 });

/** The package under test: the production stub + the real chunk source as the loader. */
const pkg = createLazyPackage(awkStub, async () => {
  const mod = await import('../../src/terminal/packages/awk/index.js');
  return { commands: mod.commands, manPages: mod.manPages };
});

let core: TerminalCore;
const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const run = (line: string): ExecResult => core.execLine(line);

beforeEach(async () => {
  core = new TerminalCore();
  expect(core.mountPlugin(posixPlugin).ok).toBe(true); // cat/echo for piped stages
  expect(core.mountPlugin({ name: 'pkg-awk-test', version: '0', commands: pkg.commands, files: [] }).ok).toBe(true);
  core.vfs.mountFile('/a.txt', 'one 1\ntwo 2\n');
  core.vfs.mountFile('/b.txt', 'three 3\n');
  core.vfs.mountFile('/nums.txt', '5\n10\n2.5\n');
  core.vfs.mountFile('/passwd', 'root:x:0:0:root:/root:/bin/sh\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n');
  core.vfs.mountFile('/empty.txt', '');
  core.vfs.mountFile('/crlf.txt', 'one\r\ntwo\r\n');
  core.vfs.mountFile('/uni.txt', 'héllo 😀 wörld\n');
  await pkg.ensure();
});

/* ------------------------------------------------------------------ */
/* patterns and records                                                */
/* ------------------------------------------------------------------ */

describe('awk — patterns and records', () => {
  it('default action prints each record; pipe in works', () => {
    expect(out(run('echo hi | awk \'{print}\''))).toEqual(['hi']);
    expect(out(run('cat /a.txt | awk \'1\''))).toEqual(['one 1', 'two 2']);
  });

  it('BEGIN runs before input, END after, exit carries from END', () => {
    expect(out(run('awk \'BEGIN{print "b"} {print NR} END{print "e", NR}\' /a.txt'))).toEqual(['b', '1', '2', 'e 2']);
    expect(status(run('awk \'BEGIN{exit 7}\''))).toBe(7);
  });

  it('NR/FNR/FILENAME across files', () => {
    const r = run('awk \'{print NR, FNR, FILENAME}\' /a.txt /b.txt');
    expect(out(r)).toEqual([
      '1 1 /a.txt',
      '2 2 /a.txt',
      '3 1 /b.txt',
    ]);
  });

  it('empty input still runs END', () => {
    expect(out(run('awk \'END{print NR}\' /empty.txt'))).toEqual(['0']);
  });

  it('empty lines are records too', () => {
    core.vfs.mountFile('/blank.txt', 'a\n\nb\n');
    expect(out(run("awk '{print NR \": \" $0}' /blank.txt"))).toEqual(['1: a', '2: ', '3: b']);
  });
});

/* ------------------------------------------------------------------ */
/* fields and FS                                                       */
/* ------------------------------------------------------------------ */

describe('awk — fields and FS', () => {
  it('$1..$NF, $(expr), $0', () => {
    expect(out(run('awk \'{print $2, $1}\' /a.txt'))).toEqual(['1 one', '2 two']);
    expect(out(run('awk \'{print $(NF-1)}\' /a.txt'))).toEqual(['one', 'two']);
    expect(out(run('awk \'{print NF}\' /a.txt'))).toEqual(['2', '2']);
  });

  it('whitespace FS skips leading blanks', () => {
    core.vfs.mountFile('/ws.txt', '   a   b\t c\n');
    expect(out(run('awk \'{print NF, $1, $3}\' /ws.txt'))).toEqual(['3 a c']);
  });

  it('-F single char, glued and separate', () => {
    expect(out(run('awk -F: \'{print $1, $NF}\' /passwd'))).toEqual(['root /bin/sh', 'daemon /usr/sbin/nologin']);
    expect(out(run('awk -F : \'{print $3}\' /passwd'))).toEqual(['0', '1']);
  });

  it('FS as regex; FS "" splits characters', () => {
    core.vfs.mountFile('/re.txt', 'a1b22c\n');
    expect(out(run('awk \'BEGIN{FS="[0-9]+"} {print $1, $2, $3}\' /re.txt'))).toEqual(['a b c']);
    expect(out(run('awk \'BEGIN{FS=""} {print $1 $2 $3}\' /re.txt'))).toEqual(['a1b']);
  });

  it('assigning a field rebuilds $0 with OFS', () => {
    expect(out(run('awk \'{$2="X"; print}\' /a.txt'))).toEqual(['one X', 'two X']);
    expect(out(run('awk \'{$4="d"; print NF, $0}\' /a.txt'))).toEqual(['4 one 1  d', '4 two 2  d']); // NF grows, gaps empty
    expect(out(run('awk \'BEGIN{OFS="-"} {$1="q"; print}\' /a.txt'))).toEqual(['q-1', 'q-2']);
  });

  it('assigning NF rebuilds the record', () => {
    expect(out(run('awk \'{NF=1; print}\' /a.txt'))).toEqual(['one', 'two']);
    expect(out(run('awk \'{NF=3; print NF, $3==""}\' /a.txt'))).toEqual(['3 1', '3 1']);
  });

  it('CRLF records keep the carriage return (gawk semantics); sub strips it', () => {
    expect(out(run('awk \'{print $1}\' /crlf.txt'))).toEqual(['one\r', 'two\r']);
    expect(out(run('awk \'{sub(/\\r$/, ""); print $0 "end"}\' /crlf.txt'))).toEqual(['oneend', 'twoend']);
  });
});

/* ------------------------------------------------------------------ */
/* RS                                                                  */
/* ------------------------------------------------------------------ */

describe('awk — RS', () => {
  it('RS single char splits on every occurrence', () => {
    core.vfs.mountFile('/semi.txt', 'a;b;c');
    expect(out(run('awk \'BEGIN{RS=";"} {print $0}\' /semi.txt'))).toEqual(['a', 'b', 'c']);
  });

  it('paragraph mode (RS="") collapses blank-line runs', () => {
    core.vfs.mountFile('/para.txt', 'p1 l1\np1 l2\n\n\np2 l1\n\np3\n');
    const r = run('awk ' + String.raw`'BEGIN{RS=""} {print NR, $0}'` + ' /para.txt');
    expect(out(r)).toEqual(['1 p1 l1', 'p1 l2', '2 p2 l1', '3 p3']);
  });

  it('multi-char RS is a regex', () => {
    core.vfs.mountFile('/rre.txt', 'a<b>c\n</d\n');
    // RS given as a string is a regex when multi-char; the shell eats `?[`*`
    // even quoted, so keep the pattern shell-boring
    expect(out(run('awk \'BEGIN{RS="</"} {printf "%s|", $0}\' /rre.txt'))).toEqual(['a<b>c', '|', 'd', '|']);
  });
});

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

describe('awk — values and typing', () => {
  it('fields compare numerically when numeric', () => {
    expect(out(run('awk \'{print ($1 > "9")}\' /nums.txt'))).toEqual(['0', '0', '0']); // string compare: '1' < '9'
    expect(out(run('awk \'{print ($1+0 > 9)}\' /nums.txt'))).toEqual(['0', '1', '0']); // numeric compare
    core.vfs.mountFile('/cmp.txt', '10 x\n9 y\n');
    expect(out(run('awk \'$1 > 9 {print $2}\' /cmp.txt'))).toEqual(['x']); // strnum field: numeric
  });

  it('"0" and "" and unset are false; "0" prints as 0', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{if ("0") print "t"; else print "f"}'`))).toEqual(['f']);
    expect(out(run('awk ' + String.raw`'BEGIN{x=""; if (x) print "t"; else print "f"}'`))).toEqual(['f']);
    expect(out(run('awk ' + String.raw`'BEGIN{if (zz) print "t"; else print "f"}'`))).toEqual(['f']);
  });

  it('numbers print integral, else OFMT/CONVFMT style', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{print 1, 2.5, 1e21, 0.1+0.2}'`))).toEqual(['1 2.5 1e+21 0.3']);
    expect(out(run('awk ' + String.raw`'BEGIN{print 3/2, 10/4}'`))).toEqual(['1.5 2.5']);
  });

  it('-v assigns before BEGIN, typed like input data', () => {
    expect(out(run('awk -v x=3.5 -v y=02 \'BEGIN{print x+1, y}\''))).toEqual(['4.5 02']);
    expect(out(run('awk -v n=10 \'BEGIN{if (n > 9) print "yes"}\''))).toEqual(['yes']);
  });

  it('string concatenation is juxtaposition; uninit concatenates as ""', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{a="x"; b=1; print a b "!"}'`))).toEqual(['x1!']);
    expect(out(run('awk ' + String.raw`'BEGIN{print "[" u "]"}'`))).toEqual(['[]']);
  });
});

/* ------------------------------------------------------------------ */
/* print / printf                                                      */
/* ------------------------------------------------------------------ */

describe('awk — print and printf', () => {
  it('print joins args with OFS and ends with ORS', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{ORS=";"; print 1, 2}'`))).toEqual(['1 2;']);
  });

  it('printf formats: %s %d %f %e %g %x %o %c %% and widths', () => {
    const p = (prog: string): string[] => out(run(`awk 'BEGIN{${prog}}'`));
    expect(p('printf "%s|%d\\n", "x", 42')).toEqual(['x|42']);
    expect(p('printf "%5.2f|%-6s|\\n", 3.14159, "ab"')).toEqual([' 3.14|ab    |']);
    expect(p('printf "%x %X %o\\n", 255, 255, 8')).toEqual(['ff FF 10']);
    expect(p('printf "%c%c%%\\n", 65, "B"')).toEqual(['AB%']);
    expect(p('printf "%e\\n", 1234.5')).toEqual(['1.234500e+03']);
    expect(p('printf "%g %g\\n", 100000, 1000000')).toEqual(['100000 1e+06']);
    expect(p('printf "%u\\n", -1')).toEqual(['18446744073709551615']); // 64-bit wrap
    expect(p('printf "%*d|%-*s|\\n", 5, 42, 4, "ab"')).toEqual(['   42|ab  |']);
    expect(p('printf "%+d % d\\n", 5, 5')).toEqual(['+5  5']);
    expect(p('printf "%05d\\n", 42')).toEqual(['00042']);
    expect(p('print sprintf("%04d-%s", 7, "z")')).toEqual(['0007-z']);
  });

  it('print > file buffers and lands at exit; >> appends', () => {
    run('awk \'{print > "/out.txt"} END{print "done" > "/out.txt"}\' /a.txt');
    expect(core.vfs.read('/out.txt')).toBe('one 1\ntwo 2\ndone\n');
    run('awk \'BEGIN{print "more" >> "/out.txt"}\'');
    expect(core.vfs.read('/out.txt')).toBe('one 1\ntwo 2\ndone\nmore\n');
  });

  it('close() flushes mid-run so a later getline sees it', () => {
    run('awk \'BEGIN{print "x" > "/c.txt"; close("/c.txt"); while ((getline l < "/c.txt") > 0) print "got", l}\'');
    expect(out(run('cat /c.txt'))).toEqual(['x']);
  });
});

/* ------------------------------------------------------------------ */
/* arrays                                                              */
/* ------------------------------------------------------------------ */

describe('awk — arrays', () => {
  it('membership with `in`, delete one, delete all', () => {
    const p = (prog: string, file = '/a.txt'): string[] => out(run(`awk '${prog}' ${file}`));
    expect(p('{a[$1]=$2} END{print ("one" in a), ("zz" in a)}')).toEqual(['1 0']);
    expect(p('{a[$1]; delete a["one"]} END{print "one" in a, "two" in a}')).toEqual(['0 1']);
    expect(p('BEGIN{a[1]=1; a[2]=2; delete a; print ("1" in a)}')).toEqual(['0']);
  });

  it('for-in iterates keys; key order is insertion order', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{a["x"]=1;a["y"]=2; s=""; for (k in a) s=s k; print s}'`))).toEqual(['xy']);
  });

  it('multi-dim subscripts join with SUBSEP', () => {
    expect(out(run('awk ' + String.raw`'BEGIN{SUBSEP=":"; a[1,2]="v"; print a[1,2], ("1:2" in a), a[1":"2]}'`))).toEqual(['v 1 v']);
  });

  it('scalar/array name conflicts are fatal', () => {
    const r = run('awk ' + String.raw`'BEGIN{x=1; x[2]=3}'`);
    expect(status(r)).toBe(2);
    expect(errs(r)[0]).toMatch(/awk: /);
    const r2 = run('awk ' + String.raw`'BEGIN{a[1]=1; a=2}'`);
    expect(status(r2)).toBe(2);
  });

  it('word counts, the canonical array program', () => {
    core.vfs.mountFile('/words.txt', 'b a\na c b\n');
    const r = run('awk \'{for (i=1;i<=NF;i++) c[$i]++} END{for (w in c) print w, c[w]}\' /words.txt');
    expect(out(r)).toEqual(['b 2', 'a 2', 'c 1']);
  });
});

/* ------------------------------------------------------------------ */
/* builtins                                                            */
/* ------------------------------------------------------------------ */

describe('awk — string builtins', () => {
  const p = (prog: string): string[] => out(run(`awk 'BEGIN{${prog}}'`));

  it('length (bare, string, unicode code points)', () => {
    expect(p('print length')).toEqual(['0']); // empty $0
    expect(p('print length("héllo"), length("😀a")')).toEqual(['5 2']);
    expect(out(run('awk \'{print length($1), length($0)}\' /uni.txt'))).toEqual(['5 13']);
  });

  it('substr counts pre-string positions toward n (POSIX)', () => {
    expect(p('print substr("hello", 2), "|" substr("hello", 2, 3), "|"')).toEqual(['ello |ell |']);
    expect(p('print "[" substr("hello", 0, 2) "]" "|" substr("hello", -1, 2) "|"')).toEqual(['[h]||']);
    expect(p('print "[" substr("hello", 4, 99) "]"')).toEqual(['[lo]']);
  });

  it('index', () => {
    expect(p('print index("hello", "ll"), index("hello", "zz"), index("abc", "")')).toEqual(['3 0 1']);
  });

  it('split: default FS, explicit FS, returns the count, numeric keys', () => {
    expect(out(run('awk \'{n=split($0, a); print n, a[1], a[n]}\' /a.txt'))).toEqual(['2 one 1', '2 two 2']);
    expect(p('n=split("a:bb:c", arr, ":"); print n, arr[2]')).toEqual(['3 bb']);
    expect(p('n=split("a1b2c", arr, /[0-9]/); print n, arr[3]')).toEqual(['3 c']);
  });

  it('sub/gsub return counts, expand &, honour \\&', () => {
    expect(p('s="aaa"; print gsub(/a/, "b", s), s')).toEqual(['3 bbb']);
    expect(p('s="aaa"; print sub(/a/, "b", s), s')).toEqual(['1 baa']);
    expect(p('s="a_a"; print gsub(/a/, "[&]", s), s')).toEqual(['2 [a]_[a]']);
    expect(p('s="a"; print gsub(/a/, "\\\\&", s), s')).toEqual(['1 &']);
    expect(out(run('awk \'{print gsub(/o/, "0")}\' /a.txt'))).toEqual(['1', '1']);
  });

  it('match sets RSTART/RLENGTH; ~ !~ in conditions', () => {
    expect(p('print match("hello world", /w.rld/), RSTART, RLENGTH')).toEqual(['7 7 5']);
    expect(p('print match("hello", /xyz/), RSTART, RLENGTH')).toEqual(['0 0 -1']);
    expect(out(run("awk '$1 ~ /^t/ {print $1}' /a.txt"))).toEqual(['two']);
    expect(out(run("awk '$1 !~ /^t/ {print $1}' /a.txt"))).toEqual(['one']);
  });

  it('tolower/toupper and dynamic regexes', () => {
    expect(p('print toupper("aBc"), tolower("DeF")')).toEqual(['ABC def']);
    expect(p('re="l+"; print ("hello" ~ re)')).toEqual(['1']);
  });
});

describe('awk — math builtins', () => {
  const p = (prog: string): string[] => out(run(`awk 'BEGIN{${prog}}'`));

  it('int sqrt exp log sin cos atan2', () => {
    expect(p('print int(3.7), int(-3.7), int("42x")')).toEqual(['3 -3 42']);
    expect(p('print sqrt(16)')).toEqual(['4']);
    expect(p('print exp(0), log(1), log(exp(1))')).toEqual(['1 0 1']);
    expect(p('print sin(0), cos(0), atan2(0, 1)')).toEqual(['0 1 0']);
  });

  it('srand(n) makes rand() deterministic', () => {
    const a = p('srand(42); print rand(), rand()');
    const b = p('srand(42); print rand(), rand()');
    expect(a).toEqual(b);
    expect(Number(a[0]!.split(' ')[0]!)).toBeGreaterThan(0);
    expect(Number(a[0]!.split(' ')[0]!)).toBeLessThan(1);
  });

  it('division by zero is fatal, exit 2', () => {
    const r = p('print 1/0');
    expect(status(run('awk ' + String.raw`'BEGIN{print 1/0}'`))).toBe(2);
    expect(r).toEqual([]);
    expect(errs(run('awk ' + String.raw`'BEGIN{x=5%0}'`))[0]).toMatch(/division by zero/);
  });
});

/* ------------------------------------------------------------------ */
/* getline                                                             */
/* ------------------------------------------------------------------ */

describe('awk — getline', () => {
  it('getline shares the main stream; main rules see the rest', () => {
    core.vfs.mountFile('/g.txt', 'first\nsecond\nthird\n');
    const r = run('awk ' + String.raw`'BEGIN{getline head; print "head:", head} {print "main:", $0}'` + ' /g.txt');
    expect(out(r)).toEqual(['head: first', 'main: second', 'main: third']);
  });

  it('getline var < file; EOF gives 0; missing file gives -1', () => {
    const r = run('awk ' + String.raw`'BEGIN{print getline x < "/a.txt", x; print getline y; print getline z < "/nope.txt"}'`);
    expect(out(r)).toEqual(['1 one 1', '0', '-1']);
  });

  it('while ((getline line) > 0) reads a whole file', () => {
    const r = run('awk ' + String.raw`'BEGIN{while ((getline line < "/nums.txt") > 0) s += line; print s}'`);
    expect(out(r)).toEqual(['17.5']);
  });

  it('getline target may be a field or array element', () => {
    core.vfs.mountFile('/g2.txt', 'only\n');
    const r = run('awk ' + String.raw`'BEGIN{getline arr["k"] < "/g2.txt"; print arr["k"]}'`);
    expect(out(r)).toEqual(['only']);
  });
});

/* ------------------------------------------------------------------ */
/* user functions                                                      */
/* ------------------------------------------------------------------ */

describe('awk — user functions', () => {
  it('definition, call, recursion, return', () => {
    const r = run('awk \'function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) } BEGIN{print fact(6)}\'');
    expect(out(r)).toEqual(['720']);
  });

  it('arrays pass by reference; scalars by value; extra params are locals', () => {
    const r = run(
      'awk \'function bump(arr, x, i) { x = 99; for (i in arr) arr[i]++ } '
      + String.raw`BEGIN{a[1]=1; y=5; bump(a, y); print a[1], y}'`,
    );
    expect(out(r)).toEqual(['2 5']);
  });

  it('calling an undefined function is a parse error (exit 1)', () => {
    const r = run('awk ' + String.raw`'BEGIN{nope()}'`);
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toMatch(/calling undefined function nope/);
  });

  it('deep recursion errors instead of hanging', () => {
    const r = run('awk \'function f(n) { return f(n + 1) } BEGIN{f(0)}\'');
    expect(status(r)).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* control flow                                                        */
/* ------------------------------------------------------------------ */

describe('awk — control flow', () => {
  it('break/continue in loops', () => {
    const r = run('awk ' + String.raw`'BEGIN{for (i=1;i<=9;i++){if(i>3)break; s=s i} print s}'`);
    expect(out(r)).toEqual(['123']);
    const r2 = run('awk ' + String.raw`'BEGIN{for(i=1;i<=5;i++){if(i%2)continue; s=s i} print s}'`);
    expect(out(r2)).toEqual(['24']);
  });

  it('next skips to the next record; nextfile skips the rest of the file', () => {
    expect(out(run("awk '/1/ {next} {print}' /a.txt"))).toEqual(['two 2']);
    const r = run('awk ' + String.raw`'FNR==2 {nextfile} {print NR}'` + ' /a.txt /b.txt');
    expect(out(r)).toEqual(['1', '3']); // NR counts the nextfile'd record, as in gawk
  });

  it('exit n stops immediately; exit in END overrides; exit with no code keeps status', () => {
    const r = run('awk \'{exit 5} END{print "end"}\' /a.txt');
    expect(out(r)).toEqual(['end']);
    expect(status(r)).toBe(5);
    const r2 = run('awk ' + String.raw`'BEGIN{exit 1} END{exit 0}'`);
    expect(status(r2)).toBe(0);
    const r3 = run('awk ' + String.raw`'BEGIN{exit} END{print "e"}'`);
    expect(status(r3)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

describe('awk — errors and exits', () => {
  it('parse errors report the source line, exit 1', () => {
    core.vfs.mountFile('/bad.awk', '{print 1}\n)\n');
    const r = run('awk -f /bad.awk /a.txt');
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toMatch(/awk: cmd\. line:2:/);
  });

  it('no program is a usage error (exit 1)', () => {
    const r = run('awk');
    expect(status(r)).toBe(1);
    expect(errs(r).join('\n')).toMatch(/^awk: no program given/);
  });

  it('missing input file exits 2 with the GNU message', () => {
    const r = run('awk \'{print}\' /missing.txt');
    expect(status(r)).toBe(2);
    expect(errs(r)).toEqual(["awk: can't open file '/missing.txt': No such file or directory"]);
  });

  it('a directory as input exits 2', () => {
    core.vfs.mkdir('/docs', { parents: true });
    const r = run('awk \'{print}\' /docs');
    expect(status(r)).toBe(2);
    expect(errs(r)[0]).toMatch(/Is a directory/);
  });

  it('missing -f source file exits 2', () => {
    const r = run('awk -f /no-prog.awk /a.txt');
    expect(status(r)).toBe(2);
    expect(errs(r)[0]).toMatch(/can't open source file/);
  });

  it('no input with main rules prints a hint, runs END, exit 1', () => {
    const r = run('awk \'{print} END{print "end"}\'');
    expect(out(r)).toEqual(['end']);
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toMatch(/no input/);
  });

  it('-f reads the program from a file; -f and -e concatenate', () => {
    core.vfs.mountFile('/p.awk', '{print $2}');
    expect(out(run('awk -f /p.awk /a.txt'))).toEqual(['1', '2']);
    expect(out(run('awk -f /p.awk -e \'END{print "done"}\' /a.txt'))).toEqual(['1', '2', 'done']);
  });

  it('--help and --version', () => {
    expect(out(run('awk --help'))[0]).toBe('Usage: ' + "awk [-F fs] [-v var=val] [-f progfile] ['program'] [file ...]");
    expect(status(run('awk --help'))).toBe(0);
    expect(out(run('awk --version'))[0]).toMatch(/^awk \(semtext-sh\)/);
  });

  it('unknown options are usage errors', () => {
    const r = run('awk -Z x');
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toMatch(/invalid option/);
  });
});

/* ------------------------------------------------------------------ */
/* package contract                                                    */
/* ------------------------------------------------------------------ */

describe('awk — the lazy package contract', () => {
  it('stub metadata matches the chunk (name + usage), man pages cover the command', async () => {
    const mod = await import('../../src/terminal/packages/awk/index.js');
    expect(mod.commands.map((c) => [c.name, c.usage])).toEqual(awkStub.commands.map((c) => [c.name, c.usage]));
    for (const c of awkStub.commands) expect(mod.manPages![c.name]!.length).toBeGreaterThan(4);
  });

  it('a stub-only instance answers help from the stub, then ensure() swaps the real page', async () => {
    const stubOnly = createLazyPackage(awkStub, () => new Promise(() => {}));
    expect(stubOnly.loaded()).toBe(false);
    expect(stubOnly.manPage('awk')!.join('\n')).toContain('short page');
    expect(await pkg.ensure()).toBe(true);
    expect(pkg.loaded()).toBe(true);
    expect(pkg.manPage('awk')!.join('\n')).toContain('SYNOPSIS');
  });
});
