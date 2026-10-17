// @vitest-environment happy-dom
// Unit spec — src/lit/semext/semext-annotate.ts · the one live-read embed
//
// Feature: semext-annotate renders visitor threads from a snapshot, and is
//   the ONE semext element allowed a client live read (anonymous-read)
//   Scenario: snapshot mode renders the authored record + card chrome, fetching nothing
//   Scenario: live bodies render AS TEXT ONLY — a <script> in a comment body stays escaped text
//   Scenario: live mode resolves <endpoint>/threads?site&page, fetches once, no credentials
//   Scenario: fail soft — a failed live fetch falls back to the authored view, never throws
//   Scenario: a fixture source vetoes the endpoint (zero fetch calls)
//   Scenario: the authored endpoint attribute is never rewritten

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SemextAnnotate,
  annotateThreadsUrl,
} from '../../src/lit/semext/semext-annotate.js';
import '../../src/lit/semext/semext-annotate.js';

const BASE = 'https://annotate-srv.test/api/v1';
const SITE = 'semtext-demo';
const PAGE = '/pages/one.html';

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

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: () => Promise.reject(new Error(`HTTP ${status}`)),
  } as unknown as Response;
}

// ── mount idiom (house pattern, cf. lit-cached-embed.test.ts) ────

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(el: SemextAnnotate): Promise<void> {
  await tick();
  await el.updateComplete;
  await tick();
  await el.updateComplete;
}

async function mount(opts: {
  attrs?: Record<string, string>;
  html?: string;
  fetch?: typeof fetch;
} = {}): Promise<SemextAnnotate> {
  const el = document.createElement('semext-annotate') as SemextAnnotate;
  for (const [name, value] of Object.entries(opts.attrs ?? {})) el.setAttribute(name, value);
  if (opts.html) el.innerHTML = opts.html;
  if (opts.fetch) el.fetchImpl = opts.fetch;
  document.body.appendChild(el);
  customElements.upgrade(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

const EVIL_BODY = '<script>alert(1)</script><img src=x onerror=alert(1)> and [click](javascript:alert(1))';

const LIVE_THREADS = {
  site: SITE,
  page: PAGE,
  threads: [
    {
      id: 't-9',
      status: 'open',
      title: 'Live thread',
      author: 'visitor',
      createdAt: '2026-10-18T00:00:00Z',
      anchor: { text: '§3 Cached content' },
      comments: [{ id: 'c-9', author: 'visitor', body: EVIL_BODY, createdAt: '2026-10-18T00:00:00Z' }],
    },
  ],
};

describe('semext-annotate registration + policy', () => {
  it('registers the semext-annotate tag', () => {
    expect(customElements.get('semext-annotate')).toBe(SemextAnnotate);
  });

  it('is the one anonymous-read element of the family', () => {
    expect(SemextAnnotate.livePolicy).toBe('anonymous-read');
  });
});

describe('semext-annotate snapshot mode', () => {
  it('renders the authored record plus card chrome from the JSON child, fetching nothing', async () => {
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    const el = await mount({
      attrs: { site: SITE, page: PAGE, endpoint: BASE },
      html:
        '<article class="semext-annotate-thread" data-status="open"><strong>Authored</strong><p>tyna — authored body.</p></article>' +
        `<script type="application/json">${JSON.stringify({
          site: SITE,
          page: PAGE,
          threads: [{ id: 't-1', status: 'open', title: 'Snapshot thread', comments: [] }],
        })}</script>`,
      fetch: rec.fetch,
    });
    expect(el.getAttribute('status')).toBe('cached');
    expect(el.getAttribute('data-sem-upgraded')).toBe('');
    expect(rec.calls).toEqual([]); // snapshot wins; endpoint vetoed
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-annotate-chrome')).toBeTruthy();
    expect(chrome?.textContent).toContain('Snapshot thread');
    // the authored record stands untouched, outside the chrome
    const authored = el.querySelector('article.semext-annotate-thread') as HTMLElement;
    expect(chrome.contains(authored)).toBe(false);
    expect(authored.textContent).toContain('Authored');
  });

  it('an empty snapshot renders the "no comments yet" note', async () => {
    const el = await mount({
      attrs: { site: SITE, page: PAGE },
      html: '<script type="application/json">{"site":"s","page":"/p","threads":[]}</script>',
    });
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-annotate-empty')?.textContent).toContain('No comments');
  });
});

describe('semext-annotate untrusted-data rendering (TEXT ONLY)', () => {
  it('a <script>/<img>-bearing comment body stays escaped text — never markup, never a link', async () => {
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    const el = await mount({ attrs: { site: SITE, page: PAGE, endpoint: BASE }, fetch: rec.fetch });
    expect(el.getAttribute('status')).toBe('live');
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    // the payload survived as TEXT …
    expect(chrome.textContent).toContain('<script>alert(1)</script>');
    expect(chrome.textContent).toContain('<img src=x onerror=alert(1)>');
    // … and NEVER became markup
    expect(chrome.querySelector('script')).toBeNull();
    expect(chrome.querySelector('img')).toBeNull();
    const evilAnchor = chrome.querySelector('a[href^="javascript:"]');
    expect(evilAnchor).toBeNull();
    // the body text node carries the raw string verbatim
    const body = chrome.querySelector('.semext-annotate-body') as HTMLElement;
    expect(body.textContent).toContain('<script>alert(1)</script>');
  });

  it('module source never uses unsafeHTML (static guarantee)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/lit/semext/semext-annotate.ts'), 'utf8');
    // no directive import, no directive call (a prose mention in the header
    // comment is not usage — pin the two real API surfaces)
    expect(src.includes('lit/directives')).toBe(false);
    expect(/\bunsafeHTML\s*\(/.test(src)).toBe(false);
  });
});

