// @vitest-environment happy-dom
// Unit spec — src/lit/shared/cached-embed.ts · the cached-embed base
//
// Feature: service-backed SemText elements share one cached-embed contract
//   Scenario: snapshot precedence — inline JSON child > fixtures source (inline JSON, then same-origin path) > none
//   Scenario: a fixture source in any form vetoes the endpoint (zero fetch calls)
//   Scenario: live fetches only when livePolicy allows AND endpoint is set AND the URL passes the source policy
//   Scenario: status transitions — cached | stale | live | error, all reflected
//   Scenario: fail soft — a failed live fetch falls back to the authored view, never throws
//   Scenario: fail soft — broken snapshot JSON renders the authored children, never throws
//   Scenario: the JS-off view is the authored record — nothing fabricated, chrome is data-sem-chrome only

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CachedEmbedProps,
  TestCachedEmbed,
  type LivePolicy,
} from '../../src/lit/shared/cached-embed.js';
import { SemElement } from '../../src/lit/base.js';

const ENDPOINT = 'https://api.example.test/v1/thing';
const FIXTURE_PATH = '/fixtures/agent-kit/artifacts.json';

// ── fetch doubles (never real network) ──────────────────────────

type RecordedFetch = { calls: string[]; fetch: typeof fetch };

function recordFetch(handler: (url: string) => Response | Promise<Response>): RecordedFetch {
  const calls: string[] = [];
  const fn = ((input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'object' && input !== null && 'url' in input
        ? String((input as Request).url)
        : String(input);
    calls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return { calls, fetch: fn };
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/** A non-2xx reply (its body is not JSON). */
function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: () => Promise.reject(new Error(`HTTP ${status}`)),
  } as unknown as Response;
}

/** 200 OK whose body refuses to parse as JSON. */
function badJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
  } as unknown as Response;
}

// ── throwaway subclasses for the policy matrix ──────────────────

class NeverLiveEmbed extends TestCachedEmbed {
  static override livePolicy: LivePolicy = 'never';
}

class StaleEmbed extends NeverLiveEmbed {
  static override stalenessMs = 60_000;
}

SemElement.register('sem-test-embed-never', NeverLiveEmbed);
SemElement.register('sem-test-embed-stale', StaleEmbed);

// ── mount idiom (house pattern, cf. lit-sem-reveal.test.ts) ─────

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(el: TestCachedEmbed): Promise<void> {
  await tick();
  await el.updateComplete;
  await tick();
  await el.updateComplete;
}

async function mount(opts: {
  tag?: string;
  attrs?: Record<string, string>;
  html?: string;
  fetch?: typeof fetch;
} = {}): Promise<TestCachedEmbed> {
  const el = document.createElement(opts.tag ?? 'sem-test-cached-embed') as TestCachedEmbed;
  for (const [name, value] of Object.entries(opts.attrs ?? {})) el.setAttribute(name, value);
  if (opts.html) el.innerHTML = opts.html;
  if (opts.fetch) el.fetchImpl = opts.fetch;
  document.body.appendChild(el);
  // happy-dom races its custom-element pipeline: force the upgrade, then
  // let the macrotask deliver connectedCallback.
  customElements.upgrade(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cached-embed snapshot precedence', () => {
  it('inline JSON child wins over the fixtures attribute — and nothing is fetched at all', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      attrs: { fixtures: FIXTURE_PATH, endpoint: ENDPOINT },
      html: `<script type="application/json">${JSON.stringify({ from: 'child' })}</script><p class="record">Authored record.</p>`,
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('cached');
    expect(el.querySelector('.test-cached-embed-chrome')?.textContent).toContain('"from":"child"');
    expect(rec.calls).toEqual([]); // child source wins; neither path nor endpoint fetched
  });

  it('an inline JSON fixtures value is the snapshot when no child is authored', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      attrs: { fixtures: '{"from":"inline"}', endpoint: ENDPOINT },
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('cached');
    expect(el.querySelector('.test-cached-embed-chrome')?.textContent).toContain('"from":"inline"');
    expect(rec.calls).toEqual([]);
  });

  it('a same-origin fixtures path is fetched once; the endpoint stays untouched', async () => {
    const rec = recordFetch((url) =>
      url.endsWith(FIXTURE_PATH) ? jsonResponse({ from: 'path' }) : jsonResponse({ from: 'network' }),
    );
    const el = await mount({
      attrs: { fixtures: FIXTURE_PATH, endpoint: ENDPOINT },
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('cached');
    expect(el.querySelector('.test-cached-embed-chrome')?.textContent).toContain('"from":"path"');
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].endsWith(FIXTURE_PATH)).toBe(true);
  });

  it('with no snapshot source and livePolicy never, the authored children stand alone', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      tag: 'sem-test-embed-never',
      attrs: { endpoint: ENDPOINT },
      html: '<p class="record">Only authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBeNull(); // no runtime state exists
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(el.querySelector('.record')?.textContent).toBe('Only authored.');
    expect(rec.calls).toEqual([]);
  });
});

