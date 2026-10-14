// @vitest-environment happy-dom
/**
 * Unit tests — M2 extension raw path (design §6/§7/§9).
 *
 * Covers extension/lib/raw-url.mjs (the background's URL guard, the content
 * script's banner heuristic, the viewer tab's hash parsing), the surface
 * seams the extension adds to the shared boot (viewer-boot exports +
 * consent store shape, boot-url allowedOrigins narrowing), and the vendor
 * contract (extension sources import vendored modules).
 * happy-dom: viewer-boot.mjs resolves its element map at import time.
 */
import { describe, expect, it } from 'vitest';

import {
  RAW_HOSTS,
  canOpenViewerTarget,
  looksLikeHtmlDocument,
  parseViewerHash,
} from '../../extension/lib/raw-url.mjs';
import { resolveViewerSrc } from '../../viewer/boot-url.mjs';
import * as boot from '../../viewer/viewer-boot.mjs';

const EXT_PAGE = {
  origin: 'chrome-extension://semtext-test-id',
  href: 'chrome-extension://semtext-test-id/viewer.html',
  allowedOrigins: ['https://raw.githubusercontent.com'],
};

describe('canOpenViewerTarget — background guard (accept)', () => {
  const accepts = (raw) =>
    it(`${raw}`, () => {
      const v = canOpenViewerTarget(raw);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.url).toBeInstanceOf(URL);
    });

  accepts('https://raw.githubusercontent.com/o/r/main/doc.html');
  accepts('https://raw.githubusercontent.com/o/r/main/index.htm');
  accepts('https://raw.githubusercontent.com/o/r/refs/heads/main/doc.html');
  accepts('https://raw.githubusercontent.com/o/r/main/data.txt'); // text docs render too
});

describe('canOpenViewerTarget — background guard (reject)', () => {
  const rejects = (raw, code) =>
    it(`${JSON.stringify(raw)} → ${code}`, () => {
      expect(canOpenViewerTarget(raw)).toEqual({ ok: false, code });
    });

  rejects(undefined, 'invalid-url');
  rejects('', 'invalid-url');
  rejects('   ', 'invalid-url');
  rejects('not a url', 'invalid-url');
  rejects('http://raw.githubusercontent.com/o/r/main/doc.html', 'non-https');
  rejects('file:///etc/passwd', 'non-https');
  rejects('javascript:alert(1)', 'non-https');
  rejects('data:text/html,<h1>hi</h1>', 'non-https');
  rejects('blob:https://raw.githubusercontent.com/uuid', 'non-https');
  rejects('https://github.com/o/r/raw/main/doc.html', 'origin-not-allowed'); // M3, not M2
  rejects('https://gist.githubusercontent.com/u/g/raw/doc.html', 'origin-not-allowed');
  rejects('https://raw.githubusercontent.com.evil.test/o/r/doc.html', 'origin-not-allowed');
  rejects('https://raw.githubusercontent.com@evil.test/doc.html', 'origin-not-allowed');
  rejects('https://user:pass@raw.githubusercontent.com/o/r/doc.html', 'origin-not-allowed');
});

describe('looksLikeHtmlDocument — content-script banner heuristic', () => {
  it('matches html/htm/xhtml (case-insensitive)', () => {
    expect(looksLikeHtmlDocument('/o/r/main/doc.html')).toBe(true);
    expect(looksLikeHtmlDocument('/o/r/main/INDEX.HTM')).toBe(true);
    expect(looksLikeHtmlDocument('/o/r/main/page.xhtml')).toBe(true);
  });

  it('does not match non-HTML paths or lookalikes', () => {
    expect(looksLikeHtmlDocument('/o/r/main/doc.md')).toBe(false);
    expect(looksLikeHtmlDocument('/o/r/main/doc.html.txt')).toBe(false);
    expect(looksLikeHtmlDocument('/o/r/main/.htmlignore')).toBe(false);
    expect(looksLikeHtmlDocument('')).toBe(false);
    expect(looksLikeHtmlDocument(undefined)).toBe(false);
  });
});

describe('parseViewerHash — viewer tab entry (design §7: hash, not query)', () => {
  it('decodes an encoded URL', () => {
    const url = 'https://raw.githubusercontent.com/o/r/main/a%20b.html';
    expect(parseViewerHash(`#${encodeURIComponent(url)}`)).toEqual({ ok: true, url });
  });

  it('tolerates an unencoded URL and a missing leading hash', () => {
    const url = 'https://raw.githubusercontent.com/o/r/main/doc.html';
    expect(parseViewerHash(`#${url}`)).toEqual({ ok: true, url });
    expect(parseViewerHash(url)).toEqual({ ok: true, url });
  });

  it('rejects empty/absent hashes', () => {
    expect(parseViewerHash('')).toEqual({ ok: false, code: 'invalid-src' });
    expect(parseViewerHash('#')).toEqual({ ok: false, code: 'invalid-src' });
    expect(parseViewerHash(null)).toEqual({ ok: false, code: 'invalid-src' });
  });

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(parseViewerHash('#https://example.com/%zz')).toEqual({ ok: false, code: 'invalid-src' });
  });
});

describe('surface seams the extension adds to the shared boot', () => {
  it('viewer-boot exports the boot entry and consent-store seam', () => {
    expect(typeof boot.bootViewerWithSrc).toBe('function');
    expect(typeof boot.setConsentStore).toBe('function');
  });

  it('a consent store shaped {read, write} is accepted', () => {
    const store = { read: () => [], write: () => {} };
    expect(() => boot.setConsentStore(store)).not.toThrow();
    boot.setConsentStore({
      read() {
        try {
          return JSON.parse(globalThis.localStorage?.getItem('semtext-viewer-allow-hosts') || '[]');
        } catch {
          return [];
        }
      },
      write() {},
    });
  });

  it('allowedOrigins narrows the hosted allowlist for the extension surface', () => {
    // gist is allowed for the hosted viewer…
    const hosted = { origin: 'https://viewer.semtext.dev', href: 'https://viewer.semtext.dev/' };
    expect(resolveViewerSrc('https://gist.githubusercontent.com/u/g/raw/d.html', hosted).ok).toBe(true);
    // …but the extension tab grants only raw.githubusercontent.com (design §6)
    const gist = resolveViewerSrc('https://gist.githubusercontent.com/u/g/raw/d.html', EXT_PAGE);
    expect(gist).toEqual({ ok: false, code: 'origin-not-allowed' });
    const raw = resolveViewerSrc('https://raw.githubusercontent.com/o/r/main/d.html', EXT_PAGE);
    expect(raw.ok).toBe(true);
  });

  it('RAW_HOSTS matches the M2 manifest host_permissions (single source of truth)', async () => {
    const { default: manifest } = await import('../../extension/manifest.json', { with: { type: 'json' } });
    expect(manifest.host_permissions).toEqual(RAW_HOSTS.map((h) => `https://${h}/*`));
  });
});
