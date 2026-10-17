// Unit spec — the net package (src/terminal/packages/net/): curl, wget and
// http (HTTPie-style) over the synchronous transport seam, plus the package
// contract (stub metadata, lazy load, man swap).
//
// The transport is injected per test (configureNet({ transport })) — the
// built-in sync XHR does not exist under node, which is also covered (the
// "no transport" error). The fake records every request for method/header/
// body assertions and answers from a URL route table; a 'cors' route throws
// the honest status-0 NetError.
//
// Feature: package contract
//   Scenario: stub entries match the chunk 1:1 (names + usage); manPages cover all
//   Scenario: --help is answered from the stub before the chunk arrives;
//             an early invocation gets the retry hint; a failed load names
//             the chunk; the man page swaps once resident
// Feature: curl
//   Scenario: GET to stdout, pipes to posix stages, exit 0; empty body
//   Scenario: -X/-H/-d/-u wire shape (method, joined parts, content-type,
//             Authorization basic, `Name;` empty-value header)
//   Scenario: -o exact bytes (CRLF + unicode preserved), -O URL basename,
//             -o - stdout
//   Scenario: -i status+headers+body, -I HEAD headers-only
//   Scenario: -f 404 → exit 22 no body; without -f → body printed exit 0
//   Scenario: -w %{http_code} %{size_download} %{url_effective}, \n interpreted
//   Scenario: CORS/network error exit 7 with the honest message; allowlist
//             deny exit 1; no-transport exit; bad scheme exit 3; unknown
//             option exit 2; no URL exit 2; -sS cluster; --help
// Feature: wget
//   Scenario: default basename save + stderr log (timestamp/Saving/saved
//             [bytes/bytes]), -q silences, -O FILE, -O - pipes
//   Scenario: 404 → ERROR line + exit 8, nothing saved; network → exit 4;
//             dir-ish URL → index.html; --help
// Feature: http (HTTPie)
//   Scenario: default GET pretty output (status, headers, pretty JSON body)
//   Scenario: -b body only, -h headers only (not help), --help, -v request block
//   Scenario: items — key:value header, key=value field, key:=json raw,
//             =-before-: wins; POST inferred; bare host defaults to http://
//   Scenario: stdin as raw body; stdin+items conflict; invalid := JSON
//   Scenario: 4xx still exit 0 with the body; network exit 7
//   Scenario: colors follow ctx.color (SGR on tty, plain when piped)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalCore, type CommandContext, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import type { PackageModule } from '../../src/terminal/packages/types.js';
import { netStub } from '../../src/terminal/packages/net/stub.js';
import {
  NetError,
  configureNet,
  fetchTransport,
  resetNet,
  type NetRequest,
  type NetResponse,
} from '../../src/terminal/packages/net/index.js';

/** Test loader: the source-tree chunk (production uses semtext-pkg-net.js). */
const chunkLoader = (): Promise<PackageModule> =>
  import('../../src/terminal/packages/net/index.js') as Promise<PackageModule>;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
/** `out` with SGR sequences stripped — http paints on a tty stage. */
const outPlain = (r: ExecResult): string[] =>
  out(r).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;

/* ------------------------------------------------------------------ *
 * fake transport: a URL route table + a request recorder
 * ------------------------------------------------------------------ */

let requests: NetRequest[] = [];
const ROUTES: Record<string, NetResponse | 'cors'> = {};

const resp = (status: number, bodyText: string, headers: Record<string, string> = {}, statusText = '', url = ''): NetResponse => ({
  status,
  statusText,
  headers,
  bodyText,
  url: url || '',
});

function fakeTransport(req: NetRequest): NetResponse {
  requests.push({ ...req, headers: { ...req.headers } });
  const route = ROUTES[req.url];
  if (route === 'cors') {
    throw new NetError('network', 'the request failed before a response was returned (status 0). [fake CORS]');
  }
  if (route === undefined) {
    throw new NetError('network', `fake transport has no route for ${req.url}`);
  }
  return { ...route, url: route.url || req.url };
}

