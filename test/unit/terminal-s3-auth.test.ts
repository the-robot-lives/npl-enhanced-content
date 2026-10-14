// @vitest-environment happy-dom
// Unit spec — the oidc credential plumbing (src/terminal/backends/s3-auth.ts):
// PKCE, id_token claims, STS XML, the session store, the authorize URL,
// the code exchange + refresh, and the redirect postMessage contract.
// Every host is .test.invalid; every credential is a fake.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_MESSAGE_SOURCE,
  OidcSession,
  S3SessionStore,
  StsClient,
  base64urlDecode,
  base64urlEncode,
  createPkce,
  decodeStsResponse,
  parseIdToken,
  randomToken,
  waitForAuthCode,
} from '../../src/terminal/backends/s3-auth.js';

const ISSUER = 'https://idp.test.invalid/application/o/semtext-test/';
const CLIENT = 'client-test-123';
const REDIRECT = 'https://app.test.invalid/redirect';
const STS = 'https://sts.test.invalid/';

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const xmlResponse = (text: string, ok = true): Response =>
  ({ ok, status: ok ? 200 : 403, json: async () => ({}), text: async () => text }) as unknown as Response;

const STS_XML = `<?xml version="1.0"?>
<AssumeRoleWithWebIdentityResponse>
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <AccessKeyId>ASIA-test-access</AccessKeyId>
      <SecretAccessKey>fake-secret-value</SecretAccessKey>
      <SessionToken>fake-session-token</SessionToken>
      <Expiration>2030-01-01T00:00:00Z</Expiration>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`;

const DISCOVERY = {
  authorization_endpoint: 'https://idp.test.invalid/application/o/semtext-test/auth',
  token_endpoint: 'https://idp.test.invalid/application/o/semtext-test/token',
};

