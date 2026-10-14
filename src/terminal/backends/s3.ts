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
 *   - OIDC ("self-hosted cognito style"): authorization-code + PKCE
 *     against a configurable issuer, ID token → `AssumeRoleWithWebIdentity`
 *     at a configurable STS endpoint → short-lived credentials; every
 *     request is SigV4-signed in the browser (see s3-auth.ts / sigv4.ts).
 *     Only the TEMPORARY credential set is stored (session/localStorage,
 *     per-mount, expiry-checked); static keys stay refused everywhere.
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
import {
  OidcSession,
  S3SessionStore,
  StsClient,
  SESSION_REFRESH_LEAD_MS,
  waitForAuthCode,
} from './s3-auth.js';
import { sigv4Headers } from './sigv4.js';

/** Short-lived S3 credentials minted by an STS AssumeRoleWithWebIdentity. */
export interface S3SessionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** Epoch ms; the store treats anything inside the refresh lead as stale. */
  expiresAt: number;
  region: string;
}

/** The `oidc` mount configuration — public client, no secrets anywhere. */
export interface S3OidcMountOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  /** STS endpoint speaking AssumeRoleWithWebIdentity (MinIO/R2/AWS). */
  stsEndpoint: string;
  roleArn?: string;
  sessionName?: string;
}

export type S3WriteMode = 'public' | 'presign' | 'signer' | 'oidc';

export interface S3MountOptions {
  /** Object base URL, e.g. `https://s3.example.test/bucket/prefix/`. */
  base: string;
  /** Where it mounts, absolute, e.g. `/s3`. */
  mountpoint: string;
  /** Write mode: `public` (read-only), presign, signer, or `oidc`. */
  mode: S3WriteMode;
  /** OIDC + STS configuration for mode `oidc`. */
  oidc?: S3OidcMountOptions;
  /** Signature region (oidc mode; default `us-east-1`). */
  region?: string;
  /** Keep the session in localStorage (default sessionStorage). */
  persist?: 'session' | 'local';
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
  readonly mode: S3WriteMode;
  readonly presignEndpoint?: string;
  readonly signer?: S3Signer;
  readonly maxObjects: number;
  readonly maxBytes: number;
  readonly region: string;
  readonly oidc?: S3OidcMountOptions;
  readonly persist: 'session' | 'local';
  readonly store?: S3SessionStore;
  #session: S3SessionCredentials | null = null;
  #oidcSession: OidcSession | null = null;
  #sts?: StsClient;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: S3MountOptions) {
    this.base = parseS3Base(opts.base); // throws with the reason on a bad URL
    this.mountpoint = opts.mountpoint;
    this.mode = opts.mode;
    this.writable = opts.mode !== 'public';
    this.presignEndpoint = opts.presignEndpoint;
    this.signer = opts.signer;
    this.maxObjects = opts.maxObjects ?? DEFAULT_MAX_OBJECTS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.region = opts.region ?? 'us-east-1';
    this.persist = opts.persist ?? 'session';
    if (opts.mode === 'oidc') {
      this.oidc = opts.oidc;
      this.store = new S3SessionStore(opts.mountpoint, this.persist);
      // Pre-boot restore: a revisit reuses the tab's (or the persisted)
      // temporary session instead of re-running the sign-in dance.
      const stored = this.store?.load() ?? null;
      if (stored?.valid) this.#session = stored;
    }
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

  /** Current session, or a clear failure naming the remedy. */
  #requireSession(): S3SessionCredentials {
    const stored = this.store?.load() ?? null;
    if (stored?.valid) this.#session = stored;
    if (this.#session && this.#session.expiresAt - SESSION_REFRESH_LEAD_MS > Date.now()) return this.#session;
    throw new Error('no session — run `mount s3 … mode=oidc …` to sign in again (or `mount --logout` first)');
  }

