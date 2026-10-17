// @vitest-environment happy-dom
// Unit spec — the semext-* family B embeds (src/lit/semext/)
//
// Feature: the nine service-backed embeds over the cached-embed base
//   Scenario: all nine tags register through defineSemext
//   Scenario: the eight static embeds keep livePolicy never and never fetch, endpoint or not
//   Scenario: semext-docptr renders the pointer card from a snapshot; no match renders the missing note
//   Scenario: sig embeds build plain deep links (query/range/env, monitor/env) — and nothing else
//   Scenario: styleguide-theme swatches render only plain colors — no CSS injection surface
//   Scenario: styleguide-theme renders the preview link only when src is authored
//   Scenario: styleguide-themes summarizes its snapshot slugs, else counts children
//   Scenario: media-prompt reports the cache region — filled assets vs not-generated placeholder
//   Scenario: media-prompt fences match by key; a foreign-keyed fence is no region

import { describe, it, expect, beforeEach } from 'vitest';
import type { CachedEmbedElement } from '../../src/lit/shared/cached-embed.js';
import { SemextAnnotate } from '../../src/lit/semext/semext-annotate.js';
import { SemextDocptr } from '../../src/lit/semext/semext-docptr.js';
import { SemextMediaPrompt } from '../../src/lit/semext/semext-media-prompt.js';
import { SemextSigLogs } from '../../src/lit/semext/semext-sig-logs.js';
import { SemextSigMetrics } from '../../src/lit/semext/semext-sig-metrics.js';
import { SemextSigSyntheticMonitor } from '../../src/lit/semext/semext-sig-synthetic-monitor.js';
import { SemextSigTraces } from '../../src/lit/semext/semext-sig-traces.js';
import { SemextStyleguideTheme } from '../../src/lit/semext/semext-styleguide-theme.js';
import { SemextStyleguideThemes } from '../../src/lit/semext/semext-styleguide-themes.js';
import { sigLink } from '../../src/lit/semext/sig-link.js';
import '../../src/lit/semext/index.js';

const TAGS = [
  'semext-annotate',
  'semext-docptr',
  'semext-media-prompt',
  'semext-sig-logs',
  'semext-sig-metrics',
  'semext-sig-synthetic-monitor',
  'semext-sig-traces',
  'semext-styleguide-theme',
  'semext-styleguide-themes',
];

// ── fetch double (never real network; the family is static except annotate) ──

