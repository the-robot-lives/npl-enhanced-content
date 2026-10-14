/**
 * extension/background.js — MV3 service worker (design §6/§7).
 *
 * One job in M2: open the viewer tab for a raw URL the content script
 * vouches for. chrome.tabs.create needs no "tabs" permission (design §6,
 * "deliberately not requested"); we never read tab state.
 *
 * The URL guard is the security boundary — a content script is page-reachable
 * code, so every request is re-validated here against the M2 allowlist
 * (public raw.githubusercontent.com only). Failures are typed rejections,
 * never silent drops (design D3).
 */

import { canOpenViewerTarget } from './lib/raw-url.mjs';

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'semtext:open') return undefined;
  if (!sender || sender.id !== chrome.runtime.id) {
    reply({ ok: false, code: 'foreign-sender' });
    return undefined;
  }

  const verdict = canOpenViewerTarget(String(msg.rawUrl || ''));
  if (!verdict.ok) {
    reply({ ok: false, code: verdict.code });
    return undefined;
  }

  // Hash, not query — nothing about the document URL hits a server (§7).
  chrome.tabs.create({
    url: `${chrome.runtime.getURL('viewer.html')}#${encodeURIComponent(verdict.url.href)}`,
  });
  reply({ ok: true });
  return undefined;
});
