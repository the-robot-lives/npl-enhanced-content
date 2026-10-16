/**
 * packages/jq/index — the jq chunk (packages round, LANE=pkg-jq).
 *
 * This file is the chunk (`semtext-pkg-jq.js` once built); the stub
 * (./stub.ts) registers `jq` and `json` before it exists. Everything here
 * is the CLI shell around the engine: option parsing (GNU long forms,
 * bundled shorts, `--`), input-source resolution (pipe or VFS files,
 * multi-document JSON streams), per-input evaluation with jq's exit-code
 * conventions, and output formatting (pretty/compact/raw). The language
 * itself lives in ./jq-lex.ts, ./jq-parse.ts, ./jq-eval.ts and the JSON
 * stream reader in ./jq-json.ts.
 *
 * Exit codes follow jq: 0 ok · 2 usage/system trouble (bad options,
 * unreadable files, malformed input JSON) · 3 program parse/compile
 * errors · 5 runtime errors (one bad input doesn't stop the rest).
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import { JqParseError, parseProgram } from './jq-parse.js';
import { JqError, evalNode, validateProgram, type Env, type JVal } from './jq-eval.js';
import { JqJsonError, parseOneJson, renderValue, scanJson } from './jq-json.js';

const USAGE = "jq [-rscn] [--arg name value] [--argjson name json] 'FILTER' [file ...]";

const RICH_HELP = [
  'Usage: ' + USAGE,
  '',
  'Filter and transform JSON (a jq subset that covers real use).',
  '',
  'Options:',
  '  -r, --raw-output     print strings raw (no quotes)',
  '  -c, --compact-output one line per output',
  '  -s, --slurp          read all inputs into one array',
  '  -n, --null-input     run the filter once with null input',
  '  --arg name value     $name as a string',
  '  --argjson name json  $name as parsed JSON',
  '  -h, --help           this help; --version',
  '',
  'Language: paths (.a.b, .["k"], .[0], slices), .[] iteration, pipe |,',
  'comma, select map keys length to_entries from_entries has add range,',
  'sort_by group_by unique_by min_by max_by unique sort reverse first last,',
  'min max any all flatten map_values with_entries join split startswith',
  'endswith ltrimstr rtrimstr ascii_downcase ascii_upcase type tostring',
  'tonumber tojson fromjson not empty error, comparisons and arithmetic,',
  'and/or/not, // alternative, if/elif/else/end, try/catch and ?, string',
  'interpolation "\\(expr)", array/object construction, $vars, reduce,',
  'formats @csv @tsv @json @base64 @base64d @text @uri @html.',
  '',
  'Not supported: assignment (= |= +=), def, foreach, regex fns (test,',
  'match, sub, gsub), .., input/inputs, @format with interpolation.',
  '',
  'Exit codes: 0 ok · 2 usage/bad input JSON · 3 bad program · 5 runtime',
  'error (later inputs still run).',
];

const JSON_USAGE = 'json [-c] [-r] [file ...]';

const JSON_HELP = [
  'Usage: ' + JSON_USAGE,
  '',
  'Pretty-print and validate JSON (the jq pretty-printer under an',
  'obvious name). Reads each file (or the pipe) as a stream of JSON',
  'documents and prints them with 2-space indent; malformed input',
  'reports the offset and exits 2.',
  '',
  '  -c, --compact   one line per document',
  '  -r, --raw       print strings without quotes',
  '  -h, --help      this help',
];

interface JqOpts {
  raw: boolean;
  compact: boolean;
  slurp: boolean;
  nullInput: boolean;
  vars: Map<string, JVal>;
  files: string[];
}

const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse jq's command line. Returns null on success; a string is an error;
 *  'handled' means help/version already printed. */
