// @vitest-environment happy-dom
// Unit spec — the s3 backend in `oidc` mode end to end over a stubbed
// fetch: session restore, SigV4-signed reads/writes/deletes, credential
// masking in every report line, silent refresh before expiry, and
// logout/detach clearing the stored session. All hosts .test.invalid,
// all credential values fake (the AWS doc example pair where a vector
// needs one).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Backend, createS3Backend } from '../../src/terminal/backends/s3.js';
import { S3SessionStore } from '../../src/terminal/backends/s3-auth.js';

const OIDC_FLAGS = [
  'https://s3.test.invalid/bucket/',
  '/s3',
  'mode=oidc',
  'issuer=https://idp.test.invalid/application/o/semtext-test/',
  'client_id=client-test-123',
  'redirect=https://app.test.invalid/redirect',
  'sts=https://sts.test.invalid/',
  'region=us-east-2',
];

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'; // AWS doc example, safe
const SESSION = {
  accessKeyId: 'ASIA-test-access',
  secretAccessKey: SECRET,
  sessionToken: 'fake-session-token',
  expiresAt: Date.now() + 900_000,
  region: 'us-east-2',
};

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const xmlResponse = (text: string): Response =>
  ({ ok: true, status: 200, text: async () => text }) as unknown as Response;
const STS_XML = `<?xml version="1.0"?><AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIA-test-access</AccessKeyId><SecretAccessKey>fake-secret-value</SecretAccessKey><SessionToken>fake-session-token</SessionToken><Expiration>2030-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;
const fakeJwt = (): string => {
  const enc = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'RS256' })}.${enc({ sub: 'u1', exp: 1900000000 })}.${enc({ sig: false })}`;
};

const DISCOVERY = {
  authorization_endpoint: 'https://idp.test.invalid/application/o/semtext-test/auth',
  token_endpoint: 'https://idp.test.invalid/application/o/semtext-test/token',
};

const LIST_XML =
  '<?xml version="1.0"?><ListBucketResult><Contents><Key>docs/readme.txt</Key><Size>21</Size></Contents></ListBucketResult>';

let calls: Array<{ url: string; init?: RequestInit }>;
let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;

const response = (text: string): Response =>
  ({ ok: true, status: 200, text: async () => text }) as unknown as Response;

beforeEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
  calls = [];
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const text = String(url);
    if (text.includes('list-type=2')) return response(LIST_XML);
    if (text.includes('.well-known/openid-configuration')) return jsonResponse(DISCOVERY);
    if (text.includes('/token')) return jsonResponse({ id_token: fakeJwt(), refresh_token: 'rt-next', expires_in: 600 });
    if (text.includes('sts.test.invalid')) return xmlResponse(STS_XML);
    if (text.endsWith('/docs/readme.txt')) return response('served from the stub\n');
    return response('');
  });
  vi.stubGlobal('fetch', fetchMock);
  // Spy directly on window.open: happy-dom's own open() tries to resolve
  // the popup URL and hangs the flow under fake timers.
  openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mounted = (): S3Backend => {
  const made = createS3Backend(OIDC_FLAGS);
  expect(typeof made).toBe('object');
  return made as S3Backend;
};

describe('mount argument handling', () => {
  it('refuses static credential flags outright', () => {
    expect(String(createS3Backend(['https://s3.test.invalid/b/', '/x', 'access_key=AKIA-test']))).toMatch(/never accepted/);
    expect(String(createS3Backend(['https://s3.test.invalid/b/', '/x', 'secret_key=zzz']))).toMatch(/never accepted/);
  });

  it('oidc mode demands issuer, client_id, redirect and sts', () => {
    expect(String(createS3Backend(['https://s3.test.invalid/b/', '/x', 'mode=oidc']))).toMatch(/oidc needs/);
  });

  it('rejects unknown persist values and builds a store-backed backend', () => {
    expect(String(createS3Backend([...OIDC_FLAGS, 'persist=disk']))).toMatch(/persist/);
    const backend = createS3Backend([...OIDC_FLAGS, 'persist=local']) as S3Backend;
    expect(backend.mode).toBe('oidc');
    expect(backend.store?.persist).toBe('local');
  });
});

