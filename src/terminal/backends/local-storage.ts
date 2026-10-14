/**
 * local-storage backend — whole-tree persistence for the shell VFS in the
 * browser's localStorage (or any KeyValueStore test double).
 *
 * Shape: the ENTIRE tree is serialized under one versioned key
 * (`semtext:shell:v1:<key>`) and re-written on every flush — snapshots,
 * not deltas, so a failed flush heals on the next write. Wiring:
 *
 *   const backend = attachLocalStorage(core.vfs, { key });   // writes flow
 *   queueMicrotask(() => {
 *     const outcome = backend.restore();                     // after plugins mount
 *     //  'seeded'   — first visit: factory state persisted as-is
 *     //  'restored' — prior visit: stored tree grafted over the cache
 *     //  'corrupt'  — payload unreadable: warned + re-seeded
 *   });
 *
 * `restore()` also captures the pristine (factory) snapshot it saw, so
 * `backend.reset()` puts the factory content back and re-persists it —
 * that is what the `storage reset` command calls.
 *
 * Quota errors are NEVER swallowed here: setItem throws, the Vfs records
 * the failed flush (vfs.storageErrors) and prints one stderr warning, and
 * the in-memory cache stays correct. No eval anywhere — the payload is a
 * plain JSON tree.
 */

import type { Vfs } from '../vfs.js';
import { cloneNode, type VfsBackend, type VfsDir, type VfsNode, type VfsStat } from '../vfs.js';

/** Key namespace: versioned so a format change never reads old payloads. */
export const STORAGE_KEY_PREFIX = 'semtext:shell:v1:';

const PAYLOAD_VERSION = 1;

/** Minimal storage surface (window.localStorage or a test double). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredNode {
  kind: 'file' | 'dir';
  name: string;
  content?: string;
  children?: StoredNode[];
}

interface StoredPayload {
  version: number;
  tree: StoredNode;
}

/** Serialize a tree to the stored JSON shape (plain data, no eval). */
export function serializeTree(root: VfsDir): string {
  const encode = (node: VfsNode): StoredNode =>
    node.kind === 'file'
      ? { kind: 'file', name: node.name, content: node.content }
      : { kind: 'dir', name: node.name, children: node.children.map(encode) };
  const payload: StoredPayload = { version: PAYLOAD_VERSION, tree: encode(root) };
  return JSON.stringify(payload);
}

/** Parse a stored payload; null when anything about it is off. */
function parseTree(text: string): VfsNode[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  const decode = (value: unknown, depth: number): VfsNode | null => {
    if (depth > 32 || typeof value !== 'object' || value === null) return null;
    const node = value as StoredNode;
    if (node.kind !== 'file' && node.kind !== 'dir') return null;
    if (typeof node.name !== 'string' || (node.name === '' && depth > 0) || node.name.includes('/')) return null;
    if (node.kind === 'file') {
      if (typeof node.content !== 'string') return null;
      return { kind: 'file', name: node.name, content: node.content };
    }
    if (!Array.isArray(node.children)) return null;
    const children: VfsNode[] = [];
    for (const child of node.children) {
      const decoded = decode(child, depth + 1);
      if (!decoded) return null;
      children.push(decoded);
    }
    return { kind: 'dir', name: node.name, children };
  };
  const root = payload as StoredPayload | null;
  if (typeof root !== 'object' || root === null) return null;
  if (root.version !== PAYLOAD_VERSION) return null;
  const tree = decode(root.tree, 0);
  if (!tree || tree.kind !== 'dir') return null;
  return tree.children;
}

/**
 * The localStorage backend. Reads answer from the live tree getter (the
 * Vfs cache is authoritative); every write re-persists the whole tree.
 */
export class LocalStorageBackend implements VfsBackend {
  readonly id = 'local-storage';
  readonly writable = true;
  readonly key: string;
  readonly mountpoint: string;
  #store: KeyValueStore;
  #getTree: () => VfsDir;
  /** Factory snapshot captured by restore(), for reset(). */
  #pristine: VfsNode[] | null = null;

