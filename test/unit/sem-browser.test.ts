// @vitest-environment happy-dom
// Unit spec — src/browser/sem-browser.ts, the chrome-like document window.
//
// Feature: sem-browser renders a SemText document live inside window chrome
//   Scenario: authored children become the viewport content, wired once
//   Scenario: no src means no address bar and an untitled fallback tab
//   Scenario: a fetched document lands in the viewport with scripts and
//             on* handlers stripped, tab titled from <title>, src in the
//             address bar, and sem-browser-load carrying {src, title}
//   Scenario: an HTTP failure shows a role=alert line and emits
//             sem-browser-error
//   Scenario: a rejected fetch takes the same error path
//   Scenario: a scheme-less src consults the resolve hook and never fetches;
//             a resolver that finds nothing errors without fetching
//   Scenario: changing src refetches; re-setting the same src does not
//   Scenario: window.SemTextLazy.hydrate is offered the viewport
//   Scenario: the viewport is a labelled focusable region; nav glyphs are
//             aria-hidden

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SemBrowser, SEM_BROWSER_TAG } from '../../src/lit/sem-browser.js';

const TAG = SEM_BROWSER_TAG;

const DECK = [
  '<!doctype html><html><head><title>The Idea</title></head><body>',
  '<sem-note data-fact="1">SemText documents are XML-well-formed.</sem-note>',
  '<p onclick="alert(1)">plain body</p>',
  '<script>window.__pwned = true;</script>',
  '</body></html>',
].join('');

function fetchResponse(text: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => text } as unknown as Response;
}

function mount(attrs: Record<string, string> = {}, inner = ''): SemBrowser {
  const el = document.createElement(TAG);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (inner) el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

const viewportOf = (el: SemBrowser): HTMLElement =>
  el.querySelector('.sem-window-viewport') as HTMLElement;

describe('sem-browser', () => {
  beforeEach(() => {
    (window as Window & { SemTextLazy?: unknown }).SemTextLazy = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('moves authored children into the viewport exactly once', async () => {
    const el = mount({}, '<p>fallback deck</p>');
    await el.updateComplete;
    const viewport = viewportOf(el);
    expect(viewport.querySelectorAll('p')).toHaveLength(1);
    expect(viewport.querySelector('p')?.textContent).toBe('fallback deck');
    expect(el.querySelectorAll('.sem-window-titlebar')).toHaveLength(1);
    expect(el.querySelectorAll('.sem-window-viewport')).toHaveLength(1);
    expect(el.querySelector('.sem-browser-address')).toBeNull();
    expect(viewportOf(el).getAttribute('aria-label')).toBe('untitled — browser viewport');
  });

  it('prefers the label attribute for the tab title', async () => {
    const el = mount({ label: 'try deck' });
    await el.updateComplete;
    const tab = el.querySelector('.sem-window-tab-title') as HTMLElement;
    expect(tab.textContent).toBe('try deck');
  });

  it('renders a fetched document with scripts and handlers stripped', async () => {
    const fetchMock = vi.fn(async () => fetchResponse(DECK));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ src: '/demo/deck.sem.html' });
    const loaded = new Promise<{ src: string; title: string }>((resolve) =>
      el.addEventListener('sem-browser-load', (e) => resolve((e as CustomEvent).detail)),
    );
    await vi.waitFor(() => {
      expect(viewportOf(el).querySelector('sem-note')).not.toBeNull();
    });
    const viewport = viewportOf(el);
    expect(viewport.querySelector('script')).toBeNull();
    expect(window).not.toHaveProperty('__pwned');
    expect(viewport.querySelector('p')?.hasAttribute('onclick')).toBe(false);
    expect((el.querySelector('.sem-window-tab-title') as HTMLElement).textContent).toBe('The Idea');
    expect((el.querySelector('.sem-browser-url') as HTMLElement).textContent).toBe('/demo/deck.sem.html');
    await expect(loaded).resolves.toMatchObject({ src: '/demo/deck.sem.html', title: 'The Idea' });
    expect(viewport.hasAttribute('aria-busy')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an HTTP failure as an alert line plus sem-browser-error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchResponse('nope', false, 404)));
    const el = mount({ src: '/demo/missing.sem.html' });
    const failed = new Promise<{ src: string; message: string }>((resolve) =>
      el.addEventListener('sem-browser-error', (e) => resolve((e as CustomEvent).detail)),
    );
    await vi.waitFor(() => {
      expect(viewportOf(el).querySelector('[role="alert"]')).not.toBeNull();
    });
    await expect(failed).resolves.toMatchObject({ src: '/demo/missing.sem.html' });
  });

  it('reports a network failure on the same error path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connection reset');
    }));
    const el = mount({ src: '/demo/deck.sem.html' });
    await vi.waitFor(() => {
      expect(viewportOf(el).querySelector('[role="alert"]')?.textContent).toContain('connection reset');
    });
  });

  it('consults the resolve hook for scheme-less paths and skips fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ src: 'demo/deck.sem.html' });
    el.resolve = () => DECK;
    await vi.waitFor(() => {
      expect(viewportOf(el).querySelector('sem-note')).not.toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('errors without fetching when the resolver finds nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ src: 'demo/deck.sem.html' });
    el.resolve = () => null;
    await vi.waitFor(() => {
      expect(viewportOf(el).querySelector('[role="alert"]')?.textContent).toContain('no document at');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches on a src change but not on a re-set of the same src', async () => {
    const fetchMock = vi.fn(async () => fetchResponse(DECK));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ src: '/demo/one.sem.html' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    el.setAttribute('src', '/demo/two.sem.html');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    el.setAttribute('src', '/demo/two.sem.html');
    await el.updateComplete;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('offers the loaded viewport to the lazy loader', async () => {
    const hydrate = vi.fn();
    (window as Window & { SemTextLazy?: { hydrate: unknown } }).SemTextLazy = { hydrate };
    vi.stubGlobal('fetch', vi.fn(async () => fetchResponse(DECK)));
    const el = mount({ src: '/demo/deck.sem.html' });
    await vi.waitFor(() => {
      expect(hydrate).toHaveBeenCalledTimes(1);
      expect((hydrate.mock.calls[0] as unknown[])[0]).toBe(viewportOf(el));
    });
  });

  it('exposes a labelled focusable viewport and inert nav glyphs', async () => {
    const el = mount({ src: '/demo/deck.sem.html', label: 'deck' });
    await el.updateComplete;
    const viewport = viewportOf(el);
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('deck — browser viewport');
    expect(viewport.tabIndex).toBe(0);
    const nav = el.querySelector('.sem-browser-nav') as HTMLElement;
    expect(nav.getAttribute('aria-hidden')).toBe('true');
    expect(nav.querySelectorAll('button, a')).toHaveLength(0);
  });
});
