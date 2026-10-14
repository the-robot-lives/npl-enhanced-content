// @vitest-environment happy-dom
// Unit spec — <sem-artifact-card>, the agent-kit artifacts upsell stub
//
// Feature: typed artifact rendering (markdown / json / diff / code) over a
//   version list with a timeline scrub, copy, and fork — zero network
//   Scenario: each type renders from fixture versions (markdown escaped)
//   Scenario: the timeline slider scrubs and the rendered content follows
//   Scenario: copy writes the current content to the clipboard
//   Scenario: fork revision appends a local copy and moves the slider
//   Scenario: a versions JSON attribute overrides the fixture
//   Scenario: the authored zero-JS fallback shows the active version, no controls

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SemArtifactCard } from '../../src/lit/sem-artifact-card.js';
import '../../src/lit/sem-artifact-card.js';
import {
  ARTIFACT_FIXTURES,
  renderMarkdown,
  artifactFallbackHtml,
} from '../../src/lit/sem-artifact-card.js';

type Card = SemArtifactCard & { updateComplete: Promise<boolean> };

const versionsAttr = (i: number): string => JSON.stringify(ARTIFACT_FIXTURES[i].versions);

/** Mount a card with optional `k=v k2=v2` attributes and wait for its first render. */
async function mount(attrs = ''): Promise<Card> {
  const el = document.createElement('sem-artifact-card') as Card;
  for (const pair of attrs.split(' ').filter(Boolean)) {
    const eq = pair.indexOf('=');
    el.setAttribute(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const scrub = (el: Card): HTMLInputElement =>
  el.querySelector<HTMLInputElement>('.sem-artifact-scrub')!;

describe('sem-artifact-card (interactive tier)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the default fixture artifact as markdown', async () => {
    const el = await mount();
    expect(el.querySelector('.sem-artifact-ui')!.getAttribute('data-type')).toBe('markdown');
    const body = el.querySelector('.sem-artifact-body')!;
    // fixture headings are "## …" → renderer maps them to h3 (h2 stays page-title territory)
    expect(body.querySelector('h3')!.textContent).toBe('Run summary');
    expect(body.querySelector('strong')!.textContent).toBe('repo-audit');
    expect(body.querySelectorAll('li').length).toBe(3);
    // default start is active-version v3
    expect(el.querySelector('.sem-artifact-version')!.textContent).toContain('Final · 2026-10-13');
  });

  it('markdown cannot execute scripts or inject inline HTML', async () => {
    const el = await mount('active-version=v1');
    const body = el.querySelector('.sem-artifact-body')!;
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('img')).toBeNull();
    // the hostile fragments survive as visible text, escaped
    expect(body.textContent).toContain("alert('pwn')");
    expect(body.textContent).toContain('onerror="alert(1)"');
    // and the renderer alone never emits content-supplied tags
    expect(renderMarkdown('<img src=x onerror="a()">')).not.toContain('<img');
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
  });

  it('renders json pretty-printed, raw on invalid input', async () => {
    const el = await mount(`type=json active-version=v2 versions=${encodeURIComponent(versionsAttr(1))}`);
    const pre = el.querySelector('.sem-artifact-pre')!;
    expect(pre.textContent).toContain('"gate": "strict"');
    expect(pre.textContent).toContain('\n  "thresholds"');

    const bad = await mount(
      `type=json versions=${encodeURIComponent(
        '[{"id":"a","label":"A","createdAt":"2026-01-01T00:00:00Z","content":"{oops"}]',
      )}`,
    );
    expect(bad.querySelector('.sem-artifact-pre')!.textContent).toContain('{oops');
  });

  it('renders diff lines as added / removed / hunk', async () => {
    const el = await mount(`type=diff active-version=v2 versions=${encodeURIComponent(versionsAttr(2))}`);
    expect(el.querySelectorAll('.sem-artifact-diff-add').length).toBe(3);
    expect(el.querySelectorAll('.sem-artifact-diff-del').length).toBe(1);
    expect(el.querySelectorAll('.sem-artifact-diff-hunk').length).toBe(1);
    expect(el.querySelector('.sem-artifact-pre')!.textContent).toContain('timeoutMs: 15_000');
  });

  it('renders code preformatted with a language chip', async () => {
    const el = await mount(
      `type=code language=typescript active-version=v3 versions=${encodeURIComponent(versionsAttr(3))}`,
    );
    expect(el.querySelector('.sem-artifact-lang')!.textContent).toBe('typescript');
    expect(el.querySelector('.sem-artifact-pre code')).toBeTruthy();
    expect(el.querySelector('.sem-artifact-pre')!.textContent).toContain('retries exhausted');
  });

  it('the timeline slider scrubs and the rendered content follows', async () => {
    const el = await mount();
    const label = () => el.querySelector('.sem-artifact-version')!.textContent;
    expect(el.querySelector('.sem-artifact-count')!.textContent).toContain('3 / 3');

    scrub(el).value = '0';
    scrub(el).dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(scrub(el).value).toBe('0');
    expect(label()).toContain('First pass');
    expect(el.querySelector('.sem-artifact-body')!.textContent).toContain('open tickets');
    expect(el.querySelector('.sem-artifact-count')!.textContent).toContain('1 / 3');

    scrub(el).value = '2';
    scrub(el).dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(el.querySelector('.sem-artifact-body')!.textContent).toContain('CHANGELOG appended');
  });

  it('copy writes the current content to the clipboard and nothing else', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const el = await mount();
    el.querySelector<HTMLButtonElement>('.sem-artifact-copy')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ARTIFACT_FIXTURES[0].versions[2].content);
    expect(el.querySelector('.sem-artifact-status')!.textContent).toBe('Copied');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fork revision appends a local copy, moves the slider, and sends nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const el = await mount();
    const forks: Array<{ version: { id: string; content: string } }> = [];
    el.addEventListener('sem-artifact-fork', (e) =>
      forks.push((e as CustomEvent).detail),
    );

    el.querySelector<HTMLButtonElement>('.sem-artifact-fork')!.click();
    await el.updateComplete;

    expect(el.versions.length).toBe(ARTIFACT_FIXTURES[0].versions.length + 1);
    expect(forks[0].version.id).toBe('local-1');
    expect(forks[0].version.content).toBe(ARTIFACT_FIXTURES[0].versions[2].content);
    expect(el.querySelector('.sem-artifact-version')!.textContent).toContain('Fork of Final');
    expect(scrub(el).max).toBe('3');
    expect(el.querySelector('.sem-artifact-count')!.textContent).toContain('4 / 4');

    el.querySelector<HTMLButtonElement>('.sem-artifact-fork')!.click();
    await el.updateComplete;
    expect(forks[1].version.id).toBe('local-2');
    expect(el.querySelector('.sem-artifact-count')!.textContent).toContain('5 / 5');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a versions JSON attribute overrides the fixture; active-version picks the start', async () => {
    const el = await mount(
      `active-version=b versions=${encodeURIComponent(
        '[{"id":"a","label":"A","createdAt":"2026-01-01T00:00:00Z","content":"alpha"},' +
          '{"id":"b","label":"B","createdAt":"2026-01-02T00:00:00Z","content":"beta"}]',
      )}`,
    );
    expect(el.querySelector('.sem-artifact-version')!.textContent).toContain('B · 2026-01-02');
    expect(el.querySelector('.sem-artifact-body')!.textContent).toContain('beta');
    expect(scrub(el).value).toBe('1');
    expect(scrub(el).max).toBe('1');
  });
});

