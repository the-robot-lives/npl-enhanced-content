// Unit spec — the `git` package body (packages round, LANE=pkg-git):
// src/terminal/packages/git/** — a pure-JS git object store over the Vfs.
//
// Feature: git — object store
//   Scenario: SHA-1 vectors (empty, abc, padding edges, multi-block, "hello\n")
//   Scenario: blobs, trees and commits land at objects/xx/yyy with real names
//   Scenario: the index is JSON and HEAD is a symref to refs/heads/main
// Feature: git — init
//   Scenario: init creates the skeleton and says so; re-init reinit-word
//   Scenario: init accepts a directory operand
// Feature: git — add/status
//   Scenario: outside a repo every command but init is fatal 128
//   Scenario: untracked files and collapsed untracked directories
//   Scenario: add stages files and directories; deletions stage too
//   Scenario: status sections and --short porcelain rows
//   Scenario: unknown pathspec is fatal 128
// Feature: git — commit
//   Scenario: identity unknown exits 128 with git's advice
//   Scenario: root commit output, then parent linkage (HEAD~1)
//   Scenario: nothing to commit exits 1; -a stages; --amend keeps parent
// Feature: git — log
//   Scenario: no commits is fatal; --oneline, -n and default shapes
// Feature: git — diff
//   Scenario: worktree vs index hunks; untracked files never appear
//   Scenario: --cached before/after staging; --exit-code
//   Scenario: git diff HEAD shows staged new files against /dev/null
//   Scenario: deletions diff, CRLF and unicode content survive, missing
//             final newline emits git's backslash marker
// Feature: git — branch
//   Scenario: list/create, duplicate is fatal 128, -d merged deletes
//   Scenario: -d refuses unmerged and the current branch
// Feature: git — checkout/switch
//   Scenario: checkout -b creates and switches; switch returns and restores
//   Scenario: dirty overwrite is refused with git's error block
//   Scenario: checkout -- file restores the staged content
// Feature: git — show/rev-parse
//   Scenario: show prints author, date, message and the root diff
//   Scenario: rev-parse HEAD/branch/prefix/HEAD~1; unknown is 128
// Feature: git — edges
//   Scenario: network subcommands explain themselves; unknown subcommand
//   Scenario: --version, bare git, --help; unicode + CRLF repo paths

import { describe, expect, it } from 'vitest';
import { Vfs } from '../../src/terminal/vfs.js';
import type { CommandContext } from '../../src/terminal/terminal-core.js';
import { commands, manPages } from '../../src/terminal/packages/git/index.js';
import { gitPackage, gitStub } from '../../src/terminal/packages/git/stub.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import { sha1Text } from '../../src/terminal/packages/git/sha1.js';
import { blobSha, configWrite, GitRepo } from '../../src/terminal/packages/git/repo.js';

const git = commands[0]!;

interface Result {
  outs: string[];
  errs: string[];
  code: number;
}

