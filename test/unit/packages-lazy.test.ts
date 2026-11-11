// Unit spec — the command-package machinery (packages round, LANE=pkg-infra):
// the lazy loader, the man wrap and the manifest integration
// (src/terminal/packages/{lazy,manifest}.ts + hello/wasm stubs)
//
// Feature: createLazyPackage — the stub answers without the chunk
//   Scenario: --help/-h print the stub usage, exit 0, kick no load
//   Scenario: no import starts before the first command invocation;
//             the first non-help invocation kicks exactly one load and
//             the same cold call runs the real command (no retry hint)
//   Scenario: concurrent first calls share one in-flight load
//   Scenario: a failed fetch names the chunk and exits 1 (with or
//             without an explicit ensure(); the failure is sticky)
// Feature: createLazyPackage — read-through delegation
//   Scenario: run/complete/app delegate to the chunk's specs once resident
//   Scenario: usage/help stay the stub's line (help never waits on the net)
//   Scenario: a chunk that forgets a stub command is a contract bug (exit 70)
// Feature: cold pipeline — first use loads mid-line
//   Scenario: `echo '{}' | jq .` resolves in ONE execLine with real jq
//             output, no retry text (the shell awaits run's Promise)
// Feature: man — answered from the stub, upgraded by the chunk
//   Scenario: stub page pre-load; chunk page replaces it live once resident
//   Scenario: unknown pages fall through to the base man
//   Scenario: manifests without `man` pass through unchanged
// Feature: the mounted shell
//   Scenario: packagesPlugin registers hello + wasm on a fresh core
//   Scenario: `help` lists the packages; `man hello` answers from the stub
//   Scenario: the production stubs fail honest in vitest (no chunk file)
//             and still answer --help and man
// Feature: supersede wrapper — async results cross the pipe
//   Scenario: resident package spec returning a Promise feeds the next stage
//   Scenario: a failed-load name runs the ASYNC base through the pipe with a
//             once-per-name stderr note (base.run's Promise forwarded)
//   Scenario: a superseded name's first use kicks the background load
//             without waiting on it; later calls run the package command

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type CommandContext, type ExecResult, type PluginManifest } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { createLazyPackage, withPackageMan, type LazyPackage } from '../../src/terminal/packages/lazy.js';
import type { PackageModule, PackageStub } from '../../src/terminal/packages/types.js';
import { PACKAGES, applyPackageMan, mountPackages, packagesPlugin } from '../../src/terminal/packages/manifest.js';
import { stub as helloStub } from '../../src/terminal/packages/hello/stub.js';
import { jqStub } from '../../src/terminal/packages/jq/stub.js';
// Importing the real stubs registers them (the shell's exact boot); with
// first-use loading nothing imports here — their chunk imports only start
// if a command is invoked, and fail honest under vitest (asserted below).
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

const stubOnly = (): PackageStub => helloStub;

