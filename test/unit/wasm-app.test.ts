// Unit spec — the wasm command + app layer (CORE-V2 Appendix A,
// round-3 LANE=wasm-poc)
//
// Feature: `wasm` as a pipeline command
//   Scenario: no operand prints usage, exit 2
//   Scenario: missing module reports and exits 66
//   Scenario: non-wasm content is refused, exit 65
//   Scenario: hello.wasm from the VFS runs batch and prints its line
//   Scenario: wcat.wasm echoes the piped stdin, exit code propagates
//   Scenario: wtype.wasm reads a preopen file from the VFS snapshot
// Feature: the tty hook (§6.4)
//   Scenario: wasmApp declines on every error path (usage, missing, bad b64)
//   Scenario: wasmApp claims with a real module and the app runs it
// Feature: the app (real Screen + AppRunner harness)
//   Scenario: typed lines reach the guest; Ctrl+D EOFs; exit code lands
//   Scenario: Ctrl+C kills and exits 130
//   Scenario: the a11y summary describes state

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lineText, Screen } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import { RawLine } from '../../src/terminal/line/discipline.js';
import { AppRunner } from '../../src/terminal/app/runner.js';
import { Vfs } from '../../src/terminal/vfs.js';
import type { KeyEvent } from '../../src/terminal/screen/types.js';
import type { CommandContext, ShellState } from '../../src/terminal/terminal-core.js';
import { wasmApp, wasmCommand } from '../../src/terminal/wasm/command.js';

const here = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(here, '../../poc/wasm/bin');

const fixtureBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(binDir, `${name}.wasm`)));

/** Binary string (VFS file-content convention) for a bytes payload. */
const binaryString = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
};

const state = (cwd = '/'): ShellState => ({ cwd, env: { HOME: '/home/t' }, aliases: {}, history: [], oldpwd: null, lastStatus: 0 });

const makeCtx = (
  args: string[],
  files: Record<string, string> = {},
  opts: { stdin?: string | null } = {},
): CommandContext => {
  const vfs = new Vfs();
  vfs.mkdir('/bin', { parents: true });
  for (const [path, content] of Object.entries(files)) vfs.mountFile(path, content);
  const outs: string[] = [];
  const errs: string[] = [];
  let code: number | null = null;
  const ctx: CommandContext = {
    args,
    stdin: opts.stdin ?? null,
    vfs,
    state: state(),
    color: true,
    commands: new Map(),
    out: (t) => outs.push(t),
    err: (t) => errs.push(t),
    emit: () => {},
    exit: (c) => {
      code = c;
    },
  };
  return Object.assign(ctx, {
    __outs: outs,
    __errs: errs,
    __code: () => code,
  }) as CommandContext & { __outs: string[]; __errs: string[]; __code(): number | null };
};

/* ------------------------------------------------------------------ *
 * the command, piped
 * ------------------------------------------------------------------ */

describe('wasm command — batch run()', () => {
  it('no operand prints usage and exits 2', () => {
    const ctx = makeCtx([]);
    wasmCommand.run(ctx);
    expect(ctx.__errs).toContain('usage: wasm <module.wasm> [args...]');
    expect(ctx.__code()).toBe(2);
  });

  it('missing module reports and exits 66', () => {
    const ctx = makeCtx(['/bin/nope.wasm']);
    wasmCommand.run(ctx);
    expect(ctx.__errs[0]).toBe('wasm: no such module: /bin/nope.wasm');
    expect(ctx.__code()).toBe(66);
  });

  it('non-wasm content is refused, exit 65', () => {
    const ctx = makeCtx(['/bin/fake.wasm'], { '/bin/fake.wasm': 'not wasm at all' });
    wasmCommand.run(ctx);
    expect(ctx.__errs[0]).toBe('wasm: not a wasm module: /bin/fake.wasm');
    expect(ctx.__code()).toBe(65);
  });

  it('hello.wasm from the VFS runs batch and prints its line', () => {
    const ctx = makeCtx(['/bin/hello.wasm'], { '/bin/hello.wasm': binaryString(fixtureBytes('hello')) });
    wasmCommand.run(ctx);
    expect(ctx.__outs).toEqual(['hello from wasm']);
    expect(ctx.__code()).toBe(0);
  });

  it('wcat.wasm echoes the piped stdin', () => {
    const ctx = makeCtx(['/bin/wcat.wasm'], { '/bin/wcat.wasm': binaryString(fixtureBytes('wcat')) }, { stdin: 'piped\nline\n' });
    wasmCommand.run(ctx);
    expect(ctx.__outs).toEqual(['piped', 'line']);
    expect(ctx.__code()).toBe(0);
  });

  it('wtype.wasm reads a preopen file from the VFS snapshot', () => {
    const ctx = makeCtx(['/bin/wtype.wasm', '/docs/readme.txt'], {
      '/bin/wtype.wasm': binaryString(fixtureBytes('wtype')),
      '/docs/readme.txt': 'snapshot works\n',
    });
    wasmCommand.run(ctx);
    expect(ctx.__outs).toEqual(['snapshot works']);
    expect(ctx.__code()).toBe(0);
  });

  it('a .b64 module decodes and runs', () => {
    const b64 = Buffer.from(fixtureBytes('hello')).toString('base64');
    const ctx = makeCtx(['/bin/hello.b64'], { '/bin/hello.b64': b64 });
    wasmCommand.run(ctx);
    expect(ctx.__outs).toEqual(['hello from wasm']);
    expect(ctx.__code()).toBe(0);
  });

  it('invalid base64 reports the decode error, exit 65', () => {
    const ctx = makeCtx(['/bin/bad.b64'], { '/bin/bad.b64': '%%% not base64 %%%' });
    wasmCommand.run(ctx);
    expect(ctx.__errs[0]).toBe('wasm: invalid base64 in /bin/bad.b64');
    expect(ctx.__code()).toBe(65);
  });
});

