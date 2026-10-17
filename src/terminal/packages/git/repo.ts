/**
 * packages/git/repo — the minimal git object store over the VFS
 * (packages round, LANE=pkg-git).
 *
 * isomorphic-git is NOT in node_modules and the brief forbids npm
 * install, so this is a hand-rolled pure-JS store in real git's loose
 * object dialect:
 *
 *   - `.git/objects/<xx>/<38>` hold one object each, content = base64 of
 *     the raw `"<type> <byte-size>\0<payload>"` bytes, named by their
 *     SHA-1. DEVIATION from real git: payloads are stored UNcompressed
 *     (no zlib) because the synchronous command path cannot deflate;
 *     every other byte of the format (header, tree entries, commit
 *     layout, ref layout, SHA-1 naming) matches loose git, so
 *     `rev-parse`-style names and ref semantics are the real ones.
 *   - `.git/index` is JSON (`{version, entries: {path: {sha, size}}}`),
 *     not git's binary index — same role (staged snapshot), readable.
 *   - `.git/HEAD`, `refs/heads/<branch>` and `config` are byte-for-byte
 *     the real shapes (symref line, hex+newline, INI sections).
 *
 * Copying `.git` to disk for real git therefore will NOT work (objects
 * compressed, index JSON) — documented in the man page; the store is for
 * the shell's own VFS. All IO is the synchronous Vfs cache, so the
 * commands run on every backend (memory/localStorage/S3) unchanged.
 */

import { sha1Hex } from './sha1.js';
import { countChanges, diffLines, splitLines, unifiedDiffRows } from './gitdiff.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ── byte/string helpers ── */

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** b64 without the call-stack blowup on large files (8 KiB chunks). */
export function b64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(bin);
}

export function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Same path math as src/terminal/vfs.ts#resolvePath (chunk-local copy —
 *  the package contract forbids importing runtime values). */
export function resolvePath(cwd: string, input: string): string {
  const base = cwd.startsWith('/') ? cwd : '/' + cwd;
  const raw = input === '' ? base : input.startsWith('/') ? input : base + '/' + input;
  const out: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

/* ── object serialization ── */

export type ObjectType = 'blob' | 'tree' | 'commit';

interface RawObject {
  type: ObjectType;
  payload: Uint8Array;
}

/** `"<type> <size>\0" + payload` bytes, hashed — the object's name. */
function rawObjectBytes(type: ObjectType, payload: Uint8Array): Uint8Array {
  const head = utf8Bytes(`${type} ${payload.length}\0`);
  const out = new Uint8Array(head.length + payload.length);
  out.set(head);
  out.set(payload, head.length);
  return out;
}

export function hashObject(type: ObjectType, payload: Uint8Array): string {
  return sha1Hex(rawObjectBytes(type, payload));
}

/** Hash a blob's content the way `git hash-object` would. */
export function blobSha(content: string): string {
  return hashObject('blob', utf8Bytes(content));
}

const FILE_MODE = '100644';
const DIR_MODE = '40000';

export interface TreeEntry {
  mode: string;
  name: string;
  sha: string;
}

/** Serialize tree entries (git's order: names compared with `/` appended for dirs). */
export function treePayload(entries: TreeEntry[]): Uint8Array {
  const sorted = [...entries].sort((x, y) => {
    const nx = x.mode === DIR_MODE ? x.name + '/' : x.name;
    const ny = y.mode === DIR_MODE ? y.name + '/' : y.name;
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  });
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const entry of sorted) {
    const head = utf8Bytes(`${entry.mode} ${entry.name}\0`);
    parts.push(head, bytesFromSha(entry.sha));
    total += head.length + 20;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function bytesFromSha(sha: string): Uint8Array {
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(sha.slice(i * 2, i * 2 + 2), 16)!;
  return out;
}

function parseTree(payload: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let at = 0;
  while (at < payload.length) {
    let sp = at;
    while (payload[sp] !== 0x20) sp++;
    let nul = sp;
    while (payload[nul] !== 0x00) nul++;
    const mode = utf8Text(payload.subarray(at, sp));
    const name = utf8Text(payload.subarray(sp + 1, nul));
    let sha = '';
    for (let i = 0; i < 20; i++) sha += payload[nul + 1 + i]!.toString(16).padStart(2, '0');
    entries.push({ mode, name, sha });
    at = nul + 21;
  }
  return entries;
}

/* ── commits ── */

export interface CommitInfo {
  sha: string;
  tree: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorWhen: number;
  authorOffset: number;
  committerName: string;
  committerEmail: string;
  message: string;
}

/** Compose a commit object payload. */
export function commitPayload(opts: {
  tree: string;
  parents: string[];
  name: string;
  email: string;
  when: number;
  offset: number;
  message: string;
}): Uint8Array {
  const ident = `${opts.name} <${opts.email}> ${opts.when} ${formatOffset(opts.offset)}`;
  let text = `tree ${opts.tree}\n`;
  for (const parent of opts.parents) text += `parent ${parent}\n`;
  text += `author ${ident}\ncommitter ${ident}\n\n${opts.message}`;
  if (!text.endsWith('\n')) text += '\n';
  return utf8Bytes(text);
}

export function parseCommit(sha: string, payload: Uint8Array): CommitInfo {
  const text = utf8Text(payload);
  const nl = text.indexOf('\n\n');
  const header = nl === -1 ? text : text.slice(0, nl);
  const message = nl === -1 ? '' : text.slice(nl + 2);
  let tree = '';
  const parents: string[] = [];
  let authorLine = '';
  let committerLine = '';
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5);
    else if (line.startsWith('parent ')) parents.push(line.slice(7));
    else if (line.startsWith('author ')) authorLine = line.slice(7);
    else if (line.startsWith('committer ')) committerLine = line.slice(10);
  }
  const author = parseIdent(authorLine);
  return {
    sha,
    tree,
    parents,
    authorName: author.name,
    authorEmail: author.email,
    authorWhen: author.when,
    authorOffset: author.offset,
    committerName: parseIdent(committerLine).name,
    committerEmail: parseIdent(committerLine).email,
    message,
  };
}

