/**
 * sigv4 — AWS Signature Version 4 request signing, in the browser, on
 * WebCrypto (HMAC-SHA256) alone. No dependencies, no keys in markup, no
 * `eval`. Used by the s3 backend's `oidc` mode to sign GET / PUT /
 * DELETE / ListObjectsV2 with the short-lived credentials an STS
 * `AssumeRoleWithWebIdentity` exchange minted.
 *
 * Pure over its inputs (the clock is a parameter): the AWS published
 * test vectors (docs.aws.amazon.com — "Example: GET Object", "Example:
 * PUT Object") run byte-for-byte through the same code path production
 * requests take. Path-style addressing: the bucket stays in the URI
 * path, so MinIO/R2/custom endpoints sign exactly like the vectors.
 */

const ENCODER = new TextEncoder();

/** RFC 3986 strict encode (encodeURIComponent leaves !'()* unencoded). */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const char of value) {
    if (/[A-Za-z0-9_.~-]/.test(char)) {
      out += char;
    } else if (char === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      out += Array.from(ENCODER.encode(char), (byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
    }
  }
  return out;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? ENCODER.encode(data) : data;
  return Array.from(await sha256Bytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data as unknown as ArrayBuffer);
  return new Uint8Array(signature);
}

async function hmacString(key: Uint8Array, data: string): Promise<Uint8Array> {
  return hmac(key, ENCODER.encode(data));
}

/**
 * The AWS-documented signing-key derivation:
 * kDate = HMAC('AWS4'+secret, date), kRegion = HMAC(kDate, region),
 * kService = HMAC(kRegion, service), kSigning = HMAC(kService, terminator).
 */
export async function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
  terminator = 'aws4_request',
): Promise<Uint8Array> {
  let key = await hmacString(ENCODER.encode('AWS4' + secretAccessKey), date);
  key = await hmac(key, ENCODER.encode(region));
  key = await hmac(key, ENCODER.encode(service));
  return hmac(key, ENCODER.encode(terminator));
}

export function amzDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Inputs to one signing pass. Extra headers join the canonical set. */
export interface SigV4Request {
  method: string;
  /** Absolute request URL (host + path + query are canonicalized from it). */
  url: string;
  /** Extra signed headers (host, x-amz-date, x-amz-content-sha256 and the
   * security token are always derived here; do not pass them). */
  headers?: Record<string, string>;
  /** Request body — '' means the empty payload (the e3b0c4… hash). */
  body?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  /** AWS service name (default 's3'). */
  service?: string;
  /** Signing time override — the published vectors pin this. */
  amzDate?: string;
  /** Payload hash override (the vectors quote it; production hashes `body`). */
  payloadHash?: string;
}

/** The headers to merge onto the real request after signing. */
export interface SigV4Headers {
  Authorization: string;
  'x-amz-date': string;
  'x-amz-content-sha256': string;
  'x-amz-security-token'?: string;
}

export async function sigv4Headers(req: SigV4Request): Promise<SigV4Headers> {
  const url = new URL(req.url);
  const amzDate = req.amzDate ?? amzDateNow();
  const scopeDate = amzDate.slice(0, 8);
  const service = req.service ?? 's3';
  const payloadHash = req.payloadHash ?? (await sha256Hex(req.body ?? ''));

  // Canonical headers: lowercase names, trimmed values, sorted, one per line.
  const headers = new Map<string, string>([['host', url.host]]);
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    headers.set(name.toLowerCase(), value.trim());
  }
  headers.set('x-amz-content-sha256', payloadHash);
  headers.set('x-amz-date', amzDate);
  if (req.sessionToken) headers.set('x-amz-security-token', req.sessionToken);
  const names = [...headers.keys()].sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers.get(name)}\n`).join('');
  const signedHeaders = names.join(';');

  // Canonical query: sorted by key (then value), strict-encoded.
  const pairs: Array<[string, string]> = [];
  for (const key of new Set([...url.searchParams.keys()])) {
    for (const value of url.searchParams.getAll(key)) pairs.push([key, value]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const canonicalQuery = pairs.map(([key, value]) => `${uriEncode(key, true)}=${uriEncode(value, true)}`).join('&');

  const canonicalUri = uriEncode(url.pathname, false);
  const canonicalRequest = [
    req.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${scopeDate}/${req.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(req.secretAccessKey, scopeDate, req.region, service);
  const signature = Array.from(await hmacString(signingKey, stringToSign), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

  const result: SigV4Headers = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (req.sessionToken) result['x-amz-security-token'] = req.sessionToken;
  return result;
}
