/**
 * packages/git — the git command over the VFS (packages round,
 * LANE=pkg-git).
 *
 * This module is the package CHUNK: dynamic-imported by ./stub.ts, never
 * part of the base shell bundle. One `git` command with real subcommands,
 * backed by the pure-JS object store in ./repo.ts (isomorphic-git is not
 * in node_modules and the rules forbid npm install, so the store is
 * hand-rolled — see repo.ts for the exact dialect and its documented
 * deviations from on-disk git).
 *
 * Reference behaviour is git itself: messages (`fatal: not a git
 * repository…`, `Switched to branch 'x'`, `error: Your local changes…`),
 * exit codes (0 ok, 1 clean-but-nothing / conflicts, 128 fatal, 127-
 * shaped "not a git command" → git actually exits 1 there, we match git)
 * and output shapes (status sections, log entries, unified diff headers)
 * follow the real tool. Knowingly simpler, each noted in `man git`:
 * no zlib on objects, JSON index, no .gitignore, no network transport,
 * branches only (no tags), default branch `main`.
 *
 * Diff engine: local Myers diff (./gitdiff.ts) — the brief's fallback
 * while LANE=pkg-diff is in flight; a later pass can delegate `git diff`
 * to that package without changing any behaviour surface here.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import type { PackageModule } from '../types.js';
import type { Vfs } from '../../vfs.js';
import {
  blobSha,
  commitPayload,
  formatGitDate,
  GitRepo,
  localOffsetMinutes,
  parseCommit,
  utf8Bytes,
  type IndexEntry,
  type StatusChange,
} from './repo.js';
import { countChanges, diffLines, splitLines } from './gitdiff.js';
import { gitStub } from './stub.js';

/* ------------------------------------------------------------------ *
 * constants + small helpers
 * ------------------------------------------------------------------ */

const usageOf = (name: string): string => gitStub.commands.find((c) => c.name === name)!.usage;

const VERSION = 'git version 2.43.0.semtext';

const SUBCOMMANDS: ReadonlyArray<[string, string]> = [
  ['init', 'create an empty repository'],
  ['add', 'stage file contents for the next commit'],
  ['status', 'show working-tree and index state'],
  ['commit', 'record staged changes'],
  ['log', 'show commit history'],
  ['diff', 'show changes between commits, index and worktree'],
  ['branch', 'list, create or delete branches'],
  ['checkout', 'switch branches or restore worktree files'],
  ['switch', 'switch branches (checkout, branch-only)'],
  ['show', 'show one commit with its diff'],
  ['config', 'get or set repository or global options'],
  ['rev-parse', 'resolve a revision to a commit sha'],
];

const NETWORK_SUBCOMMANDS = new Set(['clone', 'push', 'pull', 'fetch', 'remote', 'submodule']);

function fail(ctx: CommandContext, message: string, code = 128): void {
  ctx.err(message);
  ctx.exit(code);
}

function needRepo(ctx: CommandContext): GitRepo | null {
  const repo = GitRepo.discover(ctx.vfs, ctx.state.cwd);
  if (repo === null) {
    fail(ctx, 'fatal: not a git repository (or any of the parent directories): .git');
    return null;
  }
  return repo;
}

/** Resolve an absolute VFS path under (or at) the repo root; null outside. */
function repoPath(repo: GitRepo, cwd: string, input: string): string | null {
  const abs = repo.vfs.resolve(cwd, input);
  if (!abs.startsWith(repo.root === '/' ? '/' : repo.root + '/') && abs !== repo.root) return null;
  return abs;
}

/** Repo-relative path of an absolute VFS path ('' for the root). */
function relOf(repo: GitRepo, abs: string): string {
  return repo.relOf(abs);
}

function validBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('-') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('@{') &&
    !name.includes(' ') &&
    !/[\x00-\x1f\x7f~^:?*[\\]/.test(name)
  );
}

/* ------------------------------------------------------------------ *
 * diff plumbing shared by diff / show / commit summaries
 * ------------------------------------------------------------------ */

type Side = { sha: string | null; text: string | null };

interface FileChange {
  path: string;
  old: Side;
  neu: Side;
}

/** Union of two path→sha maps into FileChange pairs (null = absent side). */
function treeChanges(
  oldMap: Map<string, string>,
  newMap: Map<string, string>,
  textOf: (sha: string) => string | null,
): FileChange[] {
  const out: FileChange[] = [];
  const paths = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
  for (const path of [...paths].sort()) {
    const oldSha = oldMap.get(path) ?? null;
    const newSha = newMap.get(path) ?? null;
    if (oldSha === newSha) continue;
    out.push({
      path,
      old: { sha: oldSha, text: oldSha === null ? null : textOf(oldSha) },
      neu: { sha: newSha, text: newSha === null ? null : textOf(newSha) },
    });
  }
  return out;
}