function makeShell(): {
  vfs: Vfs;
  run: (args: string[], cwd?: string, stdin?: string | null) => Result;
} {
  const vfs = new Vfs();
  const run = (args: string[], cwd = '/', stdin: string | null = null): Result => {
    const outs: string[] = [];
    const errs: string[] = [];
    let code: number | null = null;
    git.run({
      args,
      stdin,
      vfs,
      state: { cwd, env: { HOME: '/home' }, aliases: {}, history: [], oldpwd: null, lastStatus: 0 },
      color: false,
      commands: new Map(),
      out: (t: string) => outs.push(t),
      err: (t: string) => errs.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as unknown as CommandContext);
    return { outs, errs, code: code ?? (errs.length > 0 ? 1 : 0) };
  };
  return { vfs, run };
}

/** A repo with an identity configured, for commit flows. */
function makeRepo() {
  const shell = makeShell();
  shell.run(['init']);
  shell.run(['config', 'user.name', 'Ada Lovelace']);
  shell.run(['config', 'user.email', 'ada@example.com']);
  return shell;
}

/** Stage + commit the current worktree in one step. */
function commitAll(shell: ReturnType<typeof makeRepo>, message: string): Result {
  shell.run(['add', '-A']);
  return shell.run(['commit', '-m', message]);
}

describe('git — object store', () => {
  it('hashes SHA-1 vectors', () => {
    expect(sha1Text('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Text('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Text('hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    expect(sha1Text('test')).toBe('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3');
    expect(sha1Text('The quick brown fox jumps over the lazy dog')).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
    // the 56-byte NIST vector crosses the 55-byte padding boundary
    expect(sha1Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
    expect(sha1Text('hello\n')).toBe('f572d396fae9206628714fb2ce00f72e94f2258f');
    // blob names include the object header — git's own `hash-object` value
    expect(blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('stores objects at objects/xx/yyyy... with git blob names', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/hello.txt', 'hello\n');
    shell.run(['add', 'hello.txt']);
    const sha = blobSha('hello\n');
    expect(shell.vfs.read(`/.git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`)).not.toBeNull();
    const repo = GitRepo.discover(shell.vfs, '/')!;
    expect(repo.objectText(sha)).toBe('hello\n');
  });

  it('keeps HEAD a symref and the index JSON', () => {
    const shell = makeRepo();
    expect(shell.vfs.read('/.git/HEAD')).toBe('ref: refs/heads/main\n');
    shell.vfs.mountFile('/f', 'x\n');
    shell.run(['add', 'f']);
    const index = JSON.parse(shell.vfs.read('/.git/index')!) as { entries: Record<string, unknown> };
    expect(Object.keys(index.entries)).toEqual(['f']);
    expect(index.entries['f']).toMatchObject({ sha: blobSha('x\n') });
  });
});

describe('git — init', () => {
  it('creates the skeleton and reports it; re-init uses the reinit word', () => {
    const shell = makeShell();
    const first = shell.run(['init']);
    expect(first.outs[0]).toBe('Initialized empty Git repository in /.git/');
    expect(first.code).toBe(0);
    expect(shell.vfs.nodeAt('/.git/objects')).not.toBeNull();
    expect(shell.vfs.nodeAt('/.git/refs/heads')).not.toBeNull();
    expect(shell.vfs.read('/.git/config')).toContain('[core]');
    const again = shell.run(['init']);
    expect(again.outs[0]).toBe('Reinitialized existing Git repository in /.git/');
  });

  it('accepts a directory operand and inits inside it', () => {
    const shell = makeShell();
    shell.vfs.mkdir('/proj');
    const result = shell.run(['init', 'proj']);
    expect(result.outs[0]).toBe('Initialized empty Git repository in /proj/.git/');
    expect(shell.vfs.read('/proj/.git/HEAD')).toBe('ref: refs/heads/main\n');
  });
});

describe('git — add/status', () => {
  it('is fatal outside a repository', () => {
    const shell = makeShell();
    const result = shell.run(['status']);
    expect(result.errs[0]).toBe('fatal: not a git repository (or any of the parent directories): .git');
    expect(result.code).toBe(128);
  });

  it('shows untracked files and collapses fully-untracked directories', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/a.txt', 'a\n');
    shell.vfs.mountFile('/sub/x.txt', 'x\n');
    shell.vfs.mountFile('/sub/y.txt', 'y\n');
    const result = shell.run(['status']);
    expect(result.outs).toContain('Untracked files:');
    expect(result.outs).toContain('\tsub/');
    expect(result.outs).toContain('\ta.txt');
    expect(result.outs).toContain('nothing added to commit but untracked files present (use "git add" to track)');
  });

  it('stages files and directories; deletions stage too', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/a.txt', 'a\n');
    shell.vfs.mountFile('/sub/b.txt', 'b\n');
    shell.run(['add', 'a.txt']);
    let status = shell.run(['status', '--short']);
    expect(status.outs).toEqual(['A  a.txt', '?? sub/']);
    shell.run(['add', 'sub']);
    status = shell.run(['status', '--short']);
    expect(status.outs).toEqual(['A  a.txt', 'A  sub/b.txt']);
    commitAll(shell, 'baseline'); // deletions only display once HEAD knows the file
    shell.vfs.rm('/a.txt');
    shell.run(['add', 'a.txt']); // stages the removal (git 2.x behaviour)
    status = shell.run(['status', '--short']);
    expect(status.outs).toEqual(['D  a.txt']);
  });

  it('prints the full status sections through a commit cycle', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'one\n');
    shell.run(['add', 'f']);
    const staged = shell.run(['status']);
    expect(staged.outs).toContain('Changes to be committed:');
    expect(staged.outs).toContain('\tnew file:   f');
    commitAll(shell, 'first');
    shell.vfs.mountFile('/f', 'one\ntwo\n');
    const modified = shell.run(['status']);
    expect(modified.outs).toContain('Changes not staged for commit:');
    expect(modified.outs).toContain('\tmodified:   f');
    shell.run(['add', 'f']);
    const stagedMod = shell.run(['status']);
    expect(stagedMod.outs).toContain('Changes to be committed:');
    expect(stagedMod.outs).toContain('\tmodified:   f');
    commitAll(shell, 'second');
    const clean = shell.run(['status']);
    expect(clean.outs).toContain('nothing to commit, working tree clean');
  });

  it('rejects unknown pathspecs with git wording', () => {
    const shell = makeRepo();
    const result = shell.run(['add', 'nope.txt']);
    expect(result.errs[0]).toBe("fatal: pathspec 'nope.txt' did not match any files");
    expect(result.code).toBe(128);
  });
});

describe('git — commit', () => {
  it('demands an identity before committing', () => {
    const shell = makeShell();
    shell.run(['init']);
    shell.vfs.mountFile('/f', 'x\n');
    shell.run(['add', 'f']);
    const result = shell.run(['commit', '-m', 'no identity']);
    expect(result.code).toBe(128);
    expect(result.errs).toContain('*** Please tell me who you are.');
    expect(result.errs.some((line) => line.includes('unable to auto-detect email address'))).toBe(true);
  });

  it('requires -m (no editor in the shell)', () => {
    const shell = makeRepo();
    const result = shell.run(['commit']);
    expect(result.code).toBe(128);
    expect(result.errs[0]).toContain('-m');
  });

  it('records the root commit with git output and parent linkage after', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'one\n');
    const root = commitAll(shell, 'first commit');
    expect(root.outs[0]).toMatch(/^\[main \(root-commit\) [0-9a-f]{7}\] first commit$/);
    expect(root.outs).toContain(' 1 file changed, 1 insertion(+)');
    expect(root.outs).toContain(' create mode 100644 f');
    shell.vfs.mountFile('/f', 'one\ntwo\n');
    const second = commitAll(shell, 'second commit');
    expect(second.outs[0]).toMatch(/^\[main [0-9a-f]{7}\] second commit$/);
    const head = shell.run(['rev-parse', 'HEAD']).outs[0]!;
    const parent = shell.run(['rev-parse', 'HEAD~1']).outs[0]!;
    expect(parent).not.toBe(head);
    expect(parent).toMatch(/^[0-9a-f]{40}$/);
  });

  it('exits 1 when there is nothing to commit; -a stages; --amend keeps parent', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'one\n');
    commitAll(shell, 'first');
    const nothing = shell.run(['commit', '-m', 'empty']);
    expect(nothing.outs).toContain('nothing to commit, working tree clean');
    expect(nothing.code).toBe(1);
    shell.vfs.mountFile('/f', 'one\ntwo\n');
    const withA = shell.run(['commit', '-am', 'staged via -a']);
    expect(withA.code).toBe(0);
    const before = shell.run(['rev-parse', 'HEAD~1']).outs[0];
    const amend = shell.run(['commit', '--amend', '-m', 'rewritten']);
    expect(amend.outs[0]).toContain('rewritten');
    expect(shell.run(['rev-parse', 'HEAD~1']).outs[0]).toBe(before);
  });
});

