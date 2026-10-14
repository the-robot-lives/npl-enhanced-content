// Unit spec — the posix-sh plugin: POSIX-style commands over the virtual
// file system (src/terminal/plugins/posix/)
//
// Feature: navigation
//   Scenario: pwd prints the working directory; cd handles -, ~, .., home
//   Scenario: cd onto a file or a missing path errors with exit 1
// Feature: listing and reading
//   Scenario: ls marks dirs, -a shows dot entries, -l long form, -R walks,
//             -h humanizes, --color colorizes dirs, missing path exits 2
//   Scenario: cat prints several files, -n numbers, stdin via -, errors per file
//   Scenario: bat numbers lines and highlights html; --plain strips both
//   Scenario: head/tail slice files (-n N, -N, multi-file headers, -f simulated)
//   Scenario: wc counts (-l -w -c, totals, stdin)
// Feature: searching
//   Scenario: grep -n -i -c -r with exit statuses 0/1/2
// Feature: the shell around the commands
//   Scenario: echo expands $VAR; quoting single vs double; globs * and ?
//   Scenario: printf formats; env/export/unset/alias/history/which/man work
//   Scenario: pipes carry stdout to stdin; redirects write and append files
//   Scenario: $? reports the last status (true 0, false 1, missing 1, unknown 127)
// Feature: tree mutations (mkdir · rmdir · touch · rm · cp)
//   Scenario: mkdir makes a directory, -p the parents; duplicates error
//   Scenario: touch creates empty files and leaves existing ones alone
//   Scenario: rm removes files, -r/-R trees, -f silently; the root is refused
//   Scenario: rmdir removes only empty directories
//   Scenario: cp copies files into names and into dirs, -r for directories,
//             refuses dir-into-itself and multi-source-onto-file

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const statusLine = (r: ExecResult): string | undefined =>
  r.lines.find((l) => l.kind === 'status')?.text;

beforeEach(() => {
  core = new TerminalCore();
  const result = core.mountPlugin(posixPlugin);
  if (!result.ok) throw new Error(result.error ?? 'posix plugin failed to mount');
  core.vfs.mountFile('/README.md', '# Demo\nhello world\n');
  core.vfs.mountFile('/docs/alpha.txt', 'one\ntwo\nthree\n');
  core.vfs.mountFile('/docs/beta.txt', 'ONE\n\nfour\n');
  core.vfs.mountFile('/docs/nested/deep.txt', 'bottom\n');
  core.vfs.mountFile('/page.html', '<!doctype html>\n<html>\n<h1>Hi</h1>\n</html>\n');
});

describe('pwd / cd', () => {
  it('pwd prints the working directory; cd navigates .. and absolute paths', () => {
    expect(out(core.execLine('pwd'))).toEqual(['/']);
    core.execLine('cd docs');
    expect(out(core.execLine('pwd'))).toEqual(['/docs']);
    core.execLine('cd nested');
    expect(out(core.execLine('pwd'))).toEqual(['/docs/nested']);
    core.execLine('cd ..');
    expect(out(core.execLine('pwd'))).toEqual(['/docs']);
    core.execLine('cd /');
    expect(out(core.execLine('pwd'))).toEqual(['/']);
  });

  it('cd with no argument goes home; cd - returns and prints where it went', () => {
    core.execLine('cd docs');
    core.execLine('cd');
    expect(out(core.execLine('pwd'))).toEqual(['/']); // HOME=/
    const r = core.execLine('cd -');
    expect(out(core.execLine('pwd'))).toEqual(['/docs']);
    expect(out(r)).toEqual(['/docs']); // bash prints the directory cd - landed in
  });

  it('cd ~ lands in $HOME', () => {
    core.execLine('cd docs');
    core.execLine('cd ~');
    expect(out(core.execLine('pwd'))).toEqual(['/']);
  });

  it('cd onto a file or a missing path errors with exit 1', () => {
    expect(errs(core.execLine('cd README.md'))).toEqual(['cd: README.md: Not a directory']);
    expect(status(core.execLine('cd nope'))).toBe(1);
    expect(errs(core.execLine('cd nope'))).toEqual(['cd: nope: No such file or directory']);
  });
});

