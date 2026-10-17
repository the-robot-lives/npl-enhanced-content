/**
 * packages/hello/index — the sample package body (packages round,
 * LANE=pkg-infra).
 *
 * The contract's proof vehicle: this file is the CHUNK
 * (`semtext-pkg-hello.js` once built). It never imports the base bundle —
 * only types from outside its directory — so the chunk stays ~1 KB and
 * demonstrates the rules every other package follows. The stub
 * (./stub.ts) registers `hello` before this module exists; once the chunk
 * resolves, these specs take over — including a RICHER `--help` than the
 * stub's one-liner, which is exactly the swap the contract promises.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';

const USAGE = 'hello [name] — print a greeting';

const RICH_HELP = [
  USAGE,
  '',
  'Greets the given name, or the world. With piped input and no name,',
  'every non-empty input line is greeted (a one-command pipe demo).',
  '',
  "  hello           greet the world",
  '  hello Ada       greet Ada',
  '  echo Pat | hello  greet every piped line',
  '',
  'This is the chunk-side help: richer than the stub answers before the',
  'package loads (the stub prints one line; the real command owns --help',
  'once resident).',
];

/** Greet one line, CRLF- and unicode-safe (astral pairs pass through). */
function greet(line: string): string {
  return `hello, ${line.replace(/\r$/, '')}`;
}

const hello: CommandSpec = {
  name: 'hello',
  usage: USAGE,
  complete: (ctx) => ['--help', '-h'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    if (ctx.args.includes('--help') || ctx.args.includes('-h')) {
      for (const line of RICH_HELP) ctx.out(line);
      return;
    }
    const operands = ctx.args.filter((a) => !a.startsWith('-') || a === '-');
    const options = ctx.args.filter((a) => a.startsWith('-') && a !== '-');
    if (options.length > 0) {
      ctx.err(`hello: unrecognized option '${options[0]}'`);
      ctx.err("Try 'hello --help' for more information.");
      ctx.exit(2);
      return;
    }
    if (operands.length > 0) {
      ctx.out(greet(operands.join(' ')));
      return;
    }
    const piped = ctx.stdin ?? '';
    if (piped !== '') {
      for (const line of piped.split('\n')) {
        if (line.trim() !== '') ctx.out(greet(line));
      }
      return;
    }
    ctx.out('hello, world');
  },
};

export const commands: Command[] = [hello];

export const manPages: Record<string, string[]> = {
  hello: [
    'HELLO(1)                  semtext-sh manual',
    '',
    'NAME',
    '     hello — print a greeting (the sample lazy package)',
    '',
    'SYNOPSIS',
    '     hello [name]',
    '     pipeline | hello',
    '',
    'DESCRIPTION',
    '     Greets a name, the world, or every non-empty piped line.',
    '     Ships as the command-package contract proof: the base shell',
    '     carries only the stub (usage, completion, man); this body loads',
    '     as semtext-pkg-hello.js next to the shell bundle on boot.',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
