/**
 * packages/awk/index — the awk chunk (packages round, LANE=pkg-awk).
 *
 * This file is the chunk (`semtext-pkg-awk.js` once built); the stub
 * (./stub.ts) registers `awk` before it exists. The command here is the
 * CLI shell around the engine: option parsing (-F -v -f -e, `--`, GNU
 * long forms), program-source resolution (text or files, concatenated in
 * order), input-file validation, and exit codes — GNU-worded, sed-house
 * exits: 0 ok, 1 usage/parse errors, 2 unreadable input files and fatal
 * runtime errors.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import { AwkParseError, parseProgram } from './awk-parse.js';
import { runProgram } from './awk-run.js';

const USAGE = "awk [-F fs] [-v var=val] [-f progfile] ['program'] [file ...]";

const RICH_HELP = [
  'Usage: ' + USAGE,
  '',
  'Pattern scanning and processing language (POSIX awk, gawk-flavoured).',
  '',
  'Options:',
  '  -F fs            field separator (a regex; " " means whitespace runs)',
  '  -v var=val       assign val to var before BEGIN (numeric strings too)',
  '  -f progfile      read the program from progfile (repeatable; concatenated)',
  "  -e 'program'     inline program text (repeatable; may mix with -f)",
  '  --               everything after this is program/file operands',
  '',
  'Long options: --field-separator=FS --assign VAR=VAL --file F --source P',
  '',
  'The first non-option operand is the program when no -f/-e is given;',
  'the rest are input files ("-" reads the pipe). Runs BEGIN before any',
  'input, the pattern{action} rules per record, END after all input.',
  '',
  'Supported: fields ($1..$NF, NF re-assign), NR/FNR/FS/OFS/ORS/RS/SUBSEP',
  '(RS "" is paragraph mode; multi-char RS is a regex), arrays with `in`',
  'and delete, multi-dim [a,b] via SUBSEP, ~ !~ regex match, printf/sprintf',
  '(%-10s %5.2f %x %o %c %e %g %%, * width/precision), string fns (length',
  'substr index split sub gsub match sprintf tolower toupper), math fns',
  '(sin cos atan2 exp log sqrt int rand srand), getline (var, <file), user',
  'functions (recursion; arrays pass by reference), > and >> redirection',
  'with buffering and close().',
  '',
  'Not supported: | output pipes, system(), |& coprocesses.',
];

const VERSION = 'awk (semtext-sh) 0.1.0 — POSIX awk for the sem-shell';

interface AwkOpts {
  assigns: Array<[string, string]>;
  progFiles: string[];
  progTexts: string[];
  files: string[];
}

const VAR_NAME_RE = /^[_A-Za-z][_A-Za-z0-9]*$/;

/** Parse awk's command line: options first, then program + file operands. */
function parseArgs(args: readonly string[], ctx: CommandContext, opts: AwkOpts): string | null {
  let i = 0;
  const shortWithArg = new Set(['F', 'v', 'f', 'e']);
  let operands: string[] = [];

  const pushAssign = (spec: string): string | null => {
    const eq = spec.indexOf('=');
    if (eq <= 0) return `awk: -v assignment '${spec}' lacks a name=value shape`;
    const name = spec.slice(0, eq);
    if (!VAR_NAME_RE.test(name)) return `awk: invalid -v variable name '${name}'`;
    opts.assigns.push([name, spec.slice(eq + 1)]);
    return null;
  };

  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--') {
      i++;
      operands = operands.concat(args.slice(i));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const value = eq === -1 ? null : arg.slice(eq + 1);
      switch (name) {
        case '--help':
          for (const line of RICH_HELP) ctx.out(line);
          ctx.exit(0);
          return 'handled';
        case '--version':
          ctx.out(VERSION);
          ctx.exit(0);
          return 'handled';
        case '--field-separator':
          if (value === null) return "awk: option '--field-separator' requires an argument";
          opts.assigns.push(['FS', value]);
          break;
        case '--assign':
          if (value === null) return "awk: option '--assign' requires an argument";
          {
            const bad = pushAssign(value);
            if (bad !== null) return bad;
          }
          break;
        case '--file':
          if (value === null) return "awk: option '--file' requires an argument";
          opts.progFiles.push(value);
          break;
        case '--source':
          if (value === null) return "awk: option '--source' requires an argument";
          opts.progTexts.push(value);
          break;
        default:
          return `awk: unrecognized option '${name}'\nTry 'awk --help' for more information.`;
      }
      i++;
      continue;
    }
    if (arg.length >= 2 && arg[0] === '-' && arg !== '-') {
      let rest = arg.slice(1);
      while (rest !== '') {
        const flag = rest[0]!;
        if (!shortWithArg.has(flag)) {
          return `awk: invalid option -- '${flag}'\nTry 'awk --help' for more information.`;
        }
        let value: string;
        rest = rest.slice(1);
        if (rest !== '') {
          value = rest; // glued: -F: -vA=1
        } else {
          i++;
          if (i >= args.length) return `awk: option '${flag}' requires an argument`;
          value = args[i]!;
        }
        if (flag === 'F') opts.assigns.push(['FS', value]);
        else if (flag === 'v') {
          const bad = pushAssign(value);
          if (bad !== null) return bad;
        } else if (flag === 'f') opts.progFiles.push(value);
        else opts.progTexts.push(value);
        rest = '';
      }
      i++;
      continue;
    }
    operands.push(arg);
    i++;
  }

  // POSIX: first operand is the program when no -f/-e; the rest are files
  if (opts.progFiles.length === 0 && opts.progTexts.length === 0) {
    if (operands.length === 0) return 'awk: no program given\nTry \'awk --help\' for more information.';
    opts.progTexts.push(operands.shift()!);
  }
  opts.files = operands;
  return null;
}

