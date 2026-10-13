// Unit spec — the virtual file system plugins mount into (src/terminal/vfs.ts)
//
// Feature: POSIX-style path resolution over the in-memory tree
//   Scenario: relative paths resolve against the cwd
//   Scenario: absolute paths escape the cwd
//   Scenario: `..` pops, clamped at the root; `.` and empty segments collapse
//   Scenario: empty input resolves to the cwd itself
// Feature: mounting
//   Scenario: a fresh Vfs is empty
//   Scenario: mountFile creates intermediate directories
//   Scenario: remounting a path replaces its content (last write wins)
//   Scenario: relative and `..` mount paths are refused; walking through a file is refused
// Feature: tree mutations
//   Scenario: mkdir makes parents on demand; duplicates refuse
//   Scenario: touch creates empty files and leaves existing nodes alone
//   Scenario: rm removes files and trees (recursive, force); the root stays
//   Scenario: rmdir takes only empty directories
//   Scenario: copy keeps the basename in a dir target, needs recursive for
//             dirs, refuses to land inside itself
//   Scenario: rename moves a node under the new path and nowhere else
// Feature: durable backends
//   Scenario: the longest mountpoint covers a path; `/` covers the rest
//   Scenario: every mutation flushes to the covering backend
//   Scenario: a failing flush records a VfsStorageError and fires onError
//   Scenario: write operations against a read-only backend are skipped

import { describe, it, expect } from 'vitest';
import { resolvePath, Vfs, type VfsBackend, type VfsStat } from '../../src/terminal/vfs.js';

describe('resolvePath', () => {
  it('resolves relative paths against the cwd', () => {
    expect(resolvePath('/', 'demo')).toBe('/demo');
    expect(resolvePath('/demo', 'quiz.html')).toBe('/demo/quiz.html');
  });

  it('absolute paths escape the cwd', () => {
    expect(resolvePath('/demo', '/README.md')).toBe('/README.md');
  });

  it('pops `..`, clamped at the root, and collapses `.` and empty segments', () => {
    expect(resolvePath('/demo', '..')).toBe('/');
    expect(resolvePath('/demo', '../demo/quiz.html')).toBe('/demo/quiz.html');
    expect(resolvePath('/a/b', '../../..')).toBe('/');
    expect(resolvePath('/', '.')).toBe('/');
    expect(resolvePath('/a', 'b//c/')).toBe('/a/b/c');
  });

  it('empty input resolves to the cwd itself', () => {
    expect(resolvePath('/', '')).toBe('/');
    expect(resolvePath('/demo', '')).toBe('/demo');
  });
});

describe('Vfs mounting', () => {
  it('a fresh Vfs is empty', () => {
    const vfs = new Vfs();
    expect(vfs.nodeAt('/')).not.toBeNull();
    expect(vfs.list('/')).toEqual([]);
    expect(vfs.read('/README.md')).toBeNull();
  });

  it('mountFile creates intermediate directories', () => {
    const vfs = new Vfs();
    vfs.mountFile('/demo/nested/doc.html', 'x');
    expect(vfs.nodeAt('/demo/nested')?.kind).toBe('dir');
    expect(vfs.read('/demo/nested/doc.html')).toBe('x');
  });

  it('remounting a path replaces its content (last write wins)', () => {
    const vfs = new Vfs();
    vfs.mountFile('/demo/doc.html', 'one');
    vfs.mountFile('/demo/doc.html', 'two');
    expect(vfs.read('/demo/doc.html')).toBe('two');
    expect(vfs.list('/demo')).toHaveLength(1);
  });

  it('refuses relative and `..` mount paths, and walking through a file', () => {
    const vfs = new Vfs();
    expect(() => vfs.mountFile('demo/doc.html', 'x')).toThrow(/absolute/);
    expect(() => vfs.mountFile('/a/../doc.html', 'x')).toThrow(/\.\./);
    expect(() => vfs.mountFile('/', 'x')).toThrow(/root/);
    vfs.mountFile('/f.txt', 'x');
    expect(() => vfs.mountFile('/f.txt/child', 'x')).toThrow(/walks through a file/);
    expect(() => vfs.mountFile('/f.txt', 'ok')).not.toThrow(); // file overwrite is fine
  });
});

/** Backend double that records ops; failOn turns chosen ops into failures. */
class MemoryBackend implements VfsBackend {
  readonly ops: Array<{ op: string; path: string }> = [];
  constructor(
    readonly id: string,
    readonly mountpoint: string,
    readonly writable = true,
    private readonly failOn: (op: string, path: string) => boolean = () => false,
  ) {}