function parseIdent(line: string): { name: string; email: string; when: number; offset: number } {
  const lt = line.lastIndexOf(' <');
  const gt = line.indexOf('> ', lt);
  if (lt === -1 || gt === -1) return { name: line, email: '', when: 0, offset: 0 };
  const tail = line.slice(gt + 2).trim().split(/\s+/);
  return {
    name: line.slice(0, lt),
    email: line.slice(lt + 2, gt),
    when: Number(tail[0] ?? 0),
    offset: parseOffset(tail[1] ?? '+0000'),
  };
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return sign + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
}

function parseOffset(text: string): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(text);
  if (!m) return 0;
  const value = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -value : value;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** git's `Date:` line shape: `Thu Oct 17 09:15:00 2026 +0200`. */
export function formatGitDate(when: number, offsetMinutes: number): string {
  const shifted = new Date((when + offsetMinutes * 60) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${DAYS[shifted.getUTCDay()]} ${MONTHS[shifted.getUTCMonth()]} ` +
    `${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:` +
    `${pad(shifted.getUTCSeconds())} ${shifted.getUTCFullYear()} ${formatOffset(offsetMinutes)}`
  );
}

/** Local offset in minutes east of UTC (git stamps commits in local time). */
export function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/* ── the repo ── */

export interface IndexEntry {
  sha: string;
  size: number;
}

export type StatusKind = 'added' | 'modified' | 'deleted';

export interface StatusChange {
  path: string;
  kind: StatusKind;
}

export interface RepoStatus {
  staged: StatusChange[];
  unstaged: StatusChange[];
  untracked: string[];
}

const NOT_A_REPO = 'fatal: not a git repository (or any of the parent directories): .git';

/**
 * The repository model. Construct via `discover` (walk up from a cwd) or
 * `create` (after `init`). All paths are absolute VFS paths; repo-internal
 * state lives under `<root>/.git/`.
 */
export class GitRepo {
  constructor(
    readonly vfs: import('../../vfs.js').Vfs,
    readonly root: string,
  ) {}

  /** Walk up from `cwd` looking for `.git`; null when there is no repo. */
  static discover(vfs: import('../../vfs.js').Vfs, cwd: string): GitRepo | null {
    let at = cwd;
    for (;;) {
      if (vfs.nodeAt(at + '/.git') !== null) return new GitRepo(vfs, at);
      if (at === '/' || at === '') return null;
      at = at.slice(0, at.lastIndexOf('/')) || '/';
    }
  }

  /** Create the skeleton (git init). Returns the repo (re-init keeps history). */
  static create(vfs: import('../../vfs.js').Vfs, root: string): GitRepo {
    const gitDir = root === '/' ? '/.git' : root + '/.git';
    for (const dir of ['objects', 'refs/heads', 'refs/tags']) {
      const path = gitDir + '/' + dir;
      if (vfs.nodeAt(path) === null) vfs.mkdir(path, { parents: true });
    }
    if (vfs.nodeAt(gitDir + '/HEAD') === null) {
      vfs.mountFile(gitDir + '/HEAD', 'ref: refs/heads/main\n');
    }
    if (vfs.nodeAt(gitDir + '/config') === null) {
      vfs.mountFile(
        gitDir + '/config',
        '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n',
      );
    }
    return new GitRepo(vfs, root);
  }

  static notFound(): string {
    return NOT_A_REPO;
  }

  /** `.git`-relative path → absolute VFS path. */
  gitPath(rel: string): string {
    return (this.root === '/' ? '' : this.root) + '/.git/' + rel;
  }

  /** Repo-relative worktree path → absolute VFS path. */
  workPath(rel: string): string {
    return (this.root === '/' ? '' : this.root) + '/' + rel;
  }

  /** Absolute VFS path → repo-relative ('' for the root itself). */
  relOf(abs: string): string {
    if (abs === this.root) return '';
    return this.root === '/' ? abs.slice(1) : abs.slice(this.root.length + 1);
  }

  /** True when `abs` lives inside `.git`. */
  inGitDir(abs: string): boolean {
    const gitDir = this.root === '/' ? '/.git' : this.root + '/.git';
    return abs === gitDir || abs.startsWith(gitDir + '/');
  }

  /* objects */

  readObject(sha: string): RawObject | null {
    const path = this.gitPath(`objects/${sha.slice(0, 2)}/${sha.slice(2)}`);
    const content = this.vfs.read(path);
    if (content === null) return null;
    const bytes = bytesFromB64(content);
    const nul = bytes.indexOf(0);
    const type = utf8Text(bytes.subarray(0, nul)).split(' ')[0] as ObjectType;
    return { type, payload: bytes.subarray(nul + 1) };
  }

  writeObject(type: ObjectType, payload: Uint8Array): string {
    const sha = hashObject(type, payload);
    const dir = this.gitPath(`objects/${sha.slice(0, 2)}`);
    const path = `${dir}/${sha.slice(2)}`;
    if (this.vfs.nodeAt(path) === null) {
      if (this.vfs.nodeAt(dir) === null) this.vfs.mkdir(dir, { parents: true });
      this.vfs.mountFile(path, b64FromBytes(rawObjectBytes(type, payload)));
    }
    return sha;
  }

  writeBlob(content: string): string {
    return this.writeObject('blob', utf8Bytes(content));
  }

  objectText(sha: string): string | null {
    const obj = this.readObject(sha);
    return obj ? utf8Text(obj.payload) : null;
  }

  /** All object names (for short-sha resolution). */
  allObjects(): string[] {
    const out: string[] = [];
    const objectsDir = this.gitPath('objects');
    for (const fan of this.vfs.list(objectsDir)) {
      if (fan.kind !== 'dir' || fan.name.length !== 2) continue;
      for (const rest of this.vfs.list(objectsDir + '/' + fan.name)) {
        out.push(fan.name + rest.name);
      }
    }
    return out;
  }

  /* refs + HEAD */

  /** Current branch name (empty string when HEAD is detached). */
  currentBranch(): string {
    const head = this.vfs.read(this.gitPath('HEAD')) ?? '';
    const m = /^ref: refs\/heads\/(.*)\n?$/.exec(head);
    return m ? m[1]! : '';
  }

  /** Resolve the current HEAD commit sha, or null before the first commit. */
  headSha(): string | null {
    const branch = this.currentBranch();
    if (branch !== '') return this.refSha(branch);
    const head = (this.vfs.read(this.gitPath('HEAD')) ?? '').trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : null;
  }

  refSha(branch: string): string | null {
    const content = this.vfs.read(this.gitPath(`refs/heads/${branch}`));
    return content === null ? null : content.trim();
  }

  writeRef(branch: string, sha: string): void {
    this.vfs.mountFile(this.gitPath(`refs/heads/${branch}`), sha + '\n');
  }

  listBranches(): string[] {
    const heads = this.gitPath('refs/heads');
    const out: string[] = [];
    const walk = (path: string, prefix: string) => {
      for (const node of this.vfs.list(path)) {
        if (node.kind === 'dir') walk(path + '/' + node.name, prefix + node.name + '/');
        else out.push(prefix + node.name);
      }
    };
    walk(heads, '');
    return out.sort();
  }

  /* index */

  readIndex(): Map<string, IndexEntry> {
    const raw = this.vfs.read(this.gitPath('index'));
    const map = new Map<string, IndexEntry>();
    if (raw === null) return map;
    try {
      const parsed = JSON.parse(raw) as { entries?: Record<string, IndexEntry> };
      for (const [path, entry] of Object.entries(parsed.entries ?? {})) {
        map.set(path, { sha: entry.sha, size: entry.size });
      }
    } catch {
      // a corrupt index behaves like an empty one; `git add` rebuilds it
    }
    return map;
  }

  writeIndex(entries: Map<string, IndexEntry>): void {
    const payload: Record<string, IndexEntry> = {};
    for (const [path, entry] of [...entries.entries()].sort()) payload[path] = entry;
    this.vfs.mountFile(
      this.gitPath('index'),
      JSON.stringify({ version: 1, entries: payload }, null, 1) + '\n',
    );
  }

  /* trees */

  /** Flatten a tree object into `path → sha` (files only, recursive). */
  flattenTree(treeSha: string, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    const obj = this.readObject(treeSha);
    if (obj === null) return out;
    for (const entry of parseTree(obj.payload)) {
      const path = prefix + entry.name;
      if (entry.mode === DIR_MODE) {
        for (const [sub, sha] of this.flattenTree(entry.sha, path + '/')) out.set(sub, sha);
      } else {
        out.set(path, entry.sha);
      }
    }
    return out;
  }

  /** Tree of a commit sha (empty map for the synthetic empty tree). */
  commitTree(commitSha: string | null): Map<string, string> {
    if (commitSha === null) return new Map();
    const obj = this.readObject(commitSha);
    if (obj === null || obj.type !== 'commit') return new Map();
    const m = /^tree ([0-9a-f]{40})/m.exec(utf8Text(obj.payload));
    return m ? this.flattenTree(m[1]!) : new Map();
  }

  /** Build nested tree objects from staged entries; returns the root tree sha. */
  writeTreeFromIndex(entries: Map<string, IndexEntry>): string {
    interface DirNode {
      files: TreeEntry[];
      dirs: Map<string, DirNode>;
    }
    const root: DirNode = { files: [], dirs: new Map() };
    for (const [path, entry] of entries) {
      const parts = path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i]!;
        let next = node.dirs.get(name);
        if (!next) {
          next = { files: [], dirs: new Map() };
          node.dirs.set(name, next);
        }
        node = next;
      }
      node.files.push({ mode: FILE_MODE, name: parts[parts.length - 1]!, sha: entry.sha });
    }
    const write = (node: DirNode): string => {
      const entriesOut: TreeEntry[] = [...node.files];
      for (const [name, child] of node.dirs) {
        entriesOut.push({ mode: DIR_MODE, name, sha: write(child) });
      }
      return this.writeObject('tree', treePayload(entriesOut));
    };
    return write(root);
  }

  /* worktree */

  /** Scan the working tree (`.git` skipped) → `relpath → content`. */
  worktree(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (abs: string, rel: string) => {
      for (const node of this.vfs.list(abs)) {
        const childAbs = abs === '/' ? '/' + node.name : abs + '/' + node.name;
        if (this.inGitDir(childAbs)) continue;
        const childRel = rel === '' ? node.name : rel + '/' + node.name;
        if (node.kind === 'dir') walk(childAbs, childRel);
        else out.set(childRel, node.content);
      }
    };
    walk(this.root, '');
    return out;
  }

  /** Blob sha of a worktree file without writing the object. */
  worktreeSha(content: string): string {
    return blobSha(content);
  }

  /* status */

  status(): RepoStatus {
    const headTree = this.commitTree(this.headSha());
    const index = this.readIndex();
    const work = this.worktree();
    const staged: StatusChange[] = [];
    const unstaged: StatusChange[] = [];
    const untracked: string[] = [];
    const paths = new Set<string>([...headTree.keys(), ...index.keys(), ...work.keys()]);
    for (const path of [...paths].sort()) {
      const headSha = headTree.get(path);
      const indexSha = index.get(path)?.sha;
      const workContent = work.get(path);
      const workSha = workContent === undefined ? undefined : blobSha(workContent);
      if (headSha !== indexSha) {
        if (headSha === undefined) staged.push({ path, kind: 'added' });
        else if (indexSha === undefined) staged.push({ path, kind: 'deleted' });
        else staged.push({ path, kind: 'modified' });
      }
      if (indexSha !== workSha) {
        if (indexSha === undefined) {
          untracked.push(path);
        } else if (workSha === undefined) {
          unstaged.push({ path, kind: 'deleted' });
        } else {
          unstaged.push({ path, kind: 'modified' });
        }
      }
    }
    return { staged, unstaged, untracked };
  }

  /** Stage worktree state for tracked paths (commit -a helper); writes blobs. */
  stageAllTracked(): void {
    const index = this.readIndex();
    const work = this.worktree();
    for (const [path, entry] of index) {
      const content = work.get(path);
      if (content === undefined) {
        index.delete(path);
      } else if (blobSha(content) !== entry.sha) {
        index.set(path, { sha: this.writeBlob(content), size: utf8Bytes(content).length });
      }
    }
    this.writeIndex(index);
  }

  /* revision parsing */

  /**
   * Resolve a revision: HEAD (+ ~n/^n chains), a branch, a full sha, or a
   * unique ≥4-char sha prefix. Null when nothing matches.
   */
  revParse(rev: string): string | null {
    let name = rev;
    const steps: Array<{ kind: 'tilde' | 'caret'; n: number }> = [];
    for (;;) {
      const tilde = /^(.*?)(~(\d+))$/.exec(name);
      const caret = /^(.*?)(\^(\d*))$/.exec(name);
      if (tilde) {
        steps.push({ kind: 'tilde', n: Number(tilde[3]) });
        name = tilde[1]!;
      } else if (caret) {
        steps.push({ kind: 'caret', n: caret[3] === '' ? 1 : Number(caret[3]) });
        name = caret[1]!;
      } else {
        break;
      }
    }
    let sha: string | null = null;
    if (name === 'HEAD') sha = this.headSha();
    else sha = this.refSha(name);
    if (sha === null && /^[0-9a-f]{4,40}$/.test(name)) {
      if (name.length === 40) sha = this.readObject(name) ? name : null;
      else {
        const matches = this.allObjects().filter((cand) => cand.startsWith(name));
        if (matches.length === 1) sha = matches[0]!;
        else if (matches.length > 1) return null; // ambiguous — caller reports
      }
    }
    if (sha === null) return null;
    for (const step of steps) {
      if (sha === null) return null;
      const commit = this.readObject(sha);
      if (commit === null || commit.type !== 'commit') return null;
      const parents: string[] = parseCommit(sha, commit.payload).parents;
      if (step.kind === 'caret') {
        const next: string | undefined = parents[step.n - 1];
        if (next === undefined) return null;
        sha = next;
      } else {
        for (let i = 0; i < step.n; i++) {
          if (parents.length === 0) return null;
          const first: string = parents[0]!;
          sha = first;
          const obj = this.readObject(first);
          if (obj === null || obj.type !== 'commit') return null;
          parents.splice(0, parents.length, ...parseCommit(first, obj.payload).parents);
        }
      }
    }
    return sha;
  }

  /* config */

  /** Read one config key (`section.key`); repo config first, then $HOME/.gitconfig. */
  configGet(key: string): string | null {
    const repoValue = configLookup(this.vfs.read(this.gitPath('config')) ?? '', key);
    if (repoValue !== null) return repoValue;
    const home = this.vfs.resolve('/', this.homeDir() + '/.gitconfig');
    return configLookup(this.vfs.read(home) ?? '', key);
  }

  homeDir(): string {
    return this.homeOverride ?? '/home';
  }

  /** Test hook: where $HOME lives in the VFS (default /home). */
  homeOverride: string | null = null;

  configSet(key: string, value: string, global: boolean): void {
    const path = global
      ? resolvePath('/', this.homeDir() + '/.gitconfig')
      : this.gitPath('config');
    const current = this.vfs.read(path) ?? '';
    this.vfs.mountFile(path, configWrite(current, key, value));
  }

  configList(): Array<[string, string]> {
    return configPairs(this.vfs.read(this.gitPath('config')) ?? '');
  }

  /* diffs (worktree/index/commits) */

  /**
   * One file's unified diff, git-style header included. Sides carry both
   * the blob sha (for the `index a..b` header; null = the /dev/null side
   * of an add or delete) and the text — worktree files diff from raw
   * content because `git diff` must not write objects for unstaged edits.
   */
  fileDiff(
    path: string,
    old: { sha: string | null; text: string | null },
    neu: { sha: string | null; text: string | null },
  ): { rows: string[]; adds: number; dels: number } {
    const a = splitLines(old.text ?? '');
    const b = splitLines(neu.text ?? '');
    const rows: string[] = [`diff --git a/${path} b/${path}`];
    if (old.sha === null) {
      rows.push('new file mode ' + FILE_MODE);
      rows.push(`index ${'0'.repeat(7)}..${short(neu.sha!)}`);
      rows.push('--- /dev/null');
      rows.push(`+++ b/${path}`);
    } else if (neu.sha === null) {
      rows.push('deleted file mode ' + FILE_MODE);
      rows.push(`index ${short(old.sha)}..${'0'.repeat(7)}`);
      rows.push(`--- a/${path}`);
      rows.push('+++ /dev/null');
    } else {
      rows.push(`index ${short(old.sha)}..${short(neu.sha)} ${FILE_MODE}`);
      rows.push(`--- a/${path}`);
      rows.push(`+++ b/${path}`);
    }
    if (old.text !== neu.text) {
      const ops = diffLines(a.lines, b.lines);
      rows.push(
        ...unifiedDiffRows(ops, 3, {
          aLen: a.lines.length,
          aEndsNewline: a.endsWithNewline,
          bLen: b.lines.length,
          bEndsNewline: b.endsWithNewline,
        }),
      );
    }
    const counts = countChanges(diffLines(a.lines, b.lines));
    return { rows, adds: counts.adds, dels: counts.dels };
  }
}

/** git prints 7-hex abbreviations in diff headers. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/* ── config INI (repo `config` + $HOME/.gitconfig) ── */

export function configPairs(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let section = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.*)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      if (section !== '') out.push([`${section}.${line.toLowerCase()}`, 'true']);
      continue;
    }
    if (section === '') continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out.push([`${section}.${key}`, value]);
  }
  return out;
}

export function configLookup(text: string, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const [k, v] of configPairs(text)) if (k === wanted) return v;
  return null;
}

/** Set (or replace) one key in INI text, creating the section as needed. */
export function configWrite(text: string, key: string, value: string): string {
  const dot = key.indexOf('.');
  const section = key.slice(0, dot).toLowerCase();
  const name = key.slice(dot + 1).toLowerCase();
  const lines = text.split('\n');
  let inSection = false;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sec = /^\s*\[(.*)\]\s*$/.exec(line);
    if (sec) {
      inSection = sec[1]!.trim().toLowerCase() === section;
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf('=');
    if (eq !== -1 && line.slice(0, eq).trim().toLowerCase() === name) {
      lines[i] = `\t${name} = ${value}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    // append under the section (creating it at the end when missing)
    let sectionAt = -1;
    for (let i = 0; i < lines.length; i++) {
      const sec = /^\s*\[(.*)\]\s*$/.exec(lines[i]!);
      if (sec && sec[1]!.trim().toLowerCase() === section) sectionAt = i;
    }
    if (sectionAt === -1) {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      lines.push(`[${section}]`, `\t${name} = ${value}`, '');
    } else {
      lines.splice(sectionAt + 1, 0, `\t${name} = ${value}`);
    }
  }
  return lines.join('\n');
}
