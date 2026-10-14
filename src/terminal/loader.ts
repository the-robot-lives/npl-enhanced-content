/**
 * sem-terminal — plugin loading: fetching, integrity, CDN rules.
 *
 * The contract (src/terminal/PLUGINS.md) has three hard rules this module
 * enforces, always BEFORE any network request for the source in question:
 *
 *   1. Absolute CDN sources (https://…) need an integrity hash. A manifest
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

/** Split `url#sha256-…` into the fetch URL and its integrity claim. */
export function splitIntegrityFragment(url: string): { base: string; integrity: string | null } {
  const hash = url.indexOf('#');
  if (hash < 0) return { base: url, integrity: null };
  return { base: url.slice(0, hash), integrity: url.slice(hash + 1) };
}

export function isIntegrityFormat(value: string | null | undefined): value is string {
  return typeof value === 'string' && INTEGRITY_PATTERN.test(value);
}

/**
 * Rule check for one source. `context` names the plugin in the error.
 * Throws `PluginRefusedError`; never fetches.
 */
export function checkSourceAllowed(load: LoadDescriptor | null | undefined, context: string): void {
  const src = load?.src;
  if (!src) return;
  if (src.startsWith('https://')) {
    if (!isIntegrityFormat(load?.integrity)) {
      throw new PluginRefusedError(
        `refused: CDN source ${src} needs an integrity hash (sha256-<64 hex>); ` +
          `absolute https without one never loads (see src/terminal/PLUGINS.md) [${context}]`,
      );
    }
    return;
  }
  if (src.startsWith('http://') || src.startsWith('//')) {
    throw new PluginRefusedError(`refused: only absolute https is remote: ${src} [${context}]`);
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
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex === integrity.slice('sha256-'.length);
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
  const src = new URL(load.src, manifestUrl).toString();
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
