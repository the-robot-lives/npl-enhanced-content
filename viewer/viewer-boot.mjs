/**
 * viewer/viewer-boot.mjs — boot loader page logic (the trusted surface).
 *
 * Owns fetch policy, viewer chrome, the provenance banner, the D2 consent
 * prompt and typed error display. Rendering happens only in the jail iframe
 * (sandbox="allow-scripts" — no allow-same-origin, no top navigation). This
 * page never parses the document: it holds text and passes it to the jail
 * via postMessage (design §3). No innerHTML anywhere — the page runs under
 * require-trusted-types-for 'script'.
 */

import { fetchDocument } from './boot-fetch.mjs';
import { resolveViewerSrc, viewerError } from './boot-url.mjs';

const JAIL_READY_TIMEOUT_MS = 8000;
const ALLOW_STORE_KEY = 'semtext-viewer-allow-hosts';

/** Message types the trusted jail emits; anything else from the jail frame
 *  means non-jail code is running in there — trip the security banner. */
const JAIL_MESSAGE_TYPES = new Set([
  'semtext:ready', 'semtext:render', 'semtext:consent', 'semtext:consent-result',
  'semtext:strip-report', 'semtext:height', 'semtext:navigate', 'semtext:error',
]);

const els = {
  provenance: document.getElementById('provenance'),
  status: document.getElementById('viewer-status'),
  error: document.getElementById('viewer-error'),
  consent: document.getElementById('viewer-consent'),
  consentHosts: document.getElementById('consent-hosts'),
  consentNote: document.getElementById('consent-note'),
  security: document.getElementById('viewer-security'),
  mount: document.getElementById('jail-mount'),
};

function setState(state) {
  document.documentElement.setAttribute('data-viewer-state', state);
}

function showError(code, detail) {
  const err = viewerError(code, detail);
  els.error.textContent = '';
  const title = document.createElement('p');
  title.setAttribute('data-error-title', '');
  title.textContent = err.title;
  const message = document.createElement('p');
  message.textContent = err.message;
  const codeLine = document.createElement('p');
  codeLine.setAttribute('data-error-code', '');
  codeLine.textContent = `error code: ${err.code}` +
    (err.detail && err.detail.status ? ` · HTTP ${err.detail.status}` : '');
  els.error.append(title, message, codeLine);
  els.error.hidden = false;
  els.status.hidden = true;
  setState('error');
  console.error(`[semtext-viewer] ${err.code}`, err.detail || '');
}

function jailFrame() {
  return els.mount.querySelector('iframe');
}

function boot(src) {
  const page = { origin: location.origin, href: location.href };
  const verdict = resolveViewerSrc(src, page);
  if (!verdict.ok) {
    showError(verdict.code);
    return;
  }
  els.status.textContent = 'Fetching document…';

  fetchDocument(verdict.url, page)
    .then(({ text, finalUrl }) => {
      els.provenance.textContent = `Rendered from ${finalUrl.href}`;
      embedJail(text, finalUrl.href);
    })
    .catch((err) => showError(err && err.code ? err.code : 'fetch-failed', err && err.detail));
}

let lastText = null;
let lastSrc = '';
let renderSent = false;
let renderAcked = false;
let jailReadyTimer = null;
let renderAckTimer = null;

function embedJail(text, srcHref) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); // opaque origin; scripts yes, same-origin no, popups no
  frame.setAttribute('src', 'jail.html');
  frame.setAttribute('title', 'SemText render jail');
  frame.addEventListener('load', () => {
    // Belt and braces: if the jail's ready ping was missed (module order),
    // render from the load event too — sendRender is idempotent.
    sendRender();
  });
  els.mount.replaceChildren(frame);

  lastText = text;
  lastSrc = srcHref;
  renderSent = false;

  jailReadyTimer = setTimeout(() => {
    if (!renderSent) showError('jail-failed', { message: 'render jail did not become ready' });
  }, JAIL_READY_TIMEOUT_MS);
}

function sendRender() {
  const frame = jailFrame();
  if (!frame || renderSent || lastText === null) return;
  renderSent = true;
  clearTimeout(jailReadyTimer);
  // If the jail accepts the render but dies before replying (e.g. its
  // module graph failed to load), don't hang — typed error after the grace
  // period. strip-report / semtext:error both count as an ack.
  renderAckTimer = setTimeout(() => {
    if (!renderAcked) showError('jail-failed', { message: 'jail accepted the document but produced no render' });
  }, JAIL_READY_TIMEOUT_MS);
  // targetOrigin '*': the jail is opaque-origin; its authenticity is the
  // sandbox itself plus its source check (event.source === window.parent).
  frame.contentWindow.postMessage({ type: 'semtext:render', text: lastText, meta: { src: lastSrc } }, '*');
}

