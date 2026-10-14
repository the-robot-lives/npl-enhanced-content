// @vitest-environment node
/**
 * Unit tests — M2 extension package structure (design §6).
 *
 * Static guards over the manifest and page wiring: MV3 shape, the M2
 * permission envelope (raw only, no github.com, no WAR/options — those are
 * M3), the sandboxed jail, and that the pages reference the vendored
 * trusted bundle set rather than remote code (design §4.1).
 */
import { describe, expect, it } from 'vitest';

import manifest from '../../extension/manifest.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ext = (p) => resolve(process.cwd(), 'extension', p);
const read = (p) => readFileSync(ext(p), 'utf8');

describe('manifest — MV3 shape (design §6)', () => {
  it('is manifest v3 with a module service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  });

  it('declares the raw content script only (blob path is M3)', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(['https://raw.githubusercontent.com/*']);
    expect(manifest.content_scripts[0].js).toEqual(['content.js']);
  });

  it('grants exactly raw.githubusercontent.com host access (private/raw-on-github is M3)', () => {
    expect(manifest.host_permissions).toEqual(['https://raw.githubusercontent.com/*']);
  });

  it('requests storage only (design §6: no tabs/cookies/scripting/identity)', () => {
    expect(manifest.permissions).toEqual(['storage']);
    const forbidden = ['tabs', 'cookies', 'scripting', 'identity', 'downloads', 'webRequest'];
    for (const p of forbidden) expect(manifest.permissions).not.toContain(p);
    expect(manifest.permissions).not.toContain('<all_urls>');
  });

  it('delays WAR and options_ui to M3 (nothing blob-related in M2)', () => {
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.options_ui).toBeUndefined();
    expect(manifest.action).toBeUndefined();
  });

  it('declares jail.html a sandboxed page (no chrome.* APIs — design §4.3/§4.4)', () => {
    expect(manifest.sandbox).toEqual({ pages: ['jail.html'] });
  });

  it('sandbox CSP: no eval, script only from the package, passive remote resources', () => {
    const csp = manifest.content_security_policy.sandbox;
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/img-src [^;]*https:/);
    expect(csp).toMatch(/style-src [^;]*https:/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("base-uri 'none'");
  });
});

describe('extension pages — no remote code, vendored bundle set (design §4.1)', () => {
  it('jail.html loads the vendored bundle + jail boot, nothing remote', () => {
    const html = read('jail.html');
    expect(html).toContain('src="./vendor/semtext.js"');
    expect(html).toContain('src="./vendor/jail-boot.mjs"');
    expect(html).not.toMatch(/src="https?:\/\//);
  });

  it('viewer.html wires the vendored boot chain', () => {
    const html = read('viewer.html');
    expect(html).toContain('href="./vendor/viewer.css"');
    expect(html).toContain('src="./viewer.js"');
    expect(html).not.toMatch(/src="https?:\/\//);
    for (const id of ['provenance', 'viewer-status', 'viewer-error', 'viewer-consent', 'jail-mount']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('viewer.js consumes the vendored boot module and the pure guard', () => {
    const js = read('viewer.js');
    expect(js).toContain("from './vendor/viewer-boot.mjs'");
    expect(js).toContain("from './lib/raw-url.mjs'");
  });

  it('background.js imports the pure guard (unit-tested)', () => {
    expect(read('background.js')).toContain("from './lib/raw-url.mjs'");
  });

  it('content.js holds no document parsing (text never touches the page)', () => {
    const js = read('content.js');
    expect(js).not.toMatch(/DOMParser|innerHTML|document\.write/);
    expect(js).toContain('semtext:open');
  });
});

describe('extension/vendor — build artifacts present (local unpacked load)', () => {
  it('vendored modules + bundle exist after scripts/build-extension.mjs', () => {
    for (const name of [
      'boot-url.mjs',
      'boot-fetch.mjs',
      'viewer-boot.mjs',
      'jail-boot.mjs',
      'jail-strip.mjs',
      'viewer.css',
      'semtext.js',
      'MANIFEST.txt',
    ]) {
      expect(() => readFileSync(ext(`vendor/${name}`)), `vendor/${name}`).not.toThrow();
    }
  });
});
