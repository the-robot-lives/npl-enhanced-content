/**
 * packages/net/transport — the network seam for the net package (packages
 * round, LANE=pkg-net).
 *
 * The shell's pipeline executor (`terminal-core.ts#execLine`) is fully
 * synchronous: each stage's `run()` returns before the next starts, and a
 * stage's stdout string feeds the next stage's stdin. A `fetch()`-based
 * transport can never work there — the body lands in a microtask, after
 * the whole line has been dispatched, so `curl -s URL | jq` would pipe an
 * empty string. The only browser primitive that returns a response body
 * synchronously is `XMLHttpRequest` in sync mode, so that is the built-in
 * transport. Both curl and fetch are "HTTP from the process's point of
 * view"; the differences that survive (the shell blocks during the
 * request like a foreground curl; no timeout/progress; redirects always
 * followed) are documented in the command man pages and the lane report.
 *
 * Everything is behind a seam so tests and embedders control it:
 *
 *   configureNet({
 *     transport, // (req: NetRequest) => NetResponse — sync, or throws NetError
 *     allow,     // (url: URL) => true | string — false-by-string denies
 *   });
 *
 * Defaults: no allowlist (every http/https URL allowed), transport =
 * sync-XHR when `XMLHttpRequest` exists, else none (commands report
 * `no network transport` honestly instead of hanging or failing deep).
 * Module state, not shell state: the allowlist is per page, shared by
 * every tab/session — the contract has no per-session net config yet.
 */

/** One outgoing HTTP request (the wire shape the transports accept). */
export interface NetRequest {
  /** Uppercase method — GET, POST, HEAD, … */
  method: string;
  /** Absolute URL (scheme http/https). */
  url: string;
  /** Header names as they will appear on the wire (case preserved). */
  headers: Record<string, string>;
  /** Request body, or null for body-less methods. */
  body: string | null;
}

/** One completed HTTP response. */
export interface NetResponse {
  status: number;
  /** Status text as reported by the transport ('' when unavailable). */
  statusText: string;
  /** Header map, names lowercased (transports report case-insensitively). */
  headers: Record<string, string>;
  /** The decoded body text. */
  bodyText: string;
  /** Final URL after redirects (=== `url` when the transport cannot tell). */
  url: string;
}

/** A transport-level failure: network, CORS, scheme, allowlist, no transport. */
export class NetError extends Error {
  /**
   * 'network' — connection/DNS/CORS failure (browsers hide which);
   * 'blocked' — denied by the embedder's allowlist;
   * 'unsupported' — no transport in this environment;
   * 'url' — malformed URL or non-http(s) scheme.
   */
  readonly kind: 'network' | 'blocked' | 'unsupported' | 'url';

  constructor(kind: NetError['kind'], message: string) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
  }
}

export type NetTransport = (req: NetRequest) => NetResponse;

export interface NetConfig {
  /** Replaces the transport for every net command. Null forces "none". */
  transport?: NetTransport | null;
  /**
   * Embedder allowlist hook. Return `true` to allow, or a string — the
   * reason shown to the user in the denial message.
   */
  allow?: ((url: URL) => true | string) | null;
}

let config: NetConfig = {};

/** Patch the net config (later patches win per key). Chunk-level API. */
export function configureNet(patch: NetConfig): void {
  config = { ...config, ...patch };
}

/** Reset to defaults — no allowlist, built-in transport. Tests use this. */
export function resetNet(): void {
  config = {};
}

/** The live config (tests and the man page's introspection examples). */
export function netConfig(): Readonly<NetConfig> {
  return config;
}

/**
 * Parse + validate + allowlist-check a URL argument. Throws NetError
 * ('url' for malformed/non-http(s), 'blocked' for a deny verdict).
 */
export function checkAllowed(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetError('url', `URL rejected: '${raw}' is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NetError('url', `URL rejected: unsupported scheme '${url.protocol.replace(/:$/, '')}' (the net commands speak http and https only)`);
  }
  const allow = config.allow;
  if (allow) {
    const verdict = allow(url);
    if (verdict !== true) {
      throw new NetError('blocked', `request to '${raw}' blocked by the shell's network allowlist` + (typeof verdict === 'string' && verdict !== '' ? ` (${verdict})` : ''));
    }
  }
  return url;
}

/**
 * The status-0 explanation. Browsers deliberately make a CORS refusal
 * indistinguishable from a refused connection / DNS failure — the honest
 * message says so instead of guessing one cause.
 */
export const STATUS_ZERO_HELP =
  'the request failed before a response was returned (status 0). ' +
  'Browsers block this for several indistinguishable reasons: a CORS ' +
  "refusal (the server must send Access-Control-Allow-Origin naming this page's " +
  'origin), a refused connection or DNS failure, or mixed-content blocking ' +
  '(https page → http URL). The browser hides the exact cause from scripts.';

/** The built-in transport: synchronous XMLHttpRequest. */
export function xhrTransport(req: NetRequest): NetResponse {
  const xhr = new XMLHttpRequest();
  try {
    xhr.open(req.method, req.url, false); // false = synchronous, like curl in a foreground terminal
    for (const [name, value] of Object.entries(req.headers)) {
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // Forbidden header names (Cookie, User-Agent, …) are enforced by
        // the browser at open/setRequestHeader time; fall through — the
        // server just never sees the header, like curl's ignored --header.
      }
    }
    // withCredentials stays false (the default): ambient cookies and HTTP
    // auth are NEVER attached, cross-origin or not — credentials travel
    // only when the user passes them explicitly (-u / a header).
    xhr.send(req.body ?? null);
  } catch {
    throw new NetError('network', STATUS_ZERO_HELP);
  }
  if (xhr.status === 0) throw new NetError('network', STATUS_ZERO_HELP);
  const headers: Record<string, string> = {};
  for (const line of xhr.getAllResponseHeaders().split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return {
    status: xhr.status,
    statusText: xhr.statusText ?? '',
    headers,
    bodyText: xhr.responseText,
    url: xhr.responseURL || req.url,
  };
}

/** The transport in effect: the injected one, else the built-in, else null. */
export function activeTransport(): NetTransport | null {
  if (config.transport !== undefined) return config.transport;
  return defaultTransport();
}

/** The built-in transport for this environment (null outside a browser). */
export function defaultTransport(): NetTransport | null {
  return typeof XMLHttpRequest === 'undefined' ? null : xhrTransport;
}

/** Resolve a request through the active transport. Throws NetError. */
export function netFetch(req: NetRequest): NetResponse {
  const transport = activeTransport();
  if (transport === null) {
    throw new NetError(
      'unsupported',
      'no network transport in this environment (the built-in one needs XMLHttpRequest; ' +
        'tests and embedders install one with configureNet({ transport }))',
    );
  }
  return transport(req);
}

/** UTF-8 byte length — `-w %{size_download}`, wget's saved-byte count. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * RFC 7617 Basic auth value. `btoa` alone throws on non-latin1 passwords;
 * UTF-8 bytes → latin1 string → btoa matches what servers expect.
 */
export function basicAuthValue(userPass: string): string {
  const bytes = new TextEncoder().encode(userPass);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}