describe('cached-embed fixture veto', () => {
  it('a fixture source present with an endpoint and anonymous-read makes ZERO fetch calls', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      attrs: { fixtures: '{"from":"inline"}', endpoint: ENDPOINT },
      fetch: rec.fetch,
    });
    expect(rec.calls).toEqual([]); // the hard rule, asserted against a mock fetcher
    expect(el.getAttribute('status')).toBe('cached');
    expect(el.querySelector('.test-cached-embed-chrome')?.textContent).toContain('"from":"inline"');
  });

  it('a fixtures path that fails to fetch still vetoes the endpoint and reports error', async () => {
    const rec = recordFetch((url) =>
      url.endsWith('/nope.json') ? errorResponse(500) : jsonResponse({ from: 'network' }),
    );
    const el = await mount({
      attrs: { fixtures: '/nope.json', endpoint: ENDPOINT },
      html: '<p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull(); // no fabricated view
    expect(el.querySelector('.record')?.textContent).toBe('Authored.'); // authored view stands
    expect(rec.calls.filter((c) => c.includes('api.example.test'))).toEqual([]); // endpoint never called
  });

  it('an unparseable inline JSON child reports error, renders the authored children, and never throws', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      attrs: { endpoint: ENDPOINT },
      html: '<script type="application/json">not,valid</script><p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('.record')?.textContent).toBe('Authored.');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(rec.calls).toEqual([]); // fixtures present ⇒ endpoint vetoed even on parse failure
  });

  it('an unparseable fixtures attribute behaves the same', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      attrs: { fixtures: '{nope', endpoint: ENDPOINT },
      html: '<p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('.record')?.textContent).toBe('Authored.');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(rec.calls).toEqual([]);
  });
});

describe('cached-embed live policy', () => {
  it('livePolicy never never fetches, even with a valid endpoint', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({
      tag: 'sem-test-embed-never',
      attrs: { endpoint: ENDPOINT },
      fetch: rec.fetch,
    });
    expect(rec.calls).toEqual([]);
    expect(el.getAttribute('status')).toBeNull();
  });

  it('anonymous-read refuses non-http(s), javascript:, data: and blob: endpoints', async () => {
    for (const endpoint of [
      'javascript:alert(1)',
      'data:application/json,{"from":"x"}',
      'blob:http://localhost:3000/abc',
      'ftp://example.test/x',
    ]) {
      const rec = recordFetch(() => jsonResponse({ from: 'network' }));
      await mount({ attrs: { endpoint }, fetch: rec.fetch });
      expect(rec.calls, endpoint).toEqual([]);
    }
  });

  it('anonymous-read with a valid endpoint fetches it once and reports live', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'endpoint' }));
    const el = await mount({
      attrs: { endpoint: ENDPOINT },
      html: '<p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(rec.calls).toEqual([ENDPOINT]);
    expect(el.getAttribute('status')).toBe('live');
    expect(el.querySelector('.test-cached-embed-chrome')?.textContent).toContain('"from":"endpoint"');
  });

  it('anonymous-read without an endpoint fetches nothing', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = await mount({ fetch: rec.fetch, html: '<p class="record">Authored.</p>' });
    expect(rec.calls).toEqual([]);
    expect(el.getAttribute('status')).toBeNull();
  });
});

