// @vitest-environment happy-dom
// Unit spec — the durable storage backends (src/terminal/backends/)
//
// Feature: the local-storage backend
//   Scenario: first visit seeds the factory tree under a namespaced key
//   Scenario: a stored payload is grafted over the cache and user edits
//             survive into a fresh element (reload round-trip)
//   Scenario: an unreadable or wrong-version payload is corrupt — the
//             factory tree is re-seeded, not lost
//   Scenario: reset() puts the factory snapshot back and re-persists
//   Scenario: the payload is plain JSON (versioned, no eval)
//   Scenario: quota failures surface as one storage error + onError while
//             the cache stays authoritative
// Feature: the s3 backend
//   Scenario: parseS3Base normalizes a bucket URL and refuses http://,
//             credentials-in-URL, and non-URLs
//   Scenario: parseS3ListXml maps ListObjectsV2 XML to base-relative keys
//   Scenario: reads/lists/stats go straight to REST over stubbed fetch
//   Scenario: public mounts are read-only; presign and signer write flows
//             mint their URLs per operation
//   Scenario: rm deletes one key, or lists + deletes a prefix recursively
//   Scenario: hydrate seeds objects into the cache with caps and reports
//   Scenario: createS3Backend validates its args and picks the mode

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Vfs } from '../../src/terminal/vfs.js';
import {
  STORAGE_KEY_PREFIX,
  attachLocalStorage,
  type KeyValueStore,
} from '../../src/terminal/backends/local-storage.js';
import {
  S3Backend,
  createS3Backend,
  parseS3Base,
  parseS3ListXml,
} from '../../src/terminal/backends/s3.js';
import type { S3Signer } from '../../src/terminal/terminal-core.js';

/** In-memory KeyValueStore double with quota simulation. */
class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  writes = 0;
  failNext = false;
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.failNext) throw new Error('QuotaExceededError: DOM Exception 22');
    this.data.set(key, value);
    this.writes += 1;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A factory tree every scenario starts from. */
function factoryVfs(): Vfs {
  const vfs = new Vfs();
  vfs.mountFile('/docs/readme.txt', 'factory readme\n');
  vfs.mountFile('/docs/nested/deep.txt', 'factory deep\n');
  return vfs;
}

describe('the local-storage backend', () => {
  it('first visit seeds the factory tree under a namespaced key', () => {
    const store = new MemoryStore();
    const vfs = factoryVfs();
    const backend = attachLocalStorage(vfs, { key: 'demo', store });
    expect(backend.storageKey).toBe(STORAGE_KEY_PREFIX + 'demo');
    expect(backend.restore()).toBe('seeded');
    const raw = store.getItem(backend.storageKey);
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw as string) as { version: number; tree: { name: string; children: unknown[] } };
    expect(payload.version).toBe(1);
    expect(payload.tree.name).toBe(''); // the root node is unnamed
    expect(payload.tree.children.map((c) => (c as { name: string }).name)).toEqual(['docs']);
  });

  it('a stored payload grafts over the cache; edits survive a reload round-trip', () => {
    const store = new MemoryStore();
    const first = factoryVfs();
    const firstBackend = attachLocalStorage(first, { key: 'k', store });
    expect(firstBackend.restore()).toBe('seeded');
    first.mountFile('/notes/user.txt', 'typed by the user');

    const second = factoryVfs();
    const secondBackend = attachLocalStorage(second, { key: 'k', store });
    expect(secondBackend.restore()).toBe('restored');
    expect(second.read('/notes/user.txt')).toBe('typed by the user');
    expect(second.read('/docs/readme.txt')).toBe('factory readme\n'); // factory survives too
  });

  it('an unreadable or wrong-version payload is corrupt; the factory tree is re-seeded', () => {
    const store = new MemoryStore();
    store.data.set(STORAGE_KEY_PREFIX + 'k', '{ this is not json');
    const vfs = factoryVfs();
    const backend = attachLocalStorage(vfs, { key: 'k', store });
    expect(backend.restore()).toBe('corrupt');
    expect(vfs.list('/docs')).toHaveLength(2); // factory content intact
    expect(() => JSON.parse(store.getItem(backend.storageKey) as string)).not.toThrow(); // re-seeded valid

    const store2 = new MemoryStore();
    store2.data.set(
      STORAGE_KEY_PREFIX + 'k',
      JSON.stringify({ version: 99, tree: { kind: 'dir', name: '/', children: [] } }),
    );
    const vfs2 = factoryVfs();
    expect(attachLocalStorage(vfs2, { key: 'k', store: store2 }).restore()).toBe('corrupt');
    expect(vfs2.list('/docs')).toHaveLength(2);
  });

  it('reset() restores the factory snapshot and re-persists it', () => {
    const store = new MemoryStore();
    const vfs = factoryVfs();
    const backend = attachLocalStorage(vfs, { key: 'k', store });
    backend.restore();
    vfs.mountFile('/temp/scratch.txt', 'to be wiped');
    const message = backend.reset();
    expect(message).toContain('factory content restored');
    expect(vfs.nodeAt('/temp')).toBeNull();
    expect(vfs.list('/docs')).toHaveLength(2);
    const payload = JSON.parse(store.getItem(backend.storageKey) as string) as { tree: { children: unknown[] } };
    expect(payload.tree.children).toHaveLength(1); // just docs/
  });

  it('quota failures surface as one storage error + onError; the cache stays authoritative', async () => {
    const store = new MemoryStore();
    const vfs = factoryVfs();
    const backend = attachLocalStorage(vfs, { key: 'k', store });
    backend.restore();
    const seen: string[] = [];
    vfs.onError = (error) => seen.push(`${error.backend}:${error.op}:${error.path}`);
    store.failNext = true;
    vfs.mountFile('/late.txt', 'written anyway');
    await settled();
    expect(vfs.storageErrors).toHaveLength(1);
    expect(seen).toEqual(['local-storage:write:/late.txt']);
    expect(vfs.read('/late.txt')).toBe('written anyway'); // the cache keeps the truth
  });
});