/** `path | N +-` rows + trailing summary, git's --stat shape. */
function diffstat(changes: FileChange[]): string[] {
  const rows: string[] = [];
  let adds = 0;
  let dels = 0;
  let width = 0;
  const parts: Array<{ label: string; count: number; a: number; d: number }> = [];
  for (const change of changes) {
    const ops = diffLines(splitLines(change.old.text ?? '').lines, splitLines(change.neu.text ?? '').lines);
    const counts = countChanges(ops);
    adds += counts.adds;
    dels += counts.dels;
    width = Math.max(width, change.path.length);
    parts.push({ label: change.path, count: counts.adds + counts.dels, a: counts.adds, d: counts.dels });
  }
  for (const part of parts) {
    const graphWidth = Math.min(part.count, 40);
    const plus = part.count === 0 ? 0 : Math.round((part.a / part.count) * graphWidth);
    const minus = graphWidth - plus;
    rows.push(
      ` ${part.label.padEnd(width)} | ${String(part.count).padStart(3)} ${'+'.repeat(plus)}${'-'.repeat(minus)}`,
    );
  }
  const files = parts.length;
  const pieces: string[] = [`${files} file${files === 1 ? '' : 's'} changed`];
  if (adds > 0) pieces.push(`${adds} insertion${adds === 1 ? '' : 's'}(+)`);
  if (dels > 0) pieces.push(`${dels} deletion${dels === 1 ? '' : 's'}(-)`);
  if (files > 0) rows.push(' ' + pieces.join(', '));
  return rows;
}

/* ------------------------------------------------------------------ *
 * subcommands
 * ------------------------------------------------------------------ */

function cmdInit(ctx: CommandContext, args: string[]): void {
  let quiet = false;
  const operands: string[] = [];
  for (const arg of args) {
    if (arg === '-q' || arg === '--quiet') quiet = true;
    else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  const dir = operands.length > 1 ? null : (operands[0] ?? '');
  if (dir === null) {
    fail(ctx, 'usage: git init [<directory>]');
    return;
  }
  const root = ctx.vfs.resolve(ctx.state.cwd, dir);
  const existed = ctx.vfs.nodeAt((root === '/' ? '' : root) + '/.git') !== null;
  GitRepo.create(ctx.vfs, root);
  if (!quiet) {
    const verb = existed ? 'Reinitialized existing' : 'Initialized empty';
    ctx.out(`${verb} Git repository in ${root === '/' ? '' : root}/.git/`);
  }
  ctx.exit(0);
}

function cmdAdd(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let all = false;
  let updateOnly = false;
  const operands: string[] = [];
  for (const arg of args) {
    if (arg === '-A' || arg === '--all' || arg === '.') all = true;
    else if (arg === '-u' || arg === '--update') updateOnly = true;
    else if (arg === '-v' || arg === '--verbose' || arg === '-f' || arg === '--force') {
      // accepted no-ops (no ignore rules, no dry-run semantics here)
    } else if (arg === '--') continue;
    else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  const specs = all || operands.length === 0 ? [''] : operands;
  const index = repo.readIndex();
  const work = repo.worktree();
  let matched = false;
  for (const spec of specs) {
    const abs = repoPath(repo, ctx.state.cwd, spec);
    if (abs === null) {
      fail(ctx, `fatal: ${spec}: '${spec}' is outside repository at '${repo.root}'`);
      return;
    }
    const rel = relOf(repo, abs);
    const node = repo.vfs.nodeAt(abs);
    if (node !== null && node.kind === 'dir') {
      matched = true;
      stageDir(repo, rel, index, work, updateOnly);
    } else if (node !== null && node.kind === 'file') {
      matched = true;
      stageFile(repo, index, rel, node.content);
    } else if (index.has(rel) || rel === '') {
      // a deleted tracked file: `git add` stages the removal (git 2.x)
      if (rel !== '') {
        matched = true;
        index.delete(rel);
      }
    } else if (updateOnly && !index.has(rel)) {
      // -u silently ignores untracked paths
    } else {
      fail(ctx, `fatal: pathspec '${spec}' did not match any files`);
      return;
    }
  }
  if (!matched && !all && !updateOnly) {
    fail(ctx, "fatal: nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?");
    return;
  }
  repo.writeIndex(index);
  ctx.exit(0);
}

function stageDir(
  repo: GitRepo,
  rel: string,
  index: Map<string, IndexEntry>,
  work: Map<string, string>,
  updateOnly: boolean,
): void {
  // stage every file under `rel`; also drop tracked files under it that
  // vanished from the worktree
  const prefix = rel === '' ? '' : rel + '/';
  if (updateOnly) {
    for (const path of [...index.keys()]) {
      if (!path.startsWith(prefix)) continue;
      const content = work.get(path);
      if (content === undefined) index.delete(path);
      else stageFile(repo, index, path, content);
    }
    return;
  }
  for (const [path, content] of work) {
    if (path.startsWith(prefix)) stageFile(repo, index, path, content);
  }
  for (const path of [...index.keys()]) {
    if (path.startsWith(prefix) && !work.has(path)) index.delete(path);
  }
}

/** Stage one file: write the blob object (git writes blobs on add) + index it. */
function stageFile(repo: GitRepo, index: Map<string, IndexEntry>, rel: string, content: string): void {
  index.set(rel, { sha: repo.writeBlob(content), size: utf8Bytes(content).length });
}

const KIND_LABEL: Record<StatusChange['kind'], string> = {
  added: 'new file:   ',
  modified: 'modified:   ',
  deleted: 'deleted:    ',
};

/** Collapse untracked paths: show the topmost directory with no tracked file inside. */
function collapseUntracked(repo: GitRepo, untracked: string[]): string[] {
  const tracked = new Set<string>();
  for (const path of repo.readIndex().keys()) tracked.add(path);
  for (const path of repo.commitTree(repo.headSha()).keys()) tracked.add(path);
  const trackedUnder = (dir: string) => {
    const prefix = dir + '/';
    for (const path of tracked) if (path.startsWith(prefix)) return true;
    return false;
  };
  const out = new Set<string>();
  for (const path of untracked) {
    const parts = path.split('/');
    let display = path;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!trackedUnder(dir)) {
        display = dir + '/';
        break;
      }
    }
    out.add(display);
  }
  return [...out].sort();
}

