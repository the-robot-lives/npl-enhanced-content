// Unit spec — the fs command package (packages round, LANE=pkg-fs):
// src/terminal/packages/fs/{stub,index}.ts
//
// Feature: the package contract
//   Scenario: stub names == chunk names == manPages keys; all names match
//             NAME_PATTERN; fs names collide with no other package or the
//             posix plugin
//   Scenario: with a dead chunk the stub still answers --help and fails
//             honest otherwise (lazy.ts semantics)
// Feature: mv
//   Scenario: rename; move into a directory; multiple sources; -v; -n
//   Scenario: GNU errors — missing operand(s), cannot stat, target not a
//             directory, same file, missing dest parent, dir into itself
// Feature: ln / readlink — the VFS has no symlink nodes
//   Scenario: operand validation errors GNU-style; creation reports
//             'Operation not supported' (exit 1); readlink -f canonicalizes
// Feature: chmod / stat
//   Scenario: octal modes land in the session map and stat shows them;
//             -R recurses; symbolic modes and missing files error
//   Scenario: stat prints File/Size/Kind/Access/Backend; exit 1 on missing
// Feature: tree
//   Scenario: default box drawing + summary; -a dot files; -d dirs only;
//             -L depth cap; invalid -L; missing operand
// Feature: du / df
//   Scenario: post-order byte totals, -s, -a, -h, file operands, errors
//   Scenario: df lists every mounted backend (or the covering one), Used
//             bytes, '-' for unknown Avail/Capacity, memory when bare
// Feature: file
//   Scenario: ASCII/UTF-8 text with CRLF/no-newline notes, JSON, XML,
//             HTML vs SemText, PNG dimensions, gzip, zip, tar, shebang,
//             data (NUL); missing files and dirs keep exit 0; -b; stdin
// Feature: realpath / basename / dirname
//   Scenario: normalization, suffix stripping, trailing slashes, root;
//             GNU missing-operand / extra-operand errors
// Feature: mktemp
//   Scenario: unique file/dir under /tmp, custom template, -p DIR, too
//             few X's, missing parent
// Feature: type
//   Scenario: alias and/or command resolution, not found exits 1
// Feature: date / cal
//   Scenario: +FORMAT strftime subset, -u, -d @epoch/ISO, invalid date
//   Scenario: October 2026 grid, leap February, year sheet, month names,
//             invalid month/year
// Feature: sleep / seq / yes — sync-core deviations, documented
//   Scenario: sleep validates GNU-style and returns at once
//   Scenario: seq ranges, negative incr, -s, -w, -f, zero incr, NaN, cap
//   Scenario: yes emits its 1000-line budget then exits 0
// Feature: expr
//   Scenario: arithmetic + precedence + parens, truncating division,
//             comparisons, : BRE match with \( \) capture, string fns,
//             exit codes 0/1/2
// Feature: test
//   Scenario: file/string/integer/unary/binary conditions, ! -a -o ( ),
//             bare test false, error exit 2, $? interplay
// Feature: pipes and redirects through the real dispatcher
//   Scenario: seq | head; echo | file -; tree > file; test + $?

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalCore, type CommandContext, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import { PACKAGES, applyPackageMan } from '../../src/terminal/packages/manifest.js';
import { fsStub } from '../../src/terminal/packages/fs/stub.js';
import { commands as fsCommands, manPages, pkg as fsChunk } from '../../src/terminal/packages/fs/index.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;

beforeEach(async () => {
  core = new TerminalCore();
  expect(core.mountPlugin(posixPlugin).ok).toBe(true);
  const fsTest = createLazyPackage(fsStub, async () => fsChunk);
  expect(core.mountPlugin({ name: 'packages-test', version: '0.0.0', commands: fsTest.commands, files: [] }).ok).toBe(true);
  await fsTest.ensure();
  core.vfs.mountFile('/a.txt', 'alpha\n');
  core.vfs.mountFile('/empty.txt', '');
  core.vfs.mountFile('/docs/alpha.txt', 'one\ntwo\nthree\n');
  core.vfs.mountFile('/docs/nested/deep.txt', 'bottom\n');
  core.vfs.mountFile('/.hidden', 'h\n');
});

/** Run one spec directly with a context over the shared core (bypasses parsing). */
function runSpec(name: string, args: string[], stdin: string | null = null): { outs: string[]; errs: string[]; code: number } {
  const spec = core.commands.get(name)!;
  const outs: string[] = [];
  const errsCol: string[] = [];
  let code: number | null = null;
  spec.run({
    args,
    stdin,
    vfs: core.vfs,
    state: core.state,
    color: false,
    commands: core.commands,
    out: (t: string) => outs.push(t),
    err: (t: string) => errsCol.push(t),
    emit: () => {},
    exit: (c: number) => {
      code = c;
    },
  } as unknown as CommandContext);
  return { outs, errs: errsCol, code: code ?? (errsCol.length > 0 ? 1 : 0) };
}

/* ------------------------------------------------------------------ */
/* the package contract                                                */
/* ------------------------------------------------------------------ */