describe('git — log', () => {
  it('is fatal with no commits; lists history oneline and limited', () => {
    const shell = makeRepo();
    const empty = shell.run(['log']);
    expect(empty.code).toBe(128);
    expect(empty.errs[0]).toContain('does not have any commits yet');
    shell.vfs.mountFile('/f', '1\n');
    commitAll(shell, 'one');
    shell.vfs.mountFile('/f', '1\n2\n');
    commitAll(shell, 'two');
    const oneline = shell.run(['log', '--oneline']);
    expect(oneline.outs).toHaveLength(2);
    expect(oneline.outs[0]).toMatch(/^[0-9a-f]{7} two$/);
    expect(oneline.outs[1]).toMatch(/^[0-9a-f]{7} one$/);
    expect(shell.run(['log', '--oneline', '-n', '1']).outs).toHaveLength(1);
    const full = shell.run(['log']);
    expect(full.outs.some((line) => line.startsWith('commit '))).toBe(true);
    expect(full.outs).toContain('Author: Ada Lovelace <ada@example.com>');
    expect(full.outs).toContain('    two');
  });
});

describe('git — diff', () => {
  it('diffs worktree against the index and hides untracked files', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'one\ntwo\nthree\n');
    commitAll(shell, 'first');
    shell.vfs.mountFile('/f', 'one\ntwo\nTHREE\n');
    shell.vfs.mountFile('/untracked', 'u\n');
    const result = shell.run(['diff']);
    expect(result.outs).toContain('diff --git a/f b/f');
    expect(result.outs).toContain('@@ -1,3 +1,3 @@');
    expect(result.outs).toContain('-three');
    expect(result.outs).toContain('+THREE');
    expect(result.outs.some((row) => row.includes('untracked'))).toBe(false);
    expect(result.code).toBe(0);
    expect(shell.run(['diff', '--exit-code']).code).toBe(1);
    expect(shell.run(['diff', '--stat']).outs).toContain(' f |   2 +-');
  });

  it('shows nothing before staging with --cached, everything after', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'one\n');
    commitAll(shell, 'first');
    shell.vfs.mountFile('/f', 'one\nTWO\n');
    expect(shell.run(['diff', '--cached']).outs).toEqual([]);
    shell.run(['add', 'f']);
    const cached = shell.run(['diff', '--cached']);
    expect(cached.outs).toContain('+TWO');
    expect(shell.run(['diff']).outs).toEqual([]); // worktree now matches index
  });

  it('shows staged new files against /dev/null via git diff HEAD', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/base', 'base\n');
    commitAll(shell, 'first'); // HEAD exists now
    shell.vfs.mountFile('/new.txt', 'fresh\nlines\n');
    shell.run(['add', 'new.txt']);
    const result = shell.run(['diff', 'HEAD']);
    expect(result.outs).toContain('diff --git a/new.txt b/new.txt');
    expect(result.outs).toContain('new file mode 100644');
    expect(result.outs).toContain('--- /dev/null');
    expect(result.outs).toContain('+++ b/new.txt');
    expect(result.outs).toContain('+fresh');
  });

  it('diffs deletions against /dev/null on the other side', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/gone', 'bye\n');
    commitAll(shell, 'first');
    shell.vfs.rm('/gone');
    shell.run(['add', 'gone']);
    const result = shell.run(['diff', '--cached', 'HEAD']);
    expect(result.outs).toContain('deleted file mode 100644');
    expect(result.outs).toContain('+++ /dev/null');
    expect(result.outs).toContain('-bye');
  });

  it('keeps CRLF rows, unicode and the no-final-newline marker intact', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/crlf', 'ünïcode\r\nlines\r\n');
    commitAll(shell, 'crlf base');
    shell.vfs.mountFile('/crlf', 'ünïcode\r\nchanged\r\n');
    const crlf = shell.run(['diff']);
    expect(crlf.outs).toContain('-lines\r');
    expect(crlf.outs).toContain('+changed\r');
    const shell2 = makeRepo();
    shell2.vfs.mountFile('/nonl', 'no trailing newline');
    commitAll(shell2, 'base');
    shell2.vfs.mountFile('/nonl', 'no trailing newline!\n');
    const marked = shell2.run(['diff']);
    expect(marked.outs).toContain('-no trailing newline');
    expect(marked.outs).toContain('\\ No newline at end of file');
    expect(marked.outs).toContain('+no trailing newline!');
  });
});

