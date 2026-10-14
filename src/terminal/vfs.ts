/**
 * vfs — the virtual file system plugins mount into, with pluggable
 * durable backends behind a synchronous in-memory cache.
 *
 * The cache is a plain in-memory POSIX-ish tree with NO built-in content:
 * a fresh `Vfs` is empty, and everything in it arrives through a plugin
 * manifest (`mountFile`, usually via `TerminalCore.mountPlugin`). Paths
 * are absolute strings resolved against a cwd; there is no IO on the
 * command path — every command mutates the cache synchronously and the
 * Vfs flushes the change to the backend covering that path, fire and
 * forget (write-through). Backend failures NEVER break the command: the
 * cache stays correct for the session, the error is recorded on
 * `vfs.storageErrors`, and `onError` fires so the terminal can print one
 * stderr warning line.
 *
 * Consistency semantics (documented in src/terminal/PLUGINS.md § Storage
 * backends):
 *   - write-through, last write wins; the cache is authoritative for the
 *     running session;
 *   - a failed flush is reported and dropped — the next write to the same
 *     path re-persists it, so a later successful write heals earlier
 *     losses;
 *   - hydration (`mount s3`, localStorage restore) is asynchronous: until
 *     it lands the covered subtree is simply empty, and the mounting shell
 *     announces completion through the core's async line channel.
 *
 * No async on the command path, no browser dependency in this module —
 * the whole thing unit-tests in plain Node.
 */

export interface VfsFile {
  kind: 'file';
  name: string;
  content: string;
}

export interface VfsDir {
  kind: 'dir';
  name: string;
  children: VfsNode[];
}

export type VfsNode = VfsFile | VfsDir;

export interface VfsStat {
  kind: 'file' | 'dir';
  size: number;
}

/**
 * One durable store behind a mountpoint. Backends are async; the Vfs is
 * the sync cache in front of them. Implementations: the localStorage
 * backend (src/terminal/backends/local-storage.ts) and the S3 backend
 * (src/terminal/backends/s3.ts, shipped as a separate bundle). The
 * default Vfs has none — nothing persists unless a page opts in.
 */
export interface VfsBackend {
  /** Backend id for `mount` listings, e.g. `local-storage`, `s3`. */
  readonly id: string;
  /** False for read-only mounts (public S3 buckets, detached stores). */
  readonly writable: boolean;
  /** Where it is mounted — absolute, e.g. `/` or `/s3`. */
  readonly mountpoint: string;
  stat(path: string): Promise<VfsStat | null>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  rm(path: string, opts: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Entries of the dir at `path` (bare names + kinds). */
  list(path: string): Promise<Array<{ name: string; kind: 'file' | 'dir' }>>;
  /**
   * Optional detach-side cleanup — umount/logout drops sessions and
   * timers (e.g. the s3 oidc credential session). Never throws.
   */
  dispose?(): void;
}

/** One failed backend flush, for introspection and warnings. */
export interface VfsStorageError {
  backend: string;
  mountpoint: string;
  op: 'read' | 'write' | 'mkdirp' | 'rm' | 'rename' | 'stat' | 'list';
  path: string;
  message: string;
}

/** Deep structural copy — for pristine-snapshot keeps (`storage reset`). */
export function cloneNode(node: VfsNode): VfsNode {
  if (node.kind === 'file') return { kind: 'file', name: node.name, content: node.content };
  return { kind: 'dir', name: node.name, children: node.children.map(cloneNode) };
}

/**
 * Resolve `input` against `cwd` to a normalized absolute path. Pure
 * string math — no tree lookup, so it never fails: `.` and empty
 * segments collapse, `..` pops (clamped at the root), a leading `/`
 * escapes the cwd.
 */
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

/** Split a normalized absolute path into its segments. */
function segments(path: string): string[] {
  return path.split('/').filter((part) => part !== '');
}

const lastSegment = (path: string): string => segments(path).pop() ?? '';

const makeDir = (name: string, children: VfsNode[] = []): VfsDir => ({ kind: 'dir', name, children });

/** Mount paths must be absolute and traversable — no escapes, no mistakes. */
function assertMountPath(path: string): string[] {
  if (!path.startsWith('/')) throw new Error(`vfs: mount path must be absolute: "${path}"`);
  const parts = segments(path);
  if (parts.includes('..')) throw new Error(`vfs: mount path must not contain "..": "${path}"`);
  if (parts.length === 0) throw new Error('vfs: cannot operate on the root');
  return parts;
}

/**
 * The registry + sync cache. One terminal owns one; plugins merge into
 * it, backends attach behind it, last write wins.
 */
export class Vfs {
  readonly root: VfsDir = makeDir('');
  /** Mountpoint (absolute, longest-prefix wins) → durable backend. */
  readonly mounts = new Map<string, VfsBackend>();
  /** Every failed backend flush, oldest first. */
  readonly storageErrors: VfsStorageError[] = [];
  /** Set by the element: one stderr warning per failed flush. */
  onError: ((error: VfsStorageError) => void) | null = null;

