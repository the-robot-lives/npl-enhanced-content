// Unit spec — the command-package machinery (packages round, LANE=pkg-infra):
// the lazy loader, the man wrap and the manifest integration
// (src/terminal/packages/{lazy,manifest}.ts + hello/wasm stubs)
//
// Feature: createLazyPackage — the stub answers without the chunk
//   Scenario: --help/-h print the stub usage, exit 0, chunk never loaded
//   Scenario: an invocation that beats the fetch gets a one-line retry
//             hint, exit 1, and run() returns (never a hang)
//   Scenario: a failed fetch names the chunk and exits 1
// Feature: createLazyPackage — read-through delegation
//   Scenario: run/complete/app delegate to the chunk's specs once resident
//   Scenario: usage/help stay the stub's line (help never waits on the net)
//   Scenario: a chunk that forgets a stub command is a contract bug (exit 70)
//   Scenario: the kick happens at creation (boot-parallel preload)
// Feature: man — answered from the stub, upgraded by the chunk
//   Scenario: stub page pre-load; chunk page replaces it live once resident
//   Scenario: unknown pages fall through to the base man
//   Scenario: manifests without `man` pass through unchanged
// Feature: the mounted shell
//   Scenario: packagesPlugin registers hello + wasm on a fresh core
//   Scenario: `help` lists the packages; `man hello` answers from the stub
//   Scenario: the production stubs fail honest in vitest (no chunk file)
//             and still answer --help and man

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type CommandContext, type ExecResult, type PluginManifest } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage, withPackageMan, type LazyPackage } from '../../src/terminal/packages/lazy.js';
import type { PackageModule, PackageStub } from '../../src/terminal/packages/types.js';
import { PACKAGES, applyPackageMan, mountPackages, packagesPlugin } from '../../src/terminal/packages/manifest.js';
import { stub as helloStub } from '../../src/terminal/packages/hello/stub.js';
// Importing the real stubs registers + kicks them (the shell's exact boot);
// their chunk imports fail honest under vitest — asserted below.
import '../../src/terminal/packages/wasm/stub.js';

vi.setConfig({ testTimeout: 5_000 });

const HELLO_USAGE = 'hello [name] — print a greeting';

/** A CommandContext shim: records out/err/exit, no vfs (the loader never touches one). */
function mkCtx(args: string[], stdin: string | null = null): CommandContext & {
  __outs: string[];
  __errs: string[];
  __code: () => number;
} {
  const __outs: string[] = [];
  const __errs: string[] = [];
  let code: number | null = null;
  return {
    args,
    stdin,
    __outs,
    __errs,
    __code: () => code ?? (__errs.length > 0 ? 1 : 0),
    out: (t: string) => __outs.push(t),
    err: (t: string) => __errs.push(t),
    emit: () => {},
    exit: (c: number) => {
      code = c;
    },
  } as unknown as CommandContext & { __outs: string[]; __errs: string[]; __code: () => number };
}

const neverLoader = (): Promise<PackageModule> => new Promise(() => {});
const stubOnly = (): PackageStub => helloStub;

describe('createLazyPackage — the stub answers without the chunk', () => {
  it('--help prints the stub usage, exits 0, and never touches the chunk', () => {
    const pkg = createLazyPackage(stubOnly(), neverLoader);
    const ctx = mkCtx(['--help']);
    pkg.commands[0]!.run(ctx);
    expect(ctx.__outs).toEqual([HELLO_USAGE]);
    expect(ctx.__code()).toBe(0);
    expect(pkg.loaded()).toBe(false);
    const ctxH = mkCtx(['-h']);
    pkg.commands[0]!.run(ctxH);
    expect(ctxH.__outs).toEqual([HELLO_USAGE]);
  });

  it('an invocation that beats the fetch gets one retry line, exit 1, no hang', () => {
    const pkg = createLazyPackage(stubOnly(), neverLoader);
    const ctx = mkCtx([]);
    const started = Date.now();
    pkg.commands[0]!.run(ctx); // must return synchronously
    expect(Date.now() - started).toBeLessThan(250);
    expect(ctx.__errs).toEqual(['hello: chunk still loading — try again']);
    expect(ctx.__code()).toBe(1);
  });

  it('a failed fetch names the chunk and exits 1', async () => {
    const pkg = createLazyPackage(stubOnly(), () => Promise.reject(new Error('fetch failed')));
    expect(await pkg.ensure()).toBe(false);
    const ctx = mkCtx([]);
    pkg.commands[0]!.run(ctx);
    expect(ctx.__errs).toEqual(['hello: package chunk failed to load (semtext-pkg-hello.js)']);
    expect(ctx.__code()).toBe(1);
  });
});