describe('the fs package contract', () => {
  it('stub names == chunk names == manPages keys; every name is registrable', () => {
    const stubNames = fsStub.commands.map((c) => c.name).sort();
    const chunkNames = fsCommands.map((c) => c.name).sort();
    expect(stubNames).toEqual(chunkNames);
    expect(Object.keys(manPages).sort()).toEqual(stubNames);
    for (const name of stubNames) expect(name).toMatch(NAME_PATTERN);
    expect(stubNames.length).toBe(21);
  });

  it('fs names collide with neither the posix plugin nor any other package', () => {
    const posixNames = new Set(posixPlugin.commands.map((c) => c.name));
    for (const pkg of PACKAGES) {
      for (const cmd of pkg.commands) {
        if (pkg.name === 'fs') {
          expect(posixNames.has(cmd.name), `fs command collides with posix: ${cmd.name}`).toBe(false);
        } else if (posixNames.has(cmd.name)) {
          continue; // other lanes' overlaps are their lane's report
        } else {
          const mine = new Set(fsStub.commands.map((c) => c.name));
          expect(mine.has(cmd.name), `fs collides with package ${pkg.name}: ${cmd.name}`).toBe(false);
        }
      }
    }
  });

  it('chunk usage lines come from the stub (help never waits on the network)', () => {
    for (const spec of fsCommands) {
      const stubCmd = fsStub.commands.find((c) => c.name === spec.name)!;
      expect(spec.usage).toBe(stubCmd.usage);
    }
  });

  it('with a dead chunk the stub answers --help and fails honest otherwise', async () => {
    const deadCore = new TerminalCore();
    const dead = createLazyPackage(fsStub, () => Promise.reject(new Error('no chunk file')));
    // Production wraps whichever manifest carries `man` (the posix plugin's)
    // with the packages' pages — mirror that here.
    expect(deadCore.mountPlugin(applyPackageMan(posixPlugin)).ok).toBe(true);
    expect(deadCore.mountPlugin({ name: 'fs-dead', version: '0', commands: dead.commands, files: [] }).ok).toBe(true);
    await dead.ensure();
    expect(await dead.ensure()).toBe(false);
    const r = deadCore.execLine('date');
    expect(errs(r)).toEqual(['date: package chunk failed to load (semtext-pkg-fs.js)']);
    expect(status(r)).toBe(1);
    expect(out(deadCore.execLine('date --help'))).toEqual(['date [-u] [-d DATE] [+FORMAT]']);
    const man = out(deadCore.execLine('man chmod')).join('\n');
    expect(man).toContain('CHMOD(1)');
    expect(man).toContain('session-scoped map');
  });
});

/* ------------------------------------------------------------------ */
/* mv                                                                  */
/* ------------------------------------------------------------------ */

describe('mv', () => {
  it('renames, moves into directories, multi-source, -v and -n', () => {
    expect(out(core.execLine('mv a.txt b.txt'))).toEqual([]);
    expect(core.vfs.read('/b.txt')).toBe('alpha\n');
    expect(core.vfs.nodeAt('/a.txt')).toBeNull();

    core.vfs.mountFile('/x.txt', 'x\n');
    expect(out(core.execLine('mv x.txt docs'))).toEqual([]);
    expect(core.vfs.read('/docs/x.txt')).toBe('x\n');

    core.vfs.mountFile('/y.txt', 'y\n');
    core.vfs.mountFile('/z.txt', 'z\n');
    expect(out(core.execLine('mv y.txt z.txt docs'))).toEqual([]);
    expect(core.vfs.read('/docs/y.txt')).toBe('y\n');

    core.vfs.mountFile('/v.txt', 'v\n');
    expect(out(core.execLine('mv -v v.txt docs'))).toEqual(["'v.txt' -> 'docs/v.txt'"]);

    core.vfs.mountFile('/n1.txt', 'one\n');
    core.vfs.mountFile('/n2.txt', 'two\n');
    const r = core.execLine('mv -n n1.txt n2.txt');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/n2.txt')).toBe('two\n'); // -n skipped
    expect(core.vfs.read('/n1.txt')).toBe('one\n'); // source kept
  });

  it('GNU errors', () => {
    expect(errs(core.execLine('mv'))).toEqual(['mv: missing file operand']);
    expect(errs(core.execLine('mv onefile'))).toEqual(["mv: missing destination file operand after 'onefile'"]);
    const r = core.execLine('mv nope.txt b.txt');
    expect(errs(r)).toEqual(["mv: cannot stat 'nope.txt': No such file or directory"]);
    expect(status(r)).toBe(1);
    expect(errs(core.execLine('mv a.txt empty.txt b.txt'))).toEqual(["mv: target 'b.txt' is not a directory"]);
    expect(errs(core.execLine('mv a.txt a.txt'))).toEqual(["mv: 'a.txt' and 'a.txt' are the same file"]);
    expect(errs(core.execLine('mv a.txt ./a.txt'))).toEqual(["mv: 'a.txt' and './a.txt' are the same file"]);
    const noParent = core.execLine('mv a.txt no/such/dir/x');
    expect(errs(noParent)[0]).toBe("mv: cannot move 'a.txt' to 'no/such/dir/x': No such file or directory");
    const intoSelf = core.execLine('mv docs docs/nested');
    expect(errs(intoSelf)[0]).toContain('mv: cannot move');
    expect(errs(intoSelf)[0]).toContain('itself');
  });
});