describe('git — branch', () => {
  it('lists, creates, refuses duplicates', () => {
    const shell = makeRepo();
    expect(shell.run(['branch']).outs).toEqual([]);
    shell.vfs.mountFile('/f', 'x\n');
    commitAll(shell, 'first');
    expect(shell.run(['branch']).outs).toEqual(['* main']);
    shell.run(['branch', 'topic']);
    // sorted listing, star marks the current branch
    expect(shell.run(['branch']).outs).toEqual(['* main', '  topic']);
    const dup = shell.run(['branch', 'topic']);
    expect(dup.errs[0]).toBe("fatal: a branch named 'topic' already exists");
    expect(dup.code).toBe(128);
    const bad = shell.run(['branch', 'bad..name']);
    expect(bad.code).toBe(128);
  });

  it('-d deletes merged branches and refuses unmerged or current ones', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'x\n');
    commitAll(shell, 'first');
    shell.run(['branch', 'merged-into-main']);
    const del = shell.run(['branch', '-d', 'merged-into-main']);
    expect(del.outs[0]).toMatch(/^Deleted branch merged-into-main \(was [0-9a-f]{7}\)\.$/);
    shell.run(['branch', 'ahead']);
    shell.run(['checkout', '-q', 'ahead']);
    shell.vfs.mountFile('/ahead-only', 'a\n');
    commitAll(shell, 'ahead work');
    shell.run(['checkout', '-q', 'main']);
    const unmerged = shell.run(['branch', '-d', 'ahead']);
    expect(unmerged.code).toBe(1);
    expect(unmerged.errs[0]).toContain('not fully merged');
    const current = shell.run(['branch', '-d', 'main']);
    expect(current.code).toBe(1);
    expect(current.errs[0]).toContain('cannot delete branch');
  });
});