describe('createLazyPackage — read-through delegation', () => {
  const realRun = vi.fn();
  const realComplete = vi.fn(() => ['--from-chunk']);
  const app = { id: 'fake-app' } as never;
  const realApp = vi.fn(() => app);
  const real: PackageModule = {
    commands: [{ name: 'hello', usage: 'chunk usage line', run: realRun, complete: realComplete, app: realApp }],
  };

  it('run/complete/app delegate once the chunk is resident', async () => {
    const pkg = createLazyPackage(stubOnly(), () => Promise.resolve(real));
    expect(pkg.commands[0]!.app?.(mkCtx([]))).toBeNull(); // claims only when loaded (§6.4)
    expect(await pkg.ensure()).toBe(true);
    expect(pkg.loaded()).toBe(true);
    const ctx = mkCtx(['Ada']);
    pkg.commands[0]!.run(ctx);
    expect(realRun).toHaveBeenCalledWith(ctx);
    expect(pkg.commands[0]!.complete?.({ word: '--', args: [] } as never)).toEqual(['--from-chunk']);
    expect(pkg.commands[0]!.app?.(mkCtx([]))).toBe(app);
  });

  it('usage stays the stub line — `help` never waits on the network', async () => {
    const pkg = createLazyPackage(stubOnly(), () => Promise.resolve(real));
    expect(pkg.commands[0]!.usage).toBe(HELLO_USAGE);
    await pkg.ensure();
    expect(pkg.commands[0]!.usage).toBe(HELLO_USAGE);
  });

  it('a chunk that forgets a stub command is a contract bug (exit 70)', async () => {
    const pkg = createLazyPackage(stubOnly(), () => Promise.resolve({ commands: [] }));
    await pkg.ensure();
    const ctx = mkCtx([]);
    pkg.commands[0]!.run(ctx);
    expect(ctx.__errs).toEqual(['hello: package chunk semtext-pkg-hello.js does not provide it']);
    expect(ctx.__code()).toBe(70);
  });

  it('the kick happens at creation — ensure() resolves the already-started load', async () => {
    let loads = 0;
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return Promise.resolve(real);
    });
    expect(loads).toBe(1); // boot-parallel preload, not first-use
    await pkg.ensure();
    expect(loads).toBe(1); // one kick, ever
  });
});

describe('man — stub page, chunk upgrade, base fall-through', () => {
  const baseMan = {
    name: 'man',
    usage: 'man COMMAND — the short manual page',
    run: vi.fn((ctx: CommandContext) => ctx.out('No manual entry for ' + (ctx.args[0] ?? '?'))),
  };
  const manifest = { name: 't', version: '0', commands: [baseMan], files: [] } as never;

  it('stub page pre-load, chunk page replaces it live, unknown falls through', async () => {
    const pkg = createLazyPackage(stubOnly(), () =>
      Promise.resolve({ commands: [], manPages: { hello: ['CHUNK PAGE'] } }),
    );
    const wrapped = withPackageMan(manifest, [pkg]);
    const man = wrapped.commands.find((s) => s.name === 'man')!;

    const pre = mkCtx(['hello']);
    man.run(pre);
    expect(pre.__outs[0]).toContain('HELLO(1)');
    expect(pre.__outs.join('\n')).toContain('short page');

    await pkg.ensure();
    const post = mkCtx(['hello']); // no re-registration: the wrap consults live
    man.run(post);
    expect(post.__outs).toEqual(['HELLO(1)                semtext-sh manual', '', 'CHUNK PAGE']);

    const miss = mkCtx(['nosuch']);
    man.run(miss);
    expect(baseMan.run).toHaveBeenCalledWith(miss);
  });

  it('manifests without `man` pass through unchanged', () => {
    const bare = { name: 't', version: '0', commands: [], files: [] } as never;
    expect(withPackageMan(bare, [])).toBe(bare);
  });
});