function parseArgs(args: readonly string[], ctx: CommandContext, opts: JqOpts): string | null | 'handled' {
  const operands: string[] = [];
  let i = 0;
  let endOfFlags = false;
  const needValue = (flag: string): string => {
    if (i >= args.length) throw new Error(`jq: ${flag} requires an argument`);
    return args[i++]!;
  };
  while (i < args.length) {
    const arg = args[i++]!;
    if (endOfFlags || arg === '-' || !arg.startsWith('-') || arg === '') {
      operands.push(arg);
      continue;
    }
    if (arg === '--') {
      endOfFlags = true;
      continue;
    }
    if (arg.startsWith('--')) {
      switch (arg) {
        case '--help':
          for (const line of RICH_HELP) ctx.out(line);
          ctx.exit(0);
          return 'handled';
        case '--version':
          ctx.out(VERSION);
          ctx.exit(0);
          return 'handled';
        case '--raw-output':
          opts.raw = true;
          break;
        case '--compact-output':
          opts.compact = true;
          break;
        case '--slurp':
          opts.slurp = true;
          break;
        case '--null-input':
          opts.nullInput = true;
          break;
        case '--arg': {
          const name = needValue('--arg');
          const value = needValue('--arg');
          const bad = checkVar(name);
          if (bad !== null) return bad;
          opts.vars.set(name, value);
          break;
        }
        case '--argjson': {
          const name = needValue('--argjson');
          const text = needValue('--argjson');
          const bad = checkVar(name);
          if (bad !== null) return bad;
          try {
            opts.vars.set(name, parseOneJson(text));
          } catch {
            return `jq: Invalid JSON text passed to --argjson`;
          }
          break;
        }
        default:
          return `jq: Unknown option: ${arg}\nTry 'jq --help' for more information.`;
      }
      continue;
    }
    // short cluster: -rn, -rc, …
    for (const ch of arg.slice(1)) {
      switch (ch) {
        case 'r':
          opts.raw = true;
          break;
        case 'c':
          opts.compact = true;
          break;
        case 's':
          opts.slurp = true;
          break;
        case 'n':
          opts.nullInput = true;
          break;
        default:
          return `jq: Unknown option: -${ch}\nTry 'jq --help' for more information.`;
      }
    }
  }
  opts.files = operands;
  return null;
}

function checkVar(name: string): string | null {
  if (!VAR_NAME_RE.test(name)) return `jq: Invalid variable name '${name}' passed to --arg/--argjson`;
  return null;
}

const VERSION = 'jq-1.6-semtext (semtext-sh) — a jq subset for the sem-shell';

/**
 * Read every input document. Files concatenate in order (`-` is the
 * pipe); malformed JSON aborts with jq's exit-2 wording. Returns null
 * after reporting a fatal read error.
 */
function readInputs(ctx: CommandContext, files: readonly string[]): JVal[] | null {
  const docs: JVal[] = [];
  const sources: Array<{ label: string; text: string }> = [];
  if (files.length === 0) {
    sources.push({ label: '<stdin>', text: ctx.stdin ?? '' });
  } else {
    for (const file of files) {
      if (file === '-') {
        if (ctx.stdin === null) {
          ctx.err('jq: error: Could not open -: no piped input');
          ctx.exit(2);
          return null;
        }
        sources.push({ label: '<stdin>', text: ctx.stdin });
        continue;
      }
      const path = ctx.vfs.resolve(ctx.state.cwd, file);
      const node = ctx.vfs.nodeAt(path);
      if (node === null) {
        ctx.err(`jq: error: Could not open ${file}: No such file or directory`);
        ctx.exit(2);
        return null;
      }
      if (node.kind === 'dir') {
        ctx.err(`jq: error: Could not open ${file}: Is a directory`);
        ctx.exit(2);
        return null;
      }
      sources.push({ label: file, text: node.content });
    }
  }
  for (const source of sources) {
    try {
      for (const doc of scanJson(source.text)) docs.push(doc);
    } catch (e) {
      if (e instanceof JqJsonError) {
        ctx.err(`jq: error (at ${source.label}): ${e.message}`);
        ctx.exit(2);
        return null;
      }
      throw e;
    }
  }
  return docs;
}

/** Emit one output value (line-split like every shell command). */
function emitValue(ctx: CommandContext, v: JVal, opts: { raw: boolean; compact: boolean }): void {
  const text = renderValue(v, opts);
  if (text === '') {
    ctx.out('');
    return;
  }
  for (const line of text.split('\n')) ctx.out(line);
}