describe('git — checkout/switch', () => {
  it('checkout -b creates and switches; switch goes back and restores content', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'main version\n');
    commitAll(shell, 'main base');
    const create = shell.run(['checkout', '-b', 'feature']);
    expect(create.outs).toEqual(["Switched to a new branch 'feature'"]);
    expect(shell.run(['status']).outs[0]).toBe('On branch feature');
    shell.vfs.mountFile('/f', 'feature version\n');
    shell.vfs.mountFile('/feature-only', 'new\n');
    commitAll(shell, 'feature work');
    const back = shell.run(['switch', 'main']);
    expect(back.outs).toEqual(["Switched to branch 'main'"]);
    expect(shell.vfs.read('/f')).toBe('main version\n');
    expect(shell.vfs.read('/feature-only')).toBeNull();
    const again = shell.run(['checkout', 'feature']);
    expect(again.outs).toEqual(["Switched to branch 'feature'"]);
    expect(shell.vfs.read('/f')).toBe('feature version\n');
    expect(shell.vfs.read('/feature-only')).toBe('new\n');
    const switchCreate = shell.run(['switch', '-c', 'from-switch']);
    expect(switchCreate.outs).toEqual(["Switched to a new branch 'from-switch'"]);
  });

  it('refuses to overwrite dirty files with git error block', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'main\n');
    commitAll(shell, 'base');
    // make the other branch's tree actually differ on f (same-commit
    // switches are legal with a dirty tree — git carries changes over)
    shell.run(['checkout', '-q', '-b', 'other']);
    shell.vfs.mountFile('/f', 'other\n');
    commitAll(shell, 'other base');
    shell.run(['checkout', '-q', 'main']);
    shell.vfs.mountFile('/f', 'main changed\n');
    const result = shell.run(['checkout', 'other']);
    expect(result.code).toBe(1);
    expect(result.errs).toContain('error: Your local changes to the following files would be overwritten by checkout:');
    expect(result.errs).toContain('\tf');
    expect(result.errs).toContain('Please commit your changes or stash them before you switch branches.');
    expect(result.errs).toContain('Aborting');
    expect(shell.run(['status']).outs[0]).toBe('On branch main');
  });

  it('checkout -- file restores the staged content', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'committed\n');
    commitAll(shell, 'base');
    shell.vfs.mountFile('/f', 'scrapped\n');
    const restore = shell.run(['checkout', '--', 'f']);
    expect(restore.code).toBe(0);
    expect(shell.vfs.read('/f')).toBe('committed\n');
    const missing = shell.run(['checkout', '--', 'absent']);
    expect(missing.errs[0]).toContain('did not match any file(s) known to git');
  });
});

describe('git — show/rev-parse', () => {
  it('show prints the commit header, message and root diff', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', 'alpha\nbeta\n');
    commitAll(shell, 'root cause');
    const result = shell.run(['show']);
    expect(result.outs.some((line) => line.startsWith('commit '))).toBe(true);
    expect(result.outs).toContain('Author: Ada Lovelace <ada@example.com>');
    expect(result.outs.some((line) => line.startsWith('Date:   '))).toBe(true);
    expect(result.outs).toContain('    root cause');
    expect(result.outs).toContain('new file mode 100644');
    expect(result.outs).toContain('+alpha');
    const unknown = shell.run(['show', 'nope']);
    expect(unknown.code).toBe(128);
    expect(unknown.errs[0]).toContain('unknown revision or path not in the working tree');
  });

  it('rev-parse resolves HEAD, branches, prefixes and HEAD~n', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/f', '1\n');
    commitAll(shell, 'one');
    shell.vfs.mountFile('/f', '1\n2\n');
    commitAll(shell, 'two');
    const head = shell.run(['rev-parse', 'HEAD']).outs[0]!;
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(shell.run(['rev-parse', 'main']).outs[0]).toBe(head);
    expect(shell.run(['rev-parse', '--short', 'HEAD']).outs[0]).toBe(head.slice(0, 7));
    expect(shell.run(['rev-parse', head.slice(0, 8)]).outs[0]).toBe(head);
    const first = shell.run(['rev-parse', 'HEAD~1']).outs[0]!;
    expect(first).not.toBe(head);
    const bad = shell.run(['rev-parse', 'zzzzzz']);
    expect(bad.code).toBe(128);
    expect(bad.errs[0]).toContain('zzzzzz');
  });
});

