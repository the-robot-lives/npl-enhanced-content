// @vitest-environment happy-dom
// Unit spec — src/lit/sem-media-prompt.ts · the active media-generation record
// BDD source of truth: spec/schema/sem-media-prompt.md
//
// Feature: sem-media-prompt renders the authored .media.prompt record and,
//          only when an author-pointed endpoint is set, runs a generation
//   Scenario: the authored YAML parses into params chrome; authored bytes survive
//   Scenario: invalid YAML blocks a run with an inline alert, never a fetch
//   Scenario: edit-mode textarea emits sem-media-prompt-change on valid input
//   Scenario: an invalid edit shows the parser error and emits nothing
//   Scenario: Generate POSTs {model?,prompt,negative?,aspect?,seed?} as JSON
//   Scenario: the reply renders gallery + evals and emits sem-media-added per asset
//   Scenario: the element's own gallery never double-appends its own events
//   Scenario: an authored nested gallery is reused, not duplicated
//   Scenario: fixtures apply locally and veto the endpoint (inline + path + bare array)
//   Scenario: no endpoint ⇒ no button, no fetch, no fabricated output
//   Scenario: a JSON snapshot with output.generated renders at upgrade
//   Scenario: non-2xx / network errors alert inline, reflect error, re-enable
//   Scenario: data-<name> mirrors win over bare attributes
//   Scenario: renderText projects the record + output for the tui driver

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// the named import evaluates the module, which registers <sem-media-prompt>
import { SemMediaPrompt, resolveAssetSrc } from '../../src/lit/sem-media-prompt.js';
// the nested gallery must be defined for the reuse / no-double-append cases
import '../../src/lit/sem-media-gallery.js';

const YAML = [
  'prompt: SemText vocabulary diagram, flat vector',
  'negative: text artifacts',
  'aspect: 16:9',
  'seed: 42',
].join('\n') + '\n';

function authored(yaml: string = YAML, extra = ''): string {
  return `<pre><code class="language-yaml">${yaml}</code></pre>${extra}`;
}

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const REPLY = {
  output: {
    assets: [
      { path: 'hero-v1.png', kind: 'image', mime: 'image/png', caption: 'v1' },
      { path: 'hero-v2.png', kind: 'image', mime: 'image/png', caption: 'v2' },
    ],
    evals: [{ rubric: 'brand-palette', score: 4, max: 5 }],
  },
};

