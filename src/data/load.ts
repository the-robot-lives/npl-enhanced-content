/**
 * data/load — source-URL policy for sem-data-source (phase 4).
 *
 * Spec: spec/data-visualizer.md §7.6/§7.7/§9. Pure URL/scheme decisions, no
 * fetch here: the reading tier (src/reading/data-load.ts) executes the
 * policy. Security rules live in the policy so they are testable without a
 * DOM: file:// documents refuse every fetch; non-http(s) schemes refuse;
 * same-origin/relative fetch plainly; cross-origin http(s) attempts and
 * leaves CORS to the browser.
 */

export type SourcePolicy =
  | { kind: 'fetch'; url: string; crossOrigin: false }
  | { kind: 'fetch'; url: string; crossOrigin: true }
  | { kind: 'refused'; reason: string };

/** Classify a `source` attribute against the document URL. */
export function resolveSource(href: string, docURL: string): SourcePolicy {
  const trim = href.trim();
  if (!trim) return { kind: 'refused', reason: 'the source attribute is empty' };
  if (/^(javascript|data|blob|vbscript):/i.test(trim)) {
    return { kind: 'refused', reason: 'source scheme "' + trim.split(':')[0] + ':" is not allowed — sources are relative paths or http(s) URLs' };
  }
  let base: URL;
  try {
    base = new URL(docURL);
  } catch {
    return { kind: 'refused', reason: 'the document URL is not parseable' };
  }
  if (base.protocol === 'file:') {
    return { kind: 'refused', reason: 'this document is file:// — loaders refuse to fetch (portable documents inline their data); serve it over http(s) or inline the payload' };
  }
  let url: URL;
  try {
    url = new URL(trim, base);
  } catch {
    return { kind: 'refused', reason: 'the source "' + trim + '" is not a valid URL or relative path' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'refused', reason: 'source scheme "' + url.protocol + '" is not allowed — use http(s) or a relative path' };
  }
  const sameOrigin = url.origin === base.origin;
  return sameOrigin
    ? { kind: 'fetch', url: url.href, crossOrigin: false }
    : { kind: 'fetch', url: url.href, crossOrigin: true };
}

/** Format precedence step 2: file extension (explicit data-format wins first). */
export function formatFromUrl(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  switch (ext) {
    case 'csv': return 'csv';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'json': return 'json';
    case 'md':
    case 'markdown': return 'table';
    default: return null;
  }
}

/**
 * Format precedence step 3: sniff the first non-blank line. A leading pipe
 * is a Markdown table; a leading { or [ is json; `- ` or a `key:` line is
 * yaml; otherwise csv (comma-separated text is the common case). The sniff
 * never overrides an explicit format or a recognizable extension.
 */
export function sniffFormat(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  if (line.startsWith('|')) return 'table';
  if (line.startsWith('{') || line.startsWith('[')) return 'json';
  if (line.startsWith('- ') || /^[^:,]+:\s/.test(line)) return 'yaml';
  return 'csv';
}