const TEXT_BODY = 'one\ntwo\nthree\n';
const CRLF_BODY = 'a\r\nb\r\n';
const UNI_BODY = 'héllo 世界 𝔘\n';

beforeEach(async () => {
  resetNet();
  requests = [];
  for (const key of Object.keys(ROUTES)) delete ROUTES[key];
  Object.assign(ROUTES, {
    'http://api.test/text': resp(200, TEXT_BODY, { 'content-type': 'text/plain' }, 'OK'),
    'http://api.test/json': resp(200, '{"name":"ada","n":3}', { 'content-type': 'application/json' }, 'OK'),
    'http://api.test/empty': resp(200, '', { 'content-type': 'text/plain' }, 'OK'),
    'http://api.test/crlf': resp(200, CRLF_BODY, { 'content-type': 'text/plain' }, 'OK'),
    'http://api.test/uni': resp(200, UNI_BODY, { 'content-type': 'text/plain' }, 'OK'),
    'http://api.test/echo': resp(200, '{"ok":true}', { 'content-type': 'application/json' }, 'OK'),
    'http://api.test/redir': resp(200, TEXT_BODY, { 'content-type': 'text/plain' }, 'OK', 'http://api.test/final'),
    'http://api.test/four04': resp(404, 'gone', {}, 'Not Found'),
    'http://api.test/five00': resp(500, 'boom', {}, 'Internal Server Error'),
    'http://blocked.test/x': 'cors',
    'https://tls.test/json': resp(200, '{"up":true}', { 'content-type': 'application/json' }, 'OK'),
  });
  configureNet({ transport: fakeTransport });

  core = new TerminalCore();
  const mounted = core.mountPlugin(posixPlugin);
  if (!mounted.ok) throw new Error(mounted.error ?? 'posix plugin failed to mount');
  const pkg = createLazyPackage(netStub, chunkLoader);
  await pkg.ensure();
  for (const spec of pkg.commands) core.commands.set(spec.name, spec);
});

let core: TerminalCore;
const run = (line: string): ExecResult => core.execLine(line);

/** Direct spec invocation with a controlled ctx.color (no core pipeline). */
function runDirect(spec: { run(ctx: CommandContext): void }, args: string[], opts: { stdin?: string | null; color?: boolean } = {}) {
  const outs: string[] = [];
  const errorLines: string[] = [];
  let code: number | null = null;
  spec.run({
    args,
    stdin: opts.stdin ?? null,
    vfs: core.vfs,
    state: core.state,
    color: opts.color ?? false,
    commands: core.commands,
    out: (t: string) => outs.push(t),
    err: (t: string) => errorLines.push(t),
    emit: () => {},
    exit: (c: number) => {
      code = c;
    },
  } as unknown as CommandContext);
  return { outs, errs: errorLines, code: code ?? (errorLines.length > 0 ? 1 : 0) };
}

const netCommands = (): { curl: { run(ctx: CommandContext): void }; wget: { run(ctx: CommandContext): void }; http: { run(ctx: CommandContext): void } } => {
  const byName = new Map(core.commands);
  const get = (name: string) => byName.get(name)!;
  return { curl: get('curl'), wget: get('wget'), http: get('http') };
};

/* ------------------------------------------------------------------ */
/* package contract                                                    */
/* ------------------------------------------------------------------ */

