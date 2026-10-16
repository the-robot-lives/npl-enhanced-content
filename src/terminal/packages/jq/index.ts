/**
 * packages/jq/index — the jq chunk (packages rounds 1–2, LANE=pkg-jq).
 *
 * This file is the chunk (`semtext-pkg-jq.js` once built); the stub
 * (./stub.ts) registers `jq` and `json` before it exists. Everything here
 * is the CLI shell around the engine: option parsing (GNU long forms,
 * bundled shorts, `--`), input-source resolution (pipe or VFS files,
 * multi-document JSON streams), per-input evaluation with jq's exit-code
 * conventions, and output formatting (pretty/compact/raw). The language
 * itself lives in ./jq-lex.ts, ./jq-parse.ts, ./jq-eval.ts, ./jq-re.ts and
 * the JSON stream reader in ./jq-json.ts.
 *
 * Exit codes follow jq: 0 ok · 2 usage/system trouble (bad options,
 * unreadable files, malformed input JSON) · 3 program parse/compile
 * errors · 5 runtime errors (one bad input doesn't stop the rest);
 * `halt`/`halt_error` end the whole run with their own code.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import { JqParseError, parseProgram } from './jq-parse.js';
import { JqError, JqHalt, evalNode, makeBaseEnv, runState, validateProgram, type JVal } from './jq-eval.js';
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
  'comma, // alternative, and/or/not, comparisons and arithmetic,',
  'if/elif/else/end, try/catch and ?, reduce, foreach, def (incl.',
  'recursion and $params), label/break, .. recursive descent,',
  'EXPR as $x, string interpolation "\\(expr)", @format and',
  '@format "\\(interp)", assignment = |= += -= *= /= %= //=,',
  '$ENV/env, $__loc__, input/inputs/input_filename, halt/halt_error,',
  'regex test match capture scan split/2 splits sub gsub with flags',
  'g i x s m n p, path getpath setpath delpaths del paths leaf_paths,',
  'indices index rindex transpose explode implode ascii tojson,',
  'limit first(f) last(f) until while repeat walk, plus the string,',
  'array and object builtins (select map keys sort_by group_by',
  'unique_by to_entries with_entries has contains inside add range',
  'min max join split startswith endswith ltrimstr rtrimstr',
  'ascii_downcase ascii_upcase tostring tonumber type not empty',
  'error, @csv @tsv @json @base64 @base64d @text @uri @html).',
  '',
  'Not supported: import/include of module files.',
  '',
  'Exit codes: 0 ok · 2 usage/bad input JSON · 3 bad program · 5 runtime',
  'error (later inputs still run); halt/halt_error exit with their code.',
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

const VERSION = 'jq-1.7-semtext (semtext-sh) — a jq subset for the sem-shell';

/**
 * One input document plus the file it came from (`input_filename`; null
 * under -n and -s, "<stdin>" for the pipe).
 */
interface Doc {
  v: JVal;
  file: string | null;
}

/** Malformed JSON met while pulling documents (fatal, jq exit 2). */
class JqDocError extends Error {
  constructor(
    message: string,
    readonly label: string,
  ) {
    super(message);
    this.name = 'JqDocError';
  }
}

/**
 * Open every input source up front (files must exist even under -n, as in
 * jq). Returns null after reporting a fatal open error and setting exit 2.
 */
function collectSources(ctx: CommandContext, files: readonly string[]): Array<{ label: string; text: string }> | null {
  const sources: Array<{ label: string; text: string }> = [];
  if (files.length === 0) {
    sources.push({ label: '<stdin>', text: ctx.stdin ?? '' });
    return sources;
  }
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
  return sources;
}

/**
 * A lazy pull-stream over the sources: documents are parsed on demand so
 * `input`/`inputs` consume exactly the not-yet-seen remainder of the stream
 * (`jq -n '[inputs]'` and `jq 'input'` behave like real jq). Parse errors
 * surface as fatal JqDocErrors carrying the source label.
 */
