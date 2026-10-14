/**
 * viewer/boot-fetch.mjs — fetch the ?src= document with typed failures.
 *
 * Wraps fetch with the viewer's policy (design T3):
 *   - credentials: 'omit', referrerPolicy: 'no-referrer' — nothing rides along
 *   - the post-redirect final URL is re-checked against the allowlist
 *   - body read under the 10 MB cap (boot-url.readCapped)
 *
 * CORS blocks and network failures both reject fetch with a bare TypeError;
 * a `mode: 'no-cors'` probe separates them: if the probe resolves, the host
 * answered but withheld CORS permission → 'cors-blocked'; if it rejects too,
 * the host was unreachable → 'fetch-failed'. `fetchImpl` is injectable for
 * unit tests.
 */

import { checkFinalUrl, readCapped, viewerError } from './boot-url.mjs';

/**
 * @param {URL | string} url - validated src (see resolveViewerSrc)
 * @param {{origin: string, href: string}} page - boot loader identity
 * @param {{fetchImpl?: typeof fetch}} [deps]
 * @returns {Promise<{text: string, finalUrl: URL}>}
 */
export async function fetchDocument(url, page, deps = {}) {
  const doFetch = deps.fetchImpl || fetch.bind(globalThis);
  const requestUrl = url instanceof URL ? url : new URL(url, page.href);

  let response;
  try {
    response = await doFetch(requestUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
    });
  } catch (err) {
    throw await classifyTransportError(requestUrl, page, doFetch, err);
  }

  // T3: a redirect that leaves the allowlist ends the fetch — the body of a
  // drifted destination is never read.
  const finalUrl = new URL(response.url || requestUrl, page.href);
  const verdict = checkFinalUrl(finalUrl, page);
  if (!verdict.ok) {
    try { await response.body?.cancel?.(); } catch { /* best effort */ }
    throw viewerError(verdict.code, { url: finalUrl.href });
  }

  const text = await readCapped(response);
  return { text, finalUrl };
}

/**
 * Distinguish a CORS block from a network failure via a no-cors probe.
 * Probe resolves (opaque response exists) → the server was reachable and
 * refused CORS → 'cors-blocked'. Probe rejects → 'fetch-failed'.
 */
async function classifyTransportError(requestUrl, page, doFetch, cause) {
  try {
    await doFetch(requestUrl, {
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    throw viewerError('cors-blocked', { url: requestUrl.href });
  } catch (probeErr) {
    if (probeErr && probeErr.code === 'cors-blocked') throw probeErr;
    throw viewerError('fetch-failed', { url: requestUrl.href, cause: String(cause) });
  }
}