function fakeJwt(claims: Record<string, unknown>): string {
  const enc = (value: object) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.${base64urlEncode(new TextEncoder().encode('not-a-signature'))}`;
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
});

describe('pkce + tokens', () => {
  it('the challenge is base64url(sha256(verifier))', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64urlEncode(new Uint8Array(digest)));
  });

  it('tokens are url-safe and distinct', () => {
    const one = randomToken();
    const two = randomToken();
    expect(one).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(one).not.toBe(two);
  });

  it('parses id_token claims without verifying the signature', () => {
    const claims = parseIdToken(fakeJwt({ iss: ISSUER, sub: 'user-test-1', exp: 1900000000 }));
    expect(claims.sub).toBe('user-test-1');
    expect(() => parseIdToken('not-a-jwt')).toThrow();
  });
});

describe('the STS exchange', () => {
  it('parses the AssumeRoleWithWebIdentity response', () => {
    const grant = decodeStsResponse(STS_XML);
    expect(grant.accessKeyId).toBe('ASIA-test-access');
    expect(grant.sessionToken).toBe('fake-session-token');
    expect(grant.expiresAt).toBe(Date.parse('2030-01-01T00:00:00Z'));
  });

  it('surfaces STS errors by their Message', () => {
    const error = '<?xml version="1.0"?><ErrorResponse><Error><Type>Sender</Type><Message>Not authorized to perform sts:AssumeRoleWithWebIdentity</Message></ErrorResponse></ErrorResponse>';
    expect(() => decodeStsResponse(error)).toThrow(/Not authorized/);
  });

  it('posts the web-identity form and returns regional credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(STS_XML));
    const sts = new StsClient({ endpoint: STS, region: 'us-east-2', roleArn: 'arn:aws:iam::123456789012:role/test-role', fetchImpl: fetchMock as unknown as typeof fetch });
    const credentials = await sts.assumeRoleWithWebIdentity('id-token-abc');
    expect(credentials.region).toBe('us-east-2');
    const form = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(form.get('Action')).toBe('AssumeRoleWithWebIdentity');
    expect(form.get('WebIdentityToken')).toBe('id-token-abc');
    expect(form.get('RoleArn')).toBe('arn:aws:iam::123456789012:role/test-role');
  });
});

describe('the oidc session', () => {
  const session = (): OidcSession => new OidcSession({ issuer: ISSUER, clientId: CLIENT, redirectUri: REDIRECT, fetchImpl: vi.fn().mockResolvedValue(jsonResponse(DISCOVERY)) as unknown as typeof fetch });

  it('discovers endpoints under the issuer', async () => {
    expect(await session().endpoints()).toEqual({ authorizationEndpoint: DISCOVERY.authorization_endpoint, tokenEndpoint: DISCOVERY.token_endpoint });
  });

  it('builds a PKCE authorize URL', async () => {
    const { url, state, pkce } = await session().start();
    expect(url.startsWith(DISCOVERY.authorization_endpoint)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(CLIENT);
    expect(params.get('redirect_uri')).toBe(REDIRECT);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(pkce.challenge);
    expect(params.get('state')).toBe(state);
  });

  it('exchanges code → tokens → STS credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(DISCOVERY))
      .mockResolvedValueOnce(jsonResponse({ id_token: fakeJwt({ sub: 'u1' }), refresh_token: 'rt-123', expires_in: 600 }))
      .mockResolvedValueOnce(xmlResponse(STS_XML));
    const oidc = new OidcSession({ issuer: ISSUER, clientId: CLIENT, redirectUri: REDIRECT, fetchImpl: fetchMock as unknown as typeof fetch });
    const started = await oidc.start();
    const sts = new StsClient({ endpoint: STS, region: 'us-east-1', fetchImpl: fetchMock as unknown as typeof fetch });
    const { credentials, tokens } = await oidc.exchange('code-xyz', started.pkce, sts);
    expect(credentials.accessKeyId).toBe('ASIA-test-access');
    expect(tokens.refreshToken).toBe('rt-123');
    const tokenForm = new URLSearchParams(String(fetchMock.mock.calls[1][1].body));
    expect(tokenForm.get('grant_type')).toBe('authorization_code');
    expect(tokenForm.get('code')).toBe('code-xyz');
    expect(tokenForm.get('code_verifier')).toBe(started.pkce.verifier);
    expect(tokenForm.get('client_id')).toBe(CLIENT);
  });

  it('refreshes through the refresh_token grant', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(DISCOVERY))
      .mockResolvedValueOnce(jsonResponse({ id_token: fakeJwt({ sub: 'u1' }), expires_in: 300 }))
      .mockResolvedValueOnce(xmlResponse(STS_XML));
    const oidc = new OidcSession({ issuer: ISSUER, clientId: CLIENT, redirectUri: REDIRECT, fetchImpl: fetchMock as unknown as typeof fetch });
    const sts = new StsClient({ endpoint: STS, region: 'us-east-1', fetchImpl: fetchMock as unknown as typeof fetch });
    const { credentials } = await oidc.refresh('rt-existing', sts);
    expect(credentials.sessionToken).toBe('fake-session-token');
    const form = new URLSearchParams(String(fetchMock.mock.calls[1][1].body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt-existing');
  });
});

describe('the session store', () => {
  const valid = { accessKeyId: 'ASIA-x', secretAccessKey: 'sec-x', sessionToken: 'tok-x', expiresAt: Date.now() + 600_000, region: 'us-east-1' };

  it('round-trips through sessionStorage by default, localStorage on opt-in', () => {
    const one = new S3SessionStore('/s3');
    one.save(valid);
    expect(new S3SessionStore('/s3').load()?.accessKeyId).toBe('ASIA-x');
    expect(globalThis.sessionStorage.getItem('semtext:shell:s3:_s3')).toBeTruthy();
    const two = new S3SessionStore('/s3', 'local');
    two.save(valid);
    expect(globalThis.localStorage.getItem('semtext:shell:s3:_s3')).toBeTruthy();
  });

  it('treats near-expiry (inside the refresh lead) as not valid', () => {
    const store = new S3SessionStore('/s3');
    store.save({ ...valid, expiresAt: Date.now() + 30_000 });
    expect(store.load()?.valid).toBe(false);
  });

  it('clears unreadable payloads and logout clears outright', () => {
    const store = new S3SessionStore('/s3');
    globalThis.sessionStorage.setItem('semtext:shell:s3:_s3', '{not json');
    expect(store.load()).toBeNull();
    expect(globalThis.sessionStorage.getItem('semtext:shell:s3:_s3')).toBeNull();
    store.save(valid);
    store.clear();
    expect(store.load()).toBeNull();
  });
});

describe('the redirect message contract', () => {
  it('resolves on a same-origin postMessage with the expected state', async () => {
    const pending = waitForAuthCode('state-1', 5000);
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://app.test.invalid', data: { source: AUTH_MESSAGE_SOURCE, state: 'other', code: 'x' } }));
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { source: AUTH_MESSAGE_SOURCE, state: 'state-1', code: 'code-9' } }));
    expect(await pending).toBe('code-9');
  });

  it('ignores foreign origins and rejects on error payloads', async () => {
    const pending = waitForAuthCode('state-2', 5000);
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test.invalid', data: { source: AUTH_MESSAGE_SOURCE, state: 'state-2', code: 'evil' } }));
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { source: AUTH_MESSAGE_SOURCE, state: 'state-2', error: 'access_denied' } }));
    await expect(pending).rejects.toThrow(/access_denied/);
  });
});
