/**
 * extension/content.js — raw.githubusercontent.com content script (M2).
 *
 * Injects a Render banner on raw .html/.htm views. The click asks the
 * service worker to open the viewer tab (chrome.tabs is not available in a
 * content script). This script holds no document text and never parses
 * document HTML — the fetch and render happen in the viewer page + jail
 * (design §1/§2/§7).
 *
 * Classic script: content scripts cannot declare modules in the manifest.
 * The banner heuristic is a path check only — wrong answers are harmless
 * (worst case: a button on a non-HTML raw file); the background's
 * lib/raw-url.mjs guard is the authority.
 */
(() => {
  'use strict';

  if (document.documentElement.hasAttribute('data-semtext-raw')) return;
  document.documentElement.setAttribute('data-semtext-raw', '');

  // Banner heuristic — keep the shape in sync with looksLikeHtmlDocument()
  // in lib/raw-url.mjs (unit-tested there). Host/https are guaranteed by
  // the manifest match pattern; only the extension matters here.
  if (!/\.(html?|xhtml)$/i.test(location.pathname)) return;

  const MESSAGE_TYPES = {
    'invalid-url': 'the address could not be parsed',
    'non-https': 'only https raw URLs are supported',
    'origin-not-allowed': 'this host is not in the viewer allowlist',
    'foreign-sender': 'the request did not come from this extension',
  };

  const banner = document.createElement('div');
  banner.setAttribute('data-semtext-raw-banner', '');

  const label = document.createElement('span');
  label.textContent = 'This looks like an HTML document.';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-semtext-render-button', '');
  button.textContent = 'Render with SemText';

  const status = document.createElement('span');
  status.setAttribute('data-semtext-raw-status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  button.addEventListener('click', () => {
    status.textContent = 'Opening viewer…';
    try {
      chrome.runtime.sendMessage(
        { type: 'semtext:open', rawUrl: location.href },
        (reply) => {
          const err = chrome.runtime.lastError;
          if (err) {
            status.textContent = `Viewer unavailable: ${err.message}`;
            return;
          }
          if (reply && reply.ok) {
            status.textContent = 'Opened in a new tab.';
          } else {
            status.textContent = `Cannot render: ${MESSAGE_TYPES[reply && reply.code] || 'unknown error'}`;
          }
        },
      );
    } catch (err) {
      status.textContent = `Cannot render: ${err && err.message ? err.message : 'extension unreachable'}`;
    }
  });

  const style = banner.style;
  style.position = 'fixed';
  style.left = '0';
  style.right = '0';
  style.bottom = '0';
  style.zIndex = '2147483647';
  style.display = 'flex';
  style.gap = '12px';
  style.alignItems = 'center';
  style.padding = '10px 16px';
  style.background = '#1f2430';
  style.color = '#f5f7fa';
  style.font = '14px/1.4 system-ui, sans-serif';
  style.boxShadow = '0 -2px 8px rgba(0, 0, 0, 0.35)';

  button.style.cursor = 'pointer';

  banner.append(label, button, status);
  document.documentElement.appendChild(banner);
})();