/* ------------------------------------------------------------------ */
/* ln / readlink — no symlink nodes exist                              */
/* ------------------------------------------------------------------ */

describe('ln / readlink (VFS has no links)', () => {
  it('validates operands GNU-style, then reports honestly', () => {
    expect(errs(core.execLine('ln'))).toEqual(['ln: missing file operand']);
    expect(errs(core.execLine('ln a.txt'))).toEqual(["ln: missing destination file operand after 'a.txt'"]);
    const hard = core.execLine('ln a.txt b.link');
    expect(errs(hard)[0]).toBe("ln: failed to create hard link 'b.link': Operation not supported");
    expect(status(hard)).toBe(1);
    const sym = core.execLine('ln -s a.txt b.link');
    expect(errs(sym)[0]).toBe("ln: failed to create symbolic link 'b.link': Operation not supported");
    expect(errs(sym)[1]).toContain('file | dir');
    expect(core.vfs.nodeAt('/b.link')).toBeNull();
  });

  it('readlink: not a symlink without -f; canonical path with -f', () => {
    const plain = core.execLine('readlink a.txt');
    expect(errs(plain)[0]).toBe('readlink: a.txt: not a symbolic link');
    expect(status(plain)).toBe(1);
    expect(errs(core.execLine('readlink'))).toEqual(['readlink: missing operand']);
    expect(out(core.execLine('readlink -f docs/../a.txt'))).toEqual(['/a.txt']);
    const miss = core.execLine('readlink -f docs/../nope.txt');
    // GNU -f requires only the PARENT to exist: the last component may be
    // missing and is still printed.
    expect(out(miss)).toEqual(['/nope.txt']);
    expect(status(miss)).toBe(0);
    const noDir = core.execLine('readlink -f no/dir/x.txt');
    expect(errs(noDir)).toEqual(['readlink: no/dir/x.txt: No such file or directory']);
    expect(status(noDir)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* chmod / stat                                                        */
/* ------------------------------------------------------------------ */

describe('chmod / stat', () => {
  it('octal modes land in the session map; stat shows them; -R recurses', () => {
    core.execLine('chmod 600 a.txt');
    const s = out(core.execLine('stat a.txt'));
    expect(s[2]).toBe('Access: (0600/rw-------)');
    core.execLine('chmod -R 700 docs');
    expect(out(core.execLine('stat docs'))[2]).toBe('Access: (0700/rwx------)');
    expect(out(core.execLine('stat docs/alpha.txt'))[2]).toBe('Access: (0700/rwx------)');
    // defaults without chmod
    expect(out(core.execLine('stat empty.txt'))[2]).toBe('Access: (0644/rw-r--r--)');
  });

  it('errors: symbolic modes, missing files, missing operands', () => {
    const symbolic = core.execLine('chmod u+x a.txt');
    expect(errs(symbolic)).toEqual(['chmod: invalid mode: \'u+x\'', 'chmod: this build accepts octal modes only (symbolic modes are not implemented)']);
    expect(status(symbolic)).toBe(1);
    const miss = core.execLine('chmod 600 nope.txt');
    expect(errs(miss)).toEqual(['chmod: cannot access \'nope.txt\': No such file or directory']);
    expect(errs(core.execLine('chmod'))[0]).toBe('chmod: missing operand');
    expect(errs(core.execLine('chmod 600'))[0]).toBe("chmod: missing operand after '600'");
  });

  it('stat blocks: File/Size/Kind/Access/Backend, separators, exit 1 on missing', () => {
    const s = out(core.execLine('stat a.txt'));
    expect(s[0]).toBe('  File: /a.txt');
    expect(s[1]).toContain('  Size: 6');
    expect(s[1]).toContain('Kind: regular file');
    expect(s[3]).toBe('Backend: memory (/)');
    const both = out(core.execLine('stat a.txt docs'));
    expect(both.length).toBe(9); // 4 lines x2 + blank separator
    expect(both[4]).toBe('');
    expect(out(core.execLine('stat docs'))[1]).toContain('Kind: directory');
    const miss = core.execLine('stat nope');
    expect(errs(miss)).toEqual(["stat: cannot stat 'nope': No such file or directory"]);
    expect(status(miss)).toBe(1);
    expect(errs(core.execLine('stat'))[0]).toBe('stat: missing operand');
  });
});

/* ------------------------------------------------------------------ */
/* tree                                                                */
/* ------------------------------------------------------------------ */

describe('tree', () => {
  it('default: box drawing, dot entries hidden, summary line', () => {
    expect(out(core.execLine('tree'))).toEqual([
      '.',
      '├── a.txt',
      '├── docs/',
      '│   ├── alpha.txt',
      '│   └── nested/',
      '│       └── deep.txt',
      '└── empty.txt',
      '2 directories, 4 files',
    ]);
  });

  it('-a shows dot entries; -d dirs only; -L caps depth', () => {
    const withHidden = out(core.execLine('tree -a'));
    expect(withHidden.some((l) => l.endsWith('.hidden'))).toBe(true); // localeCompare puts '.' first
    expect(withHidden.at(-1)).toBe('2 directories, 5 files');
    expect(out(core.execLine('tree -d'))).toEqual([
      '.',
      '└── docs/',
      '    └── nested/',
      '2 directories, 0 files',
    ]);
    expect(out(core.execLine('tree -L 1'))).toEqual([
      '.',
      '├── a.txt',
      '├── docs/',
      '└── empty.txt',
      '1 directory, 2 files',
    ]);
  });

  it('errors and edge shapes', () => {
    const badLevel = core.execLine('tree -L 0');
    expect(errs(badLevel)).toEqual(['tree: Invalid level, must be greater than 0.']);
    expect(status(badLevel)).toBe(1);
    const miss = core.execLine('tree nope');
    expect(errs(miss)).toEqual(['tree: nope: No such file or directory']);
    core.vfs.mountFile('/solo/only.txt', 'x\n');
    expect(out(core.execLine('tree solo'))).toEqual(['solo', '└── only.txt', '0 directories, 1 file']);
  });
});

/* ------------------------------------------------------------------ */
/* du / df                                                             */
/* ------------------------------------------------------------------ */

describe('du', () => {
  it('post-order byte totals; -s; -a; file operands', () => {
    expect(out(core.execLine('du docs'))).toEqual(['7\tdocs/nested', '21\tdocs']);
    expect(out(core.execLine('du -a docs'))).toEqual(['14\tdocs/alpha.txt', '7\tdocs/nested/deep.txt', '7\tdocs/nested', '21\tdocs']);
    expect(out(core.execLine('du -s docs'))).toEqual(['21\tdocs']);
    expect(out(core.execLine('du a.txt'))).toEqual(['6\ta.txt']);
    core.vfs.mountFile('/big.bin', 'x'.repeat(2048));
    expect(out(core.execLine('du -sh big.bin'))).toEqual(['2K\tbig.bin']);
  });

  it('errors', () => {
    const miss = core.execLine('du nope');
    expect(errs(miss)).toEqual(["du: cannot access 'nope': No such file or directory"]);
    expect(status(miss)).toBe(1);
  });
});

describe('df', () => {
  it('memory line when nothing is mounted', async () => {
    const bare = new TerminalCore();
    expect(bare.mountPlugin(posixPlugin).ok).toBe(true);
    const lazy = createLazyPackage(fsStub, async () => fsChunk);
    expect(bare.mountPlugin({ name: 'packages-test', version: '0.0.0', commands: lazy.commands, files: [] }).ok).toBe(true);
    await lazy.ensure();
    const lines = out(bare.execLine('df'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Filesystem');
    expect(lines[0]).toContain('Avail Capacity Mounted on');
    expect(lines[1]).toContain('memory');
    expect(lines[1]).toContain('-');
  });

  it('lists every mounted backend with used bytes; a path filters', () => {
    const fake = {
      id: 'testbed',
      writable: true,
      mountpoint: '/store',
      stat: async () => null,
      read: async () => null,
      write: async () => {},
      mkdirp: async () => {},
      rm: async () => {},
      rename: async () => {},
      list: async () => [],
    };
    core.vfs.attachBackend(fake);
    core.vfs.mountFile('/store/blob.bin', 'x'.repeat(10));
    const lines = out(core.execLine('df'));
    expect(lines).toHaveLength(2); // header + testbed (mounts exist: no memory row)
    const row = lines[1]!;
    expect(row.startsWith('testbed')).toBe(true);
    expect(row).toContain('10');
    expect(row.trim().endsWith('/store')).toBe(true);
    const filtered = out(core.execLine('df /store/blob.bin'));
    expect(filtered).toHaveLength(2);
    expect(filtered[1]!.startsWith('testbed')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* file                                                                */
/* ------------------------------------------------------------------ */

describe('file', () => {
  it('text classification: ASCII, UTF-8, CRLF, no trailing newline', () => {
    core.vfs.mountFile('/t1.txt', 'plain ascii\n');
    core.vfs.mountFile('/t2.txt', 'a\r\nb\r\n');
    core.vfs.mountFile('/t3.txt', 'no newline');
    core.vfs.mountFile('/t4.txt', 'héllo wörld\n');
    expect(out(core.execLine('file t1.txt'))).toEqual(['t1.txt: ASCII text']);
    expect(out(core.execLine('file t2.txt'))).toEqual(['t2.txt: ASCII text, with CRLF line terminators']);
    expect(out(core.execLine('file t3.txt'))).toEqual(['t3.txt: ASCII text, with no line terminators']);
    expect(out(core.execLine('file t4.txt'))).toEqual(['t4.txt: UTF-8 Unicode text']);
  });

  it('structured formats: JSON, XML, HTML vs SemText, shebang, data', () => {
    core.vfs.mountFile('/d.json', '{"a": 1}\n');
    core.vfs.mountFile('/d.xml', '<?xml version="1.0"?>\n<x/>\n');
    core.vfs.mountFile('/d.html', '<!DOCTYPE html>\n<html><body></body></html>\n');
    core.vfs.mountFile('/d.sem.html', '<!DOCTYPE html>\n<sem-page><sem-note>hi</sem-note></sem-page>\n');
    core.vfs.mountFile('/d.sh', '#!/bin/sh\necho hi\n');
    core.vfs.mountFile('/d.bin', 'a\u0000b');
    expect(out(core.execLine('file d.json'))).toEqual(['d.json: JSON text data']);
    expect(out(core.execLine('file d.xml'))).toEqual(['d.xml: XML document text']);
    expect(out(core.execLine('file d.html'))).toEqual(['d.html: HTML document text']);
    expect(out(core.execLine('file d.sem.html'))).toEqual(['d.sem.html: SemText HTML document text']);
    expect(out(core.execLine('file d.sh'))).toEqual(['d.sh: /bin/sh script text executable']);
    expect(out(core.execLine('file d.bin'))).toEqual(['d.bin: data']);
    const semBody = core.vfs.mountFile('/plain.html', '<html><sem-note>x</sem-note></html>');
    void semBody;
    expect(out(core.execLine('file plain.html'))).toEqual(['plain.html: SemText HTML document text']);
  });

  it('binary magics: PNG with dimensions, gzip, zip, tar', () => {
    const png = '\u0089PNG\r\n\u001a\n' + String.fromCharCode(0, 0, 0, 13) + 'IHDR' + String.fromCharCode(0, 1, 0, 0, 0, 4, 0, 0) + 'rest';
    core.vfs.mountFile('/i.png', png);
    core.vfs.mountFile('/a.gz', '\u001f\u008b\u0008compressed');
    core.vfs.mountFile('/a.zip', 'PK\u0003\u0004archived');
    core.vfs.mountFile('/a.tar', 'x'.repeat(257) + 'ustar' + ' '.repeat(12));
    expect(out(core.execLine('file i.png'))).toEqual(['i.png: PNG image data, 1 x 4']);
    expect(out(core.execLine('file a.gz'))).toEqual(['a.gz: gzip compressed data']);
    expect(out(core.execLine('file a.zip'))).toEqual(['a.zip: Zip archive data']);
    expect(out(core.execLine('file a.tar'))).toEqual(['a.tar: POSIX tar archive']);
  });

  it('GNU behaviours: missing/dirs keep exit 0; -b; stdin; missing operand', () => {
    const miss = core.execLine('file nope.txt');
    expect(errs(miss)).toEqual(['nope.txt: No such file or directory']);
    expect(status(miss)).toBe(0);
    const dir = core.execLine('file docs');
    expect(errs(dir)).toEqual(['docs: Is a directory']);
    expect(status(dir)).toBe(0);
    core.vfs.mountFile('/b.txt', 'x\n');
    expect(out(core.execLine('file -b b.txt'))).toEqual(['ASCII text']);
    expect(out(core.execLine("echo '{\"k\":1}' | file -"))).toEqual(['-: JSON text data']);
    const none = core.execLine('file');
    expect(errs(none)[0]).toBe('file: missing operand');
    expect(status(none)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* realpath / basename / dirname                                       */
/* ------------------------------------------------------------------ */

describe('realpath / basename / dirname', () => {
  it('realpath normalizes and requires existence', () => {
    expect(out(core.execLine('realpath docs/../a.txt'))).toEqual(['/a.txt']);
    expect(out(core.execLine('realpath docs/nested'))).toEqual(['/docs/nested']);
    const miss = core.execLine('realpath nope');
    expect(errs(miss)).toEqual(['realpath: nope: No such file or directory']);
    expect(status(miss)).toBe(1);
    expect(errs(core.execLine('realpath'))).toEqual(['realpath: missing operand']);
  });

  it('basename: segments, suffix, -a, -s, trailing slashes, root', () => {
    expect(out(core.execLine('basename docs/alpha.txt'))).toEqual(['alpha.txt']);
    expect(out(core.execLine('basename alpha.txt'))).toEqual(['alpha.txt']);
    expect(out(core.execLine('basename docs/alpha.txt .txt'))).toEqual(['alpha']);
    expect(out(core.execLine('basename -s .txt docs/alpha.txt docs/beta.txt'))).toEqual(['alpha', 'beta']);
    expect(out(core.execLine('basename -a one.txt two.md'))).toEqual(['one.txt', 'two.md']);
    expect(out(core.execLine('basename docs/'))).toEqual(['docs']);
    expect(out(core.execLine('basename /'))).toEqual(['/']);
    const extra = core.execLine('basename a b c');
    expect(errs(extra)).toEqual(["basename: extra operand 'c'"]);
    expect(status(extra)).toBe(1);
    expect(errs(core.execLine('basename'))).toEqual(['basename: missing operand', "Try 'basename --help' for more information."]);
  });

  it('dirname: parents, dots, slashes, multiple operands', () => {
    expect(out(core.execLine('dirname docs/alpha.txt'))).toEqual(['docs']);
    expect(out(core.execLine('dirname alpha.txt'))).toEqual(['.']);
    expect(out(core.execLine('dirname /a'))).toEqual(['/']);
    expect(out(core.execLine('dirname a/b/'))).toEqual(['a']);
    expect(out(core.execLine('dirname /'))).toEqual(['/']);
    expect(out(core.execLine('dirname //'))).toEqual(['/']);
    expect(out(core.execLine('dirname x y/z'))).toEqual(['.', 'y']);
    expect(errs(core.execLine('dirname'))).toEqual(['dirname: missing operand', "Try 'dirname --help' for more information."]);
  });
});

/* ------------------------------------------------------------------ */
/* mktemp                                                              */
/* ------------------------------------------------------------------ */

describe('mktemp', () => {
  it('creates unique files under /tmp by default; -d makes dirs', () => {
    const first = out(core.execLine('mktemp'))[0]!;
    expect(first).toMatch(/^\/tmp\/tmp\.[a-zA-Z0-9]{10}$/);
    const second = out(core.execLine('mktemp'))[0]!;
    expect(second).not.toBe(first);
    expect(core.vfs.nodeAt(first)?.kind).toBe('file');
    const dir = out(core.execLine('mktemp -d'))[0]!;
    expect(dir).toMatch(/^\/tmp\/tmp\.[a-zA-Z0-9]{10}$/);
    expect(core.vfs.nodeAt(dir)?.kind).toBe('dir');
  });

  it('templates, -p DIR, and errors', () => {
    const withP = out(core.execLine('mktemp -p /docs log-XXXXXX'))[0]!;
    expect(withP).toMatch(/^\/docs\/log-[a-zA-Z0-9]{6}$/);
    expect(core.vfs.nodeAt(withP)?.kind).toBe('file');
    const fewX = core.execLine('mktemp foo');
    expect(errs(fewX)).toEqual(["mktemp: too few X's in template 'foo'"]);
    const noParent = core.execLine('mktemp /nope/x-XXXXXX');
    expect(errs(noParent)).toEqual(["mktemp: Failed to create file via template '/nope/x-XXXXXX': No such file or directory"]);
    expect(status(noParent)).toBe(1);
    const inDocs = out(core.execLine('mktemp /docs/x-XXXXXX'))[0]!;
    expect(inDocs).toMatch(/^\/docs\/x-[a-zA-Z0-9]{6}$/);
  });
});

/* ------------------------------------------------------------------ */
/* type                                                                */
/* ------------------------------------------------------------------ */

describe('type', () => {
  it('resolves aliases and commands; not found exits 1', () => {
    core.execLine("alias ll='ls -l'");
    expect(out(core.execLine('type ll'))).toEqual(['ll is aliased to `ls -l`']);
    const ls = out(core.execLine('type ls'))[0]!;
    expect(ls).toMatch(/^ls is a shell command \(ls /);
    core.execLine("alias ls='ls -l'");
    const both = out(core.execLine('type ls'));
    expect(both).toEqual(['ls is aliased to `ls -l`', expect.stringMatching(/^ls is a shell command/)]);
    const miss = core.execLine('type nope');
    expect(errs(miss)).toEqual(['type: nope: not found']);
    expect(status(miss)).toBe(1);
    expect(errs(core.execLine('type'))).toEqual(['type: missing operand']);
  });
});

/* ------------------------------------------------------------------ */
/* date / cal                                                          */
/* ------------------------------------------------------------------ */

describe('date', () => {
  it('+FORMAT strftime subset, -u, -d epoch and ISO', () => {
    expect(out(core.execLine("date -u -d @0 '+%Y-%m-%dT%H:%M:%S%z'"))).toEqual(['1970-01-01T00:00:00+0000']);
    expect(out(core.execLine("date -u -d @0 '+%a %A %b %B %j %u %w'"))).toEqual(['Thu Thursday Jan January 001 4 4']);
    expect(out(core.execLine("date -u -d 2000-01-01 '+%a %A'"))).toEqual(['Sat Saturday']);
    expect(out(core.execLine("date -u -d @1000000000 '+%F %T'"))).toEqual(['2001-09-09 01:46:40']);
    expect(out(core.execLine("date -d '2026-10-17 14:30:00' '+%F %R %p'"))).toEqual(['2026-10-17 14:30 PM']);
    expect(out(core.execLine("date -u -d '2026-10-17 14:30:00' '+%F %R'"))).toEqual(['2026-10-17 14:30']);
    expect(out(core.execLine("date '+%%'"))).toEqual(['%']);
  });

  it('errors and default shape', () => {
    const bad = core.execLine("date -u -d bogus '+%F'");
    expect(errs(bad)).toEqual(["date: invalid date 'bogus'"]);
    expect(status(bad)).toBe(1);
    const plain = out(core.execLine('date'))[0]!;
    expect(plain).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \S+ \d{4}$/);
    expect(status(core.execLine('date -d now'))).toBe(0);
  });
});

describe('cal', () => {
  it('October 2026: title, header, first and last week rows', () => {
    const lines = out(core.execLine('cal 10 2026'));
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe('    October 2026');
    expect(lines[1]).toBe('Su Mo Tu We Th Fr Sa');
    expect(lines[2]).toBe('             1  2  3');
    expect(lines[6]).toBe('25 26 27 28 29 30 31');
  });

  it('leap February, month names, year sheets, current month', () => {
    const feb = out(core.execLine('cal 2 2028'));
    expect(feb[0]).toContain('February 2028');
    expect(feb[2]).toBe('       1  2  3  4  5'); // Feb 1 2028 is a Tuesday
    expect(feb.at(-1)).toBe('27 28 29');
    expect(out(core.execLine('cal feb'))[0]).toMatch(/February \d{4}/);
    const year = out(core.execLine('cal 2020'));
    expect(year.some((l) => l.includes('January 2020'))).toBe(true);
    expect(year.some((l) => l.includes('December 2020'))).toBe(true);
    expect(out(core.execLine('cal'))[1]).toBe('Su Mo Tu We Th Fr Sa');
  });

  it('invalid month/year errors', () => {
    const m = core.execLine('cal 13');
    expect(errs(m)).toEqual(["cal: invalid month: '13'"]);
    expect(status(m)).toBe(1);
    expect(errs(core.execLine('cal x 2020'))).toEqual(["cal: invalid month: 'x'"]);
    expect(errs(core.execLine('cal 10 abcd'))).toEqual(["cal: invalid year: 'abcd'"]);
  });
});

/* ------------------------------------------------------------------ */
/* sleep / seq / yes — documented sync-core deviations                 */
/* ------------------------------------------------------------------ */

describe('sleep / seq / yes', () => {
  it('sleep validates GNU-style and returns at once', () => {
    expect(status(core.execLine('sleep 2'))).toBe(0);
    expect(out(core.execLine('sleep 1.5m 2h'))).toEqual([]);
    expect(errs(core.execLine('sleep abc'))).toEqual(["sleep: invalid time interval 'abc'"]);
    expect(status(core.execLine('sleep abc'))).toBe(1);
    expect(errs(core.execLine('sleep'))).toEqual(['sleep: missing operand', "Try 'sleep --help' for more information."]);
    expect(errs(core.execLine('sleep -3'))).toEqual(["sleep: invalid time interval '-3'"]);
  });

  it('seq: ranges, negative incr, -s, -w, -f, errors, cap', () => {
    expect(out(core.execLine('seq 3'))).toEqual(['1', '2', '3']);
    expect(out(core.execLine('seq 2 4'))).toEqual(['2', '3', '4']);
    expect(out(core.execLine('seq 1 2 7'))).toEqual(['1', '3', '5', '7']);
    expect(out(core.execLine('seq 5 -2 1'))).toEqual(['5', '3', '1']);
    expect(out(core.execLine('seq 5 2'))).toEqual([]); // positive incr cannot reach
    expect(out(core.execLine('seq -s, 3'))).toEqual(['1,2,3']);
    expect(out(core.execLine('seq -w 8 10'))).toEqual(['08', '09', '10']);
    expect(out(core.execLine('seq -w -2 2'))).toEqual(['-2', '-1', '00', '01', '02']);
    expect(out(core.execLine('seq -f %5.1f 2'))).toEqual(['  1.0', '  2.0']);
    const zero = core.execLine('seq 1 0 3');
    expect(errs(zero)).toEqual(["seq: invalid Zero increment value: '0'"]);
    expect(errs(core.execLine('seq abc'))).toEqual(["seq: invalid floating point argument 'abc'"]);
    expect(errs(core.execLine('seq'))).toEqual(['seq: missing operand']);
    const badFormat = core.execLine('seq -f %d 2');
    expect(errs(badFormat)).toEqual(["seq: invalid format '%d'"]);
    const capped = core.execLine('seq 1 100001');
    expect(errs(capped)).toEqual(['seq: output limit reached (100000 lines); the sync shell would wedge on more']);
    expect(status(capped)).toBe(1);
  });

  it('yes: budgeted emission, custom strings, pipes still demo right', () => {
    const ys = out(core.execLine('yes'));
    expect(ys).toHaveLength(1000);
    expect(new Set(ys)).toEqual(new Set(['y']));
    expect(errs(core.execLine('yes'))[0]).toContain('emission budget reached');
    expect(status(core.execLine('yes'))).toBe(0); // explicit, despite the note
    expect(new Set(out(core.execLine('yes hello world')))).toEqual(new Set(['hello world']));
    expect(out(core.execLine('yes | head -n 3'))).toEqual(['y', 'y', 'y']);
  });
});

/* ------------------------------------------------------------------ */
/* expr                                                                */
/* ------------------------------------------------------------------ */

describe('expr', () => {
  it('arithmetic, precedence, truncation', () => {
    expect(out(core.execLine('expr 3 + 4'))).toEqual(['7']);
    expect(out(core.execLine("expr 1 + 2 '*' 3"))).toEqual(['7']);
    expect(out(core.execLine("expr '(' 1 + 2 ')' '*' 3"))).toEqual(['9']);
    expect(out(core.execLine('expr 7 / 2'))).toEqual(['3']);
    expect(out(core.execLine('expr -7 / 2'))).toEqual(['-3']);
    expect(out(core.execLine('expr 7 % 2'))).toEqual(['1']);
    expect(out(core.execLine('expr 1 - 5'))).toEqual(['-4']);
  });

  it('comparisons and boolean operators', () => {
    expect(out(core.execLine('expr 1 = 1'))).toEqual(['1']);
    expect(status(core.execLine('expr 1 = 2'))).toBe(1);
    expect(out(core.execLine('expr 2 != 3'))).toEqual(['1']);
    expect(out(core.execLine('expr 2 < 3'))).toEqual(['1']);
    expect(out(core.execLine('expr abc = abc'))).toEqual(['1']);
    expect(out(core.execLine("expr 3 '>' 1 '|' 0"))).toEqual(['1']);
    expect(status(core.execLine("expr 0 '&' 1"))).toBe(1);
  });

  it('BRE : matching with capture groups; string functions', () => {
    expect(out(core.execLine("expr abc : 'a\\(.\\)c'"))).toEqual(['b']);
    expect(status(core.execLine("expr abc : 'x'"))).toBe(1);
    expect(out(core.execLine("expr abc : 'a'"))).toEqual(['1']);
    expect(out(core.execLine('expr length hello'))).toEqual(['5']);
    expect(out(core.execLine('expr substr hello 2 3'))).toEqual(['ell']);
    expect(out(core.execLine('expr index hello l'))).toEqual(['3']);
    expect(out(core.execLine("expr match hello 'he'"))).toEqual(['2']);
    expect(out(core.execLine('expr substr 世界xx 1 2'))).toEqual(['世界']); // char-based, not byte-based
  });

  it('exit codes 0/1/2 and GNU error wording', () => {
    expect(out(core.execLine('expr 1 - 1'))).toEqual(['0']);
    expect(status(core.execLine('expr 1 - 1'))).toBe(1); // zero value exits 1
    const syntax = core.execLine('expr 5 +');
    expect(errs(syntax)).toEqual(['expr: syntax error']);
    expect(status(syntax)).toBe(2);
    expect(errs(core.execLine('expr'))).toEqual(['expr: syntax error']);
    expect(errs(core.execLine('expr a + 1'))).toEqual(['expr: non-integer argument']);
    expect(errs(core.execLine('expr 1 / 0'))).toEqual(['expr: division by zero']);
  });
});

/* ------------------------------------------------------------------ */
/* test                                                                */
/* ------------------------------------------------------------------ */

describe('test', () => {
  it('file conditions over the VFS', () => {
    expect(status(core.execLine('test -f a.txt'))).toBe(0);
    expect(status(core.execLine('test -d docs'))).toBe(0);
    expect(status(core.execLine('test -d a.txt'))).toBe(1);
    expect(status(core.execLine('test -e nope'))).toBe(1);
    expect(status(core.execLine('test -e a.txt'))).toBe(0);
    expect(status(core.execLine('test -s empty.txt'))).toBe(1);
    expect(status(core.execLine('test -s a.txt'))).toBe(0);
    expect(status(core.execLine('test -x docs'))).toBe(0);
    expect(status(core.execLine('test -x a.txt'))).toBe(1);
  });

  it('-w follows backend writability', () => {
    expect(status(core.execLine('test -w a.txt'))).toBe(0);
    core.vfs.attachBackend({
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
    });
    core.vfs.mountFile('/ro/f.txt', 'x\n');
    expect(status(core.execLine('test -w /ro/f.txt'))).toBe(1);
    expect(status(core.execLine('test -r /ro/f.txt'))).toBe(0);
  });

  it('strings, integers, connectives, parens', () => {
    expect(status(core.execLine('test abc = abc'))).toBe(0);
    expect(status(core.execLine('test abc != xyz'))).toBe(0);
    expect(status(core.execLine("test -z ''"))).toBe(0);
    expect(status(core.execLine('test -z abc'))).toBe(1);
    expect(status(core.execLine('test -n abc'))).toBe(0);
    expect(status(core.execLine('test 3 -lt 4'))).toBe(0);
    expect(status(core.execLine('test 4 -le 4'))).toBe(0);
    expect(status(core.execLine('test 5 -le 4'))).toBe(1);
    expect(status(core.execLine('test -1 -lt 1'))).toBe(0);
    expect(status(core.execLine('test ! -e nope'))).toBe(0);
    expect(status(core.execLine('test -f a.txt -a -d docs'))).toBe(0);
    expect(status(core.execLine('test -f nope -a -d docs'))).toBe(1);
    expect(status(core.execLine('test -f nope -o -d docs'))).toBe(0);
    expect(status(core.execLine("test '(' -f a.txt ')'"))).toBe(0);
  });

  it('bare test is false; errors exit 2; $? interplay', () => {
    expect(status(core.execLine('test'))).toBe(1);
    const missing = core.execLine('test 1 =');
    expect(errs(missing)).toEqual(['test: argument expected']);
    expect(status(missing)).toBe(2);
    expect(errs(core.execLine('test a -eq b'))).toEqual(['test: integer expression expected']);
    expect(errs(core.execLine('test 3 -foo 4'))).toEqual(['test: -foo: unary operator expected']);
    core.execLine('test -f a.txt');
    expect(out(core.execLine('echo $?'))).toEqual(['0']);
    core.execLine('test -f nope');
    expect(out(core.execLine('echo $?'))).toEqual(['1']);
  });
});

/* ------------------------------------------------------------------ */
/* pipes and redirects through the real dispatcher                     */
/* ------------------------------------------------------------------ */

describe('fs commands in pipelines', () => {
  it('seq feeds head; echo feeds file; tree redirects; unicode + CRLF survive', () => {
    expect(out(core.execLine('seq 1 5 | head -n 2'))).toEqual(['1', '2']);
    expect(out(core.execLine("echo héllo 𝔘𝔫𝔦 | file -"))).toEqual(['-: UTF-8 Unicode text']);
    core.execLine('tree docs > /tree-out.txt');
    expect(core.vfs.read('/tree-out.txt') ?? '').toContain('1 directory, 2 files'); // printed dir entries only (nested), like GNU
    core.vfs.mountFile('/crlf.txt', 'a\r\nb\r\n');
    expect(out(core.execLine('file -b crlf.txt'))).toEqual(['ASCII text, with CRLF line terminators']);
  });
});
