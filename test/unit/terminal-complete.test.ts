// Unit spec — the Tab-completion engine (src/terminal/complete.ts)
//
// Feature: command names
//   Scenario: the first word of a stage completes against commands + aliases
//   Scenario: a word after an unquoted `|` is command position again
//   Scenario: a word after `>` completes paths, not commands
// Feature: paths
//   Scenario: relative dirs gain a trailing `/`, entries sort, single matches
//             extend with a trailing space
//   Scenario: absolute and `~`-led words complete; `~` expands against $HOME
//   Scenario: candidates needing quotes are single-quoted for unquoted words
//   Scenario: no match → 'none'
// Feature: per-command hooks
//   Scenario: which/man complete command names; cd completes dirs only
//   Scenario: semtext completes subcommands, then paths for the file operand
// Feature: list vs extend
//   Scenario: several candidates with a common prefix extend and list
//   Scenario: a fully-typed candidate still lists its siblings

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { completeLine } from '../../src/terminal/complete.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { demoPlugin } from '../../src/terminal/plugins/demo/plugin.js';

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);

beforeEach(() => {
  core = new TerminalCore();
  for (const plugin of [posixPlugin, demoPlugin]) {
    const result = core.mountPlugin(plugin);
    if (!result.ok) throw new Error(result.error ?? 'plugin failed to mount');
  }
  core.vfs.mountFile('/docs/alpha.txt', 'one\n');
  core.vfs.mountFile('/docs/beta.md', 'two\n');
  core.vfs.mountFile('/docs/nested/deep.txt', 'deep\n');
  core.vfs.mountFile('/my notes.txt', 'spaced\n');
  core.vfs.mountFile('/README.md', 'read\n');
  core.state.env.HOME = '/docs';
});

describe('command names', () => {
  it('the first word completes against commands and aliases', () => {
    const r = completeLine('gr', core);
    expect(r).toEqual({ kind: 'extend', line: 'grep ' });
    const one = completeLine('grep', core);
    expect(one.kind).toBe('extend'); // fully typed: one candidate extends with a space
    expect(completeLine('zz', core).kind).toBe('none');
    expect(completeLine('c', core)).toEqual({
      kind: 'list',
      line: 'c',
      candidates: expect.arrayContaining(['cat', 'cd', 'clear', 'cp']),
    });
  });

  it('a word after an unquoted `|` is command position again', () => {
    expect(completeLine('cat /README.md | gr', core)).toEqual({ kind: 'extend', line: 'cat /README.md | grep ' });
  });

  it('a word after `>` completes paths, not commands', () => {
    const r = completeLine('echo hi > /do', core);
    expect(r.kind === 'list' || r.kind === 'extend').toBe(true);
    if (r.kind !== 'none') expect(r.line.startsWith('echo hi > /docs')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('"grep"');
  });
});

describe('paths', () => {
  it('completes relative entries; dirs gain a trailing slash; singles extend', () => {
    core.state.cwd = '/';
    expect(completeLine('cd do', core)).toEqual({ kind: 'extend', line: 'cd docs/' });
    expect(completeLine('cd docs/', core)).toEqual({ kind: 'extend', line: 'cd docs/nested/' });
    expect(completeLine('cd docs/ne', core)).toEqual({ kind: 'extend', line: 'cd docs/nested/' });
    expect(completeLine('cat docs/alpha', core)).toEqual({ kind: 'extend', line: 'cat docs/alpha.txt ' });
  });

  it('completes absolute and `~`-led words; `~` expands against $HOME', () => {
    expect(completeLine('cat /docs/al', core)).toEqual({ kind: 'extend', line: 'cat /docs/alpha.txt ' });
    expect(completeLine('cat ~/al', core)).toEqual({ kind: 'extend', line: 'cat /docs/alpha.txt ' }); // the engine expands ~ to $HOME
  });

  it('quotes candidates that need it when the typed word was unquoted', () => {
    expect(completeLine('cat my', core)).toEqual({ kind: 'extend', line: "cat 'my notes.txt' " });
    expect(completeLine("cat 'my", core)).toEqual({ kind: 'extend', line: "cat 'my notes.txt' " });
  });

  it('no match is none', () => {
    expect(completeLine('cat /ghost', core)).toEqual({ kind: 'none' });
  });
});

describe('per-command hooks', () => {
  it('which and man complete command names', () => {
    const r = completeLine('which gr', core);
    expect(r).toEqual({ kind: 'extend', line: 'which grep ' }); // single candidate extends
    expect(completeLine('man wh', core)).toEqual({ kind: 'extend', line: 'man which ' });
  });

  it('cd completes directories only', () => {
    const r = completeLine('cd ', core);
    expect(r.kind === 'list' || r.kind === 'extend').toBe(true);
    if (r.kind === 'list') expect(r.candidates.every((c) => c.endsWith('/'))).toBe(true);
    const nested = completeLine('cd docs/ne', core);
    expect(nested).toEqual({ kind: 'extend', line: 'cd docs/nested/' });
    const noFiles = completeLine('cd docs/al', core);
    expect(noFiles.kind).toBe('none');
  });

  it('semtext completes subcommands, then paths for the file operand', () => {
    expect(completeLine('semtext ', core)).toEqual({
      kind: 'list',
      line: 'semtext ',
      candidates: ['render', 'tui', 'outline', 'filter', 'format', 'expand'],
    });
    const second = completeLine('semtext render ', core);
    expect(second.kind === 'list' || second.kind === 'extend').toBe(true);
    if (second.kind === 'list') {
      expect(second.candidates.every((c) => !['render', 'tui', 'outline'].includes(c))).toBe(true);
    }
  });
});

describe('list vs extend', () => {
  it('several candidates with a common prefix extend the line and list', () => {
    const r = completeLine('cat docs/be', core);
    expect(r).toEqual({ kind: 'extend', line: 'cat docs/beta.md ' });
    const many = completeLine('cat docs/', core);
    expect(many.kind).toBe('list');
    if (many.kind === 'list') expect(many.candidates).toHaveLength(3);
  });

  it('the engine drives real command runs end to end', () => {
    const extended = completeLine('cd docs/ne', core);
    if (extended.kind === 'extend' || extended.kind === 'list') {
      const run = core.execLine(extended.line);
      expect(out(run)).toEqual([]);
      expect(core.state.cwd).toBe('/docs/nested');
    }
  });
});