describe('createLazyPackage — the stub answers without the chunk', () => {
  const deadLoader = (): Promise<PackageModule> => new Promise(() => {});

  it('--help prints the stub usage, exits 0, and never touches the chunk', () => {
    let loads = 0;
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return Promise.resolve({ commands: [] });
    });
    const ctx = mkCtx(['--help']);
    pkg.commands[0]!.run(ctx);
    expect(ctx.__outs).toEqual([HELLO_USAGE]);
    expect(ctx.__code()).toBe(0);
    expect(pkg.loaded()).toBe(false);
    expect(loads).toBe(0); // help answers from the stub and kicks nothing
    const ctxH = mkCtx(['-h']);
    pkg.commands[0]!.run(ctxH);
    expect(ctxH.__outs).toEqual([HELLO_USAGE]);
    expect(loads).toBe(0);
  });

  it('no import starts before the first command invocation; the same cold call runs the real command', async () => {
    let loads = 0;
    const realRun = vi.fn((ctx: CommandContext) => ctx.out('REAL OUT'));
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return Promise.resolve({ commands: [{ name: 'hello', usage: 'chunk usage line', run: realRun }] });
    });
    expect(loads).toBe(0); // creation kicks nothing — no chunk bytes at boot
    expect(pkg.state()).toBe('loading');
    const ctx = mkCtx(['Ada']);
    const p = pkg.commands[0]!.run(ctx); // the invocation itself is the trigger
    expect(loads).toBe(1);
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(realRun).toHaveBeenCalledWith(ctx); // the same cold call ran the real spec
    expect(ctx.__outs).toEqual(['REAL OUT']);
    expect(ctx.__errs).toEqual([]); // no "still loading — try again" anywhere
    expect(pkg.loaded()).toBe(true);
  });

  it('concurrent first calls share one in-flight load', async () => {
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realRun = vi.fn((ctx: CommandContext) => ctx.out('x'));
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return gate.then(() => ({ commands: [{ name: 'hello', usage: 'chunk usage line', run: realRun }] }));
    });
    const first = pkg.commands[0]!.run(mkCtx(['a']));
    const second = pkg.commands[0]!.run(mkCtx(['b']));
    expect(loads).toBe(1); // the second call joined the in-flight load
    release();
    await Promise.all([first, second]);
    expect(loads).toBe(1); // still exactly one kick
    expect(realRun).toHaveBeenCalledTimes(2); // both invocations ran the real spec
  });

  it('a failed fetch names the chunk and exits 1 — via an explicit ensure', async () => {
    const pkg = createLazyPackage(stubOnly(), () => Promise.reject(new Error('fetch failed')));
    expect(await pkg.ensure()).toBe(false);
    const ctx = mkCtx([]);
    await pkg.commands[0]!.run(ctx);
    expect(ctx.__errs).toEqual(['hello: package chunk failed to load (semtext-pkg-hello.js)']);
    expect(ctx.__code()).toBe(1);
  });

  it('a cold invocation reports the failed load itself; the failure is sticky', async () => {
    let loads = 0;
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return Promise.reject(new Error('fetch failed'));
    });
    const ctx = mkCtx([]);
    await pkg.commands[0]!.run(ctx); // no preload: the invocation awaited the failed load
    expect(loads).toBe(1);
    expect(ctx.__errs).toEqual(['hello: package chunk failed to load (semtext-pkg-hello.js)']);
    expect(ctx.__code()).toBe(1);
    const again = mkCtx([]);
    await pkg.commands[0]!.run(again);
    expect(loads).toBe(1); // no retry loop
    expect(again.__errs).toEqual(['hello: package chunk failed to load (semtext-pkg-hello.js)']);
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
    await pkg.commands[0]!.run(ctx);
    expect(ctx.__errs).toEqual(['hello: package chunk semtext-pkg-hello.js does not provide it']);
    expect(ctx.__code()).toBe(70);
  });

  it('ensure() kicks explicitly and resolves the shared load — one kick, ever', async () => {
    let loads = 0;
    const pkg = createLazyPackage(stubOnly(), () => {
      loads++;
      return Promise.resolve(real);
    });
    expect(loads).toBe(0); // nothing at creation (first-use loading)
    await pkg.ensure();
    expect(loads).toBe(1); // one kick
    await pkg.ensure();
    expect(loads).toBe(1); // the memoized promise — never re-fetched
    expect(pkg.state()).toBe('resident');
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

describe('cold pipeline — first use loads the chunk mid-line', () => {
  const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
  const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

  it("echo '{}' | jq . resolves in ONE execLine with real jq output and no retry text", async () => {
    const jqPkg = createLazyPackage(jqStub, async () => {
      const mod = await import('../../src/terminal/packages/jq/index.js');
      return { commands: mod.commands, manPages: mod.manPages };
    });
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    expect(
      core.mountPlugin({ name: 'pkg-jq-cold', version: '0', description: '', commands: jqPkg.commands, files: [] }).ok,
    ).toBe(true);
    expect(jqPkg.state()).toBe('loading'); // nothing loaded at mount — no boot bytes
    const r = (await core.execLine("echo '{}' | jq .")) as ExecResult;
    expect(out(r)).toEqual(['{}']); // real jq output, cold, one awaited line
    expect(errs(r)).toEqual([]); // no failure note
    expect(r.lines.map((l) => l.text).join('\n')).not.toContain('try again'); // the old hint is gone
    expect(jqPkg.state()).toBe('resident');
  });
});

describe('supersede wrapper — async results cross the pipe (the discarded-Promise fix)', () => {
  const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
  const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

  /** An async tr double: uppercases the piped stdin after a macrotask, tagged so a
   *  test can tell WHICH spec answered (the wrapper's base vs the package's own). */
  const asyncTr = (tag: string): CommandSpec => ({
    name: 'tr',
    usage: 'tr — test double',
    run(ctx) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          ctx.out(`${tag}:${(ctx.stdin ?? '').trim().toUpperCase()}`);
          ctx.exit(0);
          resolve();
        }, 5);
      });
    },
  });

  const mountTrBase = (core: TerminalCore, tag: string): void => {
    core.mountPlugin(posixPlugin); // echo + the pipe machinery
    core.mountPlugin({ name: 'base-tr', version: '0', description: '', commands: [asyncTr(tag)], files: [] }, { supersede: ['tr'] });
  };

  it('wrapper-async: a RESIDENT package spec returning a Promise feeds the pipe', async () => {
    const pkg = createLazyPackage(
      { name: 'asyncpkg', supersedes: ['tr'], commands: [{ name: 'tr', summary: 'async tr', usage: 'tr — test double' }] },
      async () => ({ commands: [asyncTr('pkg')] }),
    );
    await pkg.ensure();
    const core = new TerminalCore();
    mountTrBase(core, 'base');
    mountPackages(core, [pkg]); // the real manifest wrapper (mountPackages with an injected package list)
    const r = (await core.execLine('echo hi | tr')) as ExecResult;
    expect(out(r)).toEqual(['pkg:HI']); // the package spec answered… and discarding its Promise would truncate this to []
    expect(errs(r)).toEqual([]);
  });

  it('wrapper-failed: a failed-load superseded name runs the ASYNC base, notes once, never hangs', async () => {
    const pkg = createLazyPackage(
      { name: 'neverpkg', supersedes: ['tr'], commands: [{ name: 'tr', summary: 'never loads', usage: 'tr — test double' }] },
      () => Promise.reject(new Error('offline')), // deterministic: ensure() resolves false
    );
    const core = new TerminalCore();
    mountTrBase(core, 'base');
    mountPackages(core, [pkg]);
    const first = (await core.execLine('echo hi | tr')) as ExecResult;
    expect(out(first)).toEqual(['base:HI']); // the base answered through the pipe while the load was failing
    expect(errs(first)).toEqual([]); // the first call was still 'loading' — no premature note
    expect(first.state.lastStatus).toBe(0);
    const second = (await core.execLine('echo hi | tr')) as ExecResult;
    expect(errs(second)).toEqual(['tr: package chunk failed to load — using the base command']); // the once-note
    expect(out(second)).toEqual(['base:HI']);
    const third = (await core.execLine('echo hi | tr')) as ExecResult;
    expect(errs(third)).toEqual([]); // the note is once per name, not per call
  });

  it("a superseded name's first use kicks the background load without waiting on it", async () => {
    let loads = 0;
    let release!: (mod: PackageModule) => void;
    const gate = new Promise<PackageModule>((resolve) => {
      release = resolve;
    });
    const pkg = createLazyPackage(
      { name: 'bgpkg', supersedes: ['tr'], commands: [{ name: 'tr', summary: 'bg', usage: 'tr — test double' }] },
      () => {
        loads++;
        return gate; // held shut: the load CANNOT finish while the base answers
      },
    );
    const core = new TerminalCore();
    mountTrBase(core, 'base');
    mountPackages(core, [pkg]);
    const line = core.execLine('echo hi | tr'); // the base answers; the load kicks in the background
    expect(loads).toBe(1); // the invocation kicked it
    expect(pkg.state()).toBe('loading'); // kicked synchronously by the wrapper's first-use branch
    const r = (await line) as ExecResult; // the base's async tr answered while the load was still gated shut
    expect(out(r)).toEqual(['base:HI']); // the base ran WITHOUT waiting on the load
    expect(pkg.state()).toBe('loading'); // still gated — proof the line never awaited the chunk
    release({ commands: [asyncTr('pkg')] });
    await pkg.ensure();
    expect(pkg.state()).toBe('resident');
    const r2 = (await core.execLine('echo hi | tr')) as ExecResult; // later calls run the package command
    expect(out(r2)).toEqual(['pkg:HI']);
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
    const r = await core.execLine('hello');
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
        commandSpec: (n: string) => core.commandSpec(n),
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
      expect(text).toMatchObject({ superseded: ['grep', 'wc', 'head', 'tail'], undeclared: [] });
    } finally {
      warn.mockRestore();
    }
  });

  it('text declares supersedes for grep/wc/head/tail (integration TODO #9) — no mount warnings', () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mountPackages(core);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('packagesPlugin stays importable for lane suites (single-manifest view)', () => {
    expect(packagesPlugin.commands.length).toBeGreaterThanOrEqual(PACKAGES.length);
  });
});

