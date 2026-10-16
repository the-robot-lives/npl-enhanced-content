/**
 * packages/net — the real network commands (packages round, LANE=pkg-net).
 *
 * This module is the package CHUNK: dynamic-imported by ./stub.ts at boot,
 * never part of the base shell bundle. Three commands — curl, wget, http —
 * over the transport seam in ./transport.ts. Reference behaviour is GNU
 * curl / GNU wget / HTTPie; where the emulation knowingly differs the man
 * pages below say so (the big one: the shell's pipeline executor is
 * synchronous, so the transport is synchronous XHR — see transport.ts for
 * why fetch() cannot sit inside `curl -s URL | jq`).
 *
 * Security posture (brief requirements, enforced here):
 *   - no ambient credentials, ever: the transport never enables
 *     withCredentials, so cookies/HTTP-auth are not attached to any
 *     request — credentials travel only via explicit -u / headers;
 *   - an embedder allowlist hook (configureNet({ allow })) denies URLs
 *     with an explained message before anything is sent;
 *   - CORS/network failures are reported honestly: the browser makes them
 *     indistinguishable (status 0) and the message says exactly that.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import type { NetRequest, NetResponse } from './transport.js';
import { netStub } from './stub.js';
import { NetError, basicAuthValue, byteLength, checkAllowed, netFetch } from './transport.js';

/**
 * The embedder/test seam, re-exported at the chunk edge: an embedder (or
 * a test) installs a transport or allowlist with configureNet() after the
 * chunk has loaded — `import('semtext-pkg-net.js').then((net) =>
 * net.configureNet({ allow }))`.
 */
export { NetError, configureNet, resetNet, netConfig } from './transport.js';
export type { NetRequest, NetResponse, NetTransport, NetConfig } from './transport.js';

const usageOf = (name: string): string => netStub.commands.find((c) => c.name === name)!.usage;

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

/**
 * Split clustered short flags. Value-taking letters keep their attached
 * value (`-XPOST` → ['-X','POST'], `-O-` → ['-O','-']); others explode
 * (`-sS` → ['-s','-S']). `-`, `--`, `--long`, and everything after `--`
 * pass through verbatim (long=value is handled per command).
 */
function splitArgs(args: string[], valueLetters: string): string[] {
  const out: string[] = [];
  let endOfFlags = false;
  for (const a of args) {
    if (endOfFlags || a.length <= 2 || a[0] !== '-' || a[1] === '-') {
      if (a === '--' && !endOfFlags) endOfFlags = true;
      out.push(a);
      continue;
    }
    if (valueLetters.includes(a[1]!)) {
      out.push('-' + a[1]!, a.slice(2));
    } else {
      for (const ch of a.slice(1)) out.push('-' + ch);
    }
  }
  return out;
}

/** Print body text through the line-oriented stdout (like cat). */
function outBody(ctx: CommandContext, text: string): void {
  if (text === '') return;
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  for (const line of lines) ctx.out(line);
}

/** The `HTTP/1.1 200 OK` line — the transport does not expose the real version. */
function statusLine(resp: { status: number; statusText: string }): string {
  return `HTTP/1.1 ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`;
}

/** Sorted header block (`name: value` lines), deterministic order. */
function headerLines(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .sort()
    .map((name) => `${name}: ${headers[name]}`);
}

/** Dispatch through the allowlist + transport. Throws NetError. */
function dispatch(req: NetRequest): NetResponse {
  checkAllowed(req.url);
  return netFetch(req);
}

/** The exit code for a NetError, shared by all three commands. */
function exitCodeFor(err: NetError): number {
  switch (err.kind) {
    case 'url': return 3;
    case 'network': return 7;
    default: return 1; // blocked by the allowlist, or no transport here
  }
}

/** As NetError — commands only ever handle NetError. */
function asNetError(cause: unknown): NetError {
  return cause instanceof NetError ? cause : new NetError('network', String(cause));
}

/** Tiny SGR helper — colors only when the stage's stdout is a terminal. */
const paint = (on: boolean, code: number, text: string): string => (on ? `\x1b[${code}m${text}\x1b[0m` : text);

