/**
 * viewer/jail-strip.mjs — the defense-in-depth strip pass + consent scan.
 *
 * Runs INSIDE the render jail on every payload before anything is attached
 * to the jail document (design §4.2). DOMParser documents have scripting
 * disabled, so nothing executes at parse time; the walk covers template
 * content; what survives cannot execute:
 *
 *   - elements removed: script, iframe, frame, object, embed, applet,
 *     base, link[rel=import], meta[http-equiv=refresh]
 *   - any attribute matching /^on/i removed
 *   - URL attributes resolving to javascript: / vbscript: / data:text/html
 *     removed (whitespace/control chars inside the scheme are stripped first
 *     — `java\tscript:` must not survive)
 *   - style= / <style> survive (CSS does not execute in modern engines);
 *     their REMOTE loads go through the consent gate (§4.5)
 *
 * collectRemoteHosts powers the D2 consent prompt (distinct remote hosts);
 * dropUnapproved neutralises the subresources of hosts the user refused.
 * Pure module — tests run it under happy-dom.
 */

/** Elements that could execute or re-base a document; removed outright. */
export const STRIPPED_ELEMENTS = [
  'script', 'iframe', 'frame', 'object', 'embed', 'applet', 'base',
];

/** URL-bearing attributes checked for dangerous schemes / remote hosts. */
export const URL_ATTRS = [
  'href', 'src', 'srcset', 'xlink:href', 'action', 'formaction',
  'poster', 'data', 'background',
];

const DANGEROUS_SCHEMES = ['javascript:', 'vbscript:', 'data:text/html'];

/**
 * Strip a full HTML document text.
 * @param {string} htmlText untrusted document text
 * @param {{baseUrl: string}} opts base for relative URL resolution (the jail URL)
 * @returns {{doc: Document, removed: {elements: number, attrs: number, urls: number}}}
 */
export function stripPayload(htmlText, opts) {
  const baseUrl = opts.baseUrl;
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const removed = { elements: 0, attrs: 0, urls: 0 };

  // Static list FIRST (removals never invalidate the walk), template
  // content included — templates are inert but cloned alive at render.
  const all = allElementsIncludingTemplates(doc);

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (STRIPPED_ELEMENTS.includes(tag)) {
      el.remove();
      removed.elements += 1;
      continue;
    }
    if (tag === 'meta' &&
        (el.getAttribute('http-equiv') || '').trim().toLowerCase() === 'refresh') {
      el.remove();
      removed.elements += 1;
      continue;
    }
    if (tag === 'link' &&
        (el.getAttribute('rel') || '').trim().toLowerCase().split(/\s+/).includes('import')) {
      el.remove();
      removed.elements += 1;
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        removed.attrs += 1;
        continue;
      }
      if (URL_ATTRS.includes(name)) {
        if (isDangerousUrl(attr.value)) {
          el.removeAttribute(attr.name);
          removed.urls += 1;
        }
      }
    }
  }

  return { doc, removed };
}

/**
 * Distinct remote hosts referenced by the stripped tree: URL attributes,
 * srcset candidates, and CSS url()/@import in <style> and style=.
 * Relative and same-origin references are excluded — they render under the
 * jail's own origin. Remote data:/blob: are not hosts (nothing to consent
 * to; the jail CSP remains the ceiling).
 *
 * @param {Document} doc stripped document
 * @param {{baseUrl: string}} opts
 * @returns {string[]} sorted distinct remote hosts (host[:port])
 */
export function collectRemoteHosts(doc, opts) {
  const hosts = new Set();
  const all = allElementsIncludingTemplates(doc);

  for (const el of all) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === 'srcset') {
        for (const candidate of splitSrcset(attr.value)) {
          noteRemote(candidate, hosts, opts.baseUrl);
        }
      } else if (URL_ATTRS.includes(name)) {
        noteRemote(attr.value, hosts, opts.baseUrl);
      } else if (name === 'style') {
        for (const cssUrl of cssUrls(attr.value)) noteRemote(cssUrl, hosts, opts.baseUrl);
      }
    }
    if (el.tagName.toLowerCase() === 'style') {
      for (const cssUrl of cssUrls(el.textContent)) noteRemote(cssUrl, hosts, opts.baseUrl);
    }
  }

  return [...hosts].sort();
}