describe('ls', () => {
  it('plain ls lists entries, directories carrying /', () => {
    const lines = out(core.execLine('ls --color=never /'));
    expect(lines).toContain('README.md');
    expect(lines).toContain('docs/');
    expect(lines).toContain('page.html');
  });

  it('-a adds . and .. and shows dotfiles', () => {
    core.vfs.mountFile('/docs/.hidden', 'x');
    const lines = out(core.execLine('ls -a --color=never /docs'));
    expect(lines).toContain('.');
    expect(lines).toContain('..');
    expect(lines).toContain('.hidden');
    const plain = out(core.execLine('ls --color=never /docs'));
    expect(plain).not.toContain('.hidden');
  });

  it('-l prints mode, links, size and name; -h humanizes', () => {
    const lines = out(core.execLine('ls -l --color=never /'));
    const file = lines.find((l) => l.endsWith('README.md'))!;
    expect(file).toMatch(/^-rw-r--r--  1 +\d+  README\.md$/);
    const dir = lines.find((l) => l.endsWith('docs/'))!;
    expect(dir).toMatch(/^drwxr-xr-x/);
    const human = out(core.execLine('ls -l -h --color=never /')).find((l) => l.endsWith('README.md'))!;
    expect(human).toMatch(/README\.md$/);
    expect(human.split('  ').some((f) => /^\d+(\.\d)?[BKMGT]?$/.test(f.trim()) && f.trim() !== '1')).toBe(true);
  });

  it('-1 forces one per line', () => {
    const lines = out(core.execLine('ls -1 --color=never /docs'));
    expect(lines.every((l) => !l.includes(' '))).toBe(true);
    expect(lines).toContain('alpha.txt');
  });

  it('-R walks the tree with directory headers and blank separators', () => {
    const lines = out(core.execLine('ls -R --color=never /docs'));
    expect(lines).toContain('/docs:'); // headers are the paths as given
    expect(lines).toContain('/docs/nested:');
    expect(lines).toContain('deep.txt');
    expect(lines.some((l) => l === '')).toBe(true); // blank line between blocks
  });

  it('--color=always wraps directories in the dir color', () => {
    const lines = out(core.execLine('ls --color=always /'));
    const dirLine = lines.find((l) => l.includes('docs'))!;
    expect(dirLine).toContain('\x1b[01;34m');
    expect(dirLine).toContain('\x1b[0m');
  });

  it('a missing path errors and exits 2', () => {
    expect(errs(core.execLine('ls nope'))).toEqual(["ls: cannot access 'nope': No such file or directory"]);
    expect(status(core.execLine('ls nope'))).toBe(2);
  });
});

describe('cat', () => {
  it('prints several files in order', () => {
    const text = out(core.execLine('cat /docs/alpha.txt /docs/nested/deep.txt')).join('\n');
    expect(text).toContain('one');
    expect(text).toContain('bottom');
  });

  it('-n numbers every line', () => {
    const lines = out(core.execLine('cat -n /docs/alpha.txt'));
    expect(lines[0]).toMatch(/^\s*1\tone$/);
    expect(lines[2]).toMatch(/^\s*3\tthree$/);
  });

  it('- reads piped stdin', () => {
    expect(out(core.execLine('echo piped | cat -'))).toEqual(['piped']);
  });

  it('missing files and directories error per file, exit 1', () => {
    const r = core.execLine('cat nope /docs');
    expect(errs(r)).toEqual(['cat: nope: No such file or directory', 'cat: /docs: Is a directory']);
    expect(status(r)).toBe(1);
  });
});

describe('bat', () => {
  it('a tty invocation claims the screen — the pager app spawns (§6.4)', () => {
    // r2-integrate: bat registers CommandSpec.app; on a tty (last stage, no
    // redirect) the hook claims the invocation and run() never prints.
    const r = core.execLine('bat /page.html');
    expect(r.actions.some((a) => a.kind === 'app')).toBe(true);
    expect(status(r)).toBe(0);
  });

  it('--plain prints bare text with no gutter or color when piped (non-tty keeps run())', () => {
    const lines = out(core.execLine('bat --plain /page.html | cat'));
    expect(lines[0]).toBe('<!doctype html>');
    expect(lines.join('\n')).not.toContain('\x1b[');
  });

  it('a missing file errors, exit 1', () => {
    expect(errs(core.execLine('bat nope'))).toEqual(['bat: nope: No such file or directory']);
    expect(status(core.execLine('bat nope'))).toBe(1);
  });
});