function cmdStatus(ctx: CommandContext, args: string[], repo: GitRepo): void {
  const short = args.includes('--short') || args.includes('-s');
  const status = repo.status();
  const branch = repo.currentBranch();
  if (short) {
    const stagedKinds: Record<StatusChange['kind'], string> = { added: 'A', modified: 'M', deleted: 'D' };
    const unstagedKinds: Record<StatusChange['kind'], string> = { added: 'A', modified: 'M', deleted: 'D' };
    const seen = new Set<string>();
    for (const change of status.staged) {
      seen.add(change.path);
      const unstaged = status.unstaged.find((u) => u.path === change.path);
      const y = unstaged ? unstagedKinds[unstaged.kind] : ' ';
      ctx.out(`${stagedKinds[change.kind]}${y} ${change.path}`);
    }
    for (const change of status.unstaged) {
      if (seen.has(change.path)) continue;
      ctx.out(` ${unstagedKinds[change.kind]} ${change.path}`);
    }
    for (const path of collapseUntracked(repo, status.untracked)) ctx.out(`?? ${path}`);
    ctx.exit(0);
    return;
  }
  ctx.out(branch !== '' ? `On branch ${branch}` : 'HEAD detached');
  if (repo.headSha() === null) {
    ctx.out('');
    ctx.out('No commits yet');
  }
  if (status.staged.length > 0) {
    ctx.out('');
    ctx.out('Changes to be committed:');
    ctx.out('  (use "git restore --staged <file>..." to unstage)');
    for (const change of status.staged) ctx.out(`\t${KIND_LABEL[change.kind]}${change.path}`);
  }
  if (status.unstaged.length > 0) {
    ctx.out('');
    ctx.out('Changes not staged for commit:');
    ctx.out('  (use "git add <file>..." to update what will be committed)');
    ctx.out('  (use "git restore <file>..." to discard changes in working directory)');
    for (const change of status.unstaged) ctx.out(`\t${KIND_LABEL[change.kind]}${change.path}`);
  }
  if (status.untracked.length > 0) {
    ctx.out('');
    ctx.out('Untracked files:');
    ctx.out('  (use "git add <file>..." to include in what will be committed)');
    for (const path of collapseUntracked(repo, status.untracked)) ctx.out(`\t${path}`);
  }
  if (status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0) {
    ctx.out('');
    ctx.out('nothing to commit, working tree clean');
  } else if (status.staged.length === 0 && status.unstaged.length === 0) {
    ctx.out('');
    ctx.out('nothing added to commit but untracked files present (use "git add" to track)');
  }
  ctx.exit(0);
}

/** Commit identity from config, or git's "please tell me who you are" exit. */
function identity(repo: GitRepo): { name: string; email: string } | null {
  const name = repo.configGet('user.name');
  const email = repo.configGet('user.email');
  if (name === null || name === '' || email === null || email === '') return null;
  return { name, email };
}