describe('superseded base commands answer while the package chunk is absent (integration TODO #9 net)', () => {
  const errText = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

  it('a cold pipeline through a superseded name runs the BASE command (no retry hint, no broken pipe)', async () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    mountPackages(core); // text supersedes wc; the vitest chunk import fails honest
    for (const pkg of PACKAGES as readonly LazyPackage[]) await pkg.ensure();
    const r = core.execLine('echo hi | wc -l');
    // the base wc answered while text's chunk is a dead fetch in vitest:
    expect(r.lines.some((l) => l.kind === 'stdout' && /^ *1$/.test(l.text))).toBe(true);
    expect(errText(r).join('\n')).toContain('using the base command'); // one honest note
  });

  it('the note prints once per command; repeat calls are silent', async () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    mountPackages(core);
    for (const pkg of PACKAGES as readonly LazyPackage[]) await pkg.ensure();
    core.execLine('printf x | wc -c');
    const second = core.execLine('printf xy | wc -c');
    expect(errText(second)).toEqual([]);
    // x + the pipe's one line-sugar \n = 2 bytes; xy + \n = 3.
    expect(second.lines.some((l) => l.kind === 'stdout' && /^ *3$/.test(l.text))).toBe(true);
  });

  it('--help still answers from the stub while the chunk is absent', async () => {
    const core = new TerminalCore();
    expect(core.mountPlugin(posixPlugin).ok).toBe(true);
    mountPackages(core);
    for (const pkg of PACKAGES as readonly LazyPackage[]) await pkg.ensure();
    const r = core.execLine('wc --help');
    expect(r.lines.filter((l) => l.kind === 'stdout').length).toBeGreaterThan(0);
    expect(errText(r)).toEqual([]); // no failure note: help is stub contract
  });

  it('once the chunk is resident the package spec answers (no fallback, no note)', async () => {
    // fake text: a resident chunk whose wc prints a marker line
    const fakePkg = createLazyPackage(
      { name: 'faketext', supersedes: ['wc'], commands: [{ name: 'wc', summary: 'fake wc', usage: 'wc — fake' }] },
      () => Promise.resolve({ commands: [{ name: 'wc', usage: 'wc — fake', run: (ctx) => ctx.out('FAKE-WC') }] }),
    );
    await fakePkg.ensure();
    const core = new TerminalCore();
    core.mountPlugin(posixPlugin);
    core.mountPlugin(
      { name: 'pkg-faketext', version: '0', description: '', commands: fakePkg.commands, files: [] },
      { supersede: ['wc'] },
    );
    const r = core.execLine('printf z | wc');
    expect(r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text)).toEqual(['FAKE-WC']); // resident path — no note possible
  });
});
