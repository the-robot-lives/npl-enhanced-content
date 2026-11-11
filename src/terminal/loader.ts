/**
 * sem-terminal — plugin loading: fetching, integrity, CDN rules.
 *
 * The contract (src/terminal/PLUGINS.md) has three hard rules this module
 * enforces, always BEFORE any network request for the source in question:
 *
 *   1. Cross-origin sources (classified AFTER URL resolution) need an integrity hash. A manifest
 *      URL carries it as a fragment (`…manifest.json#sha256-<hex>`); a
 *      commands module carries it in the manifest's `load.integrity`.
 *      A https source with no hash is REFUSED, never fetched.
 *   2. Only absolute https is remote. http:// and protocol-relative `//…`
 *      are refused outright; relative / same-origin paths need no hash.
 *   3. Remote commands modules are fetched, verified, then imported via a
 *      blob URL — `eval` and `new Function` appear nowhere in this repo,
 *      and without a verified hash no remote code is imported at all.
 *
 * Manifest integrity is content verification, not a signature: it pins the
 * bytes, so a changed manifest (or module) fails closed.
 */

/** Thrown (and recorded as a load error) when a source breaks the rules. */
export class PluginRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginRefusedError';
  }
}

export interface LoadDescriptor {
  /** Where the commands module ships: relative path or absolute https URL. */
  src?: string;
  /** `sha256-<64 hex>` of the module text; required when src is absolute https. */
  integrity?: string | null;
}

/** `name@version` provenance for a mounted plugin. */
export interface MountedPlugin {
  name: string;
  version: string;
}

export const INTEGRITY_PATTERN = /^sha256-[a-f0-9]{64}$/;
/** SRI form: `sha256-` + 44 base64 chars (32 bytes, one `=` pad). */
export const INTEGRITY_SRI_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

/** Split `url#sha256-…` into the fetch URL and its integrity claim. */
export function splitIntegrityFragment(url: string): { base: string; integrity: string | null } {
  const hash = url.indexOf('#');
  if (hash < 0) return { base: url, integrity: null };
  return { base: url.slice(0, hash), integrity: url.slice(hash + 1) };
}

/** True for `sha256-<64 hex>` or the SRI `sha256-<base64>` form. */
export function isIntegrityFormat(value: string | null | undefined): value is string {
  return typeof value === 'string' && (INTEGRITY_PATTERN.test(value) || INTEGRITY_SRI_PATTERN.test(value));
}

/** The page base every relative source resolves against (never throws). */
function pageBase(): URL {
  const candidates = [
    (globalThis as { document?: { baseURI?: string } }).document?.baseURI,
    (globalThis as { location?: { href?: string } }).location?.href,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') return url;
    } catch {
      // try the next candidate
    }
  }
  return new URL('http://localhost/');
}

/**
 * Resolve `src` to an absolute URL. `base` (itself possibly relative) is
 * resolved against the page base FIRST, so nothing is ever classified from
 * its raw spelling (`HTTPS://…`, `/\host/…` and `//host/…` all resolve to
 * what the browser would really fetch). Throws PluginRefusedError when
 * unparseable.
 */
export function resolveSourceUrl(src: string, base?: string): URL {
  try {
    const root = pageBase();
    const resolvedBase = base !== undefined ? new URL(base, root) : root;
    return new URL(src, resolvedBase);
  } catch {
    throw new PluginRefusedError(`refused: unparseable source ${src}`);
  }
}

/** Same origin as the page (http/https host match, or both file:). */
export function isSameOriginUrl(url: URL): boolean {
  const root = pageBase();
  if (url.protocol !== root.protocol) return false;
  if (url.protocol === 'file:') return true;
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === root.host;
}

/**
 * Rule check for one source. `context` names the plugin in the error;
 * `base` is what a relative `src` resolves against. Same-origin loads
 * freely; ANY cross-origin URL must be https AND carry an integrity hash.
 * Throws `PluginRefusedError`; never fetches.
 */
export function checkSourceAllowed(load: LoadDescriptor | null | undefined, context: string, base?: string): void {
  const src = load?.src;
  if (!src) return;
  const url = resolveSourceUrl(src, base);
  if (isSameOriginUrl(url)) return;
  if (url.protocol !== 'https:') {
    throw new PluginRefusedError(`refused: only absolute https is remote: ${src} [${context}]`);
  }
  if (!isIntegrityFormat(load?.integrity)) {
    throw new PluginRefusedError(
      `refused: CDN source ${src} needs an integrity hash (sha256-<64 hex> or sha256-<base64>); ` +
        `cross-origin sources without one never load (see src/terminal/PLUGINS.md) [${context}]`,
    );
  }
}

/** Fetch text; non-2xx and network failures become plain Errors. */
export async function fetchText(url: string): Promise<string> {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`fetch failed: ${url} (${response.status})`);
  }
  return response.text();
}

/** SHA-256 the text and compare against `sha256-<hex>`. */
export async function verifyIntegrity(text: string, integrity: string): Promise<boolean> {
  if (!isIntegrityFormat(integrity)) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  const claim = integrity.slice('sha256-'.length);
  if (INTEGRITY_PATTERN.test(integrity)) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') === claim;
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary) === claim;
}

/**
 * Load a commands module declared by a JSON manifest: resolve `load.src`
 * against the manifest URL, enforce the rules, verify `load.integrity`,
 * then import the verified text via a blob URL. Browser-only by design —
 * outside a browser it fails with a clear error instead of improvising.
 * The module default-exports the commands array.
 */
export async function importCommandsModule(load: LoadDescriptor, manifestUrl: string): Promise<unknown> {
  if (!load.src) throw new Error('commands module load needs a src');
  const src = resolveSourceUrl(load.src, manifestUrl).toString();
  checkSourceAllowed({ src, integrity: load.integrity }, 'commands module');
  const code = await fetchText(src);
  if (load.integrity && !(await verifyIntegrity(code, load.integrity))) {
    throw new PluginRefusedError(`refused: integrity mismatch for ${src}`);
  }
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('remote command modules load only in a browser (blob import)');
  }
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    return mod.default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
