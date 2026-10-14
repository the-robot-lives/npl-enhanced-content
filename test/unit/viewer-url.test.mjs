// @vitest-environment node
/**
 * Unit tests — viewer/boot-url.mjs: ?src= validation (design §1/§4.3/T3)
 * and the post-redirect final-URL re-check. No DOM needed.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_DOCUMENT_BYTES,
  VIEWER_ERRORS,
  checkFinalUrl,
  resolveViewerSrc,
  viewerError,
} from '../../viewer/boot-url.mjs';

const PAGE_HTTP = {
  origin: 'http://localhost:4190',
  href: 'http://localhost:4190/viewer/index.html',
};
const PAGE_HTTPS = {
  origin: 'https://viewer.semtext.dev',
  href: 'https://viewer.semtext.dev/',
};

describe('resolveViewerSrc — accept', () => {
  const accepts = (raw, page = PAGE_HTTP) =>
    it(`${JSON.stringify(raw)}`, () => {
      const v = resolveViewerSrc(raw, page);
      expect(v.ok).toBe(true);
      if (v.ok) expect(typeof v.url.href).toBe('string');
    });

  accepts('/viewer/samples/hello.html');
  accepts('samples/hello.html');
  accepts('./hello.html');
  accepts('../samples/hello.html');
  accepts('?src=hello.html'); // resolves against the page
  accepts('://broken'); // parses as a same-origin PATH — weird, harmless, 404s at fetch
  accepts('http://localhost:4190/viewer/samples/hello.html'); // same-origin absolute
  accepts('https://raw.githubusercontent.com/o/r/main/doc.html', PAGE_HTTPS);
  accepts('https://gist.githubusercontent.com/u/g/raw/doc.html', PAGE_HTTPS);
});

describe('resolveViewerSrc — reject', () => {
  const rejects = (raw, code, page = PAGE_HTTP) =>
    it(`${JSON.stringify(raw)} → ${code}`, () => {
      const v = resolveViewerSrc(raw, page);
      expect(v).toEqual({ ok: false, code });
    });

  rejects(undefined, 'invalid-src');
  rejects('', 'invalid-src');
  rejects('   ', 'invalid-src');
  rejects('http://', 'invalid-src'); // unparseable

  rejects('http://example.com/doc.html', 'non-https');
  rejects('file:///etc/passwd', 'non-https');
  rejects('data:text/html,<h1>hi</h1>', 'non-https');
  rejects('javascript:parent.postMessage(1)', 'non-https');
  // blob: derives its origin from the inner URL — `blob:http://localhost:…`
  // would look same-origin, so the scheme check runs first (non-http(s) → reject)
  rejects('blob:http://localhost:4190/uuid', 'non-https');
  rejects('//evil.example.com/doc.html', 'non-https'); // protocol-relative on an http page

  rejects('https://evil.example.com/doc.html', 'origin-not-allowed');
  rejects('https://raw.githubusercontent.com.evil.example.com/doc.html', 'origin-not-allowed');
  // userinfo is not origin: raw.githubusercontent.com@evil.example.com ≠ raw
  rejects('https://raw.githubusercontent.com@evil.example.com/doc.html', 'origin-not-allowed');
  rejects('//viewer.semtext.dev/doc.html', 'non-https'); // http page → resolves http
  rejects('https://viewer.semtext.dev/doc.html', 'origin-not-allowed', PAGE_HTTP); // https but foreign to this page
});

describe('checkFinalUrl — post-redirect re-check (T3)', () => {
  it('keeps same-origin and allowlisted destinations', () => {
    expect(checkFinalUrl(new URL('http://localhost:4190/x'), PAGE_HTTP).ok).toBe(true);
    expect(
      checkFinalUrl(new URL('https://raw.githubusercontent.com/o/r/f'), PAGE_HTTPS).ok,
    ).toBe(true);
  });

  it('rejects drifted destinations', () => {
    expect(checkFinalUrl(new URL('http://evil.example.com/x'), PAGE_HTTPS)).toEqual({
      ok: false,
      code: 'non-https',
    });
    expect(checkFinalUrl(new URL('https://evil.example.com/x'), PAGE_HTTPS)).toEqual({
      ok: false,
      code: 'origin-not-allowed',
    });
  });
});

describe('viewerError — typed errors', () => {
  it('carries title/message/code and detail', () => {
    const err = viewerError('fetch-failed', { status: 404 });
    expect(err.code).toBe('fetch-failed');
    expect(err.title).toBe(VIEWER_ERRORS['fetch-failed'].title);
    expect(err.detail).toEqual({ status: 404 });
  });

  it('refuses unknown codes (no silent fallback — D3)', () => {
    expect(() => viewerError('made-up-code')).toThrow(/unknown viewer error code/);
  });

  it('caps documents at 10 MB', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});
