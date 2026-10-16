// Unit spec — the `wasm` package through the LAZY PATH (packages round,
// LANE=pkg-infra): stub registration → ensure() → the real PoC command
// running the PoC fixtures (src/terminal/packages/wasm/, sources
// src/terminal/wasm/, fixtures poc/wasm/bin).
//
// The built chunk file does not exist in the source tree, so the test
// instance injects the chunk SOURCE (packages/wasm/index.ts — exactly what
// the build bundles into semtext-pkg-wasm.js) as the loader: the same
// machinery the browser runs (see ../README.md, "Testing").
//
// Feature: wasm — the lazy path end to end
//   Scenario: the stub answers (usage error, short man) before the chunk;
//             ensure() swaps in the real spec — chunk man page included —
//             with no re-registration
//   Scenario: hello.wasm from the VFS runs batch through the delegated
//             spec and prints its line, exit 0
//   Scenario: wcat.wasm echoes piped stdin through the lazy spec
//   Scenario: the tty app hook claims only once the chunk is resident (§6.4)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage } from '../../src/terminal/packages/lazy.js';
import { stub as wasmStub } from '../../src/terminal/packages/wasm/stub.js';

vi.setConfig({ testTimeout: 5_000 });

const binDir = resolve(import.meta.dirname, '../../poc/wasm/bin');
const binaryString = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
};
const fixtureBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(binDir, `${name}.wasm`)));

/** The package under test: the production stub + the real chunk source as the loader. */
const pkg = createLazyPackage(wasmStub, async () => {
  const mod = await import('../../src/terminal/packages/wasm/index.js');
  return { commands: mod.commands, manPages: mod.manPages };
});

let core: TerminalCore;
const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;

/** A never-resolving instance: proves the true pre-load (stub) behaviour. */
const stubOnly = createLazyPackage(wasmStub, () => new Promise(() => {}));

beforeEach(() => {
  core = new TerminalCore();
  expect(core.mountPlugin(posixPlugin).ok).toBe(true); // cat/echo for the piped stages
  expect(core.mountPlugin({ name: 'pkg-test', version: '0', commands: pkg.commands, files: [] }).ok).toBe(true);
  core.vfs.mountFile('/bin/hello.wasm', binaryString(fixtureBytes('hello')));
  core.vfs.mountFile('/bin/wcat.wasm', binaryString(fixtureBytes('wcat')));
});

describe('wasm — the lazy path end to end', () => {
  it('the stub answers before the chunk; ensure() swaps in the real spec', async () => {
    expect(pkg.loaded()).toBe(false);
    const pre = core.execLine('wasm'); // not loaded yet: one honest stderr line, exit 1
    expect(status(pre)).toBe(1);
    expect(errs(pre)[0]).toMatch(/^wasm: /);
    expect(pkg.manPage('wasm')!.join('\n')).toContain('short page');

    expect(await pkg.ensure()).toBe(true);
    expect(pkg.loaded()).toBe(true);
    expect(pkg.manPage('wasm')!.join('\n')).toContain('WASI command module'); // chunk page, live
  });

  it('hello.wasm runs batch through the delegated spec (piped — a tty stage would hand the screen to the app)', async () => {
    await pkg.ensure();
    const r = core.execLine('wasm /bin/hello.wasm | cat');
    expect(out(r)).toEqual(['hello from wasm']);
    expect(status(r)).toBe(0);
  });

  it('wcat.wasm echoes piped stdin through the lazy spec (middle stage — batch, not the tty app)', async () => {
    await pkg.ensure();
    const r = core.execLine('echo piped | wasm /bin/wcat.wasm | cat');
    expect(out(r)).toEqual(['piped']);
    expect(status(r)).toBe(0);
  });

  it('the app hook claims only once the chunk is resident (§6.4)', async () => {
    // Pre-load (a never-resolving instance): the stub's app declines, so a
    // tty stage falls back to run()'s honest error — no app action.
    const stubCore = new TerminalCore();
    stubCore.vfs.mountFile('/bin/hello.wasm', binaryString(fixtureBytes('hello')));
    stubCore.mountPlugin({ name: 'pkg-stub', version: '0', commands: stubOnly.commands, files: [] });
    expect(stubCore.execLine('wasm /bin/hello.wasm').actions.some((a) => a.kind === 'app')).toBe(false);
    // Post-load: the tty stage hands over to WasmRunApp — an app action,
    // no `exit N` line (the app reports its own status when it exits).
    const r = core.execLine('wasm /bin/hello.wasm');
    expect(r.actions.some((a) => a.kind === 'app')).toBe(true);
    expect(r.lines.some((l) => l.kind === 'status')).toBe(false);
  });
});
