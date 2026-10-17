/**
 * sh lexer — quoting semantics (shell-v3 integration TODO 1).
 *
 * Regression pin for the pkg-awk round's finding: glob metachars inside
 * quoted words must survive verbatim (`awk 'BEGIN{RS="<[bn]?>"}'` once
 * received `RS="<b>"`). parseCommandLine is exercised directly so the
 * contract is on the lexer, not on whatever command happens to run.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseCommandLine } from '../../src/terminal/sh-parse.js';
import type { ShellState } from '../../src/terminal/terminal-core.js';
import { TerminalCore } from '../../src/terminal/terminal-core.js';

vi.setConfig({ testTimeout: 5_000 });

const state = (): ShellState => ({
  cwd: '/',
  env: { HOME: '/home/demo' },
  aliases: {},
  history: [],
  oldpwd: null,
  lastStatus: 0,
});
const argvOf = (line: string): string[] => {
  const r = parseCommandLine(line, state(), new TerminalCore().vfs);
  if (!r.ok) throw new Error(r.error);
  return r.stages[0]?.argv ?? [];
};

describe('sh lexer — quoting and glob metachars', () => {
  it('single quotes keep glob metachars literal ([ ] ? * and { })', () => {
    expect(argvOf(`awk 'BEGIN{RS="<[bn]?>"}'`)).toEqual(['awk', 'BEGIN{RS="<[bn]?>"}']);
    expect(argvOf(`echo '*' '[?]'`)).toEqual(['echo', '*', '[?]']);
  });

  it('single quotes suppress $ expansion and backslash escapes', () => {
    expect(argvOf(`echo '$HOME'`)).toEqual(['echo', '$HOME']);
    expect(argvOf(`echo 'a\\b'`)).toEqual(['echo', 'a\\b']);
  });

  it('a quoted segment mid-word disables globbing for the whole word', () => {
    // sh: the word is quoted, so even the unquoted part never globs.
    expect(argvOf(`echo x'[?]'y`)).toEqual(['echo', 'x[?]y']);
  });

  it('double quotes keep glob metachars but expand $', () => {
    expect(argvOf(`echo "<[bn]?>"`)).toEqual(['echo', '<[bn]?>']);
    expect(argvOf(`echo "$HOME/x"`)).toEqual(['echo', '/home/demo/x']);
  });

  it('backslash escapes one metachar outside quotes', () => {
    expect(argvOf(`echo \\*`)).toEqual(['echo', '*']);
  });

  it('unquoted metachar words still glob (nullglob off: stay literal on miss)', () => {
    expect(argvOf(`echo *.no-such-glob`)).toEqual(['echo', '*.no-such-glob']);
  });
});