  constructor(store: KeyValueStore, key: string, getTree: () => VfsDir, mountpoint = '/') {
    this.#store = store;
    this.key = key;
    this.#getTree = getTree;
    this.mountpoint = mountpoint;
  }

  /** The full storage key for this shell. */
  get storageKey(): string {
    return STORAGE_KEY_PREFIX + this.key;
  }

  /** Re-persist the whole tree. Throws on quota errors (Vfs reports them). */
  #persist(): void {
    this.#store.setItem(this.storageKey, serializeTree(this.#getTree()));
  }

  #nodeAt(path: string): VfsNode | null {
    let node: VfsNode = this.#getTree();
    for (const part of path.split('/').filter((p) => p !== '')) {
      if (node.kind !== 'dir') return null;
      const next: VfsNode | undefined = node.children.find((child) => child.name === part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  stat(path: string): Promise<VfsStat | null> {
    const node = this.#nodeAt(path);
    if (!node) return Promise.resolve(null);
    return Promise.resolve(
      node.kind === 'file'
        ? { kind: 'file', size: node.content.length }
        : { kind: 'dir', size: node.children.length },
    );
  }

  read(path: string): Promise<string | null> {
    const node = this.#nodeAt(path);
    return Promise.resolve(node && node.kind === 'file' ? node.content : null);
  }

  async write(_path: string, _content: string): Promise<void> {
    await this.#persist();
  }

  async mkdirp(_path: string): Promise<void> {
    await this.#persist();
  }

  async rm(_path: string, _opts: { recursive: boolean }): Promise<void> {
    await this.#persist();
  }

  async rename(_from: string, _to: string): Promise<void> {
    await this.#persist();
  }

  list(path: string): Promise<Array<{ name: string; kind: 'file' | 'dir' }>> {
    const node = this.#nodeAt(path);
    const children = node && node.kind === 'dir' ? node.children : [];
    return Promise.resolve(children.map((child) => ({ name: child.name, kind: child.kind })));
  }

  /**
   * Seed or restore. 'seeded': first visit — the current (factory) tree
   * is persisted as-is. 'restored': a stored payload grafted over the
   * cache; user edits survive the reload. 'corrupt': unreadable payload
   * — the caller should warn, and the factory tree is re-seeded over it.
   * Either way the pristine factory snapshot is kept for reset().
   */
  /** The stored payload, if any — peek without touching the tree. */
  peekStored(): string | null {
    return this.#store.getItem(this.storageKey);
  }

  restore(preRead?: string | null): 'seeded' | 'restored' | 'corrupt' {
    const tree = this.#getTree();
    this.#pristine = tree.children.map(cloneNode); // factory snapshot, for reset()
    const stored = preRead !== undefined ? preRead : this.#store.getItem(this.storageKey);
    if (stored === null) {
      this.#persist();
      return 'seeded';
    }
    const restored = parseTree(stored);
    if (!restored) {
      this.#persist();
      return 'corrupt';
    }
    tree.children = restored;
    this.#persist();
    return 'restored';
  }

  /** Put the factory snapshot back (what `storage reset` calls). */
  reset(): string {
    if (!this.#pristine) {
      // restore() was never called — treat the current tree as pristine.
      this.#pristine = this.#getTree().children.map(cloneNode);
    }
    const tree = this.#getTree();
    tree.children = (this.#pristine ?? []).map(cloneNode);
    this.#persist();
    return `storage reset: factory content restored (${tree.children.length} top-level entries)`;
  }
}

/**
 * Attach local-storage persistence to a Vfs. The backend starts flushing
 * immediately; call `backend.restore()` once plugins have mounted
 * (a microtask after connect is the right moment) to seed or restore.
 */
export function attachLocalStorage(
  vfs: Vfs,
  opts: { key: string; store?: KeyValueStore; mountpoint?: string },
): LocalStorageBackend {
  const backend = new LocalStorageBackend(opts.store ?? globalThis.localStorage, opts.key, () => vfs.root);
  vfs.attachBackend(backend);
  return backend;
}