describe('semext-annotate live mode', () => {
  it('resolves <endpoint>/threads?site&page, fetches once, renders live threads as chrome', async () => {
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    const el = await mount({ attrs: { site: SITE, page: PAGE, endpoint: BASE }, fetch: rec.fetch });
    const expected = annotateThreadsUrl(BASE, SITE, PAGE);
    expect(rec.calls).toEqual([expected]);
    expect(rec.calls[0]).toContain('/threads?');
    expect(rec.calls[0]).toContain(`site=${SITE}`);
    expect(el.getAttribute('status')).toBe('live');
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.textContent).toContain('Live thread');
    expect(chrome?.textContent).toContain('Visitor threads — 1');
    // the authored children are exactly: the authored record + the chrome container
    expect(el.querySelectorAll('.semext-annotate-thread').length).toBe(1);
  });

  it('sends no credentials (anonymous read)', async () => {
    let seenInit: RequestInit | undefined;
    const calls: string[] = [];
    const fn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(String(input));
      seenInit = init;
      return Promise.resolve(jsonResponse(LIVE_THREADS));
    }) as typeof fetch;
    const el = await mount({ attrs: { site: SITE, page: PAGE, endpoint: BASE }, fetch: fn });
    expect(calls.length).toBe(1);
    expect(seenInit?.credentials).toBe('omit');
    expect(el.getAttribute('status')).toBe('live');
  });

  it('a failed live fetch falls back to the authored view — status error, no chrome, no throw', async () => {
    const rec = recordFetch(() => errorResponse(500));
    const el = await mount({
      attrs: { site: SITE, page: PAGE, endpoint: BASE.replace('v1', 'v2') },
      html: '<article class="semext-annotate-thread" data-status="open"><strong>Fallback</strong><p>authored view standing.</p></article>',
      fetch: rec.fetch,
    });
    expect(rec.calls.length).toBe(1);
    expect(el.getAttribute('status')).toBe('error');
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(el.querySelector('article')?.textContent).toContain('Fallback');
  });

  it('rewrites the endpoint PROPERTY only — the authored attribute is never touched', async () => {
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    const el = await mount({ attrs: { site: SITE, page: PAGE, endpoint: BASE }, fetch: rec.fetch });
    expect(el.getAttribute('endpoint')).toBe(BASE);
    expect((el as unknown as { endpoint: string }).endpoint).toBe(annotateThreadsUrl(BASE, SITE, PAGE));
    expect(rec.calls).toEqual([annotateThreadsUrl(BASE, SITE, PAGE)]);
  });

  it('refuses non-http(s) endpoints per the shared source policy', async () => {
    for (const endpoint of ['javascript:alert(1)', 'data:application/json,{}', 'file:///etc/threads']) {
      const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
      await mount({ attrs: { site: SITE, page: PAGE, endpoint }, fetch: rec.fetch });
      expect(rec.calls, endpoint).toEqual([]);
    }
  });

  it('a fixture source vetoes the endpoint (zero fetch calls)', async () => {
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    const el = await mount({
      attrs: { site: SITE, page: PAGE, endpoint: BASE, fixtures: '{"site":"s","page":"/p","threads":[]}' },
      fetch: rec.fetch,
    });
    expect(rec.calls).toEqual([]);
    expect(el.getAttribute('status')).toBe('cached');
  });
});

describe('annotateThreadsUrl (the collection-path contract)', () => {
  it('joins base + /threads with site and page parameters', () => {
    expect(annotateThreadsUrl('https://x.test/api/v1', 's', '/p')).toBe('https://x.test/api/v1/threads?site=s&page=%2Fp');
  });

  it('strips trailing slashes from the base', () => {
    expect(annotateThreadsUrl('https://x.test/api/v1///', 's', '/p')).toBe('https://x.test/api/v1/threads?site=s&page=%2Fp');
  });

  it('omits empty parameters', () => {
    expect(annotateThreadsUrl('https://x.test/api/v1', '', '')).toBe('https://x.test/api/v1/threads');
    expect(annotateThreadsUrl('https://x.test/api/v1', 's', '')).toBe('https://x.test/api/v1/threads?site=s');
  });

  it('an already-resolved threads endpoint is fetched verbatim (the fixpoint guard)', async () => {
    const resolved = annotateThreadsUrl(BASE, SITE, PAGE);
    const rec = recordFetch(() => jsonResponse(LIVE_THREADS));
    await mount({ attrs: { site: SITE, page: PAGE, endpoint: resolved }, fetch: rec.fetch });
    expect(rec.calls).toEqual([resolved]); // no double /threads append
  });
});
