// @vitest-environment happy-dom
// Unit spec — src/lit/bind.ts · attachBind wiring: parse → fetch →
// hydrate/error/empty states, bearer-token on agentonomi fetches, the
// 401 → login → retry-once ladder (token request injected, no popup in
// unit tier), and the progress-kind poll loop with its sem-refresh
// override.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachBind, stopBind, DEFAULT_REFRESH_MS, type KVStore } from '../../src/lit/bind.js';

const mapStore = (initial: Record<string, string> = {}): KVStore & { map: Map<string, string> } => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const mount = (attrs: Record<string, string>): HTMLElement => {
  const node = document.createElement('sem-progress');
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  document.body.appendChild(node);
  return node;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.querySelectorAll('sem-progress').forEach((n) => stopBind(n));
  vi.useRealTimers();
});

describe('attachBind — static URL binds', () => {
  it('fetches, hydrates and clears the loading state', async () => {
    const el = mount({ 'sem-bind': 'https://static.example/progress.json' });
    await attachBind(el, {
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { percent: 42, comment: 'hi' })),
      store: mapStore(),
    });
    expect((el.querySelector('.sem-bind-progress-label') as HTMLElement).textContent).toBe('progress :: 42%');
    expect(el.querySelector('.sem-bind-state')).toBeNull();
  });

  it('plain hosts get no Authorization header; credentials are omitted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { percent: 1 }));
    await attachBind(mount({ 'sem-bind': 'https://static.example/x.json' }), {
      fetchImpl,
      store: mapStore({ 'semtext.bind.token': 'tok-1' }),
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('HTTP errors render the error state', async () => {
    const el = mount({ 'sem-bind': 'https://static.example/gone.json' });
    await attachBind(el, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse(404, null)), store: mapStore() });
    expect((el.querySelector('.sem-bind-state') as HTMLElement).textContent).toContain('HTTP 404');
  });

  it('an empty payload (200, null) renders the empty state', async () => {
    const el = mount({ 'sem-bind': 'https://static.example/null.json' });
    await attachBind(el, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, null)), store: mapStore() });
    expect(el.querySelector('.sem-bind-state')?.classList.contains('sem-bind-empty')).toBe(true);
  });

  it('a network throw renders the error state', async () => {
    const el = mount({ 'sem-bind': 'https://static.example/boom.json' });
    await attachBind(el, { fetchImpl: vi.fn().mockRejectedValue(new Error('offline')), store: mapStore() });
    expect((el.querySelector('.sem-bind-state') as HTMLElement).textContent).toContain('offline');
  });

  it('a relative bind resolves against the document base and fetches', async () => {
    const el = mount({ 'sem-bind': './data/progress.json' });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { percent: 5 }));
    await attachBind(el, { fetchImpl, store: mapStore() });
    const fetched = String(fetchImpl.mock.calls[0][0]);
    expect(fetched).toMatch(/^https?:\/\//);
    expect(fetched).toMatch(/\/data\/progress\.json$/);
    expect((el.querySelector('.sem-bind-progress-label') as HTMLElement).textContent).toBe('progress :: 5%');
  });

  it('an unparseable bind renders the error state without fetching', async () => {
    const el = mount({ 'sem-bind': 'javascript:alert(1)' });
    const fetchImpl = vi.fn();
    await attachBind(el, { fetchImpl, store: mapStore() });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((el.querySelector('.sem-bind-state') as HTMLElement).textContent).toContain('unparseable sem-bind');
  });

  it('a botched agent-kit shorthand is unparseable, never a bogus relative fetch', async () => {
    const el = mount({ 'sem-bind': 'agent-kit/acme/semtext/progress/demo-1' }); // no /proj/
    const fetchImpl = vi.fn();
    await attachBind(el, { fetchImpl, store: mapStore() });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((el.querySelector('.sem-bind-state') as HTMLElement).textContent).toContain('unparseable sem-bind');
  });
});

describe('attachBind — agent-kit binds', () => {
  const BIND = 'agent-kit/acme/proj/semtext/progress/demo-1';
  const URL_ = 'https://agentonomi.com/status/acme/proj/semtext/progress/demo-1';

  it('resolves the shorthand and sends the stored bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { percent: 7 }));
    await attachBind(mount({ 'sem-bind': BIND }), {
      fetchImpl,
      store: mapStore({ 'semtext.bind.token': 'tok-7' }),
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(URL_);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-7',
    });
  });

  it('on 401 runs the login flow and retries the fetch exactly once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, null))
      .mockResolvedValueOnce(jsonResponse(200, { percent: 99 }));
    const el = mount({ 'sem-bind': BIND });
    await attachBind(el, {
      fetchImpl,
      store: mapStore(),
      requestToken: vi.fn().mockResolvedValue({ access_token: 'fresh-tok', expires_in: 3600 }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((el.querySelector('.sem-bind-progress-label') as HTMLElement).textContent).toBe('progress :: 99%');
  });

  it('a token rejection after the retry renders the auth error state', async () => {
    const el = mount({ 'sem-bind': BIND });
    await attachBind(el, {
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(401, null)),
      store: mapStore(),
      requestToken: vi.fn().mockResolvedValue({ access_token: 'still-bad', expires_in: null }),
    });
    expect((el.querySelector('.sem-bind-state') as HTMLElement).textContent).toContain('authorization required');
  });
});

describe('attachBind — polling', () => {
  it('progress binds poll on DEFAULT_REFRESH_MS and refetch', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { percent: 10 }));
    const el = mount({ 'sem-bind': 'agent-kit/o/proj/p/progress/1' });
    await attachBind(el, { fetchImpl, store: mapStore(), requestToken: vi.fn() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_REFRESH_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DEFAULT_REFRESH_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    stopBind(el);
    await vi.advanceTimersByTimeAsync(DEFAULT_REFRESH_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // stopped
  });

  it('sem-refresh overrides the default; plan kinds never poll', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { percent: 50 }));
    const el = mount({ 'sem-bind': 'agent-kit/o/proj/p/progress/1', 'sem-refresh': '2' });
    await attachBind(el, { fetchImpl, store: mapStore(), requestToken: vi.fn() });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stopBind(el);

    const plan = document.createElement('sem-plan');
    plan.setAttribute('sem-bind', 'agent-kit/o/proj/p/plan/1');
    plan.setAttribute('sem-refresh', '2');
    document.body.appendChild(plan);
    await attachBind(plan, { fetchImpl, store: mapStore(), requestToken: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // still the progress element's second fetch — plan fetched once
  });
});
