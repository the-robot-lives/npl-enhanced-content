/**
 * shell async commands (shell-v3 integration TODO 2).
 *
 * CommandSpec.run may return a Promise: the shell awaits it before the
 * next pipeline stage reads stdin. An all-sync line still returns the
 * ExecResult object itself — no caller is forced to await.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalCore, type ExecResult, type PluginManifest } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';

vi.setConfig({ testTimeout: 5_000 });

const asyncPlugin: PluginManifest = {
  name: 'async-test',
  version: '0.0.0',
  description: 'test doubles',
  commands: [
    {
      name: 'slowecho',
      usage: 'slowecho WORD',
      // Resolves after a macrotask so the pipeline genuinely suspends.
      run(ctx) {
        const word = ctx.args[0] ?? 'hi';
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            ctx.out(word);
            ctx.exit(0);
            resolve();
          }, 5);
        });
      },
    },
    {
      name: 'slowfail',
      usage: 'slowfail',
      run(ctx) {
        return new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('async boom')), 5);
        }).catch((cause: unknown) => {
          ctx.err(`slowfail: ${cause instanceof Error ? cause.message : String(cause)}`);
        });
      },
    },
  ],
  files: [],
};

let core: TerminalCore;
const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;
const pipe = (line: string): string[] => out(core.execLine(line) as ExecResult);

beforeEach(() => {
  core = new TerminalCore();
  core.mountPlugin(posixPlugin);
  core.mountPlugin(asyncPlugin);
});

describe('async commands', () => {
  it('a sync-only line returns the ExecResult itself (no await needed)', () => {
    const r = core.execLine('echo hi');
    expect(r instanceof Promise).toBe(false);
    expect(out(r as ExecResult)).toEqual(['hi']);
  });

  it('an async command resolves before the next stage reads stdin', async () => {
    const r = (await core.execLine("slowecho hello | sed 's/hello/HELLO/'")) as ExecResult;
    expect(out(r)).toEqual(['HELLO']);
  });

  it('an async command drives a redirect after resolution', async () => {
    await (core.execLine('slowecho saved > /out.txt') as Promise<ExecResult>);
    expect(core.vfs.read('/out.txt')).toBe('saved\n');
  });

  it('an async command that reports an error fails the line (exit 1)', async () => {
    const r = (await core.execLine('slowfail')) as ExecResult;
    expect(errs(r)).toEqual(['slowfail: async boom']);
    expect(status(r)).toBe(1);
  });

  it('sync prefix then async middle: later stages chain the resolved output', async () => {
    const r = (await core.execLine('echo x | tr x y | slowecho end')) as ExecResult;
    expect(out(r)).toEqual(['end']);
  });
});