function cmdCommit(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let message: string | null = null;
  let amend = false;
  let all = false;
  let allowEmpty = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if ((arg === '-m' || arg === '--message') && i + 1 < args.length) {
      message = args[++i]!;
    } else if (/^-[a-z]+$/i.test(arg) && arg.includes('m')) {
      // clustered short flags (-am, -ma, -qm…): 'm' keeps its attached value
      if (all === false) all = arg.slice(1).includes('a');
      const attached = arg.slice(arg.indexOf('m') + 1);
      if (attached.length > 0) message = attached;
      else if (i + 1 < args.length) message = args[++i];
    } else if (arg.startsWith('-m') && arg.length > 2) {
      message = arg.slice(2);
    } else if (arg === '--amend') {
      amend = true;
    } else if (arg === '-a' || arg === '--all') {
      all = true;
    } else if (arg === '--allow-empty') {
      allowEmpty = true;
    } else if (arg === '-q' || arg === '--quiet' || arg === '--no-verify' || arg === '--signoff') {
      // accepted no-ops
    } else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'\nhint: semtext git cannot open an editor — pass -m <message>`);
      return;
    }
  }
  if (message === null) {
    fail(ctx, 'fatal: no commit message given (semtext git has no editor; use -m <message>)');
    return;
  }
  const who = identity(repo);
  if (who === null) {
    ctx.err('Author identity unknown');
    ctx.err('');
    ctx.err('*** Please tell me who you are.');
    ctx.err('');
    ctx.err('Run');
    ctx.err('');
    ctx.err('  git config --global user.email "you@example.com"');
    ctx.err('  git config --global user.name "Your Name"');
    ctx.err('');
    ctx.err('to set your account\'s default identity.');
    ctx.err('Omit --global to set the identity only in this repository.');
    ctx.err('');
    ctx.err("fatal: unable to auto-detect email address (got 'you@semtext.(none)')");
    ctx.exit(128);
    return;
  }
  if (all) repo.stageAllTracked();
  const headSha = repo.headSha();
  const amendTarget = amend ? headSha : null;
  if (amend && headSha === null) {
    fail(ctx, 'fatal: --amend: no commit to amend (the branch has no history)');
    return;
  }
  const parent = amend
    ? (parseCommit(headSha!, repo.readObject(headSha!)!.payload).parents[0] ?? null)
    : headSha;
  const parentTree = repo.commitTree(parent);
  const index = repo.readIndex();
  const changes = treeChanges(parentTree, new Map([...index].map(([p, e]) => [p, e.sha])), (sha) =>
    repo.objectText(sha),
  );
  if (changes.length === 0 && !allowEmpty) {
    ctx.out(`On branch ${repo.currentBranch()}`);
    ctx.out('nothing to commit, working tree clean');
    ctx.exit(1);
    return;
  }
  const treeSha = repo.writeTreeFromIndex(index);
  const when = Math.floor(Date.now() / 1000);
  const offset = localOffsetMinutes();
  const commitSha = repo.writeObject(
    'commit',
    commitPayload({
      tree: treeSha,
      parents: parent === null ? [] : [parent],
      name: who.name,
      email: who.email,
      when,
      offset,
      message,
    }),
  );
  repo.writeRef(repo.currentBranch(), commitSha);
  const branch = repo.currentBranch();
  const root = parent === null ? ' (root-commit)' : '';
  ctx.out(`[${branch}${root} ${commitSha.slice(0, 7)}] ${message.split('\n')[0]}`);
  if (changes.length > 0) {
    for (const row of diffstat(changes)) ctx.out(row);
    for (const change of changes) {
      if (change.old.sha === null) ctx.out(` create mode 100644 ${change.path}`);
      if (change.neu.sha === null) ctx.out(` delete mode 100644 ${change.path}`);
    }
  }
  ctx.exit(0);
}

function cmdLog(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let oneline = false;
  let limit = Infinity;
  let rev: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--oneline') oneline = true;
    else if (arg === '-n' && i + 1 < args.length) limit = Number(args[++i]);
    else if (arg.startsWith('--max-count=')) limit = Number(arg.slice('--max-count='.length));
    else if (/^-\d+$/.test(arg)) limit = Number(arg.slice(1));
    else if (arg === '--graph' || arg === '--decorate' || arg === '--all' || arg === '--stat') {
      // accepted no-ops (single-branch history; decorations add noise)
    } else if (arg.startsWith('-')) {
      fail(ctx, `fatal: unrecognized argument: ${arg}`);
      return;
    } else if (rev === null) rev = arg;
    else {
      fail(ctx, `fatal: unrecognized argument: ${arg}`);
      return;
    }
  }
  const start = repo.revParse(rev ?? 'HEAD');
  if (start === null) {
    if (repo.headSha() === null) {
      fail(
        ctx,
        `fatal: your current branch '${repo.currentBranch() || 'HEAD'}' does not have any commits yet`,
      );
    } else {
      fail(ctx, `fatal: ambiguous argument '${rev ?? 'HEAD'}': unknown revision or path not in the working tree.`);
    }
    return;
  }
  let shown = 0;
  let sha: string | null = start;
  while (sha !== null && shown < limit) {
    const commit = parseCommit(sha, repo.readObject(sha)!.payload);
    if (oneline) {
      ctx.out(`${sha.slice(0, 7)} ${commit.message.split('\n')[0]}`);
    } else {
      ctx.out(`commit ${sha}`);
      ctx.out(
        `Author: ${commit.authorName} <${commit.authorEmail}>`,
      );
      ctx.out(`Date:   ${formatGitDate(commit.authorWhen, commit.authorOffset)}`);
      ctx.out('');
      for (const line of commit.message.replace(/\n$/, '').split('\n')) ctx.out(`    ${line}`);
      ctx.out('');
    }
    shown++;
    sha = commit.parents[0] ?? null;
  }
  ctx.exit(0);
}