describe('net package contract', () => {
  it('stub entries match the chunk 1:1 (names + usage) and manPages cover all', async () => {
    const mod = await chunkLoader();
    expect(mod.commands.map((c) => c.name)).toEqual(netStub.commands.map((c) => c.name));
    for (const stubCmd of netStub.commands) {
      const real = mod.commands.find((c) => c.name === stubCmd.name)!;
      expect(real.usage).toBe(stubCmd.usage);
      expect(mod.manPages?.[stubCmd.name]).toBeDefined();
    }
  });

  it('--help is answered from the stub before the chunk arrives', () => {
    const never = createLazyPackage(netStub, () => new Promise<PackageModule>(() => {}));
    const helpSpec = never.commands.find((c) => c.name === 'curl')!;
    const outs: string[] = [];
    const errorLines: string[] = [];
    let code: number | null = null;
    helpSpec.run({
      args: ['--help'],
      stdin: null,
      vfs: core.vfs,
      state: core.state,
      color: false,
      commands: core.commands,
      out: (t: string) => outs.push(t),
      err: (t: string) => errorLines.push(t),
      emit: () => {},
      exit: (c: number) => {
        code = c;
      },
    } as unknown as CommandContext);
    expect(errorLines).toEqual([]); // no stderr -> the runner default exit is 0
    expect(outs[0]).toBe(netStub.commands[0]!.usage); // the stub's usage line
  });

  it('an invocation that beats the fetch gets the retry hint, not a hang', () => {
    const never = createLazyPackage(netStub, () => new Promise<PackageModule>(() => {}));
    const spec = never.commands.find((c) => c.name === 'wget')!;
    const r = runDirect(spec, ['http://api.test/text']);
    expect(r.code).toBe(1);
    expect(r.errs).toEqual(['wget: chunk still loading — try again']);
  });

  it('a failed load names the chunk and exits 1', async () => {
    const failing = createLazyPackage(netStub, () => Promise.reject(new Error('no network')));
    await expect(failing.ensure()).resolves.toBe(false);
    const spec = failing.commands.find((c) => c.name === 'http')!;
    const r = runDirect(spec, ['http://api.test/json']);
    expect(r.code).toBe(1);
    expect(r.errs[0]).toContain('semtext-pkg-net.js');
  });

  it('the man page swaps from the stub short page to the chunk page', async () => {
    const pkg = createLazyPackage(netStub, chunkLoader);
    expect(pkg.manPage('curl')!.join('\n')).toContain('short page');
    await pkg.ensure();
    expect(pkg.manPage('curl')!.join('\n')).toContain('SYNOPSIS');
    expect(pkg.manNames().has('wget')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* curl                                                                */
/* ------------------------------------------------------------------ */

describe('curl', () => {
  it('GETs a body to stdout, pipes to posix stages, exits 0', () => {
    expect(out(run('curl http://api.test/text'))).toEqual(['one', 'two', 'three']);
    expect(status(run('curl http://api.test/text'))).toBe(0);
    expect(out(run('curl -s http://api.test/text | head -1'))).toEqual(['one']);
    expect(out(run('curl -s http://api.test/text | grep two'))).toEqual(['two']);
  });

  it('an empty body prints nothing and still exits 0', () => {
    expect(out(run('curl -s http://api.test/empty'))).toEqual([]);
    expect(status(run('curl -s http://api.test/empty'))).toBe(0);
  });

  it('-X/-H/-d/-u shape the request exactly', () => {
    run('curl -s -X POST -H "X-Token: abc" -H "X-Empty;" -d a=1 -d b=2 -u ada:secret http://api.test/echo');
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.body).toBe('a=1&b=2'); // -d parts join with &
    expect(req.headers['X-Token']).toBe('abc');
    expect(req.headers['X-Empty']).toBe(''); // `Name;` sends an empty value
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded'); // curl's -d default
    expect(req.headers['Authorization']).toBe('Basic YWRhOnNlY3JldA=='); // btoa('ada:secret')
  });

  it('-d alone implies POST; GET is the default otherwise', () => {
    run('curl -s -d x=1 http://api.test/echo');
    run('curl -s http://api.test/text');
    expect(requests.map((r) => r.method)).toEqual(['POST', 'GET']);
  });

  it('--data-binary sends the body and implies POST like -d', () => {
    run('curl -s --data-binary x=1 http://api.test/echo');
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.body).toBe('x=1');
    expect(requests[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('-o writes exact bytes (CRLF and unicode preserved) into the VFS', () => {
    expect(status(run('curl -s -o /dl/crlf.txt http://api.test/crlf'))).toBe(0);
    expect(core.vfs.read('/dl/crlf.txt')).toBe(CRLF_BODY);
    expect(status(run('curl -s -o /dl/uni.txt http://api.test/uni'))).toBe(0);
    expect(core.vfs.read('/dl/uni.txt')).toBe(UNI_BODY);
    expect(out(run('cat /dl/uni.txt'))).toEqual(['héllo 世界 𝔘']);
  });

  it('-O derives the name from the URL path, -o - goes to stdout', () => {
    run('curl -s -O http://api.test/crlf');
    expect(core.vfs.read('/crlf')).toBe(CRLF_BODY);
    expect(out(run('curl -s -o - http://api.test/text'))).toEqual(['one', 'two', 'three']);
  });

  it('-i includes status + headers + body; -I sends HEAD and prints headers only', () => {
    const r = run('curl -s -i http://api.test/json');
    expect(out(r)).toEqual(['HTTP/1.1 200 OK', 'content-type: application/json', '', '{"name":"ada","n":3}']);
    run('curl -s -I http://api.test/json');
    expect(requests[requests.length - 1]!.method).toBe('HEAD');
  });

  it('-f fails on 4xx/5xx (exit 22, no body); without -f the body prints and exit is 0', () => {
    const f = run('curl -f http://api.test/four04');
    expect(status(f)).toBe(22);
    expect(out(f)).toEqual([]);
    expect(errs(f)).toEqual(['curl: (22) The requested URL returned error: 404 Not Found']);
    expect(errs(run('-sf http://api.test/four04'.replace('-', 'curl -')))).toEqual([]); // -s mutes even -f
    expect(errs(run('curl -sSf http://api.test/four04'))).toHaveLength(1); // -S unmutes
    const nof = run('curl -s http://api.test/four04');
    expect(out(nof)).toEqual(['gone']);
    expect(status(nof)).toBe(0); // real curl: 4xx is not an error without -f
  });

  it('-w renders %{http_code}, %{size_download} and %{url_effective}', () => {
    expect(out(run("curl -s -w '%{http_code}' http://api.test/text"))).toEqual(['one', 'two', 'three', '200']);
    expect(out(run("curl -s -o /dev/null -w '%{http_code}\\n%{size_download}' http://api.test/text"))).toEqual(['200', '14']);
    expect(out(run("curl -s -w '%{url_effective}' http://api.test/redir"))).toEqual(['one', 'two', 'three', 'http://api.test/final']);
  });

  it('-L is accepted; redirects are followed by the transport (documented)', () => {
    const r = run("curl -s -L -w '%{http_code}' http://api.test/redir");
    expect(status(r)).toBe(0);
    expect(out(r)[out(r).length - 1]).toBe('200');
  });

  it('CORS/network failures exit 7 with the honest status-0 message', () => {
    const r = run('curl http://blocked.test/x');
    expect(status(r)).toBe(7);
    expect(errs(r)[0]).toContain('status 0');
    expect(errs(r)[0]).toContain('CORS');
  });

  it('-s silences errors; -sS shows them again', () => {
    expect(errs(run('curl -s http://blocked.test/x'))).toEqual([]);
    expect(status(run('curl -s http://blocked.test/x'))).toBe(7);
    expect(errs(run('curl -sS http://blocked.test/x'))).toHaveLength(1);
  });

  it('the embedder allowlist blocks with an explained message, exit 1', () => {
    configureNet({ allow: (url) => (url.host === 'api.test' ? true : 'demo build: api.test only') });
    const okRun = run('curl -s http://api.test/text');
    expect(status(okRun)).toBe(0);
    const denied = run('curl https://tls.test/json');
    expect(status(denied)).toBe(1);
    expect(errs(denied)[0]).toContain('network allowlist');
    expect(errs(denied)[0]).toContain('demo build: api.test only');
    expect(requests).toHaveLength(1); // the denied request never reached the transport
  });

  it('without a transport (this node test env) the failure is honest', () => {
    resetNet();
    const r = run('curl http://api.test/text');
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toContain('no network transport');
    expect(errs(r)[0]).toContain('configureNet');
  });

  it('bad scheme exits 3, unknown option exits 2, missing URL exits 2', () => {
    expect(status(run('curl ftp://api.test/x'))).toBe(3);
    const unk = run('curl -Z http://api.test/text');
    expect(status(unk)).toBe(2);
    expect(errs(unk)).toEqual(['curl: option -Z: is unknown', "curl: try 'curl --help' for more information"]);
    const noUrl = run('curl -s');
    expect(status(noUrl)).toBe(2);
    expect(errs(noUrl)[0]).toBe('curl: no URL specified');
  });

  it('clustered short flags work (-sS)', () => {
    const r = run('curl -sS http://blocked.test/x');
    expect(status(r)).toBe(7);
    expect(errs(r)).toHaveLength(1);
  });

  it('--help prints the rich chunk-side help, exit 0', () => {
    const r = run('curl --help');
    expect(status(r)).toBe(0);
    expect(out(r).join('\n')).toContain('synchronous transport');
    expect(out(r).join('\n')).toContain('%{http_code}');
  });

  it('flags complete by prefix', () => {
    const byName = new Map(core.commands);
    const candidates = byName.get('curl')!.complete?.({ word: '--', args: [] } as never) ?? [];
    expect(candidates).toEqual(['--data-binary', '--help']);
  });
});

/* ------------------------------------------------------------------ */
/* wget                                                                */
/* ------------------------------------------------------------------ */

describe('wget', () => {
  it('saves to the URL basename and logs to stderr with byte counts', () => {
    const r = run('wget http://api.test/text');
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/text')).toBe(TEXT_BODY);
    const log = errs(r);
    expect(log[0]).toMatch(/^--\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}--  http:\/\/api\.test\/text$/);
    expect(log[1]).toBe("Saving to: 'text'");
    expect(log[2]).toBe("'text' saved [14/14]"); // TEXT_BODY is 14 UTF-8 bytes
  });

  it('-q silences the log; the file still lands', () => {
    const r = run('wget -q http://api.test/text');
    expect(errs(r)).toEqual([]);
    expect(core.vfs.read('/text')).toBe(TEXT_BODY);
  });

  it('-O names the file; -O - pipes the body (log stays on stderr)', () => {
    run('wget -O /dl/page.txt http://api.test/text');
    expect(core.vfs.read('/dl/page.txt')).toBe(TEXT_BODY);
    const piped = run('wget -O - http://api.test/text');
    expect(out(piped)).toEqual(['one', 'two', 'three']);
    expect(errs(piped).some((l) => l.startsWith('--'))).toBe(true); // timestamped log line, stderr
  });

  it('a dir-ish URL saves as index.html', () => {
    Object.assign(ROUTES, { 'http://api.test/': resp(200, 'root', {}, 'OK') });
    run('wget -q http://api.test/');
    expect(core.vfs.read('/index.html')).toBe('root');
  });

  it('server errors exit 8 with the ERROR line and save nothing', () => {
    const r = run('wget http://api.test/four04');
    expect(status(r)).toBe(8);
    expect(errs(r)).toEqual(['wget: ERROR 404: Not Found.']);
    expect(core.vfs.read('/four04')).toBeNull();
    expect(core.vfs.read('/index.html')).toBeNull();
  });

  it('network failures exit 4', () => {
    const r = run('wget -q http://blocked.test/x');
    expect(status(r)).toBe(4);
    expect(errs(r)).toEqual([]); // -q silences even failures
  });

  it('multiple URLs download sequentially; a failure keeps the worst status', () => {
    const r = run('wget -q http://api.test/text http://api.test/four04');
    expect(status(r)).toBe(8);
    expect(core.vfs.read('/text')).toBe(TEXT_BODY);
  });

  it('--help prints usage, exit 0; missing URL errors', () => {
    expect(status(run('wget --help'))).toBe(0);
    const noUrl = run('wget');
    expect(status(noUrl)).toBe(1);
    expect(errs(noUrl)[0]).toBe('wget: missing URL');
  });
});

/* ------------------------------------------------------------------ */
/* http (HTTPie)                                                       */
/* ------------------------------------------------------------------ */

describe('http', () => {
  it('default GET prints status, headers, blank line, pretty JSON body', () => {
    const r = run('http http://api.test/json');
    expect(outPlain(r)).toEqual(['HTTP/1.1 200 OK', 'content-type: application/json', '', '{', '  "name": "ada",', '  "n": 3', '}']);
    expect(status(r)).toBe(0);
  });

  it('-b prints only the body; -h only the headers (and is not --help)', () => {
    expect(outPlain(run('http -b http://api.test/json'))).toEqual(['{', '  "name": "ada",', '  "n": 3', '}']);
    expect(outPlain(run('http -h http://api.test/json'))).toEqual(['HTTP/1.1 200 OK', 'content-type: application/json']);
    expect(out(run('http --help')).join('\n')).toContain('HTTPie-style');
  });

  it('items shape the request: headers, string fields, raw JSON fields', () => {
    run('http POST http://api.test/echo X-Token:abc name=ada n:=3 flag:=true');
    const req = requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.headers['X-Token']).toBe('abc');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['Accept']).toBe('application/json, */*');
    expect(JSON.parse(req.body!)).toEqual({ name: 'ada', n: 3, flag: true });
  });

  it('the first of : and = decides the item kind, as in HTTPie', () => {
    run('http POST http://api.test/echo a=b:c');
    run('http POST http://api.test/echo a:b=c');
    expect(JSON.parse(requests[0]!.body!)).toEqual({ a: 'b:c' }); // = before : → field
    expect(requests[1]!.headers['a']).toBe('b=c'); // : before = → header
  });

  it('-v prepends the request block with Host and the body', () => {
    const r = run('http -v POST http://api.test/echo name=ada');
    const lines = outPlain(r);
    expect(lines[0]).toBe('POST /echo HTTP/1.1');
    expect(lines).toContain('Host: api.test');
    expect(lines).toContain('Content-Type: application/json');
    expect(lines).toContain('{');
    expect(lines).toContain('  "name": "ada"');
    expect(lines).toContain('HTTP/1.1 200 OK');
  });

  it('a bare hostname defaults to http://', () => {
    run('http api.test/json');
    expect(requests[0]!.url).toBe('http://api.test/json');
  });

  it('piped stdin becomes the raw request body; conflicts with items', () => {
    run("echo '{\"a\":1}' | http POST http://api.test/echo");
    // verbatim: the pipe's trailing newline rides along, like HTTPie's stdin
    expect(requests[0]!.body).toBe('{"a":1}\n');
    const conflict = run("echo '{\"a\":1}' | http POST http://api.test/echo b=2");
    expect(status(conflict)).toBe(1);
    expect(errs(conflict)[0]).toContain('mutually exclusive');
  });

  it('invalid := JSON errors cleanly, exit 1', () => {
    const r = run('http POST http://api.test/echo n:=not-json');
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toContain('invalid JSON in item');
  });

  it('an invalid item errors, exit 1; a missing URL errors', () => {
    const bad = run('http http://api.test/echo notanitem');
    expect(status(bad)).toBe(1);
    expect(errs(bad)[0]).toContain("invalid item 'notanitem'");
    const noUrl = run('http');
    expect(status(noUrl)).toBe(1);
    expect(errs(noUrl)[0]).toContain('URL is required');
  });

  it('4xx/5xx are still completed exchanges: body printed, exit 0', () => {
    const r = run('http http://api.test/five00');
    expect(status(r)).toBe(0);
    expect(outPlain(r)).toContain('HTTP/1.1 500 Internal Server Error');
    expect(outPlain(r)).toContain('boom');
  });

  it('network failures exit 7 with the honest message', () => {
    const r = run('http http://blocked.test/x');
    expect(status(r)).toBe(7);
    expect(errs(r)[0]).toContain('http: error:');
    expect(errs(r)[0]).toContain('CORS');
  });

  it('non-JSON bodies pass through raw; https URLs work', () => {
    expect(outPlain(run('http http://api.test/text'))).toEqual(['HTTP/1.1 200 OK', 'content-type: text/plain', '', 'one', 'two', 'three']);
    expect(outPlain(run('http https://tls.test/json'))).toContain('  "up": true');
  });

  it('colors follow ctx.color: SGR on a tty, plain when piped', () => {
    const { http: spec } = netCommands();
    const tty = runDirect(spec, ['http://api.test/json'], { color: true });
    expect(tty.outs[0]).toMatch(/\x1b\[32m/); // green 2xx status
    expect(tty.outs.join('\n')).toMatch(/\x1b\[36m/); // cyan JSON keys
    const piped = runDirect(spec, ['http://api.test/json'], { color: false });
    expect(piped.outs.join('\n')).not.toContain('\x1b[');
    expect(piped.outs[0]).toBe('HTTP/1.1 200 OK');
  });

  it('a broken JSON body with a JSON content-type falls back to raw text', () => {
    Object.assign(ROUTES, {
      'http://api.test/broken': resp(200, '{"nope', { 'content-type': 'application/json' }, 'OK'),
    });
    expect(outPlain(run('http http://api.test/broken'))).toEqual(['HTTP/1.1 200 OK', 'content-type: application/json', '', '{"nope']);
  });
});

/* ------------------------------------------------------------------ *
 * async transport (shell-v3 TODO 2+8): fetch transport + async dispatch
 * ------------------------------------------------------------------ */

describe('net async transport (CORE-V2)', () => {
  /** fetch double: resolves `body` after a macrotask, records the init. */
  let fetchInits: Array<{ url: string; init: RequestInit }>;
  const installFetch = (impl: (url: string, init: RequestInit) => Promise<Response>): void => {
    vi.stubGlobal('fetch', vi.fn(impl));
  };

  beforeEach(() => {
    resetNet();
    fetchInits = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetNet();
  });

  it('configureNet({ transportAsync }) routes commands through fetch and the shell awaits the body', async () => {
    installFetch(async (url, init) => {
      fetchInits.push({ url, init });
      return new Response(TEXT_BODY, { status: 200, headers: { 'content-type': 'text/plain' } });
    });
    configureNet({ transportAsync: fetchTransport });
    const r = (await run('curl -s http://api.test/text | wc -c')) as ExecResult;
    console.log('PROBE', JSON.stringify(errs(r)), status(r));
    expect(out(r)).toEqual([String(TEXT_BODY.length)]);
    expect(fetchInits).toHaveLength(1);
    // credentials never attach ambient auth (XHR parity); redirects follow.
    expect(fetchInits[0]!.init.credentials).toBe('omit');
    expect(fetchInits[0]!.init.redirect).toBe('follow');
  });

  it('no transportAsync configured: commands stay synchronous (ExecResult returned, sync transport used)', () => {
    configureNet({ transport: fakeTransport });
    const r = run('curl -s http://api.test/text');
    expect(r instanceof Promise).toBe(false);
    expect(out(r as ExecResult)).toEqual(['one', 'two', 'three']);
  });

  it('async network failure maps to the same NetError exit codes (7)', async () => {
    installFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    configureNet({ transportAsync: fetchTransport });
    const r = (await run('curl http://api.test/text')) as ExecResult;
    expect(status(r)).toBe(7);
    expect(errs(r)[0]).toContain('the request failed before a response was returned');
  });

  it('async allowlist denial still blocks before dispatch (exit 1)', async () => {
    installFetch(async () => new Response('nope', { status: 200 }));
    configureNet({ transportAsync: fetchTransport, allow: () => 'no exfiltration' });
    const r = (await run('curl http://api.test/text')) as ExecResult;
    expect(status(r)).toBe(1);
    expect(errs(r)[0]).toContain('network allowlist');
    expect(fetchInits).toHaveLength(0);
  });

  it('wget saves through the async transport, sequentially, exit 0', async () => {
    installFetch(async () => new Response('async bytes', { status: 200, headers: { 'content-type': 'text/plain' } }));
    configureNet({ transportAsync: fetchTransport });
    const r = (await run('wget -O /tmp-async.txt http://api.test/text')) as ExecResult;
    expect(status(r)).toBe(0);
    expect(core.vfs.read('/tmp-async.txt')).toBe('async bytes');
  });
});
