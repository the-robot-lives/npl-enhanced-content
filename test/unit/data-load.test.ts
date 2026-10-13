// @vitest-environment happy-dom
// Unit spec — source loaders, phase 4 (spec/data-visualizer.md §7.6/§7.7/§9)
//
// Feature: source= file and API loads
//   Scenario: policy — relative/same-origin fetch; cross-origin http(s) attempts; file:// refused; bad schemes refused
//   Scenario: format precedence — explicit > extension > sniff
//   Scenario: fetch cache — one fetch per URL; data-cache="no" bypasses; failures not cached
//   Scenario: the enhance shows a pending placeholder, then the table
//   Scenario: HTTP errors, network failures and CORS blocks render clear errors, never blanks
//   Scenario: an inline payload AND source= together is an authoring error

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolveSource, formatFromUrl, sniffFormat } from '../../src/data/load.js';
import { sourceCache, fetchSource } from '../../src/reading/data-load.js';
import { enhanceDataVisualizerElement } from '../../src/reading/data.js';

const HTTP_DOC = 'https://docs.example.com/guide/index.html';

describe('resolveSource (policy)', () => {
  it('fetches relative and same-origin sources', () => {
    expect(resolveSource('data/x.csv', HTTP_DOC)).toEqual({ kind: 'fetch', url: 'https://docs.example.com/guide/data/x.csv', crossOrigin: false });
    expect(resolveSource('https://docs.example.com/api/items', HTTP_DOC)).toEqual({ kind: 'fetch', url: 'https://docs.example.com/api/items', crossOrigin: false });
  });

  it('attempts cross-origin http(s) and lets CORS decide', () => {
    expect(resolveSource('https://other.example.org/data.json', HTTP_DOC)).toEqual({ kind: 'fetch', url: 'https://other.example.org/data.json', crossOrigin: true });
  });

  it('refuses file:// documents, unsafe schemes and junk URLs with a visible reason', () => {
    expect(resolveSource('data/x.csv', 'file:///home/me/doc.html').reason).toMatch(/file:\/\//);
    expect(resolveSource('javascript:alert(1)', HTTP_DOC).reason).toMatch(/not allowed/);
    expect(resolveSource('data:text/csv,a,b', HTTP_DOC).reason).toMatch(/not allowed/);
    expect(resolveSource('ftp://host/x.csv', HTTP_DOC).reason).toMatch(/not allowed/);
    expect(resolveSource('   ', HTTP_DOC).reason).toMatch(/empty/);
  });
});

describe('format precedence', () => {
  it('extension maps to format; query strings ignored', () => {
    expect(formatFromUrl('https://x/y/data.csv')).toBe('csv');
    expect(formatFromUrl('https://x/y/data.YML')).toBe('yaml');
    expect(formatFromUrl('https://x/y/api/items.json?limit=5')).toBe('json');
    expect(formatFromUrl('https://x/y/notes.md')).toBe('table');
    expect(formatFromUrl('https://x/y/api/items')).toBeNull();
  });

  it('sniff reads the first non-blank line', () => {
    expect(sniffFormat('\n  | a | b |')).toBe('table');
    expect(sniffFormat('[{"a":1}]')).toBe('json');
    expect(sniffFormat('- name: x')).toBe('yaml');
    expect(sniffFormat('name: x')).toBe('yaml');
    expect(sniffFormat('name,port\na,1')).toBe('csv');
  });
});

describe('fetchSource cache', () => {
  afterEach(() => {
    sourceCache.clear();
    vi.restoreAllMocks();
  });

  const res = (status: number, body: string) => ({ ok: status < 400, status, text: async () => body });

  it('fetches once per URL and bypasses with noCache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, 'a,b\n1,2'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchSource('https://x/y.csv')).toBe('a,b\n1,2');
    expect(await fetchSource('https://x/y.csv')).toBe('a,b\n1,2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchSource('https://x/y.csv', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses non-2xx and never caches a failed fetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(404, 'nope'))
      .mockResolvedValueOnce(res(200, 'a,b'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSource('https://x/missing.csv')).rejects.toThrow(/HTTP 404/);
    await expect(fetchSource('https://x/missing.csv')).resolves.toBe('a,b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('loadSource (the enhance, async)', () => {
  beforeEach(() => {
    sourceCache.clear();
    document.body.innerHTML = '';
    vi.stubGlobal('location', new URL('https://docs.example.com/guide/index.html'));
    Object.defineProperty(document, 'baseURI', { value: 'https://docs.example.com/guide/index.html', configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('shows a pending placeholder, then swaps in the parsed table', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'name,port\nalpha,8080\n' }));
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s1" data-name="Services" source="data/services.csv"></sem-data-source>
      </sem-data-visualizer>`;
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    expect(dv.querySelector('#s1 .sem-data-pending')).not.toBeNull(); // sync placeholder
    await vi.waitFor(() => expect(dv.querySelector('#s1 table')).not.toBeNull());
    expect(dv.querySelector('#s1 .sem-data-pending')).toBeNull();
    const heads = Array.from(dv.querySelectorAll('#s1 thead th'), (th) => th.textContent);
    expect(heads).toEqual(['name', 'port']); // extension resolved the format
    const json = JSON.parse((dv.querySelector('#s1 .sem-data-schema') as HTMLScriptElement).textContent!);
    expect(json.format).toBe('csv');
    expect(json.name).toBe('Services');
    expect(dv.querySelector('#s1')!.getAttribute('data-sem-upgraded')).not.toBeNull();
  });

  it('renders a clear error on HTTP failures and network/CORS blocks', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'nope' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch')));
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s1" data-name="A" source="data/broken.csv" data-format="csv"></sem-data-source>
        <sem-data-source id="s2" data-name="B" source="https://api.other.example.org/items" data-format="json"></sem-data-source>
      </sem-data-visualizer>`;
    const dv = document.getElementById('dv')!;
    enhanceDataVisualizerElement(dv);
    await vi.waitFor(() => expect(dv.querySelector('#s1 .sem-data-error')).not.toBeNull());
    expect(dv.querySelector('#s1 .sem-data-error')?.textContent).toMatch(/HTTP 500/);
    expect(dv.querySelector('#s1 table')).toBeNull();
    await vi.waitFor(() => expect(dv.querySelector('#s2 .sem-data-error')).not.toBeNull());
    expect(dv.querySelector('#s2 .sem-data-error')?.textContent).toMatch(/CORS/);
  });

  it('errors when both an inline payload and source= are present', () => {
    document.body.innerHTML = `
      <sem-data-visualizer id="dv">
        <sem-data-source id="s1" data-name="A" source="data/x.csv">name
alpha</sem-data-source>
      </sem-data-visualizer>`;
    enhanceDataVisualizerElement(document.getElementById('dv')!);
    expect(document.querySelector('#s1 .sem-data-error')?.textContent).toMatch(/mutually exclusive/);
  });
});