/** Colorize pretty-printed JSON: keys cyan, strings green, numbers yellow, keywords magenta. */
function colorizeJson(json: string, on: boolean): string {
  if (!on) return json;
  return json.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, str: string | undefined, colon: string | undefined, kw: string | undefined, num: string | undefined) => {
      if (str !== undefined) return colon !== undefined ? paint(true, 36, str) + colon : paint(true, 32, str);
      if (kw !== undefined) return paint(true, 35, kw);
      if (num !== undefined) return paint(true, 33, num);
      return match;
    },
  );
}

/** Pretty body: indented (and colored when `color`) when JSON, else raw. */
function prettyBody(contentType: string, bodyText: string, color: boolean): string {
  if (contentType.includes('json') || /^[[{]/.test(bodyText.trim())) {
    try {
      return colorizeJson(JSON.stringify(JSON.parse(bodyText), null, 2), color);
    } catch {
      /* not JSON after all — fall through to raw */
    }
  }
  return bodyText;
}

/* ------------------------------------------------------------------ *
 * curl
 * ------------------------------------------------------------------ */

const CURL_HELP = [
  usageOf('curl'),
  '',
  'Transfer a URL over HTTP. Requests run on a synchronous transport:',
  'the shell blocks until the response arrives (like foreground curl),',
  'and the body can be piped or redirected like any command output.',
  '',
  '  -s              silent (no error messages)',
  '  -S              show errors even with -s',
  '  -f              fail on HTTP >= 400 (exit 22, no body)',
  '  -i              include the response headers in the output',
  '  -I              HEAD request, headers only',
  '  -L              (accepted; redirects are always followed)',
  '  -X METHOD       request method (default GET, POST with -d)',
  '  -H "h: v"       add a request header (repeatable)',
  '  -d D            request body part; parts join with & (repeatable)',
  '  --data-binary D same wire effect as -d here',
  '  -u USER:PASS    Basic auth (Authorization header)',
  '  -o FILE         write the body to a VFS file (-o - = stdout)',
  '  -O              write to a file named from the URL',
  '  -w FMT          print after the body: %{http_code} %{response_code}',
  '                  %{url_effective} %{size_download} %{content_type};',
  '                  \\n and \\t in FMT are interpreted',
  '',
  'Exit codes: 0 ok (even on 4xx/5xx without -f) · 1 blocked by allowlist ·',
  '2 usage/transport unavailable · 3 bad URL/scheme · 7 network/CORS ·',
  '22 -f failure · 23 body write error.',
  '',
  '  curl -s https://api.example.com/x | grep id',
  '  curl -d name=ada https://api.example.com/users',
  '  curl -so /tmp/x.json -w "%{http_code}" https://example.com/x',
];

function flagComplete(words: string[]): (ctx: { word: string }) => string[] {
  return (ctx) => words.filter((f) => f.startsWith(ctx.word));
}

const curl: CommandSpec = {
  name: 'curl',
  usage: usageOf('curl'),
  complete: flagComplete(['-s', '-S', '-f', '-i', '-I', '-L', '-X', '-H', '-d', '--data-binary', '-u', '-o', '-O', '-w', '--help']),
  run(ctx: CommandContext): void {
    const args = splitArgs(ctx.args, 'XHdouw');
    let silent = false;
    let showErrors = false;
    let failOnHttpError = false;
    let includeHeaders = false;
    let headOnly = false;
    let method: string | null = null;
    let userPass: string | null = null;
    let outputFile: string | null = null;
    let remoteName = false;
    let writeOut: string | null = null;
    const headerParts: string[] = [];
    const dataParts: string[] = [];
    const urls: string[] = [];
    let endOfFlags = false;

    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--help' || a === '-h') {
        for (const line of CURL_HELP) ctx.out(line);
        ctx.exit(0);
        return;
      }
      if (!endOfFlags && a === '--') {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && (a === '--data-binary' || a.startsWith('--data-binary='))) {
        const value = a.startsWith('--data-binary=') ? a.slice('--data-binary='.length) : args[++i];
        if (value === undefined) {
          ctx.err('curl: option --data-binary: requires parameter');
          ctx.exit(2);
          return;
        }
        dataParts.push(value);
        continue;
      }
      if (!endOfFlags && a.startsWith('-') && a !== '-') {
        const valueFlags: Record<string, boolean> = { '-X': true, '-H': true, '-d': true, '-u': true, '-o': true, '-w': true };
        if (valueFlags[a] !== undefined) {
          const value = args[++i];
          if (value === undefined) {
            ctx.err(`curl: option ${a}: requires parameter`);
            ctx.exit(2);
            return;
          }
          switch (a) {
            case '-X': method = value.toUpperCase(); break;
            case '-H': headerParts.push(value); break;
            case '-d': dataParts.push(value); break;
            case '-u': userPass = value; break;
            case '-o': outputFile = value; break;
            case '-w': writeOut = value; break;
          }
          continue;
        }
        for (const ch of a.slice(1)) {
          switch (ch) {
            case 's': silent = true; break;
            case 'S': showErrors = true; break;
            case 'f': failOnHttpError = true; break;
            case 'i': includeHeaders = true; break;
            case 'I': headOnly = true; includeHeaders = true; break;
            case 'L': break; // accepted; the transport always follows redirects
            case 'O': remoteName = true; break;
            default:
              ctx.err(`curl: option -${ch}: is unknown`);
              ctx.err("curl: try 'curl --help' for more information");
              ctx.exit(2);
              return;
          }
        }
        continue;
      }
      urls.push(a);
    }

    if (urls.length === 0) {
      ctx.err('curl: no URL specified');
      ctx.err("curl: try 'curl --help' for more information");
      ctx.exit(2);
      return;
    }
    if (urls.length > 1) {
      ctx.err('curl: only one URL per invocation is supported by this build');
      ctx.exit(2);
      return;
    }
    if (outputFile !== null && remoteName) {
      ctx.err('curl: only one of -o and -O is allowed');
      ctx.exit(2);
      return;
    }
    const url = urls[0]!;

    // Headers: explicit -H parts, plus Basic auth and curl's -d default.
    const headers: Record<string, string> = {};
    let haveContentType = false;
    let haveAuthorization = false;
    for (const part of headerParts) {
      const colon = part.indexOf(':');
      if (colon < 0) {
        if (part.endsWith(';')) {
          headers[part.slice(0, -1)] = ''; // `Name;` sends the header with an empty value
          continue;
        }
        ctx.err(`curl: bad --header syntax (want 'Name: value'): '${part}'`);
        ctx.exit(2);
        return;
      }
      const name = part.slice(0, colon);
      let value = part.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (name.toLowerCase() === 'content-type') haveContentType = true;
      if (name.toLowerCase() === 'authorization') haveAuthorization = true;
      headers[name] = value;
    }
    if (userPass !== null) {
      const colon = userPass.indexOf(':');
      if (colon < 0) {
        ctx.err('curl: --user needs USER:PASS (interactive password prompting is not supported)');
        ctx.exit(2);
        return;
      }
      if (!haveAuthorization) headers['Authorization'] = basicAuthValue(userPass);
    }
    const body = dataParts.length > 0 ? dataParts.join('&') : null;
    if (body !== null && !haveContentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const effectiveMethod = method ?? (headOnly ? 'HEAD' : body !== null ? 'POST' : 'GET');
    let resp: NetResponse;
    try {
      resp = dispatch({ method: effectiveMethod, url, headers, body });
    } catch (cause) {
      const err = asNetError(cause);
      if (!silent || showErrors) ctx.err(`curl: ${err.message}`);
      ctx.exit(exitCodeFor(err));
      return;
    }
    if (failOnHttpError && resp.status >= 400) {
      if (!silent || showErrors) {
        ctx.err(`curl: (22) The requested URL returned error: ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`);
      }
      ctx.exit(22);
      return;
    }

    if (includeHeaders) {
      ctx.out(statusLine(resp));
      for (const line of headerLines(resp.headers)) ctx.out(line);
      if (!headOnly) ctx.out('');
    }
    if (!headOnly) {
      const writeToFile = (name: string): boolean => {
        try {
          ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, name), resp.bodyText);
          return true;
        } catch (cause) {
          ctx.err(`curl: ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
          ctx.exit(23);
          return false;
        }
      };
      if (outputFile === '-') {
        outBody(ctx, resp.bodyText);
      } else if (outputFile !== null) {
        if (!writeToFile(outputFile)) return;
      } else if (remoteName) {
        let name: string;
        try {
          name = decodeURIComponent(new URL(resp.url).pathname.split('/').filter(Boolean).pop() ?? '') || 'index.html';
        } catch {
          name = 'index.html';
        }
        if (!writeToFile(name)) return;
      } else {
        outBody(ctx, resp.bodyText);
      }
    }

    if (writeOut !== null) {
      const rendered = writeOut
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/%\{(\w+)\}/g, (whole, variable: string) => {
          switch (variable) {
            case 'http_code':
            case 'response_code':
              return String(resp.status);
            case 'url_effective':
              return resp.url;
            case 'size_download':
              return String(byteLength(resp.bodyText));
            case 'content_type':
              return resp.headers['content-type'] ?? '';
            default:
              return whole; // unknown %{var} passes through, like curl
          }
        });
      for (const piece of rendered.split('\n')) {
        if (piece !== '') ctx.out(piece);
      }
    }
    ctx.exit(0);
  },
};

/* ------------------------------------------------------------------ *
 * wget
 * ------------------------------------------------------------------ */

const WGET_STAMP = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const wget: CommandSpec = {
  name: 'wget',
  usage: usageOf('wget'),
  complete: flagComplete(['-q', '-O', '--help']),
  run(ctx: CommandContext): void {
    const args = splitArgs(ctx.args, 'O');
    let quiet = false;
    let outputFile: string | null = null;
    const urls: string[] = [];
    let endOfFlags = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--help' || a === '-h') {
        for (const line of [
          usageOf('wget'),
          '',
          'Download each URL into the VFS. Log lines go to stderr (like GNU',
          'wget), so `wget -O- URL | grep …` pipes only the body.',
          '',
          '  -q              quiet — no log lines',
          '  -O FILE         save to FILE instead of the URL basename',
          '  -O -            write the body to stdout instead of a file',
          '',
          "The default filename is the URL path basename (index.html when it",
          'ends in / or is empty). Exit codes: 0 ok · 1 usage/blocked ·',
          '4 network/CORS/transport · 8 server error 4xx/5xx (nothing saved).',
        ]) ctx.out(line);
        ctx.exit(0);
        return;
      }
      if (!endOfFlags && a === '--') {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && a === '-q') {
        quiet = true;
        continue;
      }
      if (!endOfFlags && a === '-O') {
        outputFile = args[++i];
        if (outputFile === undefined) {
          ctx.err('wget: option -O: requires an argument');
          ctx.exit(1);
          return;
        }
        continue;
      }
      if (!endOfFlags && a.startsWith('-') && a !== '-') {
        ctx.err(`wget: unrecognized option '${a}'`);
        ctx.exit(1);
        return;
      }
      urls.push(a);
    }
    if (urls.length === 0) {
      ctx.err('wget: missing URL');
      ctx.err('Usage: wget [-q] [-O FILE] URL...');
      ctx.exit(1);
      return;
    }

    const log = (line: string): void => {
      if (!quiet) ctx.err(line);
    };
    let status = 0;
    for (const url of urls) {
      let resp: NetResponse;
      try {
        resp = dispatch({ method: 'GET', url, headers: {}, body: null });
      } catch (cause) {
        const err = asNetError(cause);
        log(`wget: ${err.message}`);
        status = err.kind === 'network' ? 4 : 1;
        continue;
      }
      if (resp.status >= 400) {
        log(`wget: ERROR ${resp.status}: ${resp.statusText || 'error'}.`);
        status = 8;
        continue;
      }
      const bytes = byteLength(resp.bodyText);
      log(`--${WGET_STAMP()}--  ${url}`);
      if (outputFile === '-') {
        outBody(ctx, resp.bodyText);
        continue;
      }
      let name = outputFile;
      if (name === null) {
        try {
          name = decodeURIComponent(new URL(resp.url).pathname.split('/').filter(Boolean).pop() ?? '') || 'index.html';
        } catch {
          name = 'index.html';
        }
      }
      log(`Saving to: '${name}'`);
      try {
        ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, name), resp.bodyText);
      } catch (cause) {
        ctx.err(`wget: cannot write '${name}': ${cause instanceof Error ? cause.message : String(cause)}`);
        status = status === 0 ? 1 : status;
        continue;
      }
      log(`'${name}' saved [${bytes}/${bytes}]`);
    }
    // Explicit even on success: the log went to stderr, and the runner
    // defaults a stderr-writing command to exit 1 — wget exits 0 there.
    ctx.exit(status);
  },
};

/* ------------------------------------------------------------------ *
 * http (HTTPie-style)
 * ------------------------------------------------------------------ */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

type ParsedItems =
  | { ok: true; headers: Array<[string, string]>; fields: Record<string, unknown>; hasFields: boolean }
  | { ok: false; error: string };

/**
 * HTTPie item grammar: `key:value` header, `key=value` JSON string field,
 * `key:=json` raw JSON field. The `=`-before-`:` rule matches HTTPie:
 * `a=b:c` is a body field, `a:b=c` a header.
 */
function parseHttpItems(items: string[]): ParsedItems {
  const headers: Array<[string, string]> = [];
  const fields: Record<string, unknown> = {};
  let hasFields = false;
  for (const item of items) {
    const rawSep = item.indexOf(':=');
    if (rawSep >= 0) {
      try {
        fields[item.slice(0, rawSep)] = JSON.parse(item.slice(rawSep + 2));
      } catch (cause) {
        return { ok: false, error: `invalid JSON in item '${item}': ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      hasFields = true;
      continue;
    }
    const colon = item.indexOf(':');
    const eq = item.indexOf('=');
    if (colon >= 0 && (eq < 0 || colon < eq)) {
      headers.push([item.slice(0, colon), item.slice(colon + 1)]);
      continue;
    }
    if (eq >= 0) {
      fields[item.slice(0, eq)] = item.slice(eq + 1);
      hasFields = true;
      continue;
    }
    return { ok: false, error: `invalid item '${item}' (want key:value, key=value or key:=json)` };
  }
  return { ok: true, headers, fields, hasFields };
}

const http: CommandSpec = {
  name: 'http',
  usage: usageOf('http'),
  complete: (ctx) => {
    const word = ctx.word.toLowerCase();
    return [...METHODS.map((m) => m.toLowerCase()), '-v', '-b', '-h', '--verbose', '--body', '--headers', '--help'].filter((f) =>
      f.startsWith(word),
    );
  },
  run(ctx: CommandContext): void {
    const rest: string[] = [];
    let verbose = false;
    let bodyOnly = false;
    let headersOnly = false;
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === '--help') {
        for (const line of [
          usageOf('http'),
          '',
          'HTTPie-style requests. METHOD is optional (default GET, or POST',
          'when body items or piped stdin are present). Items:',
          '',
          '  key:value   request header',
          '  key=value   JSON body field (string)',
          '  key:=json   JSON body field (raw JSON)',
          '',
          '  -v          also print the request',
          '  -b          print only the response body',
          "  -h          print only the response headers (--help is help; -h isn't)",
          '',
          'Piped stdin becomes the raw request body (Content-Type stays',
          'application/json unless overridden). Output colors follow the',
          "stage's tty-ness. Any completed HTTP exchange exits 0; usage/",
          'parse errors exit 1, bad URL/scheme 3, network/CORS 7, allowlist',
          'blocks 1.',
        ]) ctx.out(line);
        ctx.exit(0);
        return;
      }
      if (a === '-v' || a === '--verbose') { verbose = true; continue; }
      if (a === '-b' || a === '--body') { bodyOnly = true; continue; }
      if (a === '-h' || a === '--headers') { headersOnly = true; continue; }
      rest.push(a);
    }

    let method: string | null = null;
    if (rest.length > 1 && /^[A-Za-z]+$/.test(rest[0]!)) method = rest.shift()!.toUpperCase();
    let url = rest.shift();
    if (url === undefined || url === '') {
      ctx.err('http: error: a URL is required');
      ctx.exit(1);
      return;
    }
    // HTTPie defaults the scheme: a bare hostname speaks http://.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
    const parsed = parseHttpItems(rest);
    if (!parsed.ok) {
      ctx.err(`http: error: ${parsed.error}`);
      ctx.exit(1);
      return;
    }

    const piped = ctx.stdin;
    if (parsed.hasFields && piped !== null && piped !== '') {
      ctx.err('http: error: request body from stdin and key=value items are mutually exclusive');
      ctx.exit(1);
      return;
    }
    const hasBody = parsed.hasFields || (piped !== null && piped !== '');
    const effectiveMethod = method ?? (hasBody ? 'POST' : 'GET');

    const headers: Record<string, string> = { Accept: 'application/json, */*' };
    if (hasBody) headers['Content-Type'] = 'application/json';
    for (const [name, value] of parsed.headers) headers[name] = value;

    let body: string | null = null;
    if (piped !== null && piped !== '') body = piped;
    else if (parsed.hasFields) body = JSON.stringify(parsed.fields);

    let urlObj: URL;
    let resp: NetResponse;
    try {
      urlObj = checkAllowed(url);
      headers['Host'] = urlObj.host; // shown by -v; the transport sets the real one
      resp = netFetch({ method: effectiveMethod, url, headers, body });
    } catch (cause) {
      const err = asNetError(cause);
      ctx.err(`http: error: ${err.message}`);
      ctx.exit(exitCodeFor(err));
      return;
    }

    const color = ctx.color;
    if (verbose) {
      const path = urlObj.pathname + urlObj.search;
      ctx.out(paint(color, 90, `${effectiveMethod} ${path} HTTP/1.1`));
      for (const line of headerLines(headers)) ctx.out(paint(color, 90, line));
      if (body !== null) {
        ctx.out('');
        for (const line of prettyBody('application/json', body, color).split('\n')) ctx.out(line);
      }
      ctx.out('');
    }
    if (!bodyOnly) {
      ctx.out(paint(color, resp.status < 300 ? 32 : resp.status < 400 ? 33 : 31, statusLine(resp)));
      for (const line of headerLines(resp.headers)) ctx.out(line);
    }
    if (!headersOnly) {
      if (!bodyOnly) ctx.out('');
      const pretty = prettyBody(resp.headers['content-type'] ?? '', resp.bodyText, color);
      if (pretty !== '') {
        const lines = pretty.split('\n');
        if (pretty.endsWith('\n')) lines.pop();
        for (const line of lines) ctx.out(line);
      }
    }
    ctx.exit(0);
  },
};