const jq: CommandSpec = {
  name: 'jq',
  usage: USAGE,
  complete: (ctx: CompletionContext): string[] =>
    ['-r', '-c', '-s', '-n', '--arg', '--argjson', '--raw-output', '--compact-output', '--slurp', '--null-input', '--help', '--version'].filter(
      (f) => f.startsWith(ctx.word),
    ),
  run(ctx: CommandContext): void {
    const opts: JqOpts = { raw: false, compact: false, slurp: false, nullInput: false, vars: new Map(), files: [] };
    let parsed: string | null | 'handled';
    try {
      parsed = parseArgs(ctx.args, ctx, opts);
    } catch (e) {
      ctx.err((e as Error).message);
      ctx.err("Try 'jq --help' for more information.");
      ctx.exit(2);
      return;
    }
    if (parsed === 'handled') return;
    if (parsed !== null) {
      ctx.err(parsed);
      ctx.exit(2);
      return;
    }

    // program text: first operand; jq errors when it is missing
    const programText = opts.files.shift();
    if (programText === undefined) {
      ctx.err('jq: error: no filter given');
      ctx.err("Try 'jq --help' for more information.");
      ctx.exit(2);
      return;
    }

    let program;
    try {
      program = parseProgram(programText);
      const bad = validateProgram(program, new Set(opts.vars.keys()));
      if (bad !== null) {
        ctx.err(`jq: error: ${bad}`);
        ctx.exit(3);
        return;
      }
    } catch (e) {
      if (e instanceof JqParseError) {
        ctx.err(`jq: error: ${e.message}`);
        ctx.exit(3);
        return;
      }
      throw e;
    }

    // inputs: -n skips reading entirely; -s wraps everything in one array
    let inputs: JVal[];
    if (opts.nullInput) {
      inputs = [null];
    } else {
      const docs = readInputs(ctx, opts.files);
      if (docs === null) return; // read failure already reported + exited
      inputs = opts.slurp ? [docs] : docs;
    }

    const env: Env = null;
    const base = [...opts.vars.entries()];
    let hadRuntimeError = false;
    for (const input of inputs) {
      let scope: Env = env;
      for (let i = base.length - 1; i >= 0; i--) {
        const [name, value] = base[i]!;
        scope = { name, value, parent: scope };
      }
      try {
        for (const out of evalNode(program, input, scope)) emitValue(ctx, out, opts);
      } catch (e) {
        if (e instanceof JqError) {
          ctx.err(`jq: error: ${e.jqMessage}`);
          hadRuntimeError = true;
          continue;
        }
        throw e;
      }
    }
    if (hadRuntimeError) ctx.exit(5);
  },
};