describe('git — edges', () => {
  it('network subcommands explain the VFS limitation and exit 1', () => {
    const shell = makeRepo();
    for (const sub of ['clone', 'push', 'pull', 'fetch']) {
      const result = shell.run([sub, 'https://example.com/repo.git']);
      expect(result.code).toBe(1);
      expect(result.errs[0]).toContain(`'${sub}' is not supported in semtext-sh`);
      expect(result.errs[0]).toContain('CORS');
    }
  });

  it('unknown subcommands name themselves; bare git prints the command list', () => {
    const shell = makeShell();
    const unknown = shell.run(['frobnicate']);
    expect(unknown.errs[0]).toBe("git: 'frobnicate' is not a git command. See 'git --help'.");
    expect(unknown.code).toBe(1);
    const bare = shell.run([]);
    expect(bare.code).toBe(1);
    expect(bare.outs).toContain('   status       show working-tree and index state');
    const help = shell.run(['--help']);
    expect(help.code).toBe(0);
    expect(shell.run(['--version']).outs[0]).toMatch(/^git version /);
  });

  it('handles unicode content and deep paths through a full cycle', () => {
    const shell = makeRepo();
    shell.vfs.mountFile('/深/文件.txt', '内容 — 𝔘𝔫𝔦𝔠𝔬𝔡𝔢\n');
    shell.run(['add', '-A']);
    const commit = shell.run(['commit', '-m', 'unicode テスト']);
    expect(commit.code).toBe(0);
    expect(commit.outs).toContain(' create mode 100644 深/文件.txt');
    expect(shell.run(['status']).outs).toContain('nothing to commit, working tree clean');
    const logged = shell.run(['log', '--oneline']);
    expect(logged.outs[0]).toContain('unicode テスト');
  });

  it('manPages covers the command; the stub is registration-only', () => {
    expect(manPages.git?.length).toBeGreaterThan(10);
    expect(gitStub.commands.map((c) => c.name)).toEqual(['git']);
    expect(gitPackage.commands).toHaveLength(1);
  });

  it('lazy: help answers from the stub even when the chunk never loads', () => {
    const never = createLazyPackage(gitStub, () => new Promise<never>((_, reject) => reject(new Error('offline'))));
    const outs: string[] = [];
    const errs: string[] = [];
    let code: number | null = null;
    never.commands[0]!.run({
      args: ['--help'],
      stdin: null,
      vfs: new Vfs(),
      state: { cwd: '/', env: {}, aliases: {}, history: [], oldpwd: null, lastStatus: 0 },
      color: false,
      commands: new Map(),
      out: (t: string) => outs.push(t),
      err: (t: string) => errs.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as unknown as CommandContext);
    expect(outs[0]).toBe(gitStub.commands[0]!.usage);
    expect(errs).toEqual([]);
    // the stub help path reports, it does not set an exit status (lazy.ts)
    expect(code).toBeNull();
  });

  it('lazy: once the chunk is injected, invocations route to the real command', async () => {
    const loaded = createLazyPackage(gitStub, async () => await import('../../src/terminal/packages/git/index.js'));
    await loaded.ensure();
    const vfs = new Vfs();
    const errs: string[] = [];
    let code: number | null = null;
    loaded.commands[0]!.run({
      args: ['init'],
      stdin: null,
      vfs,
      state: { cwd: '/', env: {}, aliases: {}, history: [], oldpwd: null, lastStatus: 0 },
      color: false,
      commands: new Map(),
      out: () => {},
      err: (t: string) => errs.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as unknown as CommandContext);
    expect(vfs.read('/.git/HEAD')).toBe('ref: refs/heads/main\n');
    expect(errs).toEqual([]);
    expect(code).toBe(0);
  });
});

// configWrite INI helper: set-then-replace within a section
describe('git — config INI', () => {
  it('writes, replaces and creates sections', () => {
    const base = configWrite('[core]\n\tbare = false\n', 'user.name', 'Ada');
    expect(base).toContain('[user]');
    expect(base).toContain('name = Ada');
    const replaced = configWrite(base, 'user.name', 'Grace');
    expect(replaced).toContain('name = Grace');
    expect(replaced.match(/name = /g)).toHaveLength(1);
    const fresh = configWrite('', 'user.email', 'a@b.c');
    expect(fresh).toContain('[user]');
  });
});