/** Resolve which two snapshots `git diff` compares; null after reporting. */
function diffRanges(
  ctx: CommandContext,
  args: string[],
  repo: GitRepo,
): { changes: FileChange[]; textOf: (sha: string) => string | null } | null {
  let cached = false;
  let stat = false;
  let exitCode = false;
  const revs: string[] = [];
  for (const arg of args) {
    if (arg === '--cached' || arg === '--staged') cached = true;
    else if (arg === '--stat') stat = true;
    else if (arg === '--exit-code') exitCode = true;
    else if (arg === '-s' || arg === '--name-only' || arg === '--color' || arg === '--color=always') {
      // --color ignored (the renderer owns color); the rest are not implemented
      if (arg !== '--color' && arg !== '--color=always') {
        fail(ctx, `fatal: unrecognized argument: ${arg}`);
        return null;
      }
    } else if (arg.startsWith('-')) {
      fail(ctx, `fatal: unrecognized argument: ${arg}`);
      return null;
    } else revs.push(arg);
  }
  const textOf = (sha: string) => repo.objectText(sha);
  const indexMap = new Map([...repo.readIndex()].map(([p, e]) => [p, e.sha]));
  const headTree = repo.commitTree(repo.headSha());
  const workMap = repo.worktree();
  let oldMap: Map<string, string>;
  let newMap: Map<string, string>;
  let newTexts: Map<string, string> | null = null;
  if (revs.length >= 2) {
    const a = repo.revParse(revs[0]!);
    const b = repo.revParse(revs[1]!);
    if (a === null || b === null) {
      fail(ctx, `fatal: ambiguous argument '${a === null ? revs[0] : revs[1]}': unknown revision or path not in the working tree.`);
      return null;
    }
    oldMap = repo.commitTree(a);
    newMap = repo.commitTree(b);
  } else if (revs.length === 1) {
    const sha = repo.revParse(revs[0]!);
    if (sha === null) {
      fail(
        ctx,
        `fatal: ambiguous argument '${revs[0]}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`,
      );
      return null;
    }
    oldMap = repo.commitTree(sha);
    newMap = indexMap;
    newTexts = workMap; // unstaged edits still show against the commit
  } else if (cached) {
    oldMap = headTree;
    newMap = indexMap;
  } else {
    oldMap = indexMap;
    newMap = new Map();
    newTexts = new Map();
    for (const [path, sha] of indexMap) {
      const content = workMap.get(path);
      if (content !== undefined) {
        newMap.set(path, blobSha(content));
        newTexts.set(path, content);
      }
    }
  }
  const changes = treeChanges(oldMap, newMap, textOf);
  if (newTexts !== null) {
    for (const change of changes) {
      const fresh = newTexts.get(change.path);
      if (fresh !== undefined && change.neu.sha !== null) change.neu.text = fresh;
    }
  }
  void stat;
  void exitCode;
  return { changes, textOf };
}

function cmdDiff(ctx: CommandContext, args: string[], repo: GitRepo): void {
  const ranged = diffRanges(ctx, args, repo);
  if (ranged === null) return;
  const { changes } = ranged;
  const stat = args.includes('--stat');
  const exitCode = args.includes('--exit-code');
  if (stat) {
    for (const row of diffstat(changes)) ctx.out(row);
  } else {
    for (const change of changes) {
      const diff = repo.fileDiff(change.path, change.old, change.neu);
      for (const row of diff.rows) ctx.out(row);
    }
  }
  ctx.exit(exitCode && changes.length > 0 ? 1 : 0);
}

function cmdShow(ctx: CommandContext, args: string[], repo: GitRepo): void {
  const operands = args.filter((arg) => !arg.startsWith('-'));
  const rev = operands[0] ?? 'HEAD';
  const sha = repo.revParse(rev);
  if (sha === null) {
    fail(
      ctx,
      `fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`,
    );
    return;
  }
  const commit = parseCommit(sha, repo.readObject(sha)!.payload);
  ctx.out(`commit ${sha}`);
  for (const parent of commit.parents) ctx.out(`Merge: ${parent.slice(0, 7)}`);
  ctx.out(`Author: ${commit.authorName} <${commit.authorEmail}>`);
  ctx.out(`Date:   ${formatGitDate(commit.authorWhen, commit.authorOffset)}`);
  ctx.out('');
  for (const line of commit.message.replace(/\n$/, '').split('\n')) ctx.out(`    ${line}`);
  ctx.out('');
  const parentTree = repo.commitTree(commit.parents[0] ?? null);
  const tree = repo.commitTree(sha);
  for (const change of treeChanges(parentTree, tree, (s) => repo.objectText(s))) {
    const diff = repo.fileDiff(change.path, change.old, change.neu);
    for (const row of diff.rows) ctx.out(row);
  }
  ctx.exit(0);
}