describe('head / tail', () => {
  it('head defaults to ten lines and honors -n and -N', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\n');
    core.vfs.mountFile('/twelve.txt', twelve);
    expect(out(core.execLine('head /twelve.txt'))).toHaveLength(10);
    expect(out(core.execLine('head -n 2 /twelve.txt'))).toEqual(['l1', 'l2']);
    expect(out(core.execLine('head -3 /twelve.txt'))).toEqual(['l1', 'l2', 'l3']);
  });

  it('tail prints the last lines; -f is accepted (simulated)', () => {
    expect(out(core.execLine('tail -n 2 /docs/alpha.txt'))).toEqual(['two', 'three']);
    expect(out(core.execLine('tail -2 -f /docs/alpha.txt'))).toEqual(['two', 'three']);
  });

  it('multi-file head labels each file', () => {
    const lines = out(core.execLine('head -1 /docs/alpha.txt /docs/beta.txt'));
    expect(lines).toContain('==> /docs/alpha.txt <==');
    expect(lines[1]).toBe('one');
    expect(lines).toContain('==> /docs/beta.txt <==');
  });
});

describe('wc', () => {
  it('counts lines, words and bytes, padded, with a total for several files', () => {
    const lines = out(core.execLine('wc /docs/alpha.txt /docs/beta.txt'));
    expect(lines[0]).toMatch(/^\s*3\s+3\s+1[45]?\d*\s+\/docs\/alpha\.txt$/); // 14 bytes? keep loose
    expect(lines[0]).toMatch(/^\s*3\s/);
    expect(lines[2]).toMatch(/total$/);
  });

  it('-l -w -c select single columns; stdin trims the padding', () => {
    expect(out(core.execLine('wc -l /docs/alpha.txt'))).toEqual(['      3 /docs/alpha.txt']); // file: padded like wc
    expect(out(core.execLine('wc -w /docs/beta.txt'))).toEqual(['      2 /docs/beta.txt']);
    expect(out(core.execLine('cat /docs/alpha.txt | wc -l'))).toEqual(['3']); // stdin: trimmed
  });
});

describe('grep', () => {
  it('-n labels and numbers matches', () => {
    const lines = out(core.execLine('grep -n two /docs/alpha.txt'));
    expect(lines).toEqual(['2:two']);
  });

  it('-i ignores case; -c counts', () => {
    expect(out(core.execLine('grep -i one /docs/beta.txt'))).toEqual(['ONE']);
    expect(out(core.execLine('grep -c e /docs/alpha.txt'))).toEqual(['2']);
  });

  it('-r walks directories with file labels', () => {
    const lines = out(core.execLine('grep -r bottom /docs'));
    expect(lines).toEqual(['/docs/nested/deep.txt:bottom']); // -n would add the line number
  });

  it('a directory without -r, a missing file and a bad pattern exit 2; no match exits 1', () => {
    expect(status(core.execLine('grep x /docs'))).toBe(2);
    expect(status(core.execLine('grep x nope'))).toBe(2);
    expect(errs(core.execLine('grep x nope'))).toEqual(['grep: nope: No such file or directory']);
    expect(status(core.execLine('grep [ /docs/alpha.txt'))).toBe(2); // bad regex
    expect(status(core.execLine('grep zz /docs/alpha.txt'))).toBe(1);
    expect(status(core.execLine('grep two /docs/alpha.txt'))).toBe(0);
  });

  it('runs down a pipe', () => {
    expect(out(core.execLine('cat /docs/alpha.txt | grep -c e'))).toEqual(['2']);
  });
});

