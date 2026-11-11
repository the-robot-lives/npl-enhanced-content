// Unit spec — src/lit/bind.ts · parse + token + login-URL + hash-return
// (pure layer; no DOM). The contract lives in the workstream doc
// semtext-sem-bind (2026-10-18): full URL → direct fetch; same-origin
// relative path → resolved against the document base; agent-kit path
// → agentonomi status route; token in localStorage["semtext.bind.token"];
// redirect returns carry #access_token + a verified state nonce.
import { describe, it, expect } from 'vitest';
import {
  parseBind,
  isPollKind,
  isAgentonomi,
  buildAuthorizeUrl,
  currentRedirectUri,
  storeToken,
  loadToken,
  clearToken,
  consumeBindHash,
  AGENTONOMI_ORIGIN,
  TOKEN_KEY,
  DEFAULT_REFRESH_MS,
  type KVStore,
} from '../../src/lit/bind.js';

const mapStore = (initial: Record<string, string> = {}): KVStore & { map: Map<string, string> } => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

describe('parseBind', () => {
  it('parses a full https URL into a direct-fetch ref', () => {
    expect(parseBind('https://example.com/status.json')).toEqual({
      kind: 'url',
      url: 'https://example.com/status.json',
    });
  });

  it('accepts http (localhost dev statics) and trims whitespace', () => {
    expect(parseBind('  http://127.0.0.1:4173/demo/data/progress-percent.json ')).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:4173/demo/data/progress-percent.json',
    });
  });

  it('parses the agent-kit shorthand into the agentonomi status route', () => {
    const ref = parseBind('agent-kit/acme/proj/semtext/progress/demo-1');
    expect(ref).toEqual({
      kind: 'agent-kit',
      org: 'acme',
      project: 'semtext',
      resource: 'progress',
      id: 'demo-1',
      url: `${AGENTONOMI_ORIGIN}/status/acme/proj/semtext/progress/demo-1`,
    });
  });

  it('resolves relative binds against the document base (same-origin static JSON)', () => {
    const base = 'http://127.0.0.1:4173/demo/sem-bind.html';
    expect(parseBind('./data/x.json', base)).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:4173/demo/data/x.json',
    });
    expect(parseBind('/api/plan.json', base)).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:4173/api/plan.json',
    });
    expect(parseBind('../up.json?a=1', base)).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:4173/up.json?a=1',
    });
  });

  it('the agent-kit shorthand never falls through to relative resolution', () => {
    expect(parseBind('agent-kit/acme/proj/semtext/progress/demo-1', 'https://example.com/page.html')).toEqual({
      kind: 'agent-kit',
      org: 'acme',
      project: 'semtext',
      resource: 'progress',
      id: 'demo-1',
      url: `${AGENTONOMI_ORIGIN}/status/acme/proj/semtext/progress/demo-1`,
    });
  });

  it('rejects malformed agent-kit paths — even against a base', () => {
    const base = 'https://example.com/page.html';
    expect(parseBind('agent-kit/acme/semtext/progress/demo-1', base)).toBeNull(); // no /proj/
    expect(parseBind('agent-kit/acme/proj/semtext/progress', base)).toBeNull(); // missing id
    expect(parseBind('agent-kit//proj/semtext/progress/x', base)).toBeNull(); // empty org
  });

  it('rejects empty and non-http values — relative or not', () => {
    expect(parseBind(null)).toBeNull();
    expect(parseBind('')).toBeNull();
    expect(parseBind('   ')).toBeNull();
    expect(parseBind('ftp://example.com/x.json', 'https://example.com/')).toBeNull();
    expect(parseBind('javascript:alert(1)', 'https://example.com/')).toBeNull();
    expect(parseBind('data:text/html,evil', 'https://example.com/')).toBeNull();
  });

  it('a relative bind without a resolvable base stays unparseable (non-browser)', () => {
    expect(parseBind('./data/x.json')).toBeNull();
  });
});

describe('isPollKind', () => {
  it('polls only progress resources', () => {
    expect(isPollKind(parseBind('agent-kit/o/proj/p/progress/1')!)).toBe(true);
    expect(isPollKind(parseBind('agent-kit/o/proj/p/plan/1')!)).toBe(false);
    expect(isPollKind(parseBind('agent-kit/o/proj/p/run-book/1')!)).toBe(false);
    expect(isPollKind(parseBind('agent-kit/o/proj/p/workflow/1')!)).toBe(false);
    expect(isPollKind(parseBind('https://example.com/x.json')!)).toBe(false);
  });
});

