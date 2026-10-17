// Unit spec — the `hello` sample package body (packages round,
// LANE=pkg-infra): the chunk-side command at
// src/terminal/packages/hello/index.ts
//
// Feature: hello — greetings
//   Scenario: no operand greets the world; a name is greeted; multi-word
//             operands join
//   Scenario: piped stdin greets every non-empty line (empty lines and
//             blank tails skipped), CRLF trimmed
//   Scenario: unicode names pass through untouched (incl. astral pairs)
// Feature: hello — options
//   Scenario: --help/-h print the rich chunk-side help, exit 0
//   Scenario: unknown options error GNU-style, exit 2
// Feature: hello — completion
//   Scenario: flags complete by prefix

import { describe, it, expect } from 'vitest';
import type { CommandContext } from '../../src/terminal/terminal-core.js';
import { commands, manPages } from '../../src/terminal/packages/hello/index.js';

const hello = commands[0]!;

function run(args: string[], stdin: string | null = null): { outs: string[]; errs: string[]; code: number } {
  const outs: string[] = [];
  const errs: string[] = [];
  let code: number | null = null;
  hello.run({
    args,
    stdin,
    out: (t: string) => outs.push(t),
    err: (t: string) => errs.push(t),
    emit: () => {},
    exit: (c: number) => {
      code = c;
    },
  } as unknown as CommandContext);
  return { outs, errs, code: code ?? (errs.length > 0 ? 1 : 0) };
}

describe('hello — greetings', () => {
  it('greets the world, a name, and multi-word operands', () => {
    expect(run([]).outs).toEqual(['hello, world']);
    expect(run(['Ada']).outs).toEqual(['hello, Ada']);
    expect(run(['Ada', 'Grace', 'Hopper']).outs).toEqual(['hello, Ada Grace Hopper']);
    expect(run([]).code).toBe(0);
  });

  it('piped input greets every non-empty line; empty lines and CRLF handled', () => {
    expect(run([], 'Pat\n\nSam\r\n').outs).toEqual(['hello, Pat', 'hello, Sam']);
    expect(run([], '\n\n').outs).toEqual([]);
    expect(run([], '').outs).toEqual(['hello, world']); // empty pipe falls back to the world
  });

  it('unicode names pass through untouched, astral pairs included', () => {
    expect(run(['wörld']).outs).toEqual(['hello, wörld']);
    expect(run(['世界']).outs).toEqual(['hello, 世界']);
    expect(run(['𝔘𝔫𝔦']).outs).toEqual(['hello, 𝔘𝔫𝔦']); // astral plane surrogate pair
  });
});

describe('hello — options', () => {
  it('--help/-h print the rich chunk-side help, exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = run([flag]);
      expect(r.code).toBe(0);
      expect(r.outs.join('\n')).toContain('chunk-side help');
      expect(r.outs.join('\n')).toContain('echo Pat | hello');
    }
  });

  it('unknown options error GNU-style, exit 2', () => {
    const r = run(['--wat']);
    expect(r.errs).toEqual(["hello: unrecognized option '--wat'", "Try 'hello --help' for more information."]);
    expect(r.code).toBe(2);
  });
});

describe('hello — completion and man', () => {
  it('flags complete by prefix', () => {
    expect(hello.complete?.({ word: '--', args: [] } as never)).toEqual(['--help']);
    expect(hello.complete?.({ word: '-', args: [] } as never)).toEqual(['--help', '-h']);
    expect(hello.complete?.({ word: '--x', args: [] } as never)).toEqual([]);
  });

  it('the chunk man page replaces the stub page', () => {
    expect(manPages.hello!.join('\n')).toContain('the command-package contract proof');
    expect(manPages.hello!.length).toBeGreaterThan(4);
  });
});