/** The `json` pretty-printer/validator — jq's printer under an obvious name. */
const json: CommandSpec = {
  name: 'json',
  usage: JSON_USAGE,
  complete: (ctx: CompletionContext): string[] => ['-c', '-r', '--compact', '--raw', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const files: string[] = [];
    let compact = false;
    let raw = false;
    let endOfFlags = false;
    let i = 0;
    while (i < ctx.args.length) {
      const arg = ctx.args[i++]!;
      if (endOfFlags || arg === '-' || !arg.startsWith('-')) {
        files.push(arg);
        continue;
      }
      if (arg === '--') {
        endOfFlags = true;
        continue;
      }
      if (arg === '--help') {
        for (const line of JSON_HELP) ctx.out(line);
        ctx.exit(0);
        return;
      }
      if (arg === '--compact') {
        compact = true;
        continue;
      }
      if (arg === '--raw') {
        raw = true;
        continue;
      }
      if (arg.startsWith('--')) {
        ctx.err(`json: unrecognized option '${arg}'`);
        ctx.err("Try 'json --help' for more information.");
        ctx.exit(2);
        return;
      }
      for (const ch of arg.slice(1)) {
        if (ch === 'c') compact = true;
        else if (ch === 'r') raw = true;
        else {
          ctx.err(`json: unrecognized option '-${ch}'`);
          ctx.err("Try 'json --help' for more information.");
          ctx.exit(2);
          return;
        }
      }
    }

    const sources: Array<{ label: string; text: string }> = [];
    if (files.length === 0) sources.push({ label: '<stdin>', text: ctx.stdin ?? '' });
    for (const file of files) {
      if (file === '-') {
        if (ctx.stdin === null) {
          ctx.err('json: -: no piped input');
          ctx.exit(2);
          return;
        }
        sources.push({ label: '<stdin>', text: ctx.stdin });
        continue;
      }
      const path = ctx.vfs.resolve(ctx.state.cwd, file);
      const node = ctx.vfs.nodeAt(path);
      if (node === null) {
        ctx.err(`json: ${file}: No such file or directory`);
        ctx.exit(2);
        return;
      }
      if (node.kind === 'dir') {
        ctx.err(`json: ${file}: Is a directory`);
        ctx.exit(2);
        return;
      }
      sources.push({ label: file, text: node.content });
    }

    let failed = false;
    for (const source of sources) {
      try {
        for (const doc of scanJson(source.text)) emitValue(ctx, doc, { raw, compact });
      } catch (e) {
        if (e instanceof JqJsonError) {
          ctx.err(`json: ${source.label}: parse error: ${e.message}`);
          failed = true;
          continue;
        }
        throw e;
      }
    }
    if (failed) ctx.exit(2);
  },
};

export const commands: Command[] = [jq, json];

export const manPages: Record<string, string[]> = {
  jq: [
    'NAME',
    '     jq — filter and transform JSON (a jq subset for the sem-shell)',
    '',
    'SYNOPSIS',
    `     ${USAGE}`,
    '',
    'DESCRIPTION',
    '     Runs FILTER (a jq program) over each JSON document read from',
    '     the files (or the pipe). Options: -r raw strings, -c compact,',
    '     -s slurp all inputs into one array, -n null input, --arg name',
    '     value ($name string), --argjson name json ($name parsed).',
    '',
    'LANGUAGE',
    '     Paths .a.b .["k"] .[0] .[1:3] and .[] iteration; pipe | and',
    '     comma; select, map, keys, length, to_entries, from_entries,',
    '     has, add, range; sort/sort_by, group_by, unique/unique_by,',
    '     min/max, min_by/max_by, reverse, first, last, any, all,',
    '     flatten, map_values, with_entries; string fns join, split,',
    '     startswith, endswith, ltrimstr, rtrimstr, ascii_downcase,',
    '     ascii_upcase, tostring, tonumber, tojson, fromjson; type,',
    '     not, empty, error; comparisons (jq total order), arithmetic',
    '     (+ - * / % incl. string/array/object forms), and/or/not, //',
    '     alternative; if/elif/else/end; try/catch and the ? suffix;',
    '     string interpolation "\\(expr)"; [..] and {..} construction;',
    '     $vars; reduce EXPR as $x (INIT; UPDATE); @csv @tsv @json',
    '     @base64 @base64d @text @uri @html.',
    '',
    'EXIT CODES',
    '     0 ok · 2 usage or malformed input JSON · 3 program compile',
    '     error · 5 runtime error (remaining inputs still run).',
    '',
    'NOT SUPPORTED',
    '     Assignment and update-assignment (=, |=, +=, ...), def,',
    '     foreach, label/break, recursive descent (..), regex functions',
    '     (test, match, capture, sub, gsub, splits), input/inputs, env,',
    '     paths, limit, and "@format "\\(interp)"" combinations.',
  ],
  json: [
    'NAME',
    '     json — pretty-print and validate JSON',
    '',
    'SYNOPSIS',
    `     ${JSON_USAGE}`,
    '',
    'DESCRIPTION',
    '     Reads each file (or the pipe) as a stream of JSON documents',
    '     and prints them with 2-space indent (jq layout). A malformed',
    '     document reports its offset; exit 2. -c/-r behave like the jq',
    '     flags. Same engine as jq — this is the obvious-name alias for',
    '     "validate and normalize this JSON".',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