describe('cached-embed status transitions', () => {
  it('a snapshot starts cached', async () => {
    const el = await mount({ attrs: { fixtures: '{"from":"inline"}' } });
    expect(el.getAttribute('status')).toBe('cached');
  });

  it('a successful live fetch reports live', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'endpoint' }));
    const el = await mount({ attrs: { endpoint: ENDPOINT }, fetch: rec.fetch });
    expect(el.getAttribute('status')).toBe('live');
  });

  it('the default staleness window is none — an old last-refreshed stays cached', async () => {
    const el = await mount({
      tag: 'sem-test-embed-never',
      attrs: { fixtures: '{"from":"inline"}', 'last-refreshed': '2020-01-01T00:00:00Z' },
    });
    expect(el.getAttribute('status')).toBe('cached');
  });

  it('with a window, an old last-refreshed is stale and a fresh one is cached', async () => {
    const old = await mount({
      tag: 'sem-test-embed-stale',
      attrs: { fixtures: '{"from":"inline"}', 'last-refreshed': '2020-01-01T00:00:00Z' },
    });
    expect(old.getAttribute('status')).toBe('stale');

    const fresh = await mount({
      tag: 'sem-test-embed-stale',
      attrs: { fixtures: '{"from":"inline"}', 'last-refreshed': new Date().toISOString() },
    });
    expect(fresh.getAttribute('status')).toBe('cached');
  });

  it('an unparseable last-refreshed stamp is not judged stale', async () => {
    const el = await mount({
      tag: 'sem-test-embed-stale',
      attrs: { fixtures: '{"from":"inline"}', 'last-refreshed': 'not-a-date' },
    });
    expect(el.getAttribute('status')).toBe('cached');
  });

  it('a failed live fetch reports error and falls back to the authored view (fail soft)', async () => {
    const rec = recordFetch(() => errorResponse(500));
    const el = await mount({
      attrs: { endpoint: ENDPOINT },
      html: '<p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('.record')?.textContent).toBe('Authored.');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
  });

  it('a 200 reply whose body is not JSON reports error and keeps the authored view', async () => {
    const rec = recordFetch(() => badJsonResponse());
    const el = await mount({
      attrs: { endpoint: ENDPOINT },
      html: '<p class="record">Authored.</p>',
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('.record')?.textContent).toBe('Authored.');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
  });
});

describe('cached-embed authored-view invariants', () => {
  it('authored children survive a live fetch untouched; fabrication is data-sem-chrome only', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'endpoint' }));
    const el = await mount({
      attrs: { endpoint: ENDPOINT },
      html: '<p class="record">Authored record.</p>',
      fetch: rec.fetch,
    });

    expect(el.getAttribute('data-sem-upgraded')).toBe(''); // the claim gates chrome rendering

    const record = el.querySelector('.record') as HTMLElement;
    expect(record.textContent).toBe('Authored record.');
    expect(record.previousElementSibling).toBeNull(); // nothing injected before the record

    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome).toBeTruthy();
    expect(chrome.contains(record)).toBe(false);
    expect(chrome.querySelector('.record')).toBeNull(); // the authored node was not adopted into chrome

    // the element's children are exactly: the authored record + the chrome container
    expect(Array.from(el.children)).toEqual([record, chrome]);
  });

  it('nothing is fabricated from JSON without the upgrade path running (never connected)', async () => {
    const rec = recordFetch(() => jsonResponse({ from: 'network' }));
    const el = document.createElement('sem-test-cached-embed') as TestCachedEmbed;
    el.setAttribute('fixtures', '{"from":"inline"}');
    el.fetchImpl = rec.fetch;
    // never appended: no connect, no update, no load — the JS-off state
    expect(el.hasAttribute('data-sem-upgraded')).toBe(false);
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(el.getAttribute('status')).toBeNull();
    expect(rec.calls).toEqual([]);
  });
});

describe('cached-embed service reference', () => {
  it('refs() surfaces the org/project/key/id quartet', async () => {
    const el = await mount({
      attrs: { org: 'acme', project: 'agent-kit', key: 'chat-transcript', id: 'abc-123' },
    });
    const refs = (el as unknown as { refs(): Record<string, string> }).refs();
    expect(refs).toEqual({ org: 'acme', project: 'agent-kit', key: 'chat-transcript', id: 'abc-123' });
  });

  it('CachedEmbedProps matches the cachedEmbed defPreset shape', () => {
    expect(Object.keys(CachedEmbedProps).sort()).toEqual(
      ['endpoint', 'fixtures', 'id', 'key', 'lastRefreshed', 'org', 'project', 'status'].sort(),
    );
    expect((CachedEmbedProps.status as { reflect?: boolean }).reflect).toBe(true);
    expect((CachedEmbedProps.lastRefreshed as { attribute?: string }).attribute).toBe('last-refreshed');
  });
});