window.addEventListener('message', (event) => {
  const frame = jailFrame();
  if (!frame || event.source !== frame.contentWindow) return;

  const data = event.data;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

  if (!JAIL_MESSAGE_TYPES.has(data.type)) {
    tripSecurity(data.type);
    return;
  }

  switch (data.type) {
    case 'semtext:ready':
      sendRender();
      break;
    case 'semtext:strip-report': {
      renderAcked = true;
      clearTimeout(renderAckTimer);
      const r = data.removed || {};
      const parts = [`stripped ${r.elements || 0} elements`, `${r.attrs || 0} event-handler attrs`, `${r.urls || 0} script URLs`];
      if (r.droppedAttrs || r.droppedCss) parts.push(`dropped ${(r.droppedAttrs || 0) + (r.droppedCss || 0)} unapproved subresources`);
      els.status.textContent = `Rendered · ${parts.join(' · ')}`;
      setState('rendered');
      break;
    }
    case 'semtext:height':
      if (Number.isFinite(data.height) && data.height > 0) frame.style.height = `${Math.ceil(data.height)}px`;
      break;
    case 'semtext:navigate':
      if (/^https?:/i.test(String(data.url))) window.open(data.url, '_blank', 'noopener');
      break;
    case 'semtext:consent':
      runConsentFlow(data.hosts || []);
      break;
    case 'semtext:error':
      renderAcked = true;
      clearTimeout(renderAckTimer);
      showError('jail-failed', { message: String(data.message || 'jail error') });
      break;
    default:
      break; // render / consent-result echo — jail-bound, not jail-sent
  }
});

/* ----------------------------- D2 consent ------------------------------- */

/**
 * Consent persistence seam (design §4.5). Default: localStorage (hosted
 * viewer, M1). A surface swaps it via setConsentStore — the extension viewer
 * tab write-throughs chrome.storage.sync ("always allow for this host").
 * Shape: { read(): string[], write(hosts: string[]): void } — both sync; the
 * extension store pre-reads at module init and merges asynchronously on
 * write (a late read only means one extra prompt — fail conservative).
 */
let consentStore = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(ALLOW_STORE_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((h) => typeof h === 'string') : [];
    } catch {
      return [];
    }
  },
  write(hosts) {
    try {
      const set = new Set([...this.read(), ...hosts]);
      localStorage.setItem(ALLOW_STORE_KEY, JSON.stringify([...set].sort()));
    } catch {
      /* storage unavailable — Allow-once semantics only */
    }
  },
};

export function setConsentStore(store) {
  consentStore = store;
}

function storedAllowedHosts() {
  return consentStore.read();
}

function persistAllowedHosts(hosts) {
  consentStore.write(hosts);
}

function runConsentFlow(hosts) {
  const known = new Set(storedAllowedHosts());
  const preApproved = hosts.filter((h) => known.has(h));
  const unknown = hosts.filter((h) => !known.has(h));

  if (unknown.length === 0) {
    replyConsent(hosts, preApproved, null);
    return;
  }

  els.consentHosts.replaceChildren(
    ...unknown.map((host) => {
      const li = document.createElement('li');
      li.setAttribute('data-consent-host', host);
      li.textContent = host;
      return li;
    }),
  );
  els.consentNote.textContent = 'Remote resources load only for approved hosts. Blocking still renders the document.';
  els.consent.hidden = false;

  let settled = false;
  const finish = (mode) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    els.consent.hidden = true;
    if (mode === 'always') persistAllowedHosts(unknown);
    const allowed = mode === 'block' ? preApproved : hosts;
    const note = mode === 'block' ? 'unapproved hosts dropped' : null;
    replyConsent(hosts, allowed, note);
  };

  const timer = setTimeout(() => {
    els.consentNote.textContent = 'Timed out — remote resources blocked.';
    finish('block');
  }, 5000);

  document.getElementById('consent-allow-once').addEventListener('click', () => finish('once'), { once: true });
  document.getElementById('consent-allow-always').addEventListener('click', () => finish('always'), { once: true });
  document.getElementById('consent-block').addEventListener('click', () => finish('block'), { once: true });
}

function replyConsent(allHosts, allowed, note) {
  const denied = allHosts.filter((h) => !allowed.includes(h));
  jailFrame()?.contentWindow?.postMessage(
    { type: 'semtext:consent-result', allowed, denied },
    '*',
  );
  if (note) console.info(`[semtext-viewer] consent: ${note}`);
}

/* ---------------------------- tripwire ---------------------------------- */

function tripSecurity(type) {
  els.security.textContent =
    `Security: the jail emitted an unknown message type (${type}). ` +
    'If a document script produced this, it ran in a null-origin box with no APIs — but this is a strip-pass failure and must be reported.';
  els.security.hidden = false;
  document.documentElement.setAttribute('data-viewer-security', 'tripped');
  console.error(`[semtext-viewer] unknown message from jail frame: ${type}`);
}

/* ------------------------------ boot ------------------------------------ */

/**
 * Boot a document by URL — the extension viewer tab entry point (M2: the
 * raw path opens viewer.html#<encodeURIComponent(rawUrl)>, design §7). The
 * hosted viewer keeps its auto-entry below (?src=). Source of the URL is
 * the caller's business; validation and fetch policy are shared.
 *
 * @param {string} src - already-extracted source URL/path
 */
export function bootViewerWithSrc(src) {
  setState('loading');
  boot(src);
}

const src = new URLSearchParams(location.search).get('src');
if (src === null) {
  // No src yet: the landing state doubles as usage help, not an error.
  // (els.status is guarded so the module stays importable in DOM-less
  // environments — unit tests; a real page always has the element.)
  setState('idle');
  if (els.status) els.status.textContent = 'Add ?src=/viewer/samples/hello.html to render a document.';
} else {
  bootViewerWithSrc(src);
}
