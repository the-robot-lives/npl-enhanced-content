/**
 * extension/lib/raw-url.mjs — pure URL policy for the M2 extension raw path
 * (design §6/§7/§9). Unit-tested in test/unit/extension-raw-url.test.mjs.
 *
 * M2 scope: PUBLIC raw.githubusercontent.com documents only. The blob path
 * and the cookie-authenticated github.com /raw/ fetch (design D3/§8) are
 * M3 — github.com URLs are deliberately NOT accepted here yet; the manifest
 * grants no github.com host permission in M2.
 */

/** Hosts the extension viewer tab may fetch (manifest host_permissions, M2). */
export const RAW_HOSTS = ['raw.githubusercontent.com'];

/**
 * Background guard: may this URL be opened in the viewer tab? Any text
 * document on an allowed raw host qualifies — the .html/.htm check is the
 * content script's banner heuristic, not a security boundary.
 *
 * @param {string} raw
 * @returns {{ok: true, url: URL} | {ok: false, code: string}}
 */
export function canOpenViewerTarget(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, code: 'invalid-url' };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid-url' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, code: 'non-https' };
  }
  if (!RAW_HOSTS.includes(url.hostname) || url.username || url.password) {
    return { ok: false, code: 'origin-not-allowed' };
  }
  return { ok: true, url };
}

/**
 * Content-script banner heuristic: does this raw path LOOK like an HTML
 * document? Wrong answers are harmless — the background guard is the
 * authority; the banner is only a button (design §6 content_scripts row).
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function looksLikeHtmlDocument(pathname) {
  return /\.(html?|xhtml)$/i.test(String(pathname || ''));
}

/**
 * Parse the viewer tab's location.hash (design §7: "hash, not query —
 * nothing hits a server"). Format: `#` + encodeURIComponent(url). A stray
 * unencoded URL is tolerated (decodeURIComponent is skipped when no % is
 * present); junk input is a typed rejection, never a throw.
 *
 * @param {string} hash - location.hash (with or without the leading '#')
 * @returns {{ok: true, url: string} | {ok: false, code: string}}
 */
export function parseViewerHash(hash) {
  let value = String(hash ?? '').replace(/^#/, '');
  if (value.trim() === '') {
    return { ok: false, code: 'invalid-src' };
  }
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return { ok: false, code: 'invalid-src' };
    }
  }
  return { ok: true, url: value };
}