/** Plain-object Response double (only ok/status/text are consumed). */
const ok = (text: string): Response =>
  ({ ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }) as unknown as Response;
const notFound = (): Response => ({ ok: false, status: 404, text: async () => 'nope' }) as unknown as Response;

/** Route stubbed fetch calls to a handler; records every (url, init). */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | undefined): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init) ?? notFound();
    },
  );
  return calls;
}

const BASE = 'https://s3.example.test/bucket/prefix/';
const listXml = (keys: Array<[string, number]>): string =>
  `<?xml version="1.0"?><ListBucketResult>` +
  keys.map(([k, s]) => `<Contents><Key>${k}</Key><Size>${s}</Size></Contents>`).join('') +
  `</ListBucketResult>`;

describe('the s3 backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parseS3Base normalizes the URL and refuses http://, credentials, and non-URLs', () => {
    const url = parseS3Base('https://h.example.test/bucket?q=1#frag');
    expect(url.toString()).toBe('https://h.example.test/bucket/');
    expect(() => parseS3Base('http://h.example.test/bucket/')).toThrow('only https://');
    expect(() => parseS3Base('https://user:pass@h.example.test/bucket/')).toThrow('credentials in URLs are never accepted');
    expect(() => parseS3Base('not a url at all')).toThrow('not a URL');
  });

  it('parseS3ListXml maps ListObjectsV2 XML to base-relative keys', () => {
    const base = new URL(BASE);
    const entries = parseS3ListXml(listXml([['prefix/a.txt', 3], ['prefix/sub/b.md', 7], ['prefix/', 0], ['outside.txt', 1]]), base);
    expect(entries.map((entry) => entry.key)).toEqual(['a.txt', 'sub/b.md', 'outside.txt']);
    expect(entries[0]?.size).toBe(3);
  });

  it('reads, lists, and stats go straight to REST over stubbed fetch', async () => {
    const objects = new Map([
      ['docs/a.txt', 'A'],
      ['docs/sub/b.md', 'B'],
      ['docs/z.txt', 'Z'],
      ['other.txt', 'O'],
    ]);
    const calls = stubFetch((url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.has('list-type')) {
        const prefix = parsed.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
        return ok(listXml(keys.map((key) => ['prefix/' + key, 1] as [string, number])));
      }
      const base = new URL(BASE);
      const content = objects.get(decodeURIComponent(parsed.pathname.slice(base.pathname.length)));
      return content === undefined ? undefined : ok(content);
    });
    const backend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public' });
    expect(await backend.read('/docs/a.txt')).toBe('A');
    expect(await backend.read('/ghost.txt')).toBeNull();
    expect(await backend.list('/docs')).toEqual([
      { name: 'a.txt', kind: 'file' },
      { name: 'sub', kind: 'dir' },
      { name: 'z.txt', kind: 'file' },
    ]);
    expect(await backend.stat('/docs')).toEqual({ kind: 'dir', size: 3 });
    expect(await backend.stat('/docs/a.txt')).toEqual({ kind: 'file', size: 1 });
    expect(await backend.stat('/ghost')).toBeNull();
    const listCall = calls.find((call) => call.url.includes('list-type=2'));
    expect(listCall?.url).toContain('prefix=docs%2F');
  });

  it('public mounts refuse writes; presign and signer mint per-operation URLs', async () => {
    const publicBackend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public' });
    expect(publicBackend.writable).toBe(false);

    const presignCalls = stubFetch((url) => {
      if (url.startsWith('https://auth.example.test/presign?op=put')) return ok(JSON.stringify({ url: 'https://signed.example.test/put?sig=1' }));
      if (url === 'https://signed.example.test/put?sig=1') return ok('');
      return undefined;
    });
    const presignBackend = new S3Backend({
      base: BASE,
      mountpoint: '/s3',
      mode: 'presign',
      presignEndpoint: 'https://auth.example.test/presign',
    });
    expect(presignBackend.writable).toBe(true);
    await presignBackend.write('docs/a.txt', 'A');
    expect(presignCalls[0]?.url).toBe('https://auth.example.test/presign?op=put&key=docs%2Fa.txt');
    expect(presignCalls[1]?.url).toBe('https://signed.example.test/put?sig=1');
    expect(presignCalls[1]?.init?.method).toBe('PUT');

    const signed: Array<[string, string]> = [];
    const signer: S3Signer = async (op: string, key: string) => {
      signed.push([op, key]);
      return `https://signed.example.test/${op}/${key}?sig=2`;
    };
    const signerCalls = stubFetch((url) => (url.includes('sig=2') ? ok('') : undefined));
    const signerBackend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'signer', signer });
    await signerBackend.write('docs/b.txt', 'B');
    expect(signed).toEqual([['put', 'docs/b.txt']]);
    expect(signerCalls[0]?.init?.method).toBe('PUT');
  });

  it('a failed presign surfaces as a storage error through the vfs', async () => {
    stubFetch(() => notFound());
    const vfs = new Vfs();
    const backend = new S3Backend({
      base: BASE,
      mountpoint: '/s3',
      mode: 'presign',
      presignEndpoint: 'https://auth.example.test/presign',
    });
    vfs.attachBackend(backend);
    vfs.mountFile('/s3/x.txt', 'X');
    await settled();
    expect(vfs.storageErrors.length).toBe(1);
    expect(vfs.read('/s3/x.txt')).toBe('X');
  });

  it('rm deletes one key, or lists + deletes a whole prefix recursively', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('list-type=2')) return ok(listXml([['prefix/old/a.txt', 1], ['prefix/old/b.txt', 1]]));
      return ok('');
    });
    const backend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public' });
    await backend.rm('old.txt', { recursive: false });
    let deletes = calls.filter((call) => call.init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url).toBe(BASE + 'old.txt');

    calls.length = 0; // count only the recursive leg
    await backend.rm('old', { recursive: true });
    deletes = calls.filter((call) => call.init?.method === 'DELETE');
    expect(deletes.map((call) => call.url)).toEqual([BASE + 'old/a.txt', BASE + 'old/b.txt']);
  });

  it('hydrate seeds the cache with caps, skipping unreadable objects', async () => {
    const calls = stubFetch((url) => {
      if (url === BASE + '?list-type=2&max-keys=1000') return ok(listXml([['prefix/a.txt', 10], ['prefix/sub/', 0], ['prefix/b.txt', 10], ['prefix/c.txt', 10]]));
      if (url === BASE + 'a.txt') return ok('content-a');
      if (url === BASE + 'b.txt') return ok('content-b');
      if (url === BASE + 'c.txt') return ok('content-c');
      return undefined;
    });
    const backend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public', maxObjects: 2 });
    const put = vi.fn();
    const report: Array<{ kind: string; text: string }> = [];
    await backend.hydrate(put, (line) => report.push(line));
    expect(put.mock.calls).toEqual([['a.txt', 'content-a'], ['b.txt', 'content-b']]);
    expect(report[0]?.kind).toBe('stdout');
    expect(report[0]?.text).toContain('2 objects hydrated (capped at 2 objects');

    const byteBackend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public', maxBytes: 15 });
    const bytePut = vi.fn();
    const byteReport: Array<{ kind: string; text: string }> = [];
    await byteBackend.hydrate(bytePut, (line) => byteReport.push(line));
    expect(bytePut).toHaveBeenCalledTimes(1); // the second object would exceed 15 bytes
    expect(byteReport[0]?.text).toContain('capped at 64 objects / 15 bytes');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('a failed list reports stderr and hydrate ends without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('CORS blocked');
      }),
    );
    const backend = new S3Backend({ base: BASE, mountpoint: '/s3', mode: 'public' });
    const report: Array<{ kind: string; text: string }> = [];
    await expect(backend.hydrate(vi.fn(), (line) => report.push(line))).resolves.toBeUndefined();
    expect(report).toHaveLength(1);
    expect(report[0]?.kind).toBe('stderr');
    expect(report[0]?.text).toContain('list failed');
  });

  it('createS3Backend validates args and picks the mode', () => {
    expect(createS3Backend([])).toBe('usage: mount s3 <https://host/bucket/prefix/> <mountpoint>');
    expect(createS3Backend([BASE, 'relative'])).toBe('s3: mountpoint must be absolute: "relative"');
    expect(createS3Backend(['http://h.example.test/b/'])).toContain('only https://');
    const signer: S3Signer = async () => 'https://signed.example.test/x';
    const signedBackend = createS3Backend([BASE, '/s3'], signer);
    expect(typeof signedBackend).toBe('object');
    if (typeof signedBackend !== 'string') {
      expect(signedBackend.mode).toBe('signer');
      expect(signedBackend.writable).toBe(true);
    }
    const publicBackend = createS3Backend([BASE]);
    if (typeof publicBackend !== 'string') {
      expect(publicBackend.mode).toBe('public');
      expect(publicBackend.writable).toBe(false);
    }
  });
});
