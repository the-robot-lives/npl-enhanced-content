// @vitest-environment node
/**
 * Unit tests — viewer/boot-fetch.mjs: typed error mapping for the ?src=
 * fetch (task: fetch failure / CORS block / non-HTTPS + size cap and the
 * redirect re-check). fetch is injected, so classification is exact.
 */
import { describe, expect, it, vi } from 'vitest';

import { fetchDocument } from '../../viewer/boot-fetch.mjs';
import { MAX_DOCUMENT_BYTES } from '../../viewer/boot-url.mjs';

const PAGE = {
  origin: 'http://localhost:4190',
  href: 'http://localhost:4190/viewer/index.html',
};
const SRC = new URL('/viewer/samples/hello.html', PAGE.href);

const textResponse = (text, init = {}) =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/html' }, ...init });

describe('fetchDocument — success', () => {
  it('returns text with credentials omitted and no referrer', async () => {
    const spy = vi.fn(async () => textResponse('<p>hi</p>'));
    const { text } = await fetchDocument(SRC, PAGE, { fetchImpl: spy });
    expect(text).toBe('<p>hi</p>');
    const [, init] = spy.mock.calls[0];
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });
});

describe('fetchDocument — HTTP failure', () => {
  it('maps 404 to fetch-failed with the status in detail', async () => {
    const spy = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'fetch-failed',
      detail: { status: 404 },
    });
  });

  it('maps 500 to fetch-failed', async () => {
    const spy = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'fetch-failed',
      detail: { status: 500 },
    });
  });
});

describe('fetchDocument — CORS vs network (TypeError disambiguation)', () => {
  it('probe resolves → cors-blocked', async () => {
    // A real Response cannot carry status 0 (constructor range), and the
    // probe result is never read — an opaque-response-shaped shim suffices.
    const spy = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // CORS-enabled attempt
      .mockResolvedValueOnce({ ok: false, status: 0, type: 'opaque' }); // no-cors probe
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'cors-blocked',
    });
  });

  it('probe rejects too → fetch-failed (host unreachable)', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'fetch-failed',
    });
    expect(spy).toHaveBeenCalledTimes(2); // enabled attempt + no-cors probe
  });
});

describe('fetchDocument — redirect drift (design T3)', () => {
  it('a redirect off the allowlist is rejected without reading the body', async () => {
    // Response init has no `url` (fetch sets it), so the final destination
    // is faked with a minimal Response-shaped shim.
    let bodyRead = false;
    const shim = {
      ok: true,
      status: 200,
      url: 'https://intranet.local/lands-here',
      headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: async () => {} },
      text: async () => {
        bodyRead = true;
        return '<p>secret intranet</p>';
      },
    };
    const spy = vi.fn(async () => shim);
    await expect(
      fetchDocument(new URL('https://raw.githubusercontent.com/o/r/f'), PAGE, { fetchImpl: spy }),
    ).rejects.toMatchObject({ code: 'origin-not-allowed' });
    expect(bodyRead).toBe(false);
  });
});

describe('fetchDocument — size cap', () => {
  it('rejects a declared content-length over the cap with too-large', async () => {
    const spy = vi.fn(async () => textResponse('<p>hi</p>', {
      headers: { 'content-length': String(MAX_DOCUMENT_BYTES + 1) },
    }));
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('rejects a streamed body that grows past the cap', async () => {
    const chunk = 'a'.repeat(1024 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 11; i += 1) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const spy = vi.fn(async () => new Response(stream, { status: 200 }));
    await expect(fetchDocument(SRC, PAGE, { fetchImpl: spy })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('accepts a body just under the cap', async () => {
    const big = 'a'.repeat(MAX_DOCUMENT_BYTES - 1);
    const spy = vi.fn(async () => textResponse(big));
    const { text } = await fetchDocument(SRC, PAGE, { fetchImpl: spy });
    expect(text.length).toBe(MAX_DOCUMENT_BYTES - 1);
  });
});