function noFetch(): typeof fetch {
  return ((input: RequestInfo | URL): Promise<Response> => {
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as unknown as typeof fetch;
}

// ── mount idiom (house pattern, cf. lit-cached-embed.test.ts) ────

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(el: CachedEmbedElement): Promise<void> {
  await tick();
  await el.updateComplete;
  await tick();
  await el.updateComplete;
}

async function mount(tag: string, opts: {
  attrs?: Record<string, string>;
  html?: string;
} = {}): Promise<CachedEmbedElement> {
  const el = document.createElement(tag) as CachedEmbedElement;
  for (const [name, value] of Object.entries(opts.attrs ?? {})) el.setAttribute(name, value);
  if (opts.html) el.innerHTML = opts.html;
  (el as unknown as { fetchImpl: typeof fetch }).fetchImpl = noFetch();
  document.body.appendChild(el);
  customElements.upgrade(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('family B registration', () => {
  it('all nine tags register through defineSemext', () => {
    const ctors = [
      SemextAnnotate,
      SemextDocptr,
      SemextMediaPrompt,
      SemextSigLogs,
      SemextSigMetrics,
      SemextSigSyntheticMonitor,
      SemextSigTraces,
      SemextStyleguideTheme,
      SemextStyleguideThemes,
    ];
    TAGS.forEach((tag, i) => expect(customElements.get(tag), tag).toBe(ctors[i]));
  });

  it('the eight static embeds keep livePolicy never; annotate is the one exception', () => {
    for (const ctor of [SemextDocptr, SemextMediaPrompt, SemextSigLogs, SemextSigMetrics, SemextSigSyntheticMonitor, SemextSigTraces, SemextStyleguideTheme, SemextStyleguideThemes]) {
      expect((ctor as unknown as { livePolicy: string }).livePolicy, ctor.name).toBe('never');
    }
    expect(SemextAnnotate.livePolicy).toBe('anonymous-read');
  });

  it('static embeds never fetch, with or without an endpoint', async () => {
    const el = await mount('semext-sig-metrics', {
      attrs: { endpoint: 'https://apm.noizu.com/api/v1/metrics', query: 'service=x' },
      html: '<script type="application/json">{"columns":["a"],"rows":[["1"]]}</script>',
    });
    expect(el.getAttribute('status')).toBe('cached');
  });
});

describe('semext-docptr', () => {
  const ENTRY = {
    uuid: '1f0dc4bd-6b29-591d-b8e7-c8c55dd95a54',
    marker: '〚🔧:𓋹𓄿𓇳𓏏〛',
    file_path: 'src/data/load.ts',
    line: 42,
    kind: 'function',
    function_name: 'resolveSource',
    description: 'Resolve an embed source with the shared source policy.',
    snippet: 'export function resolveSource(input: string): SourceRef {',
  };

  it('renders the locator card for the selected uuid', async () => {
    const el = await mount('semext-docptr', {
      attrs: { uuid: ENTRY.uuid },
      html: `<script type="application/json">${JSON.stringify({ pointers: { [ENTRY.uuid]: ENTRY } })}</script>`,
    });
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-docptr-locator')?.textContent).toBe('src/data/load.ts:42');
    expect(chrome?.querySelector('.semext-docptr-kind')?.textContent).toBe('function');
    expect(chrome?.querySelector('.semext-docptr-fn')?.textContent).toBe('resolveSource');
    expect(chrome?.querySelector('.semext-docptr-snippet')?.textContent).toContain('resolveSource');
  });

  it('selects by token extracted from the marker', async () => {
    const el = await mount('semext-docptr', {
      attrs: { token: '𓋹𓄿𓇳𓏏' },
      html: `<script type="application/json">${JSON.stringify({ pointers: { [ENTRY.uuid]: ENTRY } })}</script>`,
    });
    expect((el.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-docptr-card')).toBeTruthy();
  });

  it('narrows by file and renders the missing note when nothing matches', async () => {
    const el = await mount('semext-docptr', {
      attrs: { file: 'lib/other.ts' },
      html: `<script type="application/json">${JSON.stringify({ pointers: { [ENTRY.uuid]: ENTRY } })}</script>`,
    });
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-docptr-missing')?.textContent).toContain('Pointer not in the cached snapshot');
  });

  it('with no identifiers a single-entry snapshot renders that entry', async () => {
    const el = await mount('semext-docptr', {
      html: `<script type="application/json">${JSON.stringify({ pointers: [ENTRY] })}</script>`,
    });
    expect((el.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-docptr-card')).toBeTruthy();
  });
});

describe('sig deep links', () => {
  it('metrics/traces/logs build the plain query/range/env link', async () => {
    const expected = sigLink({ query: 'service=annotate-srv', range: '1h', env: 'prod' });
    expect(expected).toBe('https://apm.noizu.com/?query=service%3Dannotate-srv&range=1h&env=prod');
    for (const tag of ['semext-sig-metrics', 'semext-sig-traces', 'semext-sig-logs']) {
      const el = await mount(tag, {
        attrs: { query: 'service=annotate-srv', range: '1h', env: 'prod' },
        html: '<script type="application/json">{"lines":[],"traces":[]}</script>',
      });
      const link = (el.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector<HTMLAnchorElement>('.semext-sig-link');
      expect(link, tag).toBeTruthy();
      expect(link?.href).toBe(expected);
      expect(link?.getAttribute('rel')).toBe('noopener');
    }
  });

  it('the synthetic monitor builds the monitor/env link', async () => {
    const el = await mount('semext-sig-synthetic-monitor', {
      attrs: { monitor: 'annotate-srv-threads', env: 'prod' },
      html: '<script type="application/json">{"monitor":{"name":"probe","interval":"5m","assertions":["GET → 200"]}}</script>',
    });
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-sig-title')?.textContent).toBe('probe');
    expect(chrome?.querySelector('.semext-sig-monitor-interval')?.textContent).toContain('5m');
    expect(chrome?.querySelectorAll('.semext-sig-monitor-asserts li').length).toBe(1);
    const link = chrome.querySelector<HTMLAnchorElement>('.semext-sig-link');
    expect(link?.href).toBe(sigLink({ monitor: 'annotate-srv-threads', env: 'prod' }));
  });

  it('absent parameters collapse to the bare base URL', () => {
    expect(sigLink({})).toBe('https://apm.noizu.com/');
    expect(sigLink({ query: '', range: null, env: undefined })).toBe('https://apm.noizu.com/');
  });

  it('the metrics table renders columns and rows; a non-tabular snapshot skips the table', async () => {
    const good = await mount('semext-sig-metrics', {
      attrs: { query: 'q' },
      html: '<script type="application/json">{"title":"t","columns":["service","p95"],"rows":[["annotate-srv","1.8s"]]}</script>',
    });
    const chrome = (good.querySelector('[data-sem-chrome]') as HTMLElement);
    expect(chrome.querySelectorAll('.semext-sig-table thead th').length).toBe(2);
    expect(chrome.querySelectorAll('.semext-sig-table tbody td').length).toBe(2);
    expect(chrome.querySelector('.semext-sig-title')?.textContent).toBe('t');

    const bad = await mount('semext-sig-metrics', {
      attrs: { query: 'q' },
      html: '<script type="application/json">{"title":"t"}</script>',
    });
    expect(((bad.querySelector('[data-sem-chrome]') as HTMLElement)).querySelector('.semext-sig-table')).toBeNull();
  });
});

describe('semext-styleguide-theme', () => {
  it('renders swatches only for plain colors — hostile values get no style', async () => {
    const el = await mount('semext-styleguide-theme', {
      attrs: { theme: 't' },
      html: `<script type="application/json">${JSON.stringify({
        theme: {
          name: 'Hostile Tokens',
          colors: [
            { token: '--good', value: '#2563eb', role: 'accent' },
            { token: '--evil-url', value: 'url(javascript:alert(1))', role: 'x' },
            { token: '--evil-expr', value: 'expression(alert(1))', role: 'x' },
            { token: '--evil-long', value: 'x'.repeat(80), role: 'x' },
            { token: '--named-ok', value: 'transparent', role: 'x' },
          ],
        },
      })}</script>`,
    });
    const dots = el.querySelectorAll<HTMLElement>('.semext-styleguide-theme-dot');
    expect(dots.length).toBe(5);
    expect(dots[0].getAttribute('style')).toBe('background: #2563eb');
    expect(dots[1].getAttribute('style')).toBeNull();
    expect(dots[2].getAttribute('style')).toBeNull();
    expect(dots[3].getAttribute('style')).toBeNull();
    expect(dots[4].getAttribute('style')).toBe('background: transparent');
  });

  it('renders the preview link only when src is authored', async () => {
    const linked = await mount('semext-styleguide-theme', {
      attrs: { theme: 't', src: 'themes/t.css' },
      html: '<script type="application/json">{"theme":{"name":"T"}}</script>',
    });
    const a = ((linked.querySelector('[data-sem-chrome]') as HTMLElement).querySelector<HTMLAnchorElement>('.semext-styleguide-theme-preview'));
    expect(a?.getAttribute('href')).toBe('themes/t.css');

    const plain = await mount('semext-styleguide-theme', {
      attrs: { theme: 't' },
      html: '<script type="application/json">{"theme":{"name":"T"}}</script>',
    });
    expect(((plain.querySelector('[data-sem-chrome]') as HTMLElement)).querySelector('.semext-styleguide-theme-preview')).toBeNull();
  });
});

describe('semext-styleguide-themes', () => {
  it('summarizes the snapshot slugs', async () => {
    const el = await mount('semext-styleguide-themes', {
      html: '<script type="application/json">{"themes":["minimal-tech-light","paper-ink","midnight-console"]}</script>',
    });
    const summary = (el.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-styleguide-themes-summary');
    expect(summary?.textContent).toContain('3 themes');
    expect(summary?.textContent).toContain('minimal-tech-light, paper-ink, midnight-console');
  });

  it('without snapshot slugs it counts its authored theme children', async () => {
    const el = await mount('semext-styleguide-themes', {
      html:
        '<script type="application/json">{}</script>' +
        '<semext-styleguide-theme theme="a" key="a"></semext-styleguide-theme>' +
        '<semext-styleguide-theme theme="b" key="b"></semext-styleguide-theme>',
    });
    const summary = (el.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-styleguide-themes-summary');
    expect(summary?.textContent).toContain('2 themes');
  });
});

describe('semext-media-prompt', () => {
  it('a filled region reports its authored assets', async () => {
    const el = await mount('semext-media-prompt', {
      attrs: { model: 'z-image-turbo', aspect: '16:9', assetsdir: '', key: 'hero-16x9' },
      html:
        '<pre><code>model: z-image-turbo</code></pre>' +
        '<!-- semtext:cache:start semext-media-prompt hero-16x9 -->' +
        '<ul><li><a href="assets/a.png">assets/a.png</a></li><li><a href="assets/b.webp">assets/b.webp</a></li></ul>' +
        '<!-- semtext:cache:end semext-media-prompt hero-16x9 -->' +
        '<script type="application/json">{"model":"z-image-turbo","aspect":"16:9"}</script>',
    });
    expect(el.getAttribute('data-semext-cache-region')).toBe('filled');
    const chrome = el.querySelector('[data-sem-chrome]') as HTMLElement;
    expect(chrome?.querySelector('.semext-media-prompt-state')?.textContent).toContain('2 authored assets');
    // the region is untouched — the authored list still lives in the element
    expect(el.querySelectorAll('ul li a').length).toBe(2);
  });

  it('an empty (or absent) region renders the not-generated placeholder', async () => {
    const fenced = await mount('semext-media-prompt', {
      attrs: { model: 'm', key: 'k1' },
      html:
        '<pre><code>model: m</code></pre>' +
        '<!-- semtext:cache:start semext-media-prompt k1 -->' +
        '<!-- semtext:cache:end semext-media-prompt k1 -->' +
        '<script type="application/json">{"model":"m"}</script>',
    });
    expect(fenced.getAttribute('data-semext-cache-region')).toBe('empty');
    expect((fenced.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-media-prompt-empty')).toBeTruthy();

    const bare = await mount('semext-media-prompt', {
      html: '<pre><code>model: m</code></pre><script type="application/json">{"model":"m"}</script>',
    });
    expect(bare.getAttribute('data-semext-cache-region')).toBe('empty');
    expect((bare.querySelector('[data-sem-chrome]') as HTMLElement)?.querySelector('.semext-media-prompt-empty')).toBeTruthy();
  });

  it('a foreign-keyed fence is no region for this element', async () => {
    const el = await mount('semext-media-prompt', {
      attrs: { key: 'mine' },
      html:
        '<!-- semtext:cache:start semext-media-prompt someone-else -->' +
        '<ul><li>x</li></ul>' +
        '<!-- semtext:cache:end semext-media-prompt someone-else -->' +
        '<script type="application/json">{}</script>',
    });
    expect(el.getAttribute('data-semext-cache-region')).toBe('empty');
    expect(el.querySelectorAll('ul li').length).toBe(1); // foreign content untouched
  });
});

describe('semext-sig-logs + traces rendering', () => {
  it('log lines carry lowercased severity hooks', async () => {
    const el = await mount('semext-sig-logs', {
      attrs: { query: 'q' },
      html: '<script type="application/json">{"lines":[{"ts":"t","severity":"ERROR","body":"boom"},{"ts":"t2","severity":"INFO","body":"ok"}]}</script>',
    });
    const rows = (el.querySelector('[data-sem-chrome]') as HTMLElement).querySelectorAll('.semext-sig-logline');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-severity')).toBe('error');
    expect(rows[1].getAttribute('data-severity')).toBe('info');
  });

  it('traces list id/root/meta and mark the error row', async () => {
    const el = await mount('semext-sig-traces', {
      attrs: { query: 'q' },
      html: '<script type="application/json">{"traces":[{"id":"a1","root":"POST /c","service":"checkout","durationMs":214,"spans":12,"error":false},{"id":"e5","root":"GET /t","service":"annotate-srv","durationMs":1840,"spans":9,"error":true}]}</script>',
    });
    const rows = (el.querySelector('[data-sem-chrome]') as HTMLElement).querySelectorAll('.semext-sig-trace');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-error')).toBe('false');
    expect(rows[1].getAttribute('data-error')).toBe('true');
    expect(rows[0].querySelector('.semext-sig-trace-id')?.textContent).toBe('a1');
    expect(rows[0].querySelector('.semext-sig-trace-meta')?.textContent).toContain('214 ms');
  });
});