describe('a restored session', () => {
  it('skips the popup, reports masked lines, and signs every request', async () => {
    const store = new S3SessionStore('/s3');
    store.save(SESSION);
    const backend = mounted();
    const lines: Array<{ kind: string; text: string }> = [];
    await expect(backend.ensureSession((line) => lines.push(line))).resolves.toBe(true);
    expect(openMock).not.toHaveBeenCalled();
    expect(lines.map((line) => line.text).join('\n')).toContain('session restored');
    for (const line of lines) {
      expect(line.text).not.toContain(SESSION.secretAccessKey);
      expect(line.text).not.toContain(SESSION.sessionToken);
      expect(line.text).not.toContain(SESSION.accessKeyId);
    }

    await backend.hydrate(() => {}, () => {});
    await backend.read('docs/readme.txt');
    await backend.write('docs/new.txt', 'hello');
    await backend.rm('docs/new.txt', { recursive: false });

    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ASIA-test-access\/\d{8}\/us-east-2\/s3\/aws4_request/);
      expect(headers['x-amz-security-token']).toBe(SESSION.sessionToken);
      expect(String(call.url)).not.toContain(SESSION.secretAccessKey);
    }
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.init?.body).toBe('hello');
    const del = calls.find((call) => call.init?.method === 'DELETE');
    expect(del).toBeTruthy();
  });

  it('describe() lists expiry and store kind without values', () => {
    const store = new S3SessionStore('/s3');
    store.save(SESSION);
    const text = mounted().describe();
    expect(text).toContain('oidc');
    expect(text).toContain('session-storage');
    expect(text).toContain('expires in');
    expect(text).not.toContain(SESSION.secretAccessKey);
    expect(text).not.toContain(SESSION.sessionToken);
  });
});

describe('refresh + logout', () => {
  it('silently re-mints through the refresh token before expiry', async () => {
    vi.useFakeTimers();
    const store = new S3SessionStore('/s3');
    store.save({ ...SESSION, expiresAt: Date.now() + 300_000, refreshToken: 'rt-current' });
    const backend = mounted();
    const tokenCalls = (): number => calls.filter((call) => String(call.url).includes('/token')).length;
    await expect(backend.ensureSession(() => {})).resolves.toBe(true); // loads + schedules
    expect(tokenCalls()).toBe(0);
    // expiry 300s out, refresh lead 60s → the timer sits at +240s
    await vi.advanceTimersByTimeAsync(240_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tokenCalls()).toBeGreaterThanOrEqual(1);
    const fresh = store.load();
    expect(fresh?.accessKeyId).toBe('ASIA-test-access');
    expect(fresh?.valid).toBe(true);
    backend.dispose();
  });

  it('dispose() drops the stored session and stops the timer', async () => {
    vi.useFakeTimers();
    const store = new S3SessionStore('/s3');
    store.save(SESSION);
    const backend = mounted();
    expect(store.load()).not.toBeNull();
    backend.dispose();
    expect(store.load()).toBeNull();
    const tokenCalls = (): number => calls.filter((call) => String(call.url).includes('/token')).length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tokenCalls()).toBe(0);
  });

  it('a failed mount is detached by the caller contract (ensureSession false)', async () => {
    // No stored session, and the popup's message never arrives: with fake
    // timers the 120s sign-in wait times out and ensureSession resolves
    // false — the caller's signal to detach the mount.
    // Capture the real setTimeout before faking: the drain below needs
    // genuine macrotask yields.
    const realSetTimeout = setTimeout.bind(globalThis);
    vi.useFakeTimers();
    const backend = mounted();
    const lines: Array<{ kind: string; text: string }> = [];
    const done = backend.ensureSession((line) => lines.push(line));
    const guard = done.then(
      () => 'done' as const,
      () => 'rejected' as const,
    );
    // Yield real macrotasks until the discovery fetch + PKCE digest
    // resolved and the 120s sign-in wait is actually on the fake clock:
    // crypto.subtle resolves off the microtask queue, so a pure microtask
    // drain races the timer scheduling under load. Bounded at 1s real.
    for (let i = 0; i < 500 && vi.getTimerCount() === 0; i++) {
      await new Promise((resolve) => realSetTimeout(resolve, 2));
    }
    await vi.advanceTimersByTimeAsync(130_000); // fires the 120s sign-in timeout
    expect(await guard).toBe('done');
    await expect(done).resolves.toBe(false);
    expect(lines.map((line) => line.text).join(' ')).toMatch(/timed out/);
    backend.dispose();
  }, 15_000);
});
