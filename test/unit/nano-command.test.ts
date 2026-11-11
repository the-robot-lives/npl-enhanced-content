// Unit spec — the `nano` CommandSpec's LazyNano failure mapping
//
// Feature: the lazy hand-off failure paths
//   Scenario: the dynamic import rejects → status + exit 1
//   Scenario: the chunk resolves without a usable NanoEditor export → same
//   Scenario: the NanoEditor constructor throws → same
//
// The built shell loads the editor chunk with a runtime
// `import('./nano-app.js')`; every failure mode must land on the same
// `null` editor so start() reports 'nano: editor chunk failed to load'
// and exits 1 (the runner's crash line guarantees the shell is never left
// in raw mode).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vfs } from '../../src/terminal/vfs.js';
import type { AppContext } from '../../src/terminal/screen/types.js';
import type { CommandContext, ShellState } from '../../src/terminal/terminal-core.js';

const NANO_APP = '../../src/terminal/apps/nano/nano-app.js';
const NANO_COMMAND = '../../src/terminal/apps/nano/nano-command.js';

const state = (cwd = '/'): ShellState => ({
  cwd,
  env: { HOME: '/home/t' },
  aliases: {},
  history: [],
  oldpwd: null,
  lastStatus: 0,
});

const makeCtx = (args: string[], files: Record<string, string> = {}): CommandContext => {
  const vfs = new Vfs();
  for (const [path, content] of Object.entries(files)) vfs.mountFile(path, content);
  return {
    args,
    stdin: null,
    vfs,
    state: state(),
    color: true,
    commands: new Map(),
    out: () => {},
    err: () => {},
    emit: () => {},
    exit: () => {},
  };
};

/** Minimal AppContext double: records the status line and the exit code. */
const fakeApi = () => {
  const seen: { status: string | null; exits: number[] } = { status: null, exits: [] };
  const api = {
    setStatus: (text: string): void => {
      seen.status = text;
    },
    exit: (code = 0): void => {
      seen.exits.push(code);
    },
  };
  return { api: api as unknown as AppContext, seen };
};

/** Drain microtasks so the dynamic import's handlers run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LazyNano failure mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(NANO_APP);
  });

  const expectLoadFailure = async (): Promise<void> => {
    const { nanoCommand } = await import(NANO_COMMAND);
    const app = nanoCommand.app!(makeCtx(['f.txt'], { '/f.txt': 'x' }));
    expect(app).not.toBeNull();
    const { api, seen } = fakeApi();
    expect(app!.a11ySummary?.()).toBe('nano: loading');
    app!.start(api);
    await flush();
    expect(seen.status).toBe('nano: editor chunk failed to load');
    expect(seen.exits).toEqual([1]);
  };

  it('a rejected dynamic import reports the load failure and exits 1', async () => {
    vi.doMock(NANO_APP, () => {
      throw new Error('chunk fetch failed');
    });
    await expectLoadFailure();
  });

  it('a chunk without a usable NanoEditor export reports the same failure', async () => {
    vi.doMock(NANO_APP, () => ({})); // resolves, but no NanoEditor export
    await expectLoadFailure();
  });

  it('a throwing NanoEditor constructor reports the same failure', async () => {
    vi.doMock(NANO_APP, () => ({
      NanoEditor: class {
        constructor() {
          throw new Error('boom');
        }
      },
    }));
    await expectLoadFailure();
  });

  it('a usable NanoEditor export still hands off (guard does not over-fire)', async () => {
    vi.doMock(NANO_APP, async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/terminal/apps/nano/nano-app.js')>();
      return { NanoEditor: actual.NanoEditor };
    });
    const { nanoCommand } = await import(NANO_COMMAND);
    const ctx = makeCtx(['ok.txt'], { '/ok.txt': 'x' });
    const app = nanoCommand.app!(ctx);
    expect(app).not.toBeNull();
    expect(app!.a11ySummary?.()).toBe('nano: loading');
    // Drive through the real runner: the editor's start() needs the full
    // AppContext surface, not a status/exit double.
    const { Screen } = await import('../../src/terminal/screen/screen.js');
    const { ScreenFeed } = await import('../../src/terminal/screen/feed.js');
    const { RawLine } = await import('../../src/terminal/line/discipline.js');
    const { AppRunner } = await import('../../src/terminal/app/runner.js');
    const screen = new Screen({ scrollback: 100 });
    const feed = new ScreenFeed(screen);
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    expect(runner.spawn(app!)).toBe(true);
    runner.key({ key: 'o', ctrl: false, alt: false, shift: false, meta: false });
    await flush();
    expect(app!.a11ySummary?.()).toContain('nano: editing ok.txt'); // hand-off completed
    expect(exits).toEqual([]); // no forced exit
  });
});
