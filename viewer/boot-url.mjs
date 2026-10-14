/**
 * viewer/boot-url.mjs — ?src= validation for the SemText hosted viewer (M1).
 *
 * The boot loader is a trusted page; before it ever fetches, the requested
 * src is resolved and checked here. Policy (design §1/§4.3/T3):
 *
 *   - absolute URLs must be https:
 *   - same-origin URLs are always allowed (samples on the viewer origin,
 *     which in local dev is http://localhost — relative form only)
 *   - cross-origin https is limited to the fetch allowlist
 *     (raw.githubusercontent.com, gist.githubusercontent.com)
 *   - a surface may narrow the allowlist via `page.allowedOrigins`
 *     (the extension viewer tab grants only the hosts its manifest has
 *     host_permissions for — design §6); the default stays FETCH_ORIGINS
 *
 * Pure module: the page passes `{ origin, href }` so tests need no DOM.
 * Every rejection is a typed error code from VIEWER_ERRORS; the boot loader
 * renders code + message — no silent fallback (design D3).
 */

/** Origins the hosted viewer may fetch from, besides its own (design §1). */
export const FETCH_ORIGINS = [
  'https://raw.githubusercontent.com',
  'https://gist.githubusercontent.com',
];

/** Document size cap (design T2: "10 MB document"). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Typed viewer errors. `code` is stable (tests + UI key off it); `message`
 * is user-facing. Fatal ones stop the boot; `origin-not-allowed` doubles for
 * the post-redirect final-URL re-check (design T3).
 */
export const VIEWER_ERRORS = {
  'invalid-src': {
    title: 'Missing or malformed ?src=',
    message: 'Give the viewer a document address: ?src=/samples/hello.html',
  },
  'non-https': {
    title: 'Non-HTTPS source refused',
    message: 'Only https: URLs (or same-origin paths) can be fetched.',
  },
  'origin-not-allowed': {
    title: 'Origin not allowed',
    message:
      'The viewer fetches only its own origin, raw.githubusercontent.com and gist.githubusercontent.com.',
  },
  'fetch-failed': {
    title: 'Could not fetch document',
    message: 'The document could not be retrieved (network error or HTTP error status).',
  },
  'cors-blocked': {
    title: 'Cross-origin fetch blocked',
    message:
      'The host did not allow this origin to read the document (CORS). Private GitHub files need the browser extension.',
  },
  'too-large': {
    title: 'Document too large',
    message: 'Documents are capped at 10 MB.',
  },
  'jail-failed': {
    title: 'Render jail failed',
    message: 'The render jail did not complete. No document code ran; this is a viewer fault, not a document effect.',
  },
};

/** Build a typed error object; `detail` carries status/URL for the UI. */
export function viewerError(code, detail) {
  const def = VIEWER_ERRORS[code];
  if (!def) throw new Error(`unknown viewer error code: ${code}`);
  return { code, title: def.title, message: def.message, detail: detail ?? null };
}

/**
 * Validate a ?src= value against the fetch policy.
 *
 * @param {string} raw - the raw query parameter (may be empty/undefined)
 * @param {{origin: string, href: string, allowedOrigins?: string[]}} page -
 *   boot loader identity; `allowedOrigins` narrows the cross-origin allowlist
 *   for a surface (extension viewer tab: raw.githubusercontent.com only — §6)
 * @returns {{ok: true, url: URL} | {ok: false, code: string}}
 */
export function resolveViewerSrc(raw, page) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, code: 'invalid-src' };
  }
  let url;
  try {
    url = new URL(raw, page.href);
  } catch {
    return { ok: false, code: 'invalid-src' };
  }
  // Scheme check BEFORE the origin check: a blob:/data: URL derives its
  // origin from its inner URL, so `blob:http://localhost:…` would otherwise
  // sail through as "same-origin". Only http(s) references qualify.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'non-https' };
  }
  if (url.origin === page.origin) {
    return { ok: true, url };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, code: 'non-https' };
  }
  const allowedOrigins = page.allowedOrigins || FETCH_ORIGINS;
  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, code: 'origin-not-allowed' };
  }
  return { ok: true, url };
}

/**
 * Re-check a post-redirect final URL (design T3) — same rules, but a drifted
 * final URL is always a rejection of the whole fetch.
 *
 * @param {URL} finalUrl - response.url resolved against the page
 * @param {{origin: string, allowedOrigins?: string[]}} page
 * @returns {{ok: true} | {ok: false, code: string}}
 */
export function checkFinalUrl(finalUrl, page) {
  if (finalUrl.protocol !== 'https:' && finalUrl.protocol !== 'http:') {
    return { ok: false, code: 'non-https' };
  }
  if (finalUrl.origin === page.origin) return { ok: true };
  if (finalUrl.protocol !== 'https:') return { ok: false, code: 'non-https' };
  const allowedOrigins = page.allowedOrigins || FETCH_ORIGINS;
  if (!allowedOrigins.includes(finalUrl.origin)) return { ok: false, code: 'origin-not-allowed' };
  return { ok: true };
}

/**
 * Read a Response body under the size cap. Throws viewerError('too-large')
 * when the declared length or the accumulated bytes exceed the cap, and
 * viewerError('fetch-failed') for a non-2xx status (detail.status kept).
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
export async function readCapped(response) {
  if (!response.ok) {
    throw viewerError('fetch-failed', { status: response.status, url: response.url });
  }
  const declared = Number(response.headers.get('content-length') || '0');
  if (declared > MAX_DOCUMENT_BYTES) {
    throw viewerError('too-large', { declared });
  }
  const reader = response.body?.getReader
    ? response.body.getReader()
    : null;
  if (!reader) {
    const text = await response.text();
    if (text.length > MAX_DOCUMENT_BYTES) throw viewerError('too-large', {});
    return text;
  }
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_DOCUMENT_BYTES) {
      try { await reader.cancel(); } catch { /* already gone */ }
      throw viewerError('too-large', { received });
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}