function cmdBranch(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let del = false;
  const operands: string[] = [];
  for (const arg of args) {
    if (arg === '-d' || arg === '--delete') del = true;
    else if (arg === '-a' || arg === '--all' || arg === '-l' || arg === '--list') {
      // local-only listing is the default here
    } else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  if (del) {
    for (const name of operands) {
      if (name === repo.currentBranch()) {
        fail(ctx, `error: cannot delete branch '${name}' used by worktree at '${repo.root}'`, 1);
        return;
      }
      const sha = repo.refSha(name);
      if (sha === null) {
        fail(ctx, `error: branch '${name}' not found.`, 1);
        return;
      }
      if (!reachable(repo, sha)) {
        ctx.err(`error: the branch '${name}' is not fully merged.`);
        ctx.err("hint: If you are sure you want to delete it, run 'git branch -D <branch-name>'.");
        ctx.exit(1);
        return;
      }
      repo.vfs.rm(repo.gitPath(`refs/heads/${name}`));
      ctx.out(`Deleted branch ${name} (was ${sha.slice(0, 7)}).`);
    }
    ctx.exit(0);
    return;
  }
  if (operands.length === 0) {
    const current = repo.currentBranch();
    for (const name of repo.listBranches()) ctx.out(`${name === current ? '* ' : '  '}${name}`);
    ctx.exit(0);
    return;
  }
  const name = operands[0]!;
  const startSha = operands[1] !== undefined ? repo.revParse(operands[1]) : repo.headSha();
  if (startSha === null) {
    fail(ctx, `fatal: not a valid object name: '${operands[1] ?? 'HEAD'}'`);
    return;
  }
  if (!validBranchName(name)) {
    fail(ctx, `fatal: '${name}' is not a valid branch name`);
    return;
  }
  if (repo.refSha(name) !== null) {
    fail(ctx, `fatal: a branch named '${name}' already exists`);
    return;
  }
  repo.writeRef(name, startSha);
  ctx.exit(0);
}

/** Is `sha` reachable from HEAD's history (first-parent walk — enough for -d safety). */
function reachable(repo: GitRepo, sha: string): boolean {
  const seen = new Set<string>();
  let at: string | null = repo.headSha();
  while (at !== null && !seen.has(at)) {
    if (at === sha) return true;
    seen.add(at);
    const obj = repo.readObject(at);
    if (obj === null) return false;
    at = parseCommit(at, obj.payload).parents[0] ?? null;
  }
  return false;
}

/** Switch machinery shared by checkout and switch. */
function switchToBranch(ctx: CommandContext, repo: GitRepo, name: string, create: boolean, force: boolean): boolean {
  if (!validBranchName(name)) {
    fail(ctx, `fatal: '${name}' is not a valid branch name`);
    return false;
  }
  let targetSha: string;
  if (create) {
    if (repo.refSha(name) !== null) {
      if (!force) {
        fail(ctx, `fatal: a branch named '${name}' already exists`);
        return false;
      }
      targetSha = repo.headSha()!;
    } else {
      const start = repo.headSha();
      if (start === null) {
        fail(ctx, "fatal: not a valid object name: 'HEAD'");
        return false;
      }
      repo.writeRef(name, start);
      targetSha = start;
    }
  } else {
    const sha = repo.refSha(name);
    if (sha === null) {
      fail(ctx, `error: pathspec '${name}' did not match any file(s) known to git`, 1);
      return false;
    }
    targetSha = sha;
  }
  if (repo.currentBranch() === name && !create) {
    ctx.out(`Already on '${name}'`);
    ctx.exit(0);
    return true;
  }
  const oldTree = repo.commitTree(repo.headSha());
  const newTree = repo.commitTree(targetSha);
  const work = repo.worktree();
  const index = repo.readIndex();
  const blockedStaged: string[] = [];
  const blockedUntracked: string[] = [];
  const paths = new Set<string>([...oldTree.keys(), ...newTree.keys()]);
  for (const path of paths) {
    const oldSha = oldTree.get(path);
    const newSha = newTree.get(path);
    if (oldSha === newSha) continue;
    const indexSha = index.get(path)?.sha;
    const workContent = work.get(path);
    const workSha = workContent === undefined ? undefined : blobSha(workContent);
    // untracked overwrite: nothing knows this file at the old commit
    if (oldSha === undefined && indexSha === undefined && workSha !== undefined) {
      blockedUntracked.push(path);
      continue;
    }
    // dirty = any of index/work differs from the old tree (mod, add, delete)
    const dirty =
      (indexSha ?? null) !== (oldSha ?? null) || (workSha ?? null) !== (oldSha ?? null);
    if (dirty) blockedStaged.push(path);
  }
  if (blockedStaged.length > 0 || blockedUntracked.length > 0) {
    if (blockedStaged.length > 0) {
      ctx.err('error: Your local changes to the following files would be overwritten by checkout:');
      for (const path of blockedStaged.sort()) ctx.err(`\t${path}`);
      ctx.err('Please commit your changes or stash them before you switch branches.');
    }
    if (blockedUntracked.length > 0) {
      ctx.err('error: The following untracked working tree files would be overwritten by checkout:');
      for (const path of blockedUntracked.sort()) ctx.err(`\t${path}`);
      ctx.err('Please move or remove them before you switch branches.');
    }
    ctx.err('Aborting');
    ctx.exit(1);
    return false;
  }
  // apply: delete removed files, write changed ones, reset the index
  for (const path of paths) {
    if (newTree.has(path)) continue;
    const abs = repo.workPath(path);
    if (repo.vfs.nodeAt(abs) !== null) repo.vfs.rm(abs);
  }
  for (const [path, sha] of newTree) {
    repo.vfs.mountFile(repo.workPath(path), repo.objectText(sha) ?? '');
  }
  const newIndex = new Map<string, IndexEntry>();
  for (const [path, sha] of newTree) newIndex.set(path, { sha, size: utf8Bytes(repo.objectText(sha) ?? '').length });
  repo.writeIndex(newIndex);
  repo.vfs.mountFile(repo.gitPath('HEAD'), `ref: refs/heads/${name}\n`);
  ctx.out(create ? `Switched to a new branch '${name}'` : `Switched to branch '${name}'`);
  ctx.exit(0);
  return true;
}

/** `git checkout -- <paths>` / `git checkout <path>`: restore from the index. */
function restorePaths(ctx: CommandContext, repo: GitRepo, specs: string[]): boolean {
  const index = repo.readIndex();
  let failed = false;
  for (const spec of specs) {
    const abs = repoPath(repo, ctx.state.cwd, spec);
    if (abs === null) {
      fail(ctx, `error: pathspec '${spec}' did not match any file(s) known to git`, 1);
      failed = true;
      continue;
    }
    const rel = relOf(repo, abs);
    const entry = index.get(rel);
    if (entry === undefined) {
      ctx.err(`error: pathspec '${spec}' did not match any file(s) known to git`);
      ctx.exit(1);
      failed = true;
      continue;
    }
    repo.vfs.mountFile(abs, repo.objectText(entry.sha) ?? '');
  }
  return !failed;
}

function cmdCheckout(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let create = false;
  let force = false;
  const operands: string[] = [];
  let pathMode = false;
  for (const arg of args) {
    if (pathMode) {
      operands.push(arg);
      continue;
    }
    if (arg === '--') {
      pathMode = true;
    } else if (arg === '-b') {
      create = true;
    } else if (arg === '-B') {
      create = true;
      force = true;
    } else if (arg === '-f' || arg === '--force' || arg === '-q' || arg === '--quiet') {
      force ||= arg !== '-q' && arg !== '--quiet';
    } else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  if (create) {
    const name = operands[0];
    if (name === undefined) {
      fail(ctx, 'fatal: missing branch name with -b');
      return;
    }
    switchToBranch(ctx, repo, name, true, force);
    return;
  }
  if (operands.length === 0) {
    ctx.exit(0); // bare checkout is a silent no-op, like git
    return;
  }
  // branch first, then path restore — git's ambiguity order
  const first = operands[0]!;
  if (operands.length === 1 && repo.refSha(first) !== null) {
    switchToBranch(ctx, repo, first, false, force);
    return;
  }
  if (restorePaths(ctx, repo, operands)) ctx.exit(0);
}

function cmdSwitch(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let create = false;
  const operands: string[] = [];
  for (const arg of args) {
    if (arg === '-c') create = true;
    else if (arg === '-C') create = true;
    else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  const name = operands[0];
  if (name === undefined) {
    fail(ctx, 'fatal: missing branch or commit operand');
    return;
  }
  switchToBranch(ctx, repo, name, create, false);
}

function cmdConfig(ctx: CommandContext, args: string[], repo: GitRepo): void {
  let global = false;
  let list = false;
  let unset = false;
  const operands: string[] = [];
  for (const arg of args) {
    if (arg === '--global') global = true;
    else if (arg === '--list' || arg === '-l') list = true;
    else if (arg === '--unset') unset = true;
    else if (arg === '--local' || arg === '--get') {
      // --local is the default; --get is implied by the read form
    } else if (arg.startsWith('-')) {
      fail(ctx, `error: unknown option \`${arg}'`);
      return;
    } else operands.push(arg);
  }
  if (list) {
    for (const [key, value] of repo.configList()) ctx.out(`${key}=${value}`);
    ctx.exit(0);
    return;
  }
  const key = operands[0];
  if (key === undefined || !key.includes('.')) {
    fail(ctx, 'error: key does not contain a section (like user.name)');
    return;
  }
  if (unset) {
    fail(ctx, 'error: --unset is not supported in semtext git (edit the config file)');
    return;
  }
  if (operands.length === 1) {
    const value = repo.configGet(key);
    if (value === null) {
      ctx.exit(1);
      return;
    }
    ctx.out(value);
    ctx.exit(0);
    return;
  }
  repo.configSet(key, operands.slice(1).join(' '), global);
  ctx.exit(0);
}

function cmdRevParse(ctx: CommandContext, args: string[], repo: GitRepo): void {
  const short = args.includes('--short');
  const revs = args.filter((arg) => !arg.startsWith('-'));
  if (revs.length === 0) {
    fail(ctx, 'usage: git rev-parse [--short] <revision>...');
    return;
  }
  let failed = false;
  for (const rev of revs) {
    const sha = repo.revParse(rev);
    if (sha === null) {
      ctx.err(
        `fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`,
      );
      failed = true;
      continue;
    }
    ctx.out(short ? sha.slice(0, 7) : sha);
  }
  ctx.exit(failed ? 128 : 0);
}

/* ------------------------------------------------------------------ *
 * the command
 * ------------------------------------------------------------------ */

function gitMain(ctx: CommandContext): void {
  const args = ctx.args;
  const printHelp = (code: number): void => {
    ctx.out(usageOf('git'));
    ctx.out('');
    for (const [name, summary] of SUBCOMMANDS) ctx.out(`   ${name.padEnd(12)} ${summary}`);
    ctx.exit(code);
  };
  if (args.length === 0) {
    printHelp(1); // bare `git` prints the command list and exits 1, like git
    return;
  }
  const sub = args[0]!;
  const rest = args.slice(1);
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    printHelp(0);
    return;
  }
  if (sub === '--version' || sub === 'version') {
    ctx.out(VERSION);
    ctx.exit(0);
    return;
  }
  if (NETWORK_SUBCOMMANDS.has(sub)) {
    ctx.err(
      `git: '${sub}' is not supported in semtext-sh — there is no CORS-capable git transport over the VFS. ` +
        'Local history (init/add/commit/log/diff/branch/checkout) works everywhere.',
    );
    ctx.exit(1);
    return;
  }
  switch (sub) {
    case 'init':
      cmdInit(ctx, rest);
      return;
    case 'add': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdAdd(ctx, rest, repo);
      return;
    }
    case 'status': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdStatus(ctx, rest, repo);
      return;
    }
    case 'commit': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdCommit(ctx, rest, repo);
      return;
    }
    case 'log': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdLog(ctx, rest, repo);
      return;
    }
    case 'diff': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdDiff(ctx, rest, repo);
      return;
    }
    case 'show': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdShow(ctx, rest, repo);
      return;
    }
    case 'branch': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdBranch(ctx, rest, repo);
      return;
    }
    case 'checkout': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdCheckout(ctx, rest, repo);
      return;
    }
    case 'switch': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdSwitch(ctx, rest, repo);
      return;
    }
    case 'config': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdConfig(ctx, rest, repo);
      return;
    }
    case 'rev-parse': {
      const repo = needRepo(ctx);
      if (repo !== null) cmdRevParse(ctx, rest, repo);
      return;
    }
    default:
      ctx.err(`git: '${sub}' is not a git command. See 'git --help'.`);
      ctx.exit(1);
  }
}