describe('the mounted shell', () => {
  let core: TerminalCore;
  const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
  const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

  beforeEach(() => {
    core = new TerminalCore();
    expect(core.mountPlugin(applyPackageMan(posixPlugin)).ok).toBe(true);
    // The supersedes-aware mount: name clashes resolve last-wins, never a
    // thrown/failed mount (text's grep/wc/head/tail ride this over posix).
    expect(mountPackages(core).every((pm) => pm.ok)).toBe(true);
  });

  it('mountPackages registers every package stub on a fresh core', () => {
    expect(core.hasCommand('hello')).toBe(true);
    expect(core.hasCommand('wasm')).toBe(true);
  });

  it('`help` lists the packages; `man hello` answers from the stub', () => {
    expect(out(core.execLine('help')).join('\n')).toContain(HELLO_USAGE);
    const man = out(core.execLine('man hello')).join('\n');
    expect(man).toContain('HELLO(1)');
    expect(man).toContain('short page');
  });

  it('man fall-through still serves the base pages (man ls)', () => {
    expect(out(core.execLine('man ls')).join('\n')).toContain('LS(1)');
  });

  it('production stubs fail honest in vitest (no chunk file) and still answer', async () => {
    for (const pkg of PACKAGES as readonly LazyPackage[]) {
      expect(await pkg.ensure()).toBe(false); // the built chunk does not exist in the source tree
    }
    const r = core.execLine('hello');
    expect(errs(r)).toEqual(['hello: package chunk failed to load (semtext-pkg-hello.js)']);
    expect(r.state.lastStatus).toBe(1);
    expect(out(core.execLine('hello --help'))).toEqual([HELLO_USAGE]); // resilience: help survives a dead chunk
  });
});

describe('package mounts supersede base commands (never a thrown mount)', () => {
  it('mountPlugin still refuses a duplicate without the supersede opt', () => {
    const core = new TerminalCore();
    const spec = { name: 'ls', usage: 'ls', run: () => {} };
    core.mountPlugin({ name: 'a', version: '0', commands: [spec], files: [] });
    expect(core.mountPlugin({ name: 'b', version: '0', commands: [spec], files: [] }).ok).toBe(false);
    // …and the opt keeps all-or-nothing for NON-declared clashes:
    const other = { name: 'pwd', usage: 'pwd', run: () => {} };
    expect(
      core.mountPlugin({ name: 'c', version: '0', commands: [{ ...spec }, other], files: [] }, { supersede: ['pwd'] })
        .ok,
    ).toBe(false);
    expect(core.commandSpec('ls')!.usage).toBe('ls'); // a's spec survived
  });

  it('a declared supersedes replaces silently; undeclared collisions last-wins with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const core = new TerminalCore();
      core.mountPlugin({
        name: 'base',
        version: '0',
        commands: [{ name: 'hello', usage: 'base hello', run: () => {} }],
        files: [],
      });
      const supersedeArgs: ReadonlyArray<readonly string[] | undefined> = [];
      const fakeCore = {
        hasCommand: (n: string) => n === 'hello',
        mountPlugin: (m: PluginManifest, o?: { supersede?: readonly string[] }) => {
          supersedeArgs.push(o?.supersede);
          return core.mountPlugin(m, o);
        },
      };
      const mounts = mountPackages(fakeCore);
      // Every package mounted; hello's manifest declared the clash.
      expect(mounts.every((pm) => pm.ok)).toBe(true);
      expect(mounts[0]).toMatchObject({ pkg: 'hello', superseded: ['hello'], undeclared: ['hello'] });
      expect(supersedeArgs[0]).toEqual(['hello']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0])).toMatch(/supersedes/);
      // Last-wins on the real core: the package's spec won.
      expect(core.commandSpec('hello')!.usage).toBe(HELLO_USAGE);
    } finally {
      warn.mockRestore();
    }
  });

  it('the real shell mounts every package after posix — the pkg-text collision regression', () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mounts = mountPackages(core);
      expect(mounts.every((pm) => pm.ok)).toBe(true); // the blocker: mount died wholesale before
      const text = mounts.find((pm) => pm.pkg === 'text');
      expect(text !== undefined).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('packagesPlugin stays importable for lane suites (single-manifest view)', () => {
    expect(packagesPlugin.commands.length).toBeGreaterThanOrEqual(PACKAGES.length);
  });
});