/* ------------------------------------------------------------------ *
 * exports
 * ------------------------------------------------------------------ */

export const commands: Command[] = [curl, wget, http];

export const manPages: Record<string, string[]> = {
  curl: [
    'CURL(1)                   semtext-sh manual',
    '',
    'NAME',
    '     curl — transfer a URL over HTTP',
    '',
    'SYNOPSIS',
    '     curl [-sSifL] [-X METHOD] [-H HEADER]... [-d DATA]...',
    '          [--data-binary DATA]... [-u USER:PASS] [-o FILE | -O]',
    '          [-i | -I] [-w FORMAT] URL',
    '',
    'DESCRIPTION',
    '     HTTP client modelled on GNU curl. The request runs on the',
    '     synchronous transport (transport.ts): the shell blocks until the',
    '     response arrives, and the body flows through stdout like any',
    '     command output — pipes and redirection work.',
    '',
    '     No ambient credentials are ever attached (the transport never',
    '     enables withCredentials): cookies and HTTP auth travel only when',
    '     you pass them explicitly (-u, an Authorization header).',
    '',
    '     -d implies POST and defaults Content-Type to',
    '     application/x-www-form-urlencoded, like curl. -I sends HEAD and',
    '     prints headers only. -f turns HTTP >= 400 into exit 22 with no',
    '     body; without -f a 4xx/5xx body prints normally and the exit is 0.',
    '',
    'DEVIATIONS from GNU curl (the synchronous browser transport):',
    '     - Redirects are ALWAYS followed (XHR gives no way not to); -L is',
    '       accepted and has no additional effect. Use -w %{url_effective}',
    '       to see where a redirect chain landed.',
    '     - No progress meter (-s accepted; there is nothing to silence',
    '       except errors, which -S shows even under -s).',
    '     - No timeouts (-m/--max-time): a synchronous request cannot be',
    '       cancelled.',
    '     - The printed status line always says HTTP/1.1 — the browser',
    '       does not expose the real protocol version to scripts.',
    '     - Output is line-oriented (the shell model); a body without a',
    '       trailing newline gains one in a pipe. -o/-O write exact bytes.',
    '',
    'CORS AND NETWORK FAILURES',
    '     A blocked request (status 0) exits 7 with the honest message:',
    '     browsers make CORS refusals, refused connections and DNS',
    '     failures indistinguishable to scripts, so the message explains',
    '     the candidates instead of guessing one. Embedders may gate',
    '     destinations with the allowlist hook (see below) — denials exit',
    '     1 and name the shell network allowlist.',
    '',
    'ALLOWLIST HOOK (embedders)',
    '     import { configureNet } from the semtext-pkg-net.js chunk (or',
    '     src/terminal/packages/net) and set configureNet({ allow: (url)',
    '     => true | "reason" }). It applies to curl, wget and http alike.',
    '',
    'EXIT CODES',
    '     0 ok (even on 4xx/5xx without -f) · 1 blocked by allowlist ·',
    '     2 usage error / no transport · 3 invalid URL or scheme ·',
    '     7 network/CORS failure · 22 -f failure · 23 body write error.',
    '',
    'EXAMPLES',
    '     curl -s https://api.example.com/x | jq .name',
    '     curl -H "Authorization: Bearer t" -d k=v https://example.com',
    '     curl -so /tmp/page.html -w "%{http_code} %{size_download}\\n" URL',
  ],
  wget: [
    'WGET(1)                   semtext-sh manual',
    '',
    'NAME',
    '     wget — download a URL into the VFS',
    '',
    'SYNOPSIS',
    '     wget [-q] [-O FILE | -O -] URL...',
    '',
    'DESCRIPTION',
    '     Non-interactive downloader modelled on GNU wget. Log lines go to',
    '     STDERR (--timestamp-- URL, Saving to, saved [bytes/bytes]), so',
    '     `wget -O- URL | grep …` pipes only the body. -q silences the log.',
    '',
    '     The default filename is the URL path basename, or index.html',
    '     when the path ends in / or is empty. -O names the file; -O -',
    '     writes the body to stdout without saving.',
    '',
    '     Server errors (HTTP >= 400) print `ERROR <code>: <text>.` and',
    '     exit 8 without saving anything — wget fails on error responses',
    '     where curl does not (there, see -f).',
    '',
    '     Same transport, credential and allowlist posture as curl: no',
    '     ambient cookies, redirects always followed, status-0 failures',
    '     exit 4 with the honest CORS/network message.',
    '',
    'EXIT CODES',
    '     0 ok · 1 usage/blocked/write error · 4 network/CORS ·',
    '     8 server error (4xx/5xx).',
  ],
  http: [
    'HTTP(1)                   semtext-sh manual',
    '',
    'NAME',
    '     http — HTTPie-style requests with pretty output',
    '',
    'SYNOPSIS',
    '     http [-vbh] [METHOD] URL [key:value | key=value | key:=json]...',
    '',
    'DESCRIPTION',
    '     Modelled on HTTPie. METHOD is optional: GET by default, POST',
    '     when body items or piped stdin are present. Items build the',
    '     request: key:value headers, key=value JSON string fields,',
    '     key:=json raw JSON fields. The first of `:` and `=` decides the',
    '     item kind (a=b:c is a body field, a:b=c a header), as in',
    '     HTTPie. Piped stdin becomes the raw request body (mutually',
    '     exclusive with body items). Defaults: Accept:',
    '     application/json, */* and, with a body, Content-Type:',
    '     application/json — user headers override both. A bare hostname',
    '     defaults to http://.',
    '',
    '     Output is the status line, sorted response headers, a blank',
    '     line, then the body — JSON pretty-printed and, on a terminal,',
    '     colorized (2xx green / 3xx yellow / 4xx+ red status line). -b',
    '     prints only the body, -h only the headers (-h is NOT help; use',
    '     --help), -v prepends the request line, request headers and body.',
    '',
    '     Any completed HTTP exchange exits 0 (4xx/5xx are valid',
    '     responses, as in HTTPie). Transport/credential/allowlist',
    '     posture matches curl: see curl(1).',
    '',
    'EXAMPLES',
    '     http GET https://api.example.com/users/1',
    '     http POST https://api.example.com/users name=ada admin:=true',
    "     echo '{\"a\":1}' | http POST https://api.example.com/x",
    '     http -b PATCH https://api.example.com/users/1 name=grace',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