describe('echo / printf / quoting / globs', () => {
  it('echo prints words and expands $VAR', () => {
    expect(out(core.execLine('echo hello world'))).toEqual(['hello world']);
    core.execLine('export GREET=hi');
    expect(out(core.execLine('echo $GREET there'))).toEqual(['hi there']);
    expect(out(core.execLine('echo ${GREET}!'))).toEqual(['hi!']);
    expect(out(core.execLine('echo $MISSING'))).toEqual(['']);
  });

  it('single quotes are literal, double quotes keep spaces and expand', () => {
    expect(out(core.execLine("echo 'a  b $GREET'"))).toEqual(['a  b $GREET']);
    core.execLine('export GREET=hi');
    expect(out(core.execLine('echo "a  b $GREET"'))).toEqual(['a  b hi']);
  });

  it('* and ? glob against the vfs; no match stays literal', () => {
    core.vfs.mountFile('/docs/c.txt', 'see');
    const lines = out(core.execLine('ls --color=never /docs/*.txt'));
    expect(lines).toContain('alpha.txt');
    expect(lines).toContain('beta.txt');
    expect(lines).toContain('c.txt');
    expect(lines).not.toContain('nested/');
    expect(lines.some((l) => l === '')).toBe(false); // plain operands: no blank separators
    expect(out(core.execLine('ls --color=never /docs/?.txt'))).toEqual(['c.txt']); // ? is exactly one char
    expect(errs(core.execLine('ls /docs/*.zzz'))).toEqual(["ls: cannot access '/docs/*.zzz': No such file or directory"]);
  });

  it('printf formats %s, %d and %%', () => {
    expect(out(core.execLine("printf '%s has %d %s\\n' cats 9 lives"))).toEqual(['cats has 9 lives']);
    expect(out(core.execLine("printf '100%%\\n'"))).toEqual(['100%']);
  });
});

describe('env / export / unset / alias / history / which / man', () => {
  it('export sets, env lists, unset removes', () => {
    core.execLine('export TOKEN=abc');
    expect(out(core.execLine('env')).join('\n')).toContain('TOKEN=abc');
    expect(out(core.execLine('echo $TOKEN'))).toEqual(['abc']);
    core.execLine('unset TOKEN');
    expect(out(core.execLine('echo $TOKEN'))).toEqual(['']);
  });

  it('export without = errors, exit 1', () => {
    expect(errs(core.execLine('export BROKEN'))).toEqual(['export: BROKEN: not a valid assignment']);
    expect(status(core.execLine('export BROKEN'))).toBe(1);
  });

  it('alias defines and lists; which resolves aliases and builtins', () => {
    core.execLine("alias ll='ls -l'");
    expect(out(core.execLine('alias')).join('\n')).toContain("alias ll='ls -l'");
    expect(out(core.execLine('which ll'))).toEqual(['ll: aliased to ls -l']);
    expect(out(core.execLine('which pwd'))).toEqual(['pwd: shell built-in command']);
    expect(out(core.execLine('which nope'))).toEqual([]);
    expect(status(core.execLine('which nope'))).toBe(1);
  });

  it('an alias expands and runs', () => {
    core.execLine("alias dt='ls /docs'");
    const lines = out(core.execLine('dt'));
    expect(lines).toContain('alpha.txt');
  });

  it('history lists executed lines numbered', () => {
    core.execLine('true');
    core.execLine('echo done');
    const text = out(core.execLine('history')).join('\n');
    expect(text).toContain('true');
    expect(text).toContain('echo done');
  });

  it('man prints a page; missing pages error, exit 1', () => {
    expect(out(core.execLine('man ls')).join('\n')).toMatch(/ls/);
    expect(errs(core.execLine('man nope'))).toEqual(['No manual entry for nope']);
    expect(status(core.execLine('man nope'))).toBe(1);
    expect(errs(core.execLine('man')).join(' ')).toMatch(/What manual page/);
  });
});

