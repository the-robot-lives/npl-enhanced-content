/**
 * editor/io/store — `EditorStore` over the sem-shell VFS (EDITOR.md §12).
 *
 * The Vfs (`src/terminal/vfs.ts`) is the sem-shell's sync cache with
 * pluggable durable backends; io mounts documents into it and open/save go
 * through whatever backend the host attached (localStorage today, S3 when
 * the user opts in). Nothing here edits the terminal modules — import only.
 *
 * Factories:
 *  - `memoryStore()`   — a bare Vfs, no backend: session-only (tests, scratch).
 *  - `localStorageStore(key)` — the shell's whole-tree localStorage backend
 *    (`semtext:shell:v1:<key>`); every write re-persists the tree.
 *  - `s3Store(args)`   — async; LAZY-imports `backends/s3.js` so the editor
 *    bundle never carries the OIDC/session machinery until a host actually
 *    opens an S3 store (local-first + budget). Invalid args reject with the
 *    backend's own usage string, before any network call.
 */

import { Vfs, resolvePath, type VfsBackend } from '../../terminal/vfs.js';
import { attachLocalStorage, type KeyValueStore } from '../../terminal/backends/local-storage.js';
import type { EditorStore, FileInfo } from './types.js';

export interface StoreOptions {
  /** All paths resolve under this dir (default `/`). */
  root?: string;
  /** Store id (default derived from the factory). */
  id?: string;
}

function normalize(root: string, path: string): string {
  // The root is a SCOPE, not a cwd: inputs already under it pass through
  // (list() results round-trip), anything else joins under it, and `..`
  // climbs clamp at the scope instead of escaping it.
  const r = resolvePath('/', root);
  const p = resolvePath('/', path);
  if (p === r || p.startsWith(r + '/')) return p;
  return resolvePath('/', r + '/' + p);
}

/** The generic Vfs-backed store. `vfs` may already carry backends. */
export function vfsEditorStore(vfs: Vfs, opts?: StoreOptions): EditorStore {
  const root = opts?.root ?? '/';
  const id = opts?.id ?? (vfs.mounts.size > 0 ? [...vfs.mounts.values()][0]!.id : 'memory');
  return {
    id,
    async read(path: string): Promise<string> {
      const at = normalize(root, path);
      const node = vfs.nodeAt(at);
      if (node === null) throw new Error(`io: no such file: ${path}`);
      if (node.kind !== 'file') throw new Error(`io: is a directory: ${path}`);
      return node.content;
    },
    async write(path: string, source: string): Promise<void> {
      // mountFile creates intermediate dirs, replaces files, and flushes
      // write-through to the backend covering the path (never throws on
      // backend failure — the cache stays correct, vfs.storageErrors grows).
      vfs.mountFile(normalize(root, path), source);
    },
    async list(dir?: string): Promise<FileInfo[]> {
      const at = dir === undefined ? root : normalize(root, dir);
      return vfs.list(at).map((node) => ({
        name: node.name,
        kind: node.kind,
        path: joinName(at, node.name), // `at` is already absolute + scoped
        ...(node.kind === 'file' ? { size: node.content.length } : {}),
      }));
    },
    async delete(path: string): Promise<void> {
      // rm throws on missing paths (no force) and on dirs without recursive;
      // recursive covers the subtree case.
      vfs.rm(normalize(root, path), { recursive: true });
    },
  };
}

function joinName(dir: string, name: string): string {
  return dir === '' || dir === '/' ? `/${name}` : `${dir}/${name}`;
}

/** Session-only store: a bare Vfs (nothing persists, nothing leaks). */
export function memoryStore(opts?: StoreOptions): EditorStore {
  return vfsEditorStore(new Vfs(), { id: 'memory', ...opts });
}

/**
 * localStorage store: the shell's whole-tree backend under
 * `semtext:shell:v1:<key>` — the same tree `sem-terminal` restores, so
 * documents saved here show up in the shell's filesystem and vice versa.
 */
export function localStorageStore(
  key: string,
  opts?: StoreOptions & { store?: KeyValueStore },
): EditorStore {
  const vfs = new Vfs();
  attachLocalStorage(vfs, { key, store: opts?.store });
  return vfsEditorStore(vfs, { id: 'local-storage', ...opts });
}

/**
 * S3 store: lazy-import the backend (keeps s3-auth's OIDC machinery out of
 * the editor bundle until an S3 mount is actually requested), validate the
 * mount args (rejects with the backend's usage string — before any network),
 * attach at the backend's declared mountpoint.
 */
export async function s3Store(
  args: string[],
  opts?: StoreOptions,
): Promise<EditorStore> {
  const mod = await import('../../terminal/backends/s3.js');
  const created: VfsBackend | string = mod.createS3Backend(args);
  if (typeof created === 'string') throw new Error(`io: s3 store rejected — ${created}`);
  const vfs = new Vfs();
  vfs.attachBackend(created);
  return vfsEditorStore(vfs, { id: 's3', ...opts, root: opts?.root ?? created.mountpoint });
}