  /** Resolve `input` against `cwd` to a normalized absolute path. */
  resolve(cwd: string, input: string): string {
    return resolvePath(cwd, input);
  }

  /** Node at an absolute path, or null when nothing lives there. */
  nodeAt(path: string): VfsNode | null {
    let node: VfsNode = this.root;
    for (const part of segments(path)) {
      if (node.kind !== 'dir') return null;
      const next: VfsNode | undefined = node.children.find((child) => child.name === part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** Children of the dir at `path`; files and missing paths list empty. */
  list(path: string): VfsNode[] {
    const node = this.nodeAt(path);
    return node && node.kind === 'dir' ? node.children : [];
  }

  /** Content of the file at `path`; null when missing or a directory. */
  read(path: string): string | null {
    const node = this.nodeAt(path);
    return node && node.kind === 'file' ? node.content : null;
  }

  /** The backend covering `path` (longest mountpoint prefix), or null. */
  backendFor(path: string): VfsBackend | null {
    let best: VfsBackend | null = null;
    let bestLen = -1;
    for (const [mountpoint, backend] of this.mounts) {
      const covered = mountpoint === '/' ? true : path === mountpoint || path.startsWith(mountpoint + '/');
      if (covered && mountpoint.length > bestLen) {
        best = backend;
        bestLen = mountpoint.length;
      }
    }
    return best;
  }

  /** Attach a durable backend at its declared mountpoint. */
  attachBackend(backend: VfsBackend): void {
    this.mounts.set(backend.mountpoint, backend);
  }

  detachBackend(mountpoint: string): boolean {
    return this.mounts.delete(mountpoint);
  }

  /** Fire-and-forget flush; records + reports failures, never throws. */
  #flush(backend: VfsBackend, op: VfsStorageError['op'], path: string, run: () => Promise<void>): void {
    const writing = op === 'write' || op === 'mkdirp' || op === 'rm' || op === 'rename';
    if (writing && !backend.writable) return;
    run().catch((cause: unknown) => {
      const error: VfsStorageError = {
        backend: backend.id,
        mountpoint: backend.mountpoint,
        op,
        path,
        message: cause instanceof Error ? cause.message : String(cause),
      };
      this.storageErrors.push(error);
      this.onError?.(error);
    });
  }

  /** Flush one mutation to the backend covering `path` (if any). */
  #flushFor(path: string, op: VfsStorageError['op'], run: (backend: VfsBackend) => Promise<void>): void {
    const backend = this.backendFor(path);
    if (!backend) return;
    this.#flush(backend, op, path, () => run(backend));
  }

  /**
   * Put (or replace) a file at `path`, creating intermediate directories.
   * Last write wins. Throws on a relative/`..` path, when an existing
   * directory occupies the spot, or when the path walks through a file.
   */
  mountFile(path: string, content: string): VfsFile {
    const parts = assertMountPath(path);
    let node: VfsDir = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const found = node.children.find((child) => child.name === name);
      if (!found) {
        const created = makeDir(name);
        node.children.push(created);
        node = created;
      } else if (found.kind === 'dir') {
        node = found;
      } else {
        throw new Error(`vfs: "${path}" walks through a file ("${name}")`);
      }
    }
    const name = parts[parts.length - 1]!;
    const found = node.children.find((child) => child.name === name);
    if (found && found.kind === 'dir') throw new Error(`vfs: "${path}" is a directory`);
    if (found && found.kind === 'file') {
      found.content = content;
      this.#flushFor(path, 'write', (backend) => backend.write(path, content));
      return found;
    }
    const file: VfsFile = { kind: 'file', name, content };
    node.children.push(file);
    this.#flushFor(path, 'write', (backend) => backend.write(path, content));
    return file;
  }

  /**
   * mkdir — create a directory. Without `parents` every segment but the
   * last must already exist and the last must not; with `parents`, an
   * existing directory is fine (an existing file still throws). Errors
   * speak POSIX: `File exists`, `No such file or directory`.
   */
  mkdir(path: string, opts: { parents?: boolean } = {}): VfsDir {
    const parts = assertMountPath(path);
    let node: VfsDir = this.root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const last = i === parts.length - 1;
      const found = node.children.find((child) => child.name === name);
      if (found && found.kind === 'dir') {
        if (last && !opts.parents) throw new Error('File exists');
        node = found;
        continue;
      }
      if (found && found.kind === 'file') throw new Error('File exists');
      if (!last && !opts.parents) throw new Error('No such file or directory');
      const created = makeDir(name);
      node.children.push(created);
      node = created;
      if (last) this.#flushFor(path, 'mkdirp', (backend) => backend.mkdirp(path));
    }
    return node;
  }

