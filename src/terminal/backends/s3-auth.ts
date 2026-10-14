/**
 * s3-auth — browser OIDC (authorization code + PKCE) and the S3-compatible
 * STS exchange behind the s3 backend's `oidc` mode ("self-hosted cognito
 * style authentication").
 *
 *   - The IdP is any OIDC provider with a public (PKCE) client — e.g.
 *     self-hosted Authentik at `https://auth.example.test/application/o/<slug>/`.
 *     `client_id` and `redirect_uri` come from the mount config; there is
 *     NO client secret anywhere (public client, PKCE S256).
 *   - The returned ID token is exchanged at a configurable STS endpoint
 *     via `AssumeRoleWithWebIdentity` (MinIO and R2 speak this like AWS)
 *     → short-lived AccessKeyId / SecretAccessKey / SessionToken + expiry.
 *     The role is least-privilege and scoped on the server to the mount
 *     prefix (see PLUGINS.md for the sample policy).
 *   - The "connection secret" is the TEMPORARY credential set only. It
 *     lives in sessionStorage by default, localStorage when the mount
 *     opts in (`persist="local"`), namespaced per mountpoint with its
 *     expiry; a `refresh_token` re-mints silently before expiry when the
 *     IdP issued one. Credential VALUES never reach logs, listings or
 *     error text — everything that surfaces shows expiry/issuer only.
 *
 * All network goes through `globalThis.fetch` (injectable for tests) and
 * no real host is contacted from the unit suite (.test.invalid only).
 */

import type { S3SessionCredentials } from './s3.js';

const ENCODER = new TextEncoder();
/** Refresh when this much of the credential lifetime remains (or less). */
export const SESSION_REFRESH_LEAD_MS = 60_000;

// ── base64url ─────────────────────────────────────────────────────────────

export function base64urlEncode(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((text.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** URL-safe random token (default 32 bytes → 43 base64url chars). */
export function randomToken(bytes = 32): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer));
}

// ── PKCE (RFC 7636, method S256) ──────────────────────────────────────────

export interface Pkce {
  verifier: string;
  challenge: string;
}

export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken(48);
  const challenge = base64urlEncode(await sha256(ENCODER.encode(verifier)));
  return { verifier, challenge };
}

// ── ID token (claims read, signature NOT verified — public client over
//    TLS with an authorization code; see the security notes in PLUGINS.md)

export function parseIdToken(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('s3: id_token is not a JWT');
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (typeof payload !== 'object' || payload === null) throw new Error('payload');
    return payload as Record<string, unknown>;
  } catch {
    throw new Error('s3: id_token payload is unreadable');
  }
}

// ── STS: AssumeRoleWithWebIdentity ────────────────────────────────────────

/** XML → the credential fields (MinIO/R2/AWS shape; errors carry Message). */
export interface StsGrant {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: number;
}

export function decodeStsResponse(xml: string): StsGrant {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const message = doc.getElementsByTagName('Message')[0]?.textContent;
  if (message) throw new Error(`s3: STS refused the exchange: ${message.trim()}`);
  const pick = (tag: string): string => doc.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const accessKeyId = pick('AccessKeyId');
  const secretAccessKey = pick('SecretAccessKey');
  const sessionToken = pick('SessionToken');
  const expiration = pick('Expiration');
  if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) {
    throw new Error('s3: STS response is missing credential fields');
  }
  const expires = new Date(expiration);
  if (Number.isNaN(expires.getTime())) throw new Error('s3: STS Expiration is not a date');
  return { accessKeyId, secretAccessKey, sessionToken, expiresAt: expires.getTime() };
}

export class StsClient {
  readonly endpoint: string;
  readonly region: string;
  readonly roleArn?: string;
  readonly sessionName: string;
  readonly fetchImpl: typeof fetch;

  constructor(opts: {
    endpoint: string;
    region: string;
    roleArn?: string;
    sessionName?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = opts.endpoint;
    this.region = opts.region;
    this.roleArn = opts.roleArn;
    this.sessionName = opts.sessionName ?? 'semtext-shell';
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async assumeRoleWithWebIdentity(idToken: string): Promise<S3SessionCredentials> {
    const form = new URLSearchParams({
      Action: 'AssumeRoleWithWebIdentity',
      Version: '2011-06-15',
      WebIdentityToken: idToken,
      RoleSessionName: this.sessionName,
    });
    if (this.roleArn) form.set('RoleArn', this.roleArn);
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`s3: STS request failed (HTTP ${response.status})`);
    const decoded = decodeStsResponse(xml);
    return { ...decoded, region: this.region };
  }
}

// ── OIDC authorization-code + PKCE ────────────────────────────────────────

export interface OidcOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export interface OidcTokens {
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/** `postMessage` payload the redirect page hands back to the shell. */
export const AUTH_MESSAGE_SOURCE = 'semtext-s3-auth';

export class OidcSession {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly fetchImpl: typeof fetch;
  #issuer: string;
  #endpoints: { authorizationEndpoint: string; tokenEndpoint: string } | null = null;

