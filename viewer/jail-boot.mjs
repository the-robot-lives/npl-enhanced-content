/**
 * viewer/jail-boot.mjs — inside the render jail (sandbox="allow-scripts",
 * opaque origin). Runs in the SemText jail document (viewer/jail.html),
 * which loads the trusted bundle /dist/semtext.js.
 *
 * Contract with the boot loader (design §7):
 *   jail → parent  semtext:ready                  jail alive, SemText global present
 *   parent → jail  semtext:render {text, meta}    payload is untrusted text
 *   jail → parent  semtext:consent {hosts}        D2 prompt request
 *   parent → jail  semtext:consent-result {allowed, denied}
 *   jail → parent  semtext:strip-report {removed} telemetry for the chrome
 *   jail → parent  semtext:height {height}        auto-resize
 *   jail → parent  semtext:navigate {url}         link opens via the parent
 *   jail → parent  semtext:error {message}        catastrophic jail failure
 *
 * The jail accepts messages only from window.parent. The document's own
 * scripts are never re-injected: stripPayload has already removed them, and
 * the only script this frame ever runs is the jail's own trusted pair
 * (/dist/semtext.js + this file).
 */

import { collectRemoteHosts, dropUnapproved, stripPayload } from './jail-strip.mjs';

const VIEWER_ORIGIN = new URL(location.href).origin;
const CONSENT_TIMEOUT_MS = 5000; // no answer ⇒ treated as deny-all (fail closed on resources)

const knownMessageTypes = new Set([
  'semtext:ready', 'semtext:render', 'semtext:consent', 'semtext:consent-result',
  'semtext:strip-report', 'semtext:height', 'semtext:navigate', 'semtext:error',
]);

function toParent(message) {
  // targetOrigin '*': the jail is opaque-origin — it cannot compute the
  // parent's origin for enforcement; the parent side authenticates messages
  // by event.source === the jail frame (design §7 does the same).
  window.parent.postMessage(message, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.origin !== VIEWER_ORIGIN) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'semtext:render') {
    render(data.text, data.meta || {}).catch((err) => {
      toParent({ type: 'semtext:error', message: String(err && err.message || err) });
    });
  } else if (data.type === 'semtext:consent-result') {
    settleConsent(data);
  }
});

// SemText is loaded by jail.html before this module (classic script order).
// Boot telemetry lands in the DOM so a headless dump can verify the jail
// came up (and Chrome support can see what the jail saw).
document.documentElement.setAttribute('data-jail-boot', `semtext=${typeof window.SemText}`);
if (!window.SemText) {
  toParent({ type: 'semtext:error', message: 'SemText bundle failed to load in jail' });
} else {
  toParent({ type: 'semtext:ready' });
}

async function render(text, meta) {
  const { doc, removed } = stripPayload(String(text), { baseUrl: location.href });

  // D2 consent: distinct remote hosts; approved-only survive to render.
  const hosts = collectRemoteHosts(doc, { baseUrl: location.href });
  let allowed = [];
  let consentNote = null;
  if (hosts.length > 0) {
    const verdict = await askConsent(hosts);
    allowed = verdict.allowed;
    consentNote = verdict.note;
    const { droppedAttrs, droppedCss } = dropUnapproved(doc, allowed, { baseUrl: location.href });
    removed.droppedAttrs = droppedAttrs;
    removed.droppedCss = droppedCss;
  }

  adoptDocument(doc, meta);
  rerunEnhance();

  toParent({
    type: 'semtext:strip-report',
    removed,
    hosts,
    allowed,
    consentNote,
    title: doc.title || '',
  });
  reportHeight();
}

/** Move the stripped document into the jail: data-* html attributes (theme),
 *  head stylesheets/styles, body children. Links get target=_blank + noopener;
 *  with no allow-popups the sandbox blocks direct opens — clicks are trapped
 *  and surfaced to the parent as semtext:navigate (§4.4). */
function adoptDocument(doc, meta) {
  document.title = doc.title || 'SemText document';

  const docEl = doc.documentElement;
  for (const attr of [...docEl.attributes]) {
    if (/^data-/i.test(attr.name)) document.documentElement.setAttribute(attr.name, attr.value);
  }

  for (const node of [...doc.head.childNodes]) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'style') {
      document.head.appendChild(document.adoptNode(node));
    } else if (tag === 'link' && (node.getAttribute('rel') || '').toLowerCase().includes('stylesheet')) {
      document.head.appendChild(document.adoptNode(node));
    }
    // everything else in the head stays behind
  }

  const provenance = document.createElement('div');
  provenance.setAttribute('data-jail-provenance', '');
  provenance.setAttribute('data-src', String(meta.src || ''));
  document.body.appendChild(provenance);

  for (const child of [...doc.body.childNodes]) {
    document.body.appendChild(document.adoptNode(child));
  }

  for (const a of document.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    event.preventDefault();
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), document.baseURI).href;
    } catch {
      return;
    }
    if (/^https?:/i.test(url)) toParent({ type: 'semtext:navigate', url });
  }, true);
}

/** Re-run the bundle's enhancement passes over the (newly populated) jail
 *  document — the supported re-scan entry points (src/index.ts exports them
 *  "so a host can re-run on new DOM"). Handlers skip data-sem-upgraded
 *  elements, so the load-bearing pass order stays intact. */
function rerunEnhance() {
  const S = window.SemText;
  S.enhanceCore(document);
  S.enhanceMdDocument(document);
  S.enhanceReading(document);
}

function reportHeight() {
  const height = Math.max(
    document.body ? document.body.scrollHeight : 0,
    document.documentElement ? document.documentElement.scrollHeight : 0,
  );
  toParent({ type: 'semtext:height', height });
}

/* ------------------------- D2 consent handshake ------------------------- */

let consentResolve = null;

function askConsent(hosts) {
  toParent({ type: 'semtext:consent', hosts });
  return new Promise((resolve) => {
    consentResolve = resolve;
    setTimeout(() => {
      if (consentResolve === resolve) {
        consentResolve = null;
        resolve({ allowed: [], note: 'consent timed out — remote resources blocked' });
      }
    }, CONSENT_TIMEOUT_MS);
  });
}

function settleConsent(data) {
  if (!consentResolve) return;
  const resolve = consentResolve;
  consentResolve = null;
  const allowed = Array.isArray(data.allowed) ? data.allowed.filter((h) => typeof h === 'string') : [];
  resolve({ allowed, note: data.denied && data.denied.length ? 'unapproved hosts dropped' : null });
}

// Tripwire for the headless check: anything the JAIL sends is typed above.
// (A document script that somehow ran would postMessage the parent directly
// with an unknown type — the PARENT trips its banner on that, not us.)
void knownMessageTypes;