/** Path candidates under cwd for add/status/diff completion. */
function completePaths(ctx: CompletionContext): string[] {
  const slash = ctx.word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
  const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
  const base = ctx.vfs.resolve(ctx.cwd, dirPart === '' ? '.' : dirPart);
  const out: string[] = [];
  for (const node of ctx.vfs.list(base)) {
    if (!node.name.startsWith(rest) || node.name === '.git') continue;
    out.push(dirPart + node.name + (node.kind === 'dir' ? '/' : ''));
  }
  return out;
}

function completeBranches(ctx: CompletionContext): string[] {
  const repo = GitRepo.discover(ctx.vfs, ctx.cwd);
  if (repo === null) return [];
  return repo.listBranches().filter((name) => name.startsWith(ctx.word));
}

const gitCommand: CommandSpec = {
  name: 'git',
  usage: usageOf('git'),
  run: gitMain,
  complete(ctx: CompletionContext): string[] {
    if (ctx.args.length === 0) return SUBCOMMANDS.map(([name]) => name).filter((n) => n.startsWith(ctx.word));
    const sub = ctx.args[0]!;
    if (sub === 'checkout' || sub === 'switch' || sub === 'branch') {
      return [...completeBranches(ctx), ...SUBCOMMANDS_FLAG_COMPLETIONS(sub).filter((f) => f.startsWith(ctx.word))];
    }
    if (sub === 'add' || sub === 'status' || sub === 'diff' || sub === 'show' || sub === 'restore') {
      if (ctx.args.length >= 1) return completePaths(ctx);
    }
    return [];
  },
};