  constructor(opts: OidcOptions) {
    this.#issuer = opts.issuer;
    this.clientId = opts.clientId;
    this.redirectUri = opts.redirectUri;
    this.scope = opts.scope ?? 'openid';
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /** Discovery (memoized): authorization_endpoint + token_endpoint. */
  async endpoints(): Promise<{ authorizationEndpoint: string; tokenEndpoint: string }> {
    if (this.#endpoints) return this.#endpoints;
    const base = this.#issuer.endsWith('/') ? this.#issuer : this.#issuer + '/';
    const url = base + '.well-known/openid-configuration';
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`s3: identity provider discovery failed (HTTP ${response.status})`);
    const doc = (await response.json()) as Record<string, unknown>;
    const authorizationEndpoint = typeof doc.authorization_endpoint === 'string' ? doc.authorization_endpoint : '';
    const tokenEndpoint = typeof doc.token_endpoint === 'string' ? doc.token_endpoint : '';
    if (!authorizationEndpoint || !tokenEndpoint) throw new Error('s3: discovery is missing endpoint fields');
    this.#endpoints = { authorizationEndpoint, tokenEndpoint };
    return this.#endpoints;
  }

  /** Build the authorize URL. `state` comes back with the code. */
  async start(): Promise<{ url: string; state: string; pkce: Pkce }> {
    const { authorizationEndpoint } = await this.endpoints();
    const pkce = await createPkce();
    const state = randomToken(16);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scope,
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });
    return { url: `${authorizationEndpoint}?${params.toString()}`, state, pkce };
  }

  /**
   * Exchange `code` for tokens, then the ID token for S3 credentials.
   * The state check is the caller's (it compares against `start()`).
   */
  async exchange(code: string, pkce: Pkce, sts: StsClient): Promise<{ credentials: S3SessionCredentials; tokens: OidcTokens }> {
    const { tokenEndpoint } = await this.endpoints();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pkce.verifier,
    });
    const response = await this.fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!response.ok) throw new Error(`s3: token exchange failed (HTTP ${response.status})`);
    const body = (await response.json()) as Record<string, unknown>;
    const idToken = typeof body.id_token === 'string' ? body.id_token : '';
    if (!idToken) throw new Error('s3: token response has no id_token');
    const tokens: OidcTokens = {
      idToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    };
    const credentials = await sts.assumeRoleWithWebIdentity(idToken);
    return { credentials, tokens };
  }

  /** Silent re-mint from a refresh_token (same endpoint, no UI). */
  async refresh(refreshToken: string, sts: StsClient): Promise<{ credentials: S3SessionCredentials; tokens: OidcTokens }> {
    const { tokenEndpoint } = await this.endpoints();
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: refreshToken,
    });
    const response = await this.fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!response.ok) throw new Error(`s3: refresh failed (HTTP ${response.status})`);
    const body = (await response.json()) as Record<string, unknown>;
    const idToken = typeof body.id_token === 'string' ? body.id_token : '';
    if (!idToken) throw new Error('s3: refresh response has no id_token');
    const tokens: OidcTokens = {
      idToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    };
    const credentials = await sts.assumeRoleWithWebIdentity(idToken);
    return { credentials, tokens };
  }
}

// ── credential store ("the connection secret") ────────────────────────────

interface StoredSession extends S3SessionCredentials {
  issuer?: string;
  clientId?: string;
  refreshToken?: string;
}

export interface StorableSession extends StoredSession {}

const STORE_PREFIX = 'semtext:shell:s3:';

/** Mountpoint → store key (path-safe, collision-free per element origin). */
export function sessionKeyFor(mountpoint: string): string {
  return STORE_PREFIX + mountpoint.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/**
 * Namespaced session storage for one mountpoint. sessionStorage by
 * default (dies with the tab); `persist: 'local'` opts into localStorage
 * — a longer-lived token cache with a wider XSS blast radius, see the
 * trade-off note in PLUGINS.md. Loads are expiry-checked with a refresh
 * lead; expired or unreadable payloads clear themselves.
 */
export class S3SessionStore {
  readonly mountpoint: string;
  readonly persist: 'session' | 'local';

  constructor(mountpoint: string, persist: 'session' | 'local' = 'session') {
    this.mountpoint = mountpoint;
    this.persist = persist;
  }

  #storage(): Storage {
    return this.persist === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  }

  load(now = Date.now()): (StorableSession & { valid: boolean }) | null {
    let raw: string | null = null;
    try {
      raw = this.#storage().getItem(sessionKeyFor(this.mountpoint));
    } catch {
      return null; // storage disabled (privacy mode) — no session, no crash
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StorableSession;
      if (
        typeof parsed.accessKeyId !== 'string' ||
        typeof parsed.secretAccessKey !== 'string' ||
        typeof parsed.sessionToken !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        this.clear();
        return null;
      }
      return { ...parsed, valid: parsed.expiresAt - SESSION_REFRESH_LEAD_MS > now };
    } catch {
      this.clear();
      return null;
    }
  }

  save(session: StorableSession): void {
    try {
      this.#storage().setItem(sessionKeyFor(this.mountpoint), JSON.stringify(session));
    } catch {
      // Quota or privacy mode: the in-memory session still works this tab.
    }
  }

  clear(): void {
    try {
      this.#storage().removeItem(sessionKeyFor(this.mountpoint));
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }
}

/**
 * Wait for the redirect page's postMessage code. Resolves with the code
 * once a message from OUR origin carries the expected `state`; rejects
 * on timeout. The listener removes itself on either outcome.
 */
export function waitForAuthCode(
  state: string,
  timeoutMs = 120_000,
  target: { addEventListener: typeof window.addEventListener; removeEventListener: typeof window.removeEventListener } = window,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      target.removeEventListener('message', onMessage);
      clearTimeout(timer);
      fn();
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== globalThis.location.origin) return;
      const data = event.data as { source?: unknown; state?: unknown; code?: unknown; error?: unknown } | null;
      if (!data || data.source !== AUTH_MESSAGE_SOURCE) return;
      if (data.state !== state) return; // not our flow (or a stale popup)
      if (typeof data.code === 'string' && data.code !== '') {
        done(() => resolve(data.code as string));
      } else if (typeof data.error === 'string') {
        done(() => reject(new Error(`s3: sign-in failed: ${data.error as string}`)));
      }
    };
    const timer = setTimeout(() => done(() => reject(new Error('s3: sign-in timed out'))), timeoutMs);
    target.addEventListener('message', onMessage);
  });
}