/** awk emits raw text (ORS/newlines included); the shell wants lines. */
function emit(sink: (text: string) => void, text: string): void {
  const pieces = text.split('\n');
  if (pieces[pieces.length - 1] === '') pieces.pop(); // ORS's own newline
  for (const piece of pieces) sink(piece);
}

const awk: CommandSpec = {
  name: 'awk',
  usage: USAGE,
  complete: (ctx: CompletionContext): string[] =>
    ['--help', '--version', '--field-separator=', '--assign=', '--file=', '--source=', '-F', '-v', '-f', '-e'].filter(
      (f) => f.startsWith(ctx.word),
    ),
  run(ctx: CommandContext): void {
    const opts: AwkOpts = { assigns: [], progFiles: [], progTexts: [], files: [] };
    const bad = parseArgs(ctx.args, ctx, opts);
    if (bad !== null) {
      if (bad === 'handled') return;
      ctx.err(bad);
      ctx.exit(1);
      return;
    }

    // program source: -f files (concatenated) + -e/operand texts, in order
    let source = '';
    for (const file of opts.progFiles) {
      const path = ctx.vfs.resolve(ctx.state.cwd, file);
      const content = ctx.vfs.read(path);
      if (content === null) {
        ctx.err(`awk: can't open source file '${file}': No such file or directory`);
        ctx.exit(2);
        return;
      }
      source += content + '\n';
    }
    source += opts.progTexts.join('\n');

    let program;
    try {
      program = parseProgram(source);
    } catch (cause) {
      if (cause instanceof AwkParseError) {
        ctx.err(`awk: ${cause.message}`);
        ctx.exit(1);
        return;
      }
      throw cause;
    }

    // input files must exist and be readable before we touch a record
    for (const file of opts.files) {
      if (file === '-') continue; // the pipe, when there is one
      const path = ctx.vfs.resolve(ctx.state.cwd, file);
      const node = ctx.vfs.nodeAt(path);
      if (node === null) {
        ctx.err(`awk: can't open file '${file}': No such file or directory`);
        ctx.exit(2);
        return;
      }
      if (node.kind === 'dir') {
        ctx.err(`awk: can't open file '${file}': Is a directory`);
        ctx.exit(2);
        return;
      }
    }

    const status = runProgram(program, {
      vfs: ctx.vfs,
      cwd: ctx.state.cwd,
      stdin: ctx.stdin,
      files: opts.files,
      assigns: opts.assigns,
      out: (text) => emit(ctx.out, text),
      err: (text) => emit(ctx.err, text),
    });
    ctx.exit(status);
  },
};

export const commands: Command[] = [awk];

export const manPages: Record<string, string[]> = {
  awk: [
    'AWK(1)                    semtext-sh manual',
    '',
    'NAME',
    '     awk — pattern scanning and processing language',
    '',
    'SYNOPSIS',
    "     awk [-F fs] [-v var=val] [-f progfile] ['program'] [file ...]",
    '     pipeline | awk \'program\'',
    '',
    'DESCRIPTION',
    '     POSIX awk: reads records (lines by default), splits each into',
    '     fields, and runs pattern{action} rules against it. BEGIN rules',
    '     run before any input, END rules after all of it.',
    '',
    '     Fields:   $1 $2 … $NF; $0 is the whole record. Assigning NF or',
    '     any $i re-builds the record with OFS.',
    '     Built-in variables: NR FNR NF FILENAME FS OFS ORS RS SUBSEP',
    '     RSTART RLENGTH CONVFMT OFMT.',
    '     FS forms: " " whitespace runs, "" single characters, any other',
    '     string a regex. RS forms: "\\n" default, "" paragraph mode, one',
    '     character, or a multi-character regex.',
    '',
    'STATEMENTS',
    '     if/else, while, do, for (C-style), for (var in array), break,',
    '     continue, next, nextfile, delete arr[k] / delete arr, exit [code],',
    '     print, printf; print > file and >> file (buffered, flushed at',
    '     exit; close(file) flushes and frees the handle).',
    '',
    'FUNCTIONS',
    '     length [x], substr(s, m [,n]), index(s, t), split(s, a [,fs]),',
    '     sub(re, rep [,t]), gsub(re, rep [,t]), match(s, re),',
    '     sprintf(fmt, …), tolower(s), toupper(s), sin cos atan2 exp log',
    '     sqrt int rand srand([n]), close(f), fflush([f]).',
    '     User functions: function name(params) { … } — scalars pass by',
    '     value, arrays by reference; extra params are locals; return expr.',
    '',
    'OPTIONS',
    '     -F fs        field separator (same as assigning FS)',
    '     -v var=val   assignment before BEGIN, in command-line order',
    '     -f progfile  program from a file (repeatable; concatenated)',
    "     -e 'program' inline program text (repeatable; may mix with -f)",
    '     --           end of options',
    '',
    'EXIT STATUS',
    '     0 success; 1 usage or parse errors (and no-input with main',
    '     rules); 2 unreadable file operands and fatal runtime errors;',
    '     else the value of `exit n`.',
    '',
    'LIMITS',
    '     No output pipes, system(), or |& coprocesses. getline without a',
    '     file shares the main input stream; getline < file gives -1 when',
    '     the file cannot be opened.',
    '',
    'EXAMPLES',
    "     echo 'a b c' | awk '{print $2}'        → b",
    "     awk -F: '{print $1}' /etc/passwd       first column",
    "     awk 'END{print NR}' file               line count",
    "     awk '{s+=$1} END{print s}' nums        column sum",
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