describe('sem-artifact-card zero-JS tier', () => {
  it('fallback markup shows the active version and no controls', () => {
    const host = document.createElement('div');
    host.innerHTML = `<sem-artifact-card>${artifactFallbackHtml()}</sem-artifact-card>`;
    const fallback = host.querySelector('.sem-artifact-fallback')!;
    expect(fallback).toBeTruthy();
    // no controls without JS
    expect(fallback.querySelector('button')).toBeNull();
    expect(fallback.querySelector('input[type="range"]')).toBeNull();
    // the active version (v3, Final) is the content shown
    expect(fallback.querySelector('.sem-artifact-body h3')!.textContent).toBe('Run summary');
    expect(fallback.querySelector('.sem-artifact-version')!.textContent).toContain('Final');
    expect(fallback.querySelector('script')).toBeNull();
  });

  it('the fallback renders every fixture type through the same renderers', () => {
    const host = document.createElement('div');
    host.innerHTML = `<sem-artifact-card>${artifactFallbackHtml(ARTIFACT_FIXTURES[1])}</sem-artifact-card>`;
    expect(host.querySelector('.sem-artifact-pre')!.textContent).toContain('"gate": "strict"');

    host.innerHTML = `<sem-artifact-card>${artifactFallbackHtml(ARTIFACT_FIXTURES[2])}</sem-artifact-card>`;
    expect(host.querySelector('.sem-artifact-diff-add')).toBeTruthy();

    host.innerHTML = `<sem-artifact-card>${artifactFallbackHtml(ARTIFACT_FIXTURES[3])}</sem-artifact-card>`;
    expect(host.querySelector('.sem-artifact-pre code')).toBeTruthy();
    expect(host.querySelector('.sem-artifact-lang')!.textContent).toBe('typescript');
  });

  it('upgrading replaces the authored fallback with the interactive card', async () => {
    const el = document.createElement('sem-artifact-card') as Card;
    el.innerHTML = artifactFallbackHtml();
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.querySelector('.sem-artifact-fallback')).toBeNull();
    expect(scrub(el)).toBeTruthy();
    expect(el.querySelector('.sem-artifact-fork')).toBeTruthy();
  });
});