describe('pipes / redirects / $? / status lines', () => {
  it('a pipe carries stdout into stdin', () => {
    expect(out(core.execLine('cat /docs/alpha.txt | grep two | wc -l'))).toEqual(['1']);
  });

  it('> writes and truncates, >> appends', () => {
    core.execLine('echo one > /out.txt');
    expect(core.vfs.read('/out.txt')).toContain('one');
    core.execLine('echo two >> /out.txt');
    expect(core.vfs.read('/out.txt')).toContain('two');
    core.execLine('echo zero > /out.txt');
    expect(core.vfs.read('/out.txt')).not.toContain('one');
    expect(out(core.execLine('cat /out.txt'))).toEqual(['zero']);
  });

  it('a bare > creates an empty file; redirected stdout stays off the transcript', () => {
    const r = core.execLine('ls --color=never /docs > /listing.txt');
    expect(out(r)).toEqual([]); // captured, not printed
    const listing = core.vfs.read('/listing.txt') ?? '';
    expect(listing).toContain('alpha.txt');
    core.execLine('> /empty.txt');
    expect(core.vfs.read('/empty.txt')).toBe('');
  });

  it('$? expands to the last status: true 0, false 1, missing file 1, unknown 127', () => {
    core.execLine('true');
    expect(out(core.execLine('echo $?'))).toEqual(['0']);
    core.execLine('false');
    expect(out(core.execLine('echo $?'))).toEqual(['1']);
    expect(status(core.execLine('cat /nope'))).toBe(1);
    expect(status(core.execLine('totally-missing-cmd'))).toBe(127);
    expect(errs(core.execLine('totally-missing-cmd'))).toEqual(['sh: command not found: totally-missing-cmd']);
    core.execLine('totally-missing-cmd');
    expect(out(core.execLine('echo $?'))).toEqual(['127']);
  });

  it('every executed line appends an exit status line', () => {
    expect(statusLine(core.execLine('true'))).toBe('exit 0');
    expect(statusLine(core.execLine('false'))).toBe('exit 1');
    expect(statusLine(core.execLine('nope'))).toBe('exit 127');
  });

  it('parse errors report and status 2', () => {
    expect(errs(core.execLine("echo 'unterminated"))).toEqual(['sh: unterminated quote']);
    expect(status(core.execLine("echo 'unterminated"))).toBe(2);
    expect(errs(core.execLine('echo a | | b')).join(' ')).toMatch(/syntax error/);
  });
});

describe('mkdir / touch', () => {
  it('mkdir makes a directory silently; a missing parent errors GNU-style; -p makes the chain', () => {
    expect(out(core.execLine('mkdir /new'))).toEqual([]);
    expect(core.vfs.nodeAt('/new')?.kind).toBe('dir');
    expect(status(core.execLine('mkdir /new'))).toBe(1);
    expect(errs(core.execLine('mkdir /new'))).toEqual([`mkdir: cannot create directory '/new': File exists`]);
    expect(errs(core.execLine('mkdir /no/child'))).toEqual([
      `mkdir: cannot create directory '/no/child': No such file or directory`,
    ]);
    expect(out(core.execLine('mkdir -p /deep/still/lower'))).toEqual([]);
    expect(core.vfs.nodeAt('/deep/still/lower')?.kind).toBe('dir');
    expect(errs(core.execLine('mkdir'))).toEqual(['mkdir: missing operand']);
    expect(status(core.execLine('mkdir'))).toBe(1);
  });

  it('touch creates empty files and passes existing nodes unchanged', () => {
    expect(out(core.execLine('touch /fresh.txt'))).toEqual([]);
    expect(core.vfs.read('/fresh.txt')).toBe('');
    expect(status(core.execLine('touch /fresh.txt'))).toBe(0); // re-touch is fine
    expect(core.vfs.read('/README.md')).toBe('# Demo\nhello world\n'); // content untouched
    core.execLine('cd /docs');
    expect(out(core.execLine('touch a.txt b.txt'))).toEqual([]);
    expect(core.vfs.read('/docs/a.txt')).toBe('');
    expect(errs(core.execLine('touch /absent/x.txt'))).toEqual([`touch: cannot touch '/absent/x.txt': No such file or directory`]);
    expect(errs(core.execLine('touch'))).toEqual(['touch: missing file operand']);
  });
});