describe('isAgentonomi / authorize URL', () => {
  it('recognizes the agentonomi origin only', () => {
    expect(isAgentonomi(`${AGENTONOMI_ORIGIN}/status/a/proj/p/progress/x`)).toBe(true);
    expect(isAgentonomi('https://evil.example/status/a/proj/p/progress/x')).toBe(false);
    expect(isAgentonomi('not a url')).toBe(false);
  });

  it('builds the embed authorize URL with encoded redirect_uri and state', () => {
    const url = buildAuthorizeUrl('http://localhost:4173/demo/sem-bind.html?a=1', 'st-123');
    expect(url.startsWith(`${AGENTONOMI_ORIGIN}/embed/authorize?`)).toBe(true);
    expect(url).toContain(`redirect_uri=${encodeURIComponent('http://localhost:4173/demo/sem-bind.html?a=1')}`);
    expect(url).toContain('state=st-123');
  });

  it('derives the redirect URI from origin + path + search (never the hash)', () => {
    expect(
      currentRedirectUri({
        origin: 'http://127.0.0.1:4173',
        pathname: '/demo/sem-bind.html',
        search: '?x=2',
      }),
    ).toBe('http://127.0.0.1:4173/demo/sem-bind.html?x=2');
  });
});

describe('token storage', () => {
  it('stores and loads a token', () => {
    const store = mapStore();
    expect(loadToken(store)).toBeNull();
    storeToken('tok-1', null, store);
    expect(store.getItem(TOKEN_KEY)).toBe('tok-1');
    expect(loadToken(store)).toBe('tok-1');
  });

  it('treats an expired token as absent and clears it', () => {
    const store = mapStore();
    let now = 1_000_000;
    storeToken('tok-1', 60, store, () => now);
    expect(loadToken(store, () => now + 59_000)).toBe('tok-1');
    expect(loadToken(store, () => now + 61_000)).toBeNull();
    expect(store.getItem(TOKEN_KEY)).toBeNull();
  });

  it('clears both token and expiry', () => {
    const store = mapStore();
    storeToken('tok-1', 60, store);
    clearToken(store);
    expect(loadToken(store)).toBeNull();
  });
});

describe('consumeBindHash (redirect-mode return)', () => {
  const makeLoc = (hash: string) => ({ hash, pathname: '/demo/sem-bind.html', search: '' });
  const makeHist = () => {
    const calls: string[] = [];
    return {
      calls,
      replaceState(_d: unknown, _t: string, url: string) {
        calls.push(url);
      },
    };
  };

  it('verifies the state nonce, stores the token and strips the hash', () => {
    const sess = mapStore({ 'semtext.bind.state': 'nonce-1' });
    const store = mapStore();
    const hist = makeHist();
    const ok = consumeBindHash(
      makeLoc('#access_token=tok-9&expires_in=3600&state=nonce-1'),
      hist,
      sess,
      store,
    );
    expect(ok).toBe(true);
    expect(loadToken(store)).toBe('tok-9');
    expect(sess.getItem('semtext.bind.state')).toBeNull();
    expect(hist.calls).toEqual(['/demo/sem-bind.html']);
  });

  it('rejects a state mismatch without storing anything', () => {
    const sess = mapStore({ 'semtext.bind.state': 'nonce-1' });
    const store = mapStore();
    const hist = makeHist();
    const ok = consumeBindHash(makeLoc('#access_token=tok-9&state=nonce-EVIL'), hist, sess, store);
    expect(ok).toBe(false);
    expect(loadToken(store)).toBeNull();
    expect(hist.calls).toEqual([]);
  });

  it('ignores a hash without an access_token', () => {
    const sess = mapStore({ 'semtext.bind.state': 'nonce-1' });
    const store = mapStore();
    expect(consumeBindHash(makeLoc('#section-anchor'), makeHist(), sess, store)).toBe(false);
    expect(loadToken(store)).toBeNull();
  });

  it('stores a token with no expires_in as non-expiring', () => {
    const sess = mapStore({ 'semtext.bind.state': 'n' });
    const store = mapStore();
    expect(consumeBindHash(makeLoc('#access_token=tok&state=n'), makeHist(), sess, store)).toBe(true);
    expect(loadToken(store, () => Date.now() + 86400_000)).toBe('tok');
  });
});

describe('constants', () => {
  it('keeps the contract defaults', () => {
    expect(DEFAULT_REFRESH_MS).toBe(30_000);
    expect(TOKEN_KEY).toBe('semtext.bind.token');
  });
});