  /**
   * touch — create an empty file. Throws `No such file or directory`
   * when a parent segment is missing and `Is a directory` when the spot
   * is taken by a directory (commands check existence first, so the
   * POSIX "already exists is fine" behavior lives at the command layer).
   */
  touch(path: string): VfsFile {
    const node = this.nodeAt(path);
    if (node && node.kind === 'file') return node;
    if (node && node.kind === 'dir') throw new Error('Is a directory');
    const parentPath = resolvePath(path, '..');
    const parent = this.nodeAt(parentPath);
    if (!parent || parent.kind !== 'dir') throw new Error('No such file or directory');
    const file: VfsFile = { kind: 'file', name: lastSegment(path), content: '' };
    parent.children.push(file);
    this.#flushFor(path, 'write', (backend) => backend.write(path, ''));
    return file;
  }

  /**
   * rm — remove a file, or a directory with `recursive`. Missing paths
   * pass silently with `force`. The root is never removable.
   */
  rm(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    if (segments(path).length === 0) throw new Error('Device or resource busy');
    const parentPath = resolvePath(path, '..');
    const parent = this.nodeAt(parentPath);
    const name = lastSegment(path);
    const found =
      parent && parent.kind === 'dir' ? parent.children.find((child) => child.name === name) : undefined;
    if (!found) {
      if (opts.force) return;
      throw new Error('No such file or directory');
    }
    if (found.kind === 'dir' && !opts.recursive) throw new Error('Is a directory');
    if (parent && parent.kind === 'dir') parent.children = parent.children.filter((child) => child !== found);
    this.#flushFor(path, 'rm', (backend) => backend.rm(path, { recursive: opts.recursive === true }));
  }

  /**
   * rmdir — remove an EMPTY directory only; files and non-empty dirs
   * refuse (POSIX: `Not a directory` / `Directory not empty`).
   */
  rmdir(path: string): void {
    const node = this.nodeAt(path);
    if (!node) throw new Error('No such file or directory');
    if (node.kind !== 'dir') throw new Error('Not a directory');
    if (node.children.length > 0) throw new Error('Directory not empty');
    this.rm(path, { recursive: true }); // rm refuses dirs without it; empty check above keeps this to exactly one empty dir
  }

  /**
   * Copy the node at `src` onto `dest`. When `dest` is an existing
   * directory the copy keeps `src`'s basename inside it; otherwise the
   * last segment of `dest` names the copy. Directories need `recursive`
   * and refuse to land inside themselves. Overwriting a file is fine;
   * overwriting a directory is not.
   */
  copy(src: string, dest: string, opts: { recursive?: boolean } = {}): VfsNode {
    const node = this.nodeAt(src);
    if (!node) throw new Error('No such file or directory');
    if (node.kind === 'dir' && !opts.recursive) throw new Error(`omitting directory '${src}'`);
    if (node.kind === 'dir' && (dest === src || dest.startsWith(src + '/'))) {
      throw new Error(`cannot copy a directory into itself, '${src}' -> '${dest}'`);
    }
    const destNode = this.nodeAt(dest);
    let targetPath: string;
    let into: VfsDir;
    let cloneName: string;
    if (destNode && destNode.kind === 'dir') {
      into = destNode;
      targetPath = resolvePath(dest, node.name);
      cloneName = node.name;
    } else {
      const parentPath = resolvePath(dest, '..');
      const parent = this.nodeAt(parentPath);
      if (!parent || parent.kind !== 'dir') throw new Error(`cannot create '${dest}': No such file or directory`);
      into = parent;
      targetPath = dest;
      cloneName = lastSegment(dest);
    }
    const clone = cloneNode(node);
    clone.name = cloneName;
    const existing = into.children.find((child) => child.name === cloneName);
    if (existing && existing.kind === 'dir' && clone.kind === 'file') {
      throw new Error(`cannot overwrite directory '${targetPath}' with non-directory`);
    }
    if (existing) into.children = into.children.filter((child) => child !== existing);
    into.children.push(clone);
    if (clone.kind === 'file') {
      this.#flushFor(targetPath, 'write', (backend) => backend.write(targetPath, clone.content));
    } else {
      this.#persistDirTree(targetPath, clone, (backend) => backend.mkdirp(targetPath));
    }
    return clone;
  }

  /** Persist a freshly copied subtree: mkdir first, then every file. */
  #persistDirTree(path: string, node: VfsNode, first: (backend: VfsBackend) => Promise<void>): void {
    const backend = this.backendFor(path);
    if (!backend) return;
    this.#flush(backend, 'mkdirp', path, () => first(backend));
    if (node.kind !== 'dir') return;
    for (const child of node.children) {
      const childPath = resolvePath(path, child.name);
      if (child.kind === 'file') {
        this.#flushFor(childPath, 'write', (b) => b.write(childPath, child.content));
      } else {
        this.#persistDirTree(childPath, child, (b) => b.mkdirp(childPath));
      }
    }
  }

  /** Move (rename) a node: a copy followed by a remove. */
  rename(src: string, dest: string): void {
    const node = this.nodeAt(src);
    if (!node) throw new Error('No such file or directory');
    const recursive = node.kind === 'dir';
    this.copy(src, dest, { recursive });
    this.rm(src, { recursive });
  }
}
