/**
 * s3 backend — mount an S3 bucket (or any S3-REST-compatible store) as a
 * read/write subtree of the shell VFS. Browser-safe by construction:
 *
 *   - PUBLIC buckets: plain REST reads (ListObjectsV2 + GET). The mount
 *     is read-only — without a signer there is no way to write, and the
 *     backend refuses to pretend otherwise.
 *   - PRESIGN endpoint: every write goes `GET <endpoint>?op=put&key=<k>`
 *     → `{"url": "…"}` and the browser PUTs the short-lived presigned URL.
 *     The page's own backend mints the signatures; no AWS credential ever
 *     reaches the browser.
 *   - SIGNER callback: `core.setS3Signer((op, key) => url)` for pages
 *     that want full control; same shape as presign, supplied in JS.
 *
 * Static AWS credentials are NEVER accepted: URLs carrying an
 * AccessKey/secret are refused at mount time, and nothing in this module
 * reads configuration from markup beyond the base URL.
 *
 * Hydration is asynchronous (dirs are key prefixes; content arrives over
 * the network): the `mount` command reports `hydrating …`, then a ready
 * or error line through the core's line channel. Caps keep a huge bucket
 * from eating the page: maxObjects/maxBytes on the seeded subtree.
 *
 * The bucket MUST allow CORS for the page origin (GET + PUT + DELETE,
 * ListBucket on GET) — documented in src/terminal/PLUGINS.md.
 */

import type { S3Signer } from '../terminal-core.js';
import type { VfsBackend, VfsStat } from '../vfs.js';

export interface S3MountOptions {
  /** Object base URL, e.g. `https://s3.example.test/bucket/prefix/`. */
  base: string;
  /** Where it mounts, absolute, e.g. `/s3`. */
  mountpoint: string;
  /** Write mode: none for `public` (read-only), presign, or signer. */
  mode: 'public' | 'presign' | 'signer';
  /** Presign endpoint minting short-lived URLs (`?op=get|put|delete&key=`). */
  presignEndpoint?: string;
  /** Page-supplied signer callback (core.s3Signer). */
  signer?: S3Signer;
  /** Hydration caps. */
  maxObjects?: number;
  maxBytes?: number;
}

export interface S3Entry {
  key: string;
  size: number;
}