async function mount(attrs: Record<string, string> = {}, inner = authored()): Promise<SemMediaPrompt> {
  const el = document.createElement('sem-media-prompt') as SemMediaPrompt;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = inner;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const chrome = (el: SemMediaPrompt) => el.querySelector('.sem-media-prompt-chrome') as HTMLDivElement;
const alertBox = (el: SemMediaPrompt) => el.querySelector('.sem-media-prompt-error') as HTMLDivElement;
const generateBtn = (el: SemMediaPrompt) => el.querySelector('.sem-media-prompt-generate') as HTMLButtonElement | null;
const editor = (el: SemMediaPrompt) => el.querySelector('.sem-media-prompt-input') as HTMLTextAreaElement | null;

/** Click Generate and wait for the run to settle (status leaves generating). */
async function run(el: SemMediaPrompt): Promise<void> {
  generateBtn(el)!.click();
  await vi.waitFor(() => { expect(el.status === 'generating').toBe(false); });
  await el.updateComplete;
}

async function galleryItems(el: SemMediaPrompt): Promise<Array<{ src: string; caption: string; mime: string }>> {
  const gallery = el.querySelector('sem-media-gallery') as HTMLElement & { updateComplete: Promise<boolean> };
  await gallery.updateComplete;
  // items attribute is the source of truth for created/pre-upgrade galleries;
  // upgraded galleries append via the window listener — read the rendered cards.
  const cards = gallery.shadowRoot?.querySelectorAll('.card');
  if (cards && cards.length > 0) {
    return Array.from(cards).map((card) => ({
      src: (card.querySelector('img, video') as HTMLImageElement | null)?.getAttribute('src') ?? '',
      caption: card.querySelector('.card-caption')?.textContent ?? '',
      mime: '',
    }));
  }
  return JSON.parse(gallery.getAttribute('items') || '[]');
}

describe('sem-media-prompt', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('authored record', () => {
    it('parses the YAML into params chrome and leaves the authored block byte-identical', async () => {
      const el = await mount({ model: 'z-image-turbo', 'assets-dir': 'assets/' });
      const params = el.querySelector('.sem-media-prompt-params')!;
      expect(params.textContent).toContain('z-image-turbo');
      expect(params.textContent).toContain('16:9');
      expect(params.textContent).toContain('seed 42');
      expect(el.querySelector('code.language-yaml')!.textContent).toBe(YAML);
      expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
      // all chrome lives inside the one marked container
      expect(chrome(el).getAttribute('data-sem-chrome')).toBe('');
      expect(el.querySelector('.sem-media-prompt-generate')).toBeNull();
    });

    it('mints no gallery and no output without endpoint, fixtures or snapshot', async () => {
      const el = await mount();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(el.querySelector('sem-media-gallery')).toBeNull();
      expect(el.status).toBe('idle');
    });

    it('renders a generated JSON snapshot at upgrade without any fetch', async () => {
      const snapshot = `<script type="application/json">${JSON.stringify({
        model: 'z-image-turbo',
        output: { generated: true, assets: [{ path: 'assets/snap.png', mime: 'image/png', caption: 'snap' }], evals: [] },
      })}</script>`;
      const el = await mount({}, authored(YAML, snapshot));
      expect(fetchMock).not.toHaveBeenCalled();
      const items = await galleryItems(el);
      expect(items.map((i) => i.src)).toEqual(['assets/snap.png']);
      expect(el.status).toBe('generated');
    });
  });

  describe('generation (endpoint mode)', () => {
    it('POSTs the parsed record as JSON and omits absent optional keys', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({ endpoint: '/api/media', model: 'z-image-turbo', 'assets-dir': 'assets/' });
      await run(el);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/media');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        prompt: 'SemText vocabulary diagram, flat vector',
        negative: 'text artifacts',
        aspect: '16:9',
        seed: 42,
        model: 'z-image-turbo',
      });
    });

    it('omits model when unauthored and falls back to the aspect attribute', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const yaml = 'prompt: a quiet lighthouse\n';
      const el = await mount({ endpoint: '/api/media', aspect: '9:16' }, authored(yaml));
      await run(el);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ prompt: 'a quiet lighthouse', aspect: '9:16' });
      expect('model' in body).toBe(false);
      expect('seed' in body).toBe(false);
    });

    it('renders the reply into a gallery + evals, resolves assets-dir, reflects generated', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({ endpoint: '/api/media', 'assets-dir': 'assets/' });
      await run(el);

      const items = await galleryItems(el);
      expect(items.map((i) => i.src)).toEqual(['assets/hero-v1.png', 'assets/hero-v2.png']);
      expect(items[0].caption).toBe('v1');
      const evalEl = el.querySelector('.sem-media-prompt-evals sem-eval')!;
      expect(evalEl.textContent).toContain('brand-palette');
      expect(evalEl.textContent).toContain('4 / 5');
      expect(el.status).toBe('generated');
      expect(el.getAttribute('status')).toBe('generated');
      expect(alertBox(el).hidden).toBe(true);
    });

    it('emits sem-media-added per asset (bubbles, composed) without double-appending its own gallery', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({ endpoint: '/api/media' });
      const seen: Array<{ src: string; caption: string; mime: string }> = [];
      window.addEventListener('sem-media-added', ((e: CustomEvent) => seen.push(e.detail)) as EventListener);

      await run(el);
      expect(seen.map((d) => d.src)).toEqual(['hero-v1.png', 'hero-v2.png']);
      expect(seen[0]).toEqual({ src: 'hero-v1.png', caption: 'v1', mime: 'image/png' });

      // own gallery holds exactly the two assets — not four
      expect((await galleryItems(el)).length).toBe(2);

      // a second run appends once more (listener path), still no duplicates
      fetchMock.mockResolvedValue(jsonResponse({ output: { assets: [{ path: 'hero-v3.png' }], evals: [] } }));
      await run(el);
      expect((await galleryItems(el)).map((i) => i.src)).toEqual(['hero-v1.png', 'hero-v2.png', 'hero-v3.png']);
      window.removeEventListener('sem-media-added', ((e: CustomEvent) => seen.push(e.detail)) as EventListener);
    });

    it('reuses an authored nested gallery instead of creating a second one', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const nested = `<sem-media-gallery items='[{"src":"authored.png","caption":"old","mime":"image/png"}]'></sem-media-gallery>`;
      const el = await mount({ endpoint: '/api/media' }, authored(YAML, nested));
      await run(el);

      expect(el.querySelectorAll('sem-media-gallery').length).toBe(1);
      const items = await galleryItems(el);
      expect(items.map((i) => i.src)).toEqual(['authored.png', 'hero-v1.png', 'hero-v2.png']);
    });

    it('blocks a run on invalid YAML with an inline alert and never fetches', async () => {
      const el = await mount({ endpoint: '/api/media' }, authored('prompt: ok\nbogus: key\n'));
      await run(el);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(alertBox(el).hidden).toBe(false);
      expect(alertBox(el).textContent).toContain('unknown key');
      expect(el.status).toBe('error');
    });

    it('alerts inline on a non-2xx reply and re-enables the button', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      const el = await mount({ endpoint: '/api/media' });
      await run(el);
      expect(alertBox(el).hidden).toBe(false);
      expect(alertBox(el).textContent).toContain('500');
      expect(el.status).toBe('error');
      expect(generateBtn(el)!.disabled).toBe(false);
    });

    it('alerts inline on a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      const el = await mount({ endpoint: '/api/media' });
      await run(el);
      expect(alertBox(el).textContent).toContain('offline');
      expect(el.status).toBe('error');
      expect(generateBtn(el)!.disabled).toBe(false);
    });
  });

  describe('fixtures (local-only)', () => {
    it('applies inline fixtures at upgrade, never fetches, shows no Generate button', async () => {
      const fixtures = JSON.stringify({ output: { assets: [{ src: 'https://x.test/f.png', caption: 'fix', mime: 'image/png' }], evals: [] } });
      const el = await mount({ endpoint: '/api/media', fixtures });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(generateBtn(el)).toBeNull();
      expect((await galleryItems(el)).map((i) => i.src)).toEqual(['https://x.test/f.png']);
      expect(el.status).toBe('generated');
    });

    it('accepts the bare gallery-item array shape', async () => {
      const fixtures = JSON.stringify([{ src: 'https://x.test/a.png', caption: 'a', mime: 'image/png' }]);
      const el = await mount({ fixtures });
      expect((await galleryItems(el)).map((i) => i.src)).toEqual(['https://x.test/a.png']);
    });

    it('fetches a fixture path once (same-origin GET) and never the endpoint', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({ endpoint: '/api/media', fixtures: '/fixtures/media.json' });
      await vi.waitFor(() => { expect(el.status).toBe('generated'); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/fixtures/media.json');
      expect(generateBtn(el)).toBeNull();
    });
  });

  describe('edit mode', () => {
    it('seeds the textarea with the authored YAML and emits parsed fields on valid input', async () => {
      const el = await mount({ 'edit-mode': '' });
      const textarea = editor(el)!;
      expect(textarea.value).toBe(YAML);

      const events: Array<Record<string, string>> = [];
      el.addEventListener('sem-media-prompt-change', ((e: CustomEvent) => events.push(e.detail)) as EventListener);
      textarea.value = 'prompt: a new dawn\nseed: 7\n';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      expect(events.length).toBe(1);
      expect(events[0]).toEqual({ prompt: 'a new dawn', seed: '7' });
      // the authored record is never rewritten by an edit
      expect(el.querySelector('code.language-yaml')!.textContent).toBe(YAML);
    });

    it('shows the parser error and emits nothing on invalid input', async () => {
      const el = await mount({ 'edit-mode': '' });
      const events: unknown[] = [];
      el.addEventListener('sem-media-prompt-change', ((e: CustomEvent) => events.push(e.detail)) as EventListener);
      const textarea = editor(el)!;
      textarea.value = 'not yaml at all';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      expect(events.length).toBe(0);
      expect(alertBox(el).hidden).toBe(false);
      expect(alertBox(el).textContent).toContain('not key: value');
    });

    it('honors edit-mode through an ancestor sem-editor', async () => {
      const wrapper = document.createElement('sem-editor');
      wrapper.setAttribute('edit-mode', '');
      document.body.appendChild(wrapper);
      const el = document.createElement('sem-media-prompt') as SemMediaPrompt;
      el.innerHTML = authored();
      wrapper.appendChild(el);
      await el.updateComplete;
      expect(editor(el)).not.toBeNull();
    });
  });

  describe('dual data- form', () => {
    it('data-endpoint and data-model win over the bare spellings', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({
        endpoint: '/wrong', 'data-endpoint': '/right',
        model: 'wrong-model', 'data-model': 'right-model',
      });
      await run(el);
      expect(fetchMock.mock.calls[0][0]).toBe('/right');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('right-model');
    });
  });

  describe('terminal text view', () => {
    it('renderText projects the record and the not-generated state', async () => {
      const el = await mount({ model: 'z-image-turbo' });
      const text = el.renderText({ cols: 60 });
      expect(text).toContain('MEDIA PROMPT');
      expect(text).toContain('z-image-turbo');
      expect(text).toContain('prompt: SemText vocabulary diagram');
      expect(text).toContain('seed: 42');
      expect(text).toContain('not generated yet');
      expect(text.split('\n').every((line) => line.length <= 60)).toBe(true);
    });

    it('renderText reports assets and eval meters after a run', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPLY));
      const el = await mount({ endpoint: '/api/media' });
      await run(el);
      const text = el.renderText({ cols: 80 });
      expect(text).toContain('2 assets');
      expect(text).toContain('1 eval');
      expect(text).toContain('brand-palette');
      expect(text).toContain('4/5');
      expect(text).toContain('█');
    });
  });

  describe('resolveAssetSrc', () => {
    it('passes absolute URLs and root-relative paths through, joins relative paths', () => {
      expect(resolveAssetSrc('https://x.test/a.png', 'assets/')).toBe('https://x.test/a.png');
      expect(resolveAssetSrc('/abs/a.png', 'assets/')).toBe('/abs/a.png');
      expect(resolveAssetSrc('a.png', 'assets/')).toBe('assets/a.png');
      expect(resolveAssetSrc('a.png', '')).toBe('a.png');
      expect(resolveAssetSrc('', 'assets/')).toBe('');
    });
  });
});