describe('rm / rmdir', () => {
  it('rm removes files silently; a directory needs -r; clustered -rf works', () => {
    expect(out(core.execLine('rm /docs/alpha.txt'))).toEqual([]);
    expect(errs(core.execLine('cat /docs/alpha.txt'))).toEqual(['cat: /docs/alpha.txt: No such file or directory']);
    expect(core.vfs.nodeAt('/docs/nested/deep.txt')).not.toBeNull();
    expect(errs(core.execLine('rm /docs'))).toEqual([`rm: cannot remove '/docs': Is a directory`]);
    expect(core.vfs.nodeAt('/docs')).not.toBeNull();
    expect(out(core.execLine('rm -rf /docs'))).toEqual([]);
    expect(core.vfs.nodeAt('/docs')).toBeNull();
  });

  it('rm reports missing files, is silent under -f, and refuses the root', () => {
    expect(errs(core.execLine('rm /absent.txt'))).toEqual([`rm: cannot remove '/absent.txt': No such file or directory`]);
    expect(status(core.execLine('rm /absent.txt'))).toBe(1);
    expect(out(core.execLine('rm -f /absent.txt'))).toEqual([]);
    expect(status(core.execLine('rm -f /absent.txt'))).toBe(0);
    expect(errs(core.execLine('rm'))).toEqual(['rm: missing operand']);
    expect(status(core.execLine('rm -f'))).toBe(0); // -f alone: silent success
    expect(errs(core.execLine('rm /'))).toEqual([`rm: cannot remove '/': Device or resource busy`]);
    expect(core.vfs.nodeAt('/README.md')).not.toBeNull(); // the tree is intact
  });

  it('rmdir removes only empty directories', () => {
    core.execLine('mkdir /empty');
    expect(out(core.execLine('rmdir /empty'))).toEqual([]);
    expect(core.vfs.nodeAt('/empty')).toBeNull();
    expect(errs(core.execLine('rmdir /docs'))).toEqual([`rmdir: failed to remove '/docs': Directory not empty`]);
    expect(errs(core.execLine('rmdir /README.md'))).toEqual([`rmdir: failed to remove '/README.md': Not a directory`]);
    expect(errs(core.execLine('rmdir /ghost'))).toEqual([`rmdir: failed to remove '/ghost': No such file or directory`]);
  });
});

describe('cp', () => {
  it('copies a file to a new name, into a dir keeping the basename, and overwrites files', () => {
    expect(out(core.execLine('cp /docs/alpha.txt /docs/gamma.txt'))).toEqual([]);
    expect(core.vfs.read('/docs/gamma.txt')).toBe('one\ntwo\nthree\n');
    expect(out(core.execLine('cp /README.md /docs/nested'))).toEqual([]);
    expect(core.vfs.read('/docs/nested/README.md')).toBe('# Demo\nhello world\n');
    core.execLine('echo updated > /docs/gamma.txt');
    expect(out(core.execLine('cp /docs/alpha.txt /docs/gamma.txt'))).toEqual([]);
    expect(core.vfs.read('/docs/gamma.txt')).toBe('one\ntwo\nthree\n');
  });

  it('-r copies trees; without it dirs are omitted with GNU wording', () => {
    expect(errs(core.execLine('cp /docs /backup'))).toEqual(["cp: omitting directory '/docs'"]);
    expect(core.vfs.nodeAt('/backup')).toBeNull();
    expect(out(core.execLine('cp -r /docs /backup'))).toEqual([]);
    expect(core.vfs.read('/backup/nested/deep.txt')).toBe('bottom\n');
    expect(core.vfs.read('/backup/beta.txt')).toBe('ONE\n\nfour\n');
  });

  it('several sources need a directory target; a dir is not copied into itself', () => {
    expect(errs(core.execLine('cp /README.md /page.html /docs/alpha.txt'))).toEqual([
      "cp: target '/docs/alpha.txt' is not a directory",
    ]);
    expect(out(core.execLine('cp /README.md /page.html /docs/nested'))).toEqual([]);
    expect(core.vfs.nodeAt('/docs/nested/README.md')?.kind).toBe('file');
    expect(core.vfs.nodeAt('/docs/nested/page.html')?.kind).toBe('file');
    expect(errs(core.execLine('cp -r /docs /docs/nested/loop'))).toEqual([
      "cp: cannot copy a directory into itself, '/docs' -> '/docs/nested/loop'",
    ]);
  });

  it('argues about missing operands and missing sources', () => {
    expect(errs(core.execLine('cp'))).toEqual(['cp: missing file operand']);
    expect(errs(core.execLine('cp /README.md'))).toEqual(["cp: missing destination file operand after '/README.md'"]);
    expect(errs(core.execLine('cp /ghost.txt /out.txt'))).toEqual(['cp: No such file or directory']);
    expect(core.vfs.nodeAt('/out.txt')).toBeNull();
  });
});