  #record(op: string, path: string): void {
    this.ops.push({ op, path });
    if (this.failOn(op, path)) throw new Error('disk on fire');
  }

  async stat(): Promise<VfsStat | null> {
    return null;
  }
  async read(): Promise<string | null> {
    return null;
  }
  async write(path: string): Promise<void> {
    this.#record('write', path);
  }
  async mkdirp(path: string): Promise<void> {
    this.#record('mkdirp', path);
  }
  async rm(path: string): Promise<void> {
    this.#record('rm', path);
  }
  async rename(from: string): Promise<void> {
    this.#record('rename', from);
  }
  async list(): Promise<Array<{ name: string; kind: 'file' | 'dir' }>> {
    return [];
  }
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('tree mutations', () => {
  it('mkdir makes parents on demand; duplicates refuse; touch is idempotent', () => {
    const vfs = new Vfs();
    expect(vfs.mkdir('/a/b/c', { parents: true }).kind).toBe('dir');
    vfs.mkdir('/a/b/c', { parents: true }); // -p never complains about existing
    vfs.touch('/a/file.txt');
    expect(() => vfs.mkdir('/a/file.txt', { parents: true })).toThrow('File exists'); // a file is never ok
    expect(() => vfs.mkdir('/x/y')).toThrow('No such file or directory');
    vfs.touch('/a/b/note.txt');
    expect(vfs.read('/a/b/note.txt')).toBe('');
    vfs.mountFile('/a/b/note.txt', 'words');
    vfs.touch('/a/b/note.txt'); // existing content untouched
    expect(vfs.read('/a/b/note.txt')).toBe('words');
  });

  it('rm removes files and trees; force forgives; the root stays', () => {
    const vfs = new Vfs();
    vfs.mountFile('/d/f.txt', 'x');
    vfs.mountFile('/d/sub/g.txt', 'y');
    expect(() => vfs.rm('/d')).toThrow('Is a directory');
    vfs.rm('/d/f.txt');
    expect(vfs.nodeAt('/d/f.txt')).toBeNull();
    vfs.rm('/gone.txt', { force: true });
    expect(() => vfs.rm('/gone.txt')).toThrow('No such file or directory');
    vfs.rm('/d', { recursive: true });
    expect(vfs.nodeAt('/d')).toBeNull();
    expect(() => vfs.rm('/')).toThrow('Device or resource busy');
    expect(vfs.nodeAt('/')).not.toBeNull();
  });

  it('rmdir takes only empty directories', () => {
    const vfs = new Vfs();
    vfs.mountFile('/keep/child.txt', 'x');
    vfs.mkdir('/empty');
    vfs.rmdir('/empty');
    expect(vfs.nodeAt('/empty')).toBeNull();
    expect(() => vfs.rmdir('/keep')).toThrow('Directory not empty');
    expect(() => vfs.rmdir('/keep/child.txt')).toThrow('Not a directory');
    expect(() => vfs.rmdir('/ghost')).toThrow('No such file or directory');
  });

  it('copy keeps the basename in a dir target; trees need recursive; self-copies refuse', () => {
    const vfs = new Vfs();
    vfs.mountFile('/src/a.txt', 'A');
    vfs.mkdir('/dest');
    vfs.copy('/src/a.txt', '/dest');
    expect(vfs.read('/dest/a.txt')).toBe('A');
    expect(() => vfs.copy('/src', '/elsewhere')).toThrow(/omitting directory/);
    vfs.copy('/src', '/tree', { recursive: true });
    expect(vfs.read('/tree/a.txt')).toBe('A');
    expect(() => vfs.copy('/tree', '/tree/inner', { recursive: true })).toThrow(/into itself/);
    expect(() => vfs.copy('/ghost.txt', '/out.txt')).toThrow('No such file or directory');
  });

  it('rename moves the node; the old path goes dark', () => {
    const vfs = new Vfs();
    vfs.mountFile('/old.txt', 'data');
    vfs.rename('/old.txt', '/new.txt');
    expect(vfs.nodeAt('/old.txt')).toBeNull();
    expect(vfs.read('/new.txt')).toBe('data');
  });
});

describe('durable backends', () => {
  it('the longest mountpoint covers a path; `/` covers everything else', () => {
    const vfs = new Vfs();
    const rootBackend = new MemoryBackend('root', '/');
    const mediaBackend = new MemoryBackend('media', '/media');
    vfs.attachBackend(rootBackend);
    vfs.attachBackend(mediaBackend);
    expect(vfs.backendFor('/media/a.txt')).toBe(mediaBackend);
    expect(vfs.backendFor('/media')).toBe(mediaBackend);
    expect(vfs.backendFor('/elsewhere')).toBe(rootBackend);
    expect(vfs.detachBackend('/media')).toBe(true);
    expect(vfs.backendFor('/media/a.txt')).toBe(rootBackend);
  });

  it('every mutation flushes to the covering backend', async () => {
    const vfs = new Vfs();
    const backend = new MemoryBackend('store', '/');
    vfs.attachBackend(backend);
    vfs.mountFile('/docs/a.txt', 'A'); // write
    vfs.mkdir('/docs/deep'); // mkdirp
    vfs.rm('/docs/a.txt'); // rm
    vfs.rename('/docs/deep', '/docs/lower'); // rename
    await settled();
    // rename is copy + rm on the wire: mkdirp for the target path, rm for the source
    expect(backend.ops.map((entry) => entry.op)).toEqual(['write', 'mkdirp', 'rm', 'mkdirp', 'rm']);
  });

  it('a failing flush records a storage error and fires onError', async () => {
    const vfs = new Vfs();
    const backend = new MemoryBackend('brittle', '/', true, (op) => op === 'write');
    const seen: string[] = [];
    vfs.onError = (error) => seen.push(`${error.backend}:${error.op}:${error.path}:${error.message}`);
    vfs.attachBackend(backend);
    vfs.mountFile('/x.txt', 'boom');
    await settled();
    expect(seen).toEqual(['brittle:write:/x.txt:disk on fire']);
    expect(vfs.storageErrors).toHaveLength(1);
    expect(vfs.storageErrors[0]?.mountpoint).toBe('/');
    expect(vfs.read('/x.txt')).toBe('boom'); // the cache stays authoritative
  });

  it('write operations against a read-only backend are skipped', async () => {
    const vfs = new Vfs();
    const backend = new MemoryBackend('ro', '/', false);
    vfs.attachBackend(backend);
    vfs.mountFile('/x.txt', 'quiet');
    vfs.mkdir('/y');
    await settled();
    expect(backend.ops).toEqual([]); // nothing attempted
    expect(vfs.storageErrors).toHaveLength(0); // and nothing reported
    expect(vfs.nodeAt('/y')?.kind).toBe('dir'); // the in-memory tree still works
  });
});