function makeDocStream(sources: Array<{ label: string; text: string }>): { next(): Doc | null } {
  let si = 0;
  let gen: Generator<Doc> | null = null;
  return {
    next(): Doc | null {
      for (;;) {
        if (gen === null) {
          if (si >= sources.length) return null;
          const label = sources[si]!.label;
          const text = sources[si]!.text;
          gen = (function* (): Generator<Doc> {
            try {
              for (const doc of scanJson(text)) yield { v: doc, file: label };
            } catch (e) {
              if (e instanceof JqJsonError) throw new JqDocError(e.message, label);
              throw e;
            }
          })();
        }
        const r = gen.next(); // manual pull: for-of would close the generator on return
        if (r.done) {
          gen = null;
          si++;
          continue;
        }
        return r.value;
      }
    },
  };
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
      const bad = validateProgram(program, new Set([...opts.vars.keys(), 'ENV']));
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

    // Sources open up front (even under -n, as in jq); documents parse
    // lazily so input/inputs see the true remaining stream.
    const sources = collectSources(ctx, opts.files);
    if (sources === null) return; // open failure already reported + exited
    const stream = makeDocStream(sources);

    // Main-run documents: -n uses a single null; -s drains the stream into
    // one array (afterwards `input` correctly reports "No more inputs").
    let preMain: Doc[] | null = null;
    if (opts.nullInput) preMain = [{ v: null, file: null }];
    else if (opts.slurp) {
      const all: JVal[] = [];
      for (;;) {
        const d = stream.next();
        if (d === null) break;
        all.push(d.v);
      }
      preMain = [{ v: all, file: null }];
    }

    // Run state for input/inputs/$ENV/input_filename/halt.
    runState.env = { ...ctx.state.env };
    runState.depth = 0;
    runState.nextInput = () => {
      const d = stream.next();
      return d === null ? null : d.v;
    };
    const base = makeBaseEnv(opts.vars.entries(), runState.env);

    let mainAt = 0;
    const nextDoc = (): Doc | null => (preMain !== null ? (mainAt < preMain.length ? preMain[mainAt++]! : null) : stream.next());

    let hadRuntimeError = false;
    try {
      for (;;) {
        const doc = nextDoc();
        if (doc === null) break;
        runState.filename = doc.file;
        try {
          for (const out of evalNode(program, doc.v, base)) emitValue(ctx, out, opts);
        } catch (e) {
          if (e instanceof JqError) {
            ctx.err(`jq: error: ${e.jqMessage}`);
            hadRuntimeError = true;
            continue; // later inputs still run
          }
          if (e instanceof RangeError) {
            // V8 native stack exhaustion (deep recursion past the jq cap)
            ctx.err('jq: error: recursion limit exceeded');
            hadRuntimeError = true;
            continue;
          }
          throw e; // JqDocError / JqHalt → outer handlers; real bugs rethrow
        }
      }
    } catch (e) {
      if (e instanceof JqDocError) {
        ctx.err(`jq: error (at ${e.label}): ${e.message}`);
        ctx.exit(2);
        return;
      }
      if (e instanceof JqHalt) {
        if (e.payload !== null) {
          if (typeof e.payload === 'string') ctx.err(e.payload);
          else for (const line of renderValue(e.payload, { raw: false, compact: true }).split('\n')) ctx.err(line);
        }
        ctx.exit(e.code);
        return;
      }
      throw e;
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
    '     comma; the // alternative; and/or/not; comparisons (jq total',
    '     order) and arithmetic (+ - * / % incl. string/array/object',
    '     forms); if/elif/else/end; try/catch and the ? suffix; reduce',
    '     and foreach; user defs (recursion, filter and $ parameters);',
    '     label/break; recursive descent ..; EXPR as $x; string',
    '     interpolation "\\(expr)" with @format forms; assignment and',
    '     update-assignment = |= += -= *= /= %= //=; $ENV, env,',
    '     $__loc__, input, inputs, input_filename, halt, halt_error;',
    '     regex test match capture scan sub gsub split/2 splits with',
    '     flags g i x s m n p; path getpath setpath delpaths del paths',
    '     leaf_paths; indices index rindex transpose explode implode',
    '     ascii tojson fromjson; limit first(f) last(f) until while',
    '     repeat walk recurse; sort/sort_by, group_by, unique/unique_by,',
    '     min/max, min_by/max_by, reverse, flatten, first, last, any,',
    '     all, add, map, map_values, with_entries, to/from_entries, has,',
    '     contains, inside, range, join, split, startswith, endswith,',
    '     ltrimstr, rtrimstr, ascii_downcase, ascii_upcase, tostring,',
    '     tonumber, type, not, empty, error, length, keys; @csv @tsv',
    '     @json @base64 @base64d @text @uri @html.',
    '',
    'EXIT CODES',
    '     0 ok · 2 usage or malformed input JSON · 3 program compile',
    '     error · 5 runtime error (remaining inputs still run); halt',
    '     and halt_error exit with their own code (halt_error default',
    '     5).',
    '',
    'NOT SUPPORTED',
    '     Module import/include. Regexes compile to JavaScript rather',
    '     than Oniguruma: common syntax (classes, anchors, named',
    '     groups, i/x/n/s/m/p flags) matches, but exotic Onig',
    '     constructs (callouts, \K, possessive quantifiers) do not.',
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