/**
 * Neutralise subresources of remote hosts the user did not approve (§4.5):
 * URL attributes are removed; CSS url()/@import for unapproved hosts are
 * rewritten to `about:invalid` (declaration fails silently, rest survives).
 *
 * @param {Document} doc stripped document
 * @param {string[]} allowedHosts hosts the user approved
 * @param {{baseUrl: string}} opts
 * @returns {{droppedAttrs: number, droppedCss: number}}
 */
export function dropUnapproved(doc, allowedHosts, opts) {
  const allowed = new Set(allowedHosts);
  let droppedAttrs = 0;
  let droppedCss = 0;
  const all = allElementsIncludingTemplates(doc);

  for (const el of all) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === 'srcset') {
        // Drop whole candidates only; surviving candidates keep their
        // descriptors, and a no-drop pass must leave the value untouched.
        const rawParts = String(attr.value).split(',');
        const kept = rawParts.filter(
          (part) => !isRemoteBlocked(part.trim().split(/\s+/)[0], allowed, opts.baseUrl),
        );
        if (kept.length !== rawParts.length) {
          const next = kept.map((part) => part.trim()).join(', ');
          if (next === '') el.removeAttribute('srcset');
          else el.setAttribute('srcset', next);
          droppedAttrs += 1;
        }
      } else if (URL_ATTRS.includes(name)) {
        if (isRemoteBlocked(attr.value, allowed, opts.baseUrl)) {
          el.removeAttribute(attr.name);
          droppedAttrs += 1;
        }
      } else if (name === 'style') {
        const { css, dropped } = neutralizeCss(attr.value, allowed, opts.baseUrl);
        if (dropped > 0) {
          el.setAttribute('style', css);
          droppedCss += dropped;
        }
      }
    }
    if (el.tagName.toLowerCase() === 'style') {
      const { css, dropped } = neutralizeCss(el.textContent, allowed, opts.baseUrl);
      if (dropped > 0) {
        el.textContent = css;
        droppedCss += dropped;
      }
    }
  }

  return { droppedAttrs, droppedCss };
}

/* ------------------------------------------------------------------ */

function allElementsIncludingTemplates(doc) {
  const out = [...doc.querySelectorAll('*')];
  for (const tpl of doc.querySelectorAll('template')) {
    if (tpl.content) out.push(...tpl.content.querySelectorAll('*'));
  }
  return out;
}

/** True for javascript:/vbscript:/data:text/html in any letter-casing or
 *  whitespace-obfuscated spelling (`jav&#x09;ascript:` decodes before us). */
export function isDangerousUrl(value) {
  const cleaned = String(value).replace(/[\s\x00-\x20]+/g, '').toLowerCase();
  if (cleaned === '') return false;
  if (cleaned.startsWith('/') || cleaned.startsWith('#')) return false;
  if (!/^[a-z][a-z0-9+.-]*:/.test(cleaned)) return false; // relative
  return DANGEROUS_SCHEMES.some((scheme) => cleaned.startsWith(scheme));
}

/** Resolve a URL reference; returns {host, remote} or null when unresolvable
 *  or not an http(s) reference (data:, about:, fragment, …). */
function remoteHostOf(value, baseUrl) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let u;
  try {
    u = new URL(value.trim(), baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const base = new URL(baseUrl);
  return { host: u.host, remote: u.origin !== base.origin };
}

function noteRemote(value, hosts, baseUrl) {
  const info = remoteHostOf(value, baseUrl);
  if (info && info.remote) hosts.add(info.host);
}

function isRemoteBlocked(value, allowed, baseUrl) {
  const info = remoteHostOf(value, baseUrl);
  return Boolean(info && info.remote && !allowed.has(info.host));
}

/** srcset candidate URLs (descriptor part dropped). Comma-splitting is
 *  naive about data:-URL commas — over-collection only widens the consent
 *  prompt, never what renders (the jail CSP is the hard ceiling). */
function splitSrcset(value) {
  return String(value)
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** url(...) and @import "<string>" references in a CSS fragment. */
function cssUrls(css) {
  const out = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi;
  let m;
  while ((m = re.exec(String(css))) !== null) {
    out.push(m[2] ?? m[4]);
  }
  return out;
}

function neutralizeCss(css, allowed, baseUrl) {
  let dropped = 0;
  const rewritten = String(css).replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi,
    (whole, _q1, urlRef, _q2, importRef) => {
      const ref = urlRef ?? importRef;
      if (isRemoteBlocked(ref, allowed, baseUrl)) {
        dropped += 1;
        return 'url(about:invalid)';
      }
      return whole;
    },
  );
  return { css: rewritten, dropped };
}