const DEFAULT_MAX_OBJECTS = 64;
const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Validate + normalize a bucket base URL. Throws with the reason. */
export function parseS3Base(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`s3: not a URL: "${raw}"`);
  }
  if (url.protocol !== 'https:') throw new Error('s3: only https:// bucket URLs are allowed');
  if (url.username || url.password) throw new Error('s3: credentials in URLs are never accepted');
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** ListObjectsV2 XML → entries (keys relative to the base prefix). */
export function parseS3ListXml(xml: string, baseUrl: URL): S3Entry[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entries: S3Entry[] = [];
  for (const contents of Array.from(doc.getElementsByTagName('Contents'))) {
    const key = contents.getElementsByTagName('Key')[0]?.textContent ?? '';
    const size = Number.parseInt(contents.getElementsByTagName('Size')[0]?.textContent ?? '0', 10) || 0;
    const prefix = decodeURIComponent(baseUrl.pathname).replace(/^\/[^/]+/, '').replace(/^\//, ''); // /bucket/prefix/ → prefix/
    const rel = key.startsWith('/') ? key.slice(1) : key;
    const trimmed = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    if (trimmed !== '') entries.push({ key: trimmed, size });
  }
  return entries;
}

/**
 * The backend. Reads go straight to REST; every mutation persists
 * through the Vfs's write-through flush, so the cache stays authoritative
 * and network failures surface as one stderr warning, never a broken
 * command.
 */
export class S3Backend implements VfsBackend {
  readonly id = 's3';
  readonly writable: boolean;
  readonly mountpoint: string;
  readonly base: URL;
  readonly mode: S3MountOptions['mode'];
  readonly presignEndpoint?: string;
  readonly signer?: S3Signer;
  readonly maxObjects: number;
  readonly maxBytes: number;

  constructor(opts: S3MountOptions) {
    this.base = parseS3Base(opts.base); // throws with the reason on a bad URL
    this.mountpoint = opts.mountpoint;
    this.mode = opts.mode;
    this.writable = opts.mode !== 'public';
    this.presignEndpoint = opts.presignEndpoint;
    this.signer = opts.signer;
    this.maxObjects = opts.maxObjects ?? DEFAULT_MAX_OBJECTS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Object URL for one backend-relative key. */
  #urlFor(key: string): string {
    return this.base.toString() + key.split('/').map(encodeURIComponent).join('/');
  }

  /** One signed (or plain) URL for an operation. */
  async #urlForOp(op: 'get' | 'put' | 'delete', key: string): Promise<string> {
    if (op === 'get' || this.mode === 'public') return this.#urlFor(key);
    if (this.mode === 'presign') {
      if (!this.presignEndpoint) throw new Error('s3: presign mode needs an endpoint');
      const response = await fetch(`${this.presignEndpoint}?op=${op}&key=${encodeURIComponent(key)}`);
      if (!response.ok) throw new Error(`s3: presign request failed (HTTP ${response.status})`);
      const minted = (await response.json()) as { url?: unknown };
      if (typeof minted?.url !== 'string') throw new Error('s3: presign response has no url');
      return minted.url;
    }
    const signer = this.signer;
    if (!signer) throw new Error('s3: signer mode needs core.setS3Signer(fn)');
    return await signer(op, key);
  }

  async #fetchText(url: string, init?: RequestInit): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      throw new Error(
        `s3: request failed (network/CORS): ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!response.ok) throw new Error(`s3: HTTP ${response.status} for ${url}`);
    return await response.text();
  }

  /** List entries under a backend-relative dir (immediate children only). */
  async list(path: string): Promise<Array<{ name: string; kind: 'file' | 'dir' }>> {
    const prefix = path === '/' || path === '' ? '' : path.replace(/^\/+|\/+$/g, '') + '/';
    const url = `${this.base.toString()}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
    const xml = await this.#fetchText(url);
    const entries = parseS3ListXml(xml, this.base);
    const seen = new Map<string, 'file' | 'dir'>();
    for (const entry of entries) {
      const rest = entry.key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        if (rest !== '') seen.set(rest, 'file');
      } else {
        const dir = rest.slice(0, slash);
        if (dir !== '' && !seen.has(dir)) seen.set(dir, 'dir');
      }
    }
    return Array.from(seen, ([name, kind]) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async stat(path: string): Promise<VfsStat | null> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    if (clean === '') return { kind: 'dir', size: 0 };
    const children = await this.list('/' + clean);
    if (children.length > 0) return { kind: 'dir', size: children.length };
    try {
      const text = await this.#fetchText(await this.#urlForOp('get', clean));
      return { kind: 'file', size: text.length };
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<string | null> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    try {
      return await this.#fetchText(await this.#urlForOp('get', clean));
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    const url = await this.#urlForOp('put', clean);
    await this.#fetchText(url, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: content });
  }

  async mkdirp(_path: string): Promise<void> {
    // S3 has no directories; prefixes are implicit. Nothing to do.
  }

  async rm(path: string, opts: { recursive: boolean }): Promise<void> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    if (opts.recursive) {
      const prefix = clean === '' ? '' : clean + '/';
      const url = `${this.base.toString()}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
      for (const entry of parseS3ListXml(await this.#fetchText(url), this.base)) {
        await this.#deleteKey(entry.key);
      }
      return;
    }
    await this.#deleteKey(clean);
  }

  async #deleteKey(key: string): Promise<void> {
    const url = await this.#urlForOp('delete', key);
    await this.#fetchText(url, { method: 'DELETE' });
  }

  async rename(from: string, to: string): Promise<void> {
    const fromKey = from.replace(/^\/+|\/+$/g, '');
    const toKey = to.replace(/^\/+|\/+$/g, '');
    const content = await this.read(fromKey);
    if (content === null) throw new Error(`s3: no such object: ${fromKey}`);
    await this.write(toKey, content);
    await this.#deleteKey(fromKey);
  }

  /**
   * Hydrate: seed the mount's subtree into the cache (the `mount`
   * builtin supplies the sink). Reports progress lines; caps apply.
   */
  async hydrate(
    put: (path: string, content: string) => void,
    report: (line: { kind: 'stdout' | 'stderr'; text: string }) => void,
  ): Promise<void> {
    let entries: S3Entry[];
    try {
      const url = `${this.base.toString()}?list-type=2&max-keys=1000`;
      entries = parseS3ListXml(await this.#fetchText(url), this.base);
    } catch (cause) {
      report({ kind: 'stderr', text: `s3: ${this.mountpoint}: list failed: ${cause instanceof Error ? cause.message : String(cause)}` });
      return;
    }
    let seeded = 0;
    let bytes = 0;
    let truncated = false;
    for (const entry of entries) {
      if (seeded >= this.maxObjects) {
        truncated = true;
        break;
      }
      if (entry.key.endsWith('/')) {
        continue; // dir markers are implicit prefixes — nothing to seed
      }
      if (bytes + entry.size > this.maxBytes) {
        truncated = true;
        break;
      }
      try {
        const content = await this.#fetchText(await this.#urlForOp('get', entry.key));
        put(entry.key, content);
        bytes += content.length;
        seeded++;
      } catch {
        // Unreadable object: skip it, keep hydrating the rest.
      }
    }
    const capNote = truncated ? ` (capped at ${this.maxObjects} objects / ${this.maxBytes} bytes)` : '';
    report({ kind: 'stdout', text: `s3: ${this.mountpoint} ready — ${seeded} objects hydrated${capNote}` });
  }
}

/**
 * Parse `mount s3 <url> <mountpoint>` args; return a ready backend or an
 * error message. A public base stays read-only; the signer/presign modes
 * switch on when the page supplied a signer (core.setS3Signer).
 */
export function createS3Backend(args: string[], signer?: S3Signer): S3Backend | string {
  const base = args[0];
  if (!base) return 'usage: mount s3 <https://host/bucket/prefix/> <mountpoint>';
  const mountpoint = args[1] ?? '/s3';
  if (!mountpoint.startsWith('/')) return `s3: mountpoint must be absolute: "${mountpoint}"`;
  let backend: S3Backend;
  try {
    backend = new S3Backend({
      base,
      mountpoint,
      mode: signer ? 'signer' : 'public',
      signer,
    });
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  return backend;
}
