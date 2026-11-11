// @vitest-environment happy-dom
// Unit spec — loader policy: classify by RESOLVED origin, never raw spelling
// (src/terminal/loader.ts + terminal-core.ts loadPluginFromUrl)

import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkSourceAllowed, isIntegrityFormat, verifyIntegrity } from '../../src/terminal/loader.js';
import { TerminalCore } from '../../src/terminal/terminal-core.js';

const HEX = 'sha256-' + 'a'.repeat(64);
const SRI = 'sha256-' + 'A'.repeat(43) + '=';

afterEach(() => vi.unstubAllGlobals());

describe('checkSourceAllowed bypass attempts', () => {
  it.each(['HTTPS://evil.example/m.json', '/\\evil.example/m.json', '//evil.example/m.json', '\\\\evil.example/m.json', ' https://evil.example/m.json'])(
    'refuses unpinned %s',
    (src) => {
      expect(() => checkSourceAllowed({ src }, 't')).toThrow(/refused/);
    },
  );

  it('refuses http://, data: and javascript: cross-origin even with integrity', () => {
    for (const src of ['http://evil.example/m.json', 'data:text/javascript,1', 'javascript:alert(1)']) {
      expect(() => checkSourceAllowed({ src, integrity: HEX }, 't')).toThrow(/refused/);
    }
  });

  it('accepts a pinned https cross-origin source (hex or SRI) and same-origin without integrity', () => {
    expect(() => checkSourceAllowed({ src: 'HTTPS://cdn.example/m.js', integrity: HEX }, 't')).not.toThrow();
    expect(() => checkSourceAllowed({ src: 'https://cdn.example/m.js', integrity: SRI }, 't')).not.toThrow();
    expect(() => checkSourceAllowed({ src: 'plugins/m.js' }, 't')).not.toThrow();
    expect(() => checkSourceAllowed({ src: '/abs/m.js' }, 't')).not.toThrow();
  });

  it('integrity formats: hex and SRI accepted, junk rejected', () => {
    expect(isIntegrityFormat(HEX)).toBe(true);
    expect(isIntegrityFormat(SRI)).toBe(true);
    expect(isIntegrityFormat('sha256-zzz')).toBe(false);
  });

  it('verifyIntegrity matches both forms', async () => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello')));
    const hex = 'sha256-' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    const sri = 'sha256-' + btoa(String.fromCharCode(...digest));
    expect(await verifyIntegrity('hello', hex)).toBe(true);
    expect(await verifyIntegrity('hello', sri)).toBe(true);
    expect(await verifyIntegrity('hellO', sri)).toBe(false);
  });
});

describe('manifest files[].src + loadErrors', () => {
  it('refuses an unpinned cross-origin files[].src and names the real plugin', async () => {
    const manifest = JSON.stringify({
      name: 'sneaky',
      version: '1.0.0',
      files: [{ path: '/x.txt', src: 'HTTPS://evil.example/x.txt' }],
    });
    const fetchMock = vi.fn(async () => new Response(manifest, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('remote/manifest.json');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // manifest only
    expect(core.loadErrors[0]!.plugin).toBe('sneaky');
    expect(core.vfs.read('/x.txt')).toBeNull();
  });

  it('accepts a relative same-origin files[].src without integrity', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(String(url).endsWith('manifest.json') ? JSON.stringify({ name: 'ok', version: '1.0.0', files: [{ path: '/x.txt', src: 'x.txt' }] }) : 'body', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const core = new TerminalCore();
    const result = await core.loadPluginFromUrl('remote/manifest.json');
    expect(result.ok).toBe(true);
    expect(core.vfs.read('/x.txt')).toBe('body');
  });
});