function SUBCOMMANDS_FLAG_COMPLETIONS(sub: string): string[] {
  if (sub === 'checkout') return ['-b', '-B', '--'];
  if (sub === 'switch') return ['-c', '-C'];
  if (sub === 'branch') return ['-d', '--delete', '-a', '--all'];
  return [];
}

export const commands: CommandSpec[] = [gitCommand];

export const manPages: Record<string, string[]> = {
  git: [
    'GIT(1)                    semtext-sh manual',
    '',
    'NAME',
    '     git — the stupid content tracker, over the shell VFS',
    '',
    'SYNOPSIS',
    '     git <command> [<args>]',
    '',
    'DESCRIPTION',
    '     Version control on the virtual file system, backed by a pure-JS',
    '     loose-object store (SHA-1 names, real ref/commit/tree layouts).',
    '',
    'COMMANDS',
    '     init [dir]        create an empty repository (default branch: main)',
    '     add [-A] [-u] [path...]        stage content (stages deletions too)',
    '     status [--short]  working-tree / index state',
    '     commit -m <msg> [-a] [--amend] [--allow-empty]',
    '     log [--oneline] [-n N] [<rev>]',
    '     diff [--cached] [--stat] [--exit-code] [<rev> [<rev>]]',
    '     branch [-d] [<name> [<start>]]',
    '     checkout [-b <new> | <branch> | -- <paths...>]',
    '     switch [-c] <branch>',
    '     show [<rev>]      one commit + its diff',
    '     config [--global] <key> [<value>] | --list',
    '     rev-parse [--short] <revision>...',
    '',
    'REVISIONS',
    '     HEAD, HEAD~n, HEAD^n, a branch name, a full or unique-prefix sha.',
    '',
    'DEVIATIONS from on-disk git (documented, deliberate):',
    '     - objects are stored uncompressed (no zlib): the synchronous',
    '       command path cannot deflate; all other formats match loose git.',
    '     - .git/index is JSON, not the binary index.',
    '     - no network transport: clone/push/pull/fetch explain and stop.',
    '     - no tags, no .gitignore, no editor (commit needs -m).',
    '     - ^n only navigates merge parents; no tag peeling (^0 == ^1).',
    '',
    'EXIT STATUS',
    '     0 success · 1 clean-but-nothing / conflicts · 128 fatal',
    '',
    'SEMTEXT-SH                 2026-10-17                    GIT(1)',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