  /** SigV4 headers for one object request (oidc mode). */
  async #signedHeaders(method: string, url: string, body?: string, contentType?: string): Promise<Record<string, string>> {
    const session = this.#requireSession();
    const signed = await sigv4Headers({
      method,
      url,
      body,
      region: session.region,
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
      service: 's3',
      headers: contentType ? { 'content-type': contentType } : undefined,
    });
    return signed as unknown as Record<string, string>;
  }

  /** GET (and in oidc mode PUT/DELETE) with signing merged onto the init. */
  async #fetchObject(op: 'get' | 'put' | 'delete', key: string, body?: string, contentType?: string): Promise<string> {
    const url = this.#urlFor(key);
    const method = op === 'get' ? 'GET' : op === 'put' ? 'PUT' : 'DELETE';
    const init: RequestInit = { method };
    if (op !== 'get') {
      init.body = body ?? '';
      init.headers = await this.#signedHeaders(method, url, init.body as string | undefined, contentType);
    } else if (this.mode === 'oidc') {
      init.headers = await this.#signedHeaders('GET', url);
    }
    return this.#fetchText(url, init);
  }

  /** List entries under a backend-relative dir (immediate children only). */
  async list(path: string): Promise<Array<{ name: string; kind: 'file' | 'dir' }>> {
    const prefix = path === '/' || path === '' ? '' : path.replace(/^\/+|\/+$/g, '') + '/';
    const url = `${this.base.toString()}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
    const init: RequestInit | undefined = this.mode === 'oidc' ? { headers: await this.#signedHeaders('GET', url) } : undefined;
    const xml = await this.#fetchText(url, init);
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
      const text = await this.#fetchObject('get', clean);
      return { kind: 'file', size: text.length };
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<string | null> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    try {
      return await this.#fetchObject('get', clean);
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const clean = path.replace(/^\/+|\/+$/g, '');
    if (this.mode === 'oidc') {
      await this.#fetchObject('put', clean, content, 'text/plain');
      return;
    }
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
      const init: RequestInit | undefined = this.mode === 'oidc' ? { headers: await this.#signedHeaders('GET', url) } : undefined;
      for (const entry of parseS3ListXml(await this.#fetchText(url, init), this.base)) {
        await this.#deleteKey(entry.key);
      }
      return;
    }
    await this.#deleteKey(clean);
  }

  async #deleteKey(key: string): Promise<void> {
    if (this.mode === 'oidc') {
      await this.#fetchObject('delete', key, '');
      return;
    }
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
      const init: RequestInit | undefined = this.mode === 'oidc' ? { headers: await this.#signedHeaders('GET', url) } : undefined;
      entries = parseS3ListXml(await this.#fetchText(url, init), this.base);
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
        const content = await this.#fetchObject('get', entry.key);
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

  /**
   * One mount line for `mount` listings — expiry and store kind only;
   * credential VALUES never appear here or anywhere user-visible.
   */
  describe(): string {
    if (this.mode !== 'oidc') return '';
    const stored = this.store?.load() ?? null;
    if (!stored) return ' (oidc, not signed in)';
    const minutes = Math.max(0, Math.round((stored.expiresAt - Date.now()) / 60_000));
    return ` (oidc, ${this.persist}-storage, expires in ${minutes}m)`;
  }

  /**
   * Make sure an oidc session exists: reuse the stored one, refresh a
   * still-refreshable one, or run the PKCE popup dance. Reports progress
   * through `report`; resolves false when the mount should NOT stay.
   */
  async ensureSession(
    report: (line: { kind: 'stdout' | 'stderr'; text: string }) => void,
  ): Promise<boolean> {
    if (this.mode !== 'oidc' || !this.oidc || !this.store) return true;
    // Build the OIDC/STS clients FIRST: the restore path schedules a
    // pre-expiry refresh, and a null client there would silently no-op.
    this.#sts ??= new StsClient({
      endpoint: this.oidc.stsEndpoint,
      region: this.region,
      roleArn: this.oidc.roleArn,
      sessionName: this.oidc.sessionName,
    });
    this.#oidcSession ??= new OidcSession({
      issuer: this.oidc.issuer,
      clientId: this.oidc.clientId,
      redirectUri: this.oidc.redirectUri,
      scope: this.oidc.scope,
    });
    const stored = this.store.load();
    if (stored?.valid) {
      this.#session = stored;
      this.#scheduleRefresh(stored, report);
      const minutes = Math.max(0, Math.round((stored.expiresAt - Date.now()) / 60_000));
      report({ kind: 'stdout', text: `s3: ${this.mountpoint}: session restored (expires in ${minutes}m)` });
      return true;
    }
    this.#session = null;
    let started: { url: string; state: string; pkce: Awaited<ReturnType<OidcSession['start']>>['pkce'] };
    try {
      started = await this.#oidcSession.start();
    } catch (cause) {
      report({ kind: 'stderr', text: `s3: ${this.mountpoint}: sign-in failed: ${cause instanceof Error ? cause.message : String(cause)}` });
      return false;
    }
    report({ kind: 'stdout', text: `s3: ${this.mountpoint}: opening sign-in …` });
    report({ kind: 'stdout', text: `s3: ${this.mountpoint}: if the popup was blocked, open this URL and retry: ${started.url}` });
    try {
      if (typeof window !== 'undefined') {
        window.open(started.url, 'semtext-s3-auth', 'width=480,height=640,noopener');
      }
      const code = await waitForAuthCode(started.state);
      const { credentials, tokens } = await this.#oidcSession.exchange(code, started.pkce, this.#sts);
      this.#session = credentials;
      this.store.save({ ...credentials, issuer: this.oidc.issuer, clientId: this.oidc.clientId, refreshToken: tokens.refreshToken });
      this.#scheduleRefresh(this.store.load() ?? { ...credentials, refreshToken: tokens.refreshToken }, report);
      const minutes = Math.max(0, Math.round((credentials.expiresAt - Date.now()) / 60_000));
      report({ kind: 'stdout', text: `s3: ${this.mountpoint}: signed in (expires in ${minutes}m)` });
      return true;
    } catch (cause) {
      report({ kind: 'stderr', text: `s3: ${this.mountpoint}: ${cause instanceof Error ? cause.message : String(cause)}` });
      return false;
    }
  }

  /** Silent re-mint before expiry when the IdP issued a refresh_token. */
  #scheduleRefresh(
    stored: { expiresAt: number; refreshToken?: string } | null,
    report: (line: { kind: 'stdout' | 'stderr'; text: string }) => void,
  ): void {
    if (!stored || !stored.refreshToken || this.mode !== 'oidc') return;
    const delay = Math.max(0, stored.expiresAt - SESSION_REFRESH_LEAD_MS - Date.now());
    if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      void (async () => {
        try {
          if (!this.#sts || !this.#oidcSession) return;
          const refresh = await this.#oidcSession.refresh(stored.refreshToken!, this.#sts);
          this.#session = refresh.credentials;
          const refreshToken = refresh.tokens.refreshToken ?? stored.refreshToken!;
          this.store?.save({ ...refresh.credentials, issuer: this.oidc?.issuer, clientId: this.oidc?.clientId, refreshToken });
          this.#scheduleRefresh(this.store?.load() ?? { ...refresh.credentials, refreshToken }, report);
        } catch {
          // One stderr note; the session keeps serving until it truly
          // expires, then #requireSession names the remedy.
          report({ kind: 'stderr', text: `s3: ${this.mountpoint}: refresh failed — the session will expire; remount to sign in again` });
        }
      })();
    }, delay);
  }

  /** Detach-side cleanup: stop the refresh timer, drop the session. */
  dispose(): void {
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#session = null;
    this.store?.clear();
  }
}

/**
 * Parse `mount s3 <url> <mountpoint> [flags]`; return a ready backend or
 * an error message. Public bases stay read-only; presign/signer switch
 * on when the page supplied a signer (core.setS3Signer); `mode=oidc`
 * configures the PKCE + STS session (issuer= client_id= redirect= sts=).
 * Static credential flags are REFUSED — temporary sessions only.
 */
export function createS3Backend(args: string[], signer?: S3Signer): S3Backend | string {
  const base = args[0];
  if (!base) return 'usage: mount s3 <https://host/bucket/prefix/> <mountpoint> [mode=… issuer= client_id= redirect= sts= role= region= persist=]';
  const mountpoint = args[1] ?? '/s3';
  if (!mountpoint.startsWith('/')) return `s3: mountpoint must be absolute: "${mountpoint}"`;
  const flags = new Map<string, string>();
  for (const arg of args.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq <= 0) return `s3: unexpected argument "${arg}" (want key=value flags)`;
    flags.set(arg.slice(0, eq), arg.slice(eq + 1));
  }
  for (const banned of ['access_key', 'secret_key', 'accessKey', 'secretKey', 'session_token', 'sessionToken']) {
    if (flags.has(banned)) return 's3: static credentials are never accepted — use mode=oidc (temporary STS session) or a signer';
  }
  const mode = (flags.get('mode') ?? (signer ? 'signer' : 'public')) as S3WriteMode;
  if (!['public', 'presign', 'signer', 'oidc'].includes(mode)) {
    return `s3: unknown mode "${mode}" (want public|presign|signer|oidc)`;
  }
  const presignEndpoint = flags.get('presign');
  if (mode === 'presign' && !presignEndpoint) return 's3: presign mode needs presign=<endpoint>';
  const persist = (flags.get('persist') ?? 'session') as 'session' | 'local';
  if (persist !== 'session' && persist !== 'local') return `s3: persist must be session or local (got "${persist}")`;
  let oidc: S3OidcMountOptions | undefined;
  if (mode === 'oidc') {
    const issuer = flags.get('issuer');
    const clientId = flags.get('client_id') ?? flags.get('clientId');
    const redirectUri = flags.get('redirect');
    const stsEndpoint = flags.get('sts');
    if (!issuer || !clientId || !redirectUri || !stsEndpoint) {
      return 's3: oidc needs issuer=<openid issuer> client_id=<public client> redirect=<redirect uri> sts=<sts endpoint>';
    }
    oidc = {
      issuer,
      clientId,
      redirectUri,
      scope: flags.get('scope'),
      stsEndpoint,
      roleArn: flags.get('role'),
      sessionName: flags.get('session_name'),
    };
  }
  const maxObjects = flags.has('max_objects') ? Number.parseInt(flags.get('max_objects')!, 10) : undefined;
  const maxBytes = flags.has('max_bytes') ? Number.parseInt(flags.get('max_bytes')!, 10) : undefined;
  let backend: S3Backend;
  try {
    backend = new S3Backend({
      base,
      mountpoint,
      mode,
      presignEndpoint,
      signer,
      oidc,
      region: flags.get('region'),
      persist,
      maxObjects,
      maxBytes,
    });
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  return backend;
}