/* ------------------------------------------------------------------ *
 * the tty hook
 * ------------------------------------------------------------------ */

describe('wasm app hook — §6.4 claim/decline', () => {
  it('declines on usage, missing module and bad decode', () => {
    expect(wasmApp(makeCtx([]))).toBeNull();
    expect(wasmApp(makeCtx(['/bin/nope.wasm']))).toBeNull();
    expect(wasmApp(makeCtx(['/bin/bad.b64'], { '/bin/bad.b64': '!!!' }))).toBeNull();
  });

  it('declines non-wasm bytes (empty file)', () => {
    expect(wasmApp(makeCtx(['/bin/empty.wasm'], { '/bin/empty.wasm': '' }))).toBeNull();
  });

  it('claims with a real module', () => {
    const ctx = makeCtx(['/bin/hello.wasm'], { '/bin/hello.wasm': binaryString(fixtureBytes('hello')) });
    const app = wasmApp(ctx);
    expect(app).not.toBeNull();
    expect(app!.id).toBe('wasm');
  });
});

/* ------------------------------------------------------------------ *
 * the app through the real AppRunner
 * ------------------------------------------------------------------ */

const key = (k: string, ctrl = false): KeyEvent => ({ key: k, ctrl, alt: false, shift: false, meta: false });

describe('wasm app — AppRunner harness (in-thread engine)', () => {
  it('hello: output lands on the alt screen; Enter leaves with exit 0', async () => {
    const ctx = makeCtx(['/bin/hello.wasm'], { '/bin/hello.wasm': binaryString(fixtureBytes('hello')) });
    const app = wasmApp(ctx);
    if (app === null) throw new Error('wasmApp declined');
    const screen = new Screen({ scrollback: 100 });
    const feed = new ScreenFeed(screen);
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    expect(runner.spawn(app)).toBe(true);
    await new Promise((r) => setTimeout(r, 30)); // let the async run settle
    const frame = Array.from({ length: screen.rows }, (_, r) => lineText(screen.alternate.lines[r]!));
    expect(frame.some((l) => l.includes('hello from wasm'))).toBe(true);
    expect(frame.some((l) => l.includes('wasm /bin/hello.wasm'))).toBe(true);
    expect(app.a11ySummary()).toContain('exit 0');
    runner.key(key('Enter'));
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([[0, null]]);
  });

  it('wcat: typed lines reach the guest, Ctrl+D EOFs, exit 0', async () => {
    const ctx = makeCtx(['/bin/wcat.wasm'], { '/bin/wcat.wasm': binaryString(fixtureBytes('wcat')) });
    const app = wasmApp(ctx);
    if (app === null) throw new Error('wasmApp declined');
    const screen = new Screen({ scrollback: 100 });
    const feed = new ScreenFeed(screen);
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    expect(runner.spawn(app)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    for (const ch of 'echo me') runner.key(key(ch));
    runner.key(key('Enter'));
    await new Promise((r) => setTimeout(r, 30));
    let frame = Array.from({ length: screen.rows }, (_, r) => lineText(screen.alternate.lines[r]!));
    expect(frame.some((l) => l.includes('echo me'))).toBe(true);
    runner.key(key('d', true)); // Ctrl+D
    await new Promise((r) => setTimeout(r, 30));
    expect(app.a11ySummary()).toContain('exit 0');
    runner.key(key('Enter'));
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([[0, null]]);
  });

  it('Ctrl+C kills and exits 130', async () => {
    const ctx = makeCtx(['/bin/wcat.wasm'], { '/bin/wcat.wasm': binaryString(fixtureBytes('wcat')) });
    const app = wasmApp(ctx);
    if (app === null) throw new Error('wasmApp declined');
    const screen = new Screen({ scrollback: 100 });
    const feed = new ScreenFeed(screen);
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    expect(runner.spawn(app)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    runner.key(key('c', true));
    expect(exits).toEqual([[130, null]]);
    expect(app.a11ySummary()).toContain('input line ready'); // stop() ran, no crash path claimed
  });
});
