/**
 * posix-sh plugin — the POSIX-style command set, as plugin CommandSpecs
 * (src/terminal/PLUGINS.md). Mounted by <sem-shell>; the bare
 * <sem-terminal> core stays plugin-free beyond help/clear.
 *
 * Fidelity rule: for the common flags each command prints the shape the
 * real tool prints (mode strings, `%6d\t` numbering, `==> f <==` headers,
 * `path:line` grep output, GNU-ish error wording, exit statuses) over the
 * terminal's virtual file system. Output is always one line per `out()`
 * call — the one place the emulation is knowingly simpler than a tty is
 * ls's column layout (`ls` behaves like `ls -1` / piped ls).
 *
 * Exit statuses: explicit `ctx.exit(code)` wins; otherwise 1 when the
 * command wrote stderr, else 0. `grep` sets 0/1/2 itself, `ls` 2 on a
 * missing operand, `false` is 1, unknown commands are 127.
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import { highlightAnsi } from '../../sh-highlight.js';
import { resolvePath } from '../../vfs.js';

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

/** Split clustered short flags (`-laR` → -l -a -R); keeps `-5` and `--long` whole. */
function expandShorts(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a.length > 1 && a[0] === '-' && a[1] !== '-' && !/^-.\d+$/.test(a)) {
      for (const ch of a.slice(1)) out.push('-' + ch);
    } else {
      out.push(a);
    }
  }
  return out;
}

function readOperand(ctx: CommandContext, arg: string): { content: string } | { error: string } {
  const path = ctx.vfs.resolve(ctx.state.cwd, arg);
  const node = ctx.vfs.nodeAt(path);
  if (!node) return { error: `${arg}: No such file or directory` };
  if (node.kind === 'dir') return { error: `${arg}: Is a directory` };
  return { content: node.content };
}

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.slice(0, -1) : lines;
}

function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G', 'T'];
  let value = n;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)}${units[unit]}`;
}

/* ------------------------------------------------------------------ *
 * pwd · cd
 * ------------------------------------------------------------------ */

const pwd: CommandSpec = {
  name: 'pwd',
  usage: 'pwd — print the working directory',
  run(ctx) {
    ctx.out(ctx.state.cwd);
  },
};

const cd: CommandSpec = {
  name: 'cd',
  usage: 'cd [dir | - | ~] — change directory (no arg: $HOME; -: previous dir)',
  complete: completeDirs,
  run(ctx) {
    const state = ctx.state;
    const target = ctx.args[0];
    let path: string;
    if (target === undefined || target === '' || target === '~') {
      path = state.env.HOME ?? '/';
    } else if (target === '-') {
      if (state.oldpwd === null) {
        ctx.err('cd: OLDPWD not set');
        ctx.exit(1);
        return;
      }
      path = state.oldpwd;
      ctx.out(path); // the shell prints where `cd -` went
    } else {
      path = ctx.vfs.resolve(state.cwd, target);
    }
    const node = ctx.vfs.nodeAt(path);
    if (!node) {
      ctx.err(`cd: ${target}: No such file or directory`);
      ctx.exit(1);
      return;
    }
    if (node.kind !== 'dir') {
      ctx.err(`cd: ${target}: Not a directory`);
      ctx.exit(1);
      return;
    }
    state.oldpwd = state.cwd;
    state.cwd = path === '' ? '/' : path;
  },
};

/* ------------------------------------------------------------------ *
 * ls
 * ------------------------------------------------------------------ */

type ColorWhen = 'auto' | 'always' | 'never';

interface LsFlags {
  all: boolean;
  long: boolean;
  one: boolean;
  recursive: boolean;
  human: boolean;
  color: ColorWhen;
}

const DIR_COLOR = '\x1b[01;34m';
const RESET = '\x1b[0m';

function lsMode(kind: 'file' | 'dir'): string {
  return kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
}

interface LsRowEntry {
  kind: 'file' | 'dir';
  name: string;
  content?: string;
}

const ls: CommandSpec = {
  name: 'ls',
  usage: 'ls [-1aRh] [--color[=when]] [path...] — list entries (dirs carry /)',
  run(ctx) {
    const args = expandShorts(ctx.args);
    const flags: LsFlags = { all: false, long: false, one: false, recursive: false, human: false, color: 'auto' };
    const targets: string[] = [];
    for (const a of args) {
      if (a === '--color' || a === '--color=always' || a === '--color=auto' || a === '--color=never') {
        flags.color = (a.split('=')[1] ?? 'always') as LsFlags['color'];
      } else if (a === '-a') flags.all = true;
      else if (a === '-l' || a === '-1') flags.long = a === '-l';
      else if (a === '-R') flags.recursive = true;
      else if (a === '-h') flags.human = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`ls: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-')) {
        ctx.err(`ls: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else targets.push(a);
    }
    const color = flags.color === 'always' || (flags.color === 'auto' && ctx.color);
    const list = targets.length > 0 ? targets : ['.'];
    const headerWanted = list.length > 1 || flags.recursive;
    let missing = 0;
    let wrote = false;

    const blank = (): void => {
      if (wrote) ctx.out('');
    };

    const row = (entry: LsRowEntry): string => {
      const isDot = entry.name === '.' || entry.name === '..';
      const name = entry.kind === 'dir' && !isDot ? entry.name + '/' : entry.name;
      const colored = color && entry.kind === 'dir' ? DIR_COLOR + name + RESET : name;
      if (!flags.long) return colored;
      const size = entry.kind === 'dir' ? '-' : flags.human ? humanSize(entry.content?.length ?? 0) : String(entry.content?.length ?? 0);
      return `${lsMode(entry.kind)}  ${entry.kind === 'dir' ? 2 : 1} ${size.padStart(8)}  ${colored}`;
    };

    /** One directory block, then (with -R) one block per visible subdirectory. */
    const listDir = (header: string | null, path: string, relPrefix: string): void => {
      const node = ctx.vfs.nodeAt(path);
      if (!node || node.kind !== 'dir') return;
      const children = node.children.filter((c) => flags.all || !c.name.startsWith('.'));
      children.sort((a, b) => a.name.localeCompare(b.name));
      const rows: string[] = [];
      if (header !== null) rows.push(`${header}:`);
      if (flags.all) {
        rows.push(row({ kind: 'dir', name: '.' }));
        rows.push(row({ kind: 'dir', name: '..' }));
      }
      for (const child of children) rows.push(row(child));
      blank();
      for (const r of rows) ctx.out(r);
      wrote = true;
      if (flags.recursive) {
        for (const child of children) {
          if (child.kind !== 'dir') continue;
          const childPath = path === '/' ? `/${child.name}` : `${path}/${child.name}`;
          const childLabel = relPrefix === '' || relPrefix === '.' ? child.name : `${relPrefix}/${child.name}`;
          listDir(childLabel, childPath, childLabel);
        }
      }
    };

    for (const target of list) {
      const path = ctx.vfs.resolve(ctx.state.cwd, target);
      const node = ctx.vfs.nodeAt(path);
      if (!node) {
        ctx.err(`ls: cannot access '${target}': No such file or directory`);
        missing++;
        continue;
      }
      if (node.kind === 'file') {
        ctx.out(row(node)); // plain operands: no blank line between them
        wrote = true;
        continue;
      }
      listDir(headerWanted ? target : null, path, target);
    }
    if (missing > 0) ctx.exit(2);
  },
};

/* ------------------------------------------------------------------ *
 * cat · bat · head · tail · wc
 * ------------------------------------------------------------------ */

const cat: CommandSpec = {
  name: 'cat',
  usage: 'cat [-n] [file...] — print files (- or no file: piped input)',
  run(ctx) {
    const args = expandShorts(ctx.args);
    const numbered = args.includes('-n');
    const operands = args.filter((a) => a !== '-n');
    if (operands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('cat: missing file operand');
        ctx.exit(1);
        return;
      }
      emit(ctx, ctx.stdin, numbered, 0);
      return;
    }
    let count = 0;
    let failed = false;
    for (const arg of operands) {
      if (arg === '-') {
        count = emit(ctx, ctx.stdin ?? '', numbered, count);
        continue;
      }
      const found = readOperand(ctx, arg);
      if ('error' in found) {
        ctx.err(`cat: ${found.error}`);
        failed = true;
        continue;
      }
      count = emit(ctx, found.content, numbered, count);
    }
    if (failed) ctx.exit(1);
  },
};

/** Emit with optional `cat -n` numbering (`%6d\t`); returns the running line count. */
function emit(ctx: CommandContext, text: string, numbered: boolean, start: number): number {
  const lines = linesOf(text);
  for (let i = 0; i < lines.length; i++) {
    ctx.out(numbered ? `${String(start + i + 1).padStart(6)}\t${lines[i]}` : lines[i]);
  }
  return start + lines.length;
}

const bat: CommandSpec = {
  name: 'bat',
  usage: "bat [--plain] [-l lang] [--color=when] [file...] — cat with highlighting (html, text)",
  run(ctx) {
    const args = expandShorts(ctx.args);
    let plain = false;
    let lang: string | null = null;
    let color: ColorWhen = 'auto';
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--plain' || a === '-p') plain = true;
      else if (a === '-l') lang = args[++i] ?? null;
      else if (a.startsWith('--language=')) lang = a.slice('--language='.length);
      else if (a === '--color=always' || a === '--color=never' || a === '--color' || a === '--color=auto') {
        color = (a.split('=')[1] ?? 'always') as ColorWhen;
      } else if (a.startsWith('-')) {
        ctx.err(`bat: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    const paint = color === 'always' || (color === 'auto' && ctx.color);
    const texts: Array<{ name: string; content: string }> = [];
    if (operands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('bat: missing file operand (try cat for bare text)');
        ctx.exit(1);
        return;
      }
      texts.push({ name: 'stdin', content: ctx.stdin });
    } else {
      for (const arg of operands) {
        const found = readOperand(ctx, arg);
        if ('error' in found) {
          ctx.err(`bat: ${found.error}`);
          ctx.exit(1);
          return;
        }
        texts.push({ name: arg, content: found.content });
      }
    }
    for (const { name, content } of texts) {
      const inferred = lang ?? inferLang(name);
      const lines = linesOf(content);
      const width = String(Math.max(1, lines.length)).length;
      for (let i = 0; i < lines.length; i++) {
        // --plain is truly bare: no gutter, no color, no highlighting.
        if (plain) {
          ctx.out(lines[i]);
          continue;
        }
        const body = paint ? highlightAnsi(lines[i], inferred) : lines[i];
        ctx.out(`\x1b[2m${String(i + 1).padStart(width)}\x1b[0m │ ${body}`);
      }
    }
  },
};

function inferLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) return 'html';
  return 'text';
}

interface SliceFlags {
  lines: number;
  follow: boolean;
}

function parseSliceArgs(ctx: CommandContext, kind: 'head' | 'tail'): { flags: SliceFlags; operands: string[] } | null {
  const args = expandShorts(ctx.args);
  const flags: SliceFlags = { lines: 10, follow: false };
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n') {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n < 0) {
        ctx.err(`${kind}: invalid number of lines`);
        ctx.exit(1);
        return null;
      }
      flags.lines = Math.trunc(n);
    } else if (/^-\d+$/.test(a)) {
      flags.lines = Math.trunc(Number(a.slice(1)));
    } else if (a === '-f') {
      flags.follow = true; // simulated: prints the last lines and returns
    } else if (a.startsWith('-')) {
      ctx.err(`${kind}: invalid option -- '${a.slice(1)}'`);
      ctx.exit(1);
      return null;
    } else operands.push(a);
  }
  return { flags, operands };
}

function sliceLines(lines: string[], count: number, tail: boolean): string[] {
  if (count === 0) return [];
  return tail ? lines.slice(-count) : lines.slice(0, count);
}

const head: CommandSpec = {
  name: 'head',
  usage: 'head [-n N | -N] [file...] — first N lines (default 10)',
  run(ctx) {
    runSlice(ctx, 'head', false);
  },
};

const tail: CommandSpec = {
  name: 'tail',
  usage: 'tail [-n N | -N] [-f] [file...] — last N lines (-f: simulated, prints and returns)',
  run(ctx) {
    runSlice(ctx, 'tail', true);
  },
};

function runSlice(ctx: CommandContext, kind: 'head' | 'tail', isTail: boolean): void {
  const parsed = parseSliceArgs(ctx, kind);
  if (parsed === null) return;
  const { flags, operands } = parsed;
  if (operands.length === 0) {
    if (ctx.stdin === null) {
      ctx.err(`${kind}: no input (pipe one in, or name a file)`);
      ctx.exit(1);
      return;
    }
    for (const line of sliceLines(linesOf(ctx.stdin), flags.lines, isTail)) ctx.out(line);
    return;
  }
  let failed = false;
  for (let f = 0; f < operands.length; f++) {
    const found = readOperand(ctx, operands[f]!);
    if ('error' in found) {
      ctx.err(`${kind}: ${found.error}`);
      failed = true;
      continue;
    }
    if (operands.length > 1) {
      if (f > 0) ctx.out('');
      ctx.out(`==> ${operands[f]} <==`);
    }
    for (const line of sliceLines(linesOf(found.content), flags.lines, isTail)) ctx.out(line);
  }
  if (failed) ctx.exit(1);
}

const wc: CommandSpec = {
  name: 'wc',
  usage: 'wc [-l | -w | -c] [file...] — count lines, words, bytes',
  run(ctx) {
    const args = expandShorts(ctx.args);
    const want = { l: args.includes('-l'), w: args.includes('-w'), c: args.includes('-c') };
    const any = want.l || want.w || want.c;
    const columns: Array<'l' | 'w' | 'c'> = any ? (['l', 'w', 'c'] as const).filter((k) => want[k]) : ['l', 'w', 'c'];
    const operands = args.filter((a) => !a.startsWith('-'));
    const inputs: Array<{ name: string | null; text: string }> = [];
    let failed = false;
    if (operands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('wc: no input (pipe one in, or name a file)');
        ctx.exit(1);
        return;
      }
      inputs.push({ name: null, text: ctx.stdin });
    } else {
      for (const arg of operands) {
        const found = readOperand(ctx, arg);
        if ('error' in found) {
          ctx.err(`wc: ${found.error}`);
          failed = true;
          continue;
        }
        inputs.push({ name: arg, text: found.content });
      }
    }
    const total = { l: 0, w: 0, c: 0 };
    for (const { name, text } of inputs) {
      const counts = {
        l: linesOf(text).length,
        w: text.trim() === '' ? 0 : text.trim().split(/\s+/).length,
        c: text.length,
      };
      total.l += counts.l;
      total.w += counts.w;
      total.c += counts.c;
      const body = columns.map((k) => String(counts[k]).padStart(7)).join('');
      ctx.out(name === null ? body.trimStart() : `${body} ${name}`);
    }
    if (inputs.length > 1) {
      const body = columns.map((k) => String(total[k]).padStart(7)).join('');
      ctx.out(`${body} total`);
    }
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * grep
 * ------------------------------------------------------------------ */

const grep: CommandSpec = {
  name: 'grep',
  usage: 'grep [-nicr] PATTERN [file...] — matching lines (-r: walk the file system)',
  run(ctx) {
    const args = expandShorts(ctx.args);
    const flags = { n: false, i: false, c: false, r: false };
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-n') flags.n = true;
      else if (a === '-i') flags.i = true;
      else if (a === '-c') flags.c = true;
      else if (a === '-r' || a === '-R') flags.r = true;
      else if (a === '--') continue;
      else if (a.startsWith('--')) {
        ctx.err(`grep: unrecognized option '${a}'`);
        ctx.exit(2);
        return;
      } else if (a.startsWith('-')) {
        ctx.err(`grep: invalid option -- '${a[1]}'`);
        ctx.exit(2);
        return;
      } else operands.push(a);
    }
    const pattern = operands.shift();
    if (pattern === undefined || pattern === '') {
      ctx.err('grep: usage: grep [-nicr] PATTERN [file...]');
      ctx.exit(2);
      return;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags.i ? 'i' : '');
    } catch {
      ctx.err(`grep: invalid pattern: ${pattern}`);
      ctx.exit(2);
      return;
    }

    const fileOperands = operands;

    if (fileOperands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('grep: no input (pipe one in, or name a file)');
        ctx.exit(2);
        return;
      }
      report(ctx, regex, flags, [{ label: null, text: ctx.stdin }]);
      return;
    }
    const labelFiles = flags.r || fileOperands.length > 1;
    const inputs: Array<{ label: string | null; text: string }> = [];
    let missing = false;
    for (const arg of fileOperands) {
      const path = ctx.vfs.resolve(ctx.state.cwd, arg);
      const node = ctx.vfs.nodeAt(path);
      if (!node) {
        ctx.err(`grep: ${arg}: No such file or directory`);
        missing = true;
        continue;
      }
      if (node.kind === 'file') {
        inputs.push({ label: labelFiles ? arg : null, text: node.content });
        continue;
      }
      if (!flags.r) {
        ctx.err(`grep: ${arg}: Is a directory`);
        missing = true;
        continue;
      }
      const walk = (dir: typeof node, prefix: string): void => {
        for (const child of [...dir.children].sort((a, b) => a.name.localeCompare(b.name))) {
          const childPath = prefix === '' ? child.name : `${prefix}/${child.name}`;
          if (child.kind === 'dir') walk(child, childPath);
          else inputs.push({ label: childPath, text: child.content });
        }
      };
      walk(node, arg === '.' ? '' : arg);
    }
    report(ctx, regex, flags, inputs);
    if (missing) ctx.exit(2);
  },
};

function report(
  ctx: CommandContext,
  regex: RegExp,
  flags: { n: boolean; i: boolean; c: boolean; r: boolean },
  inputs: Array<{ label: string | null; text: string }>,
): void {
  let any = false;
  // POSIX-shaped prefixes: several inputs (or -r) label every line `path:num:line`.
  const multi = inputs.length > 1 || inputs.some((f) => f.label !== null);
  for (const { label, text } of inputs) {
    const lines = linesOf(text);
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue;
      any = true;
      const prefixBits: string[] = [];
      if (multi && label !== null) prefixBits.push(label);
      if (flags.n) prefixBits.push(String(i + 1));
      hits.push([...prefixBits, lines[i]].join(':'));
    }
    if (flags.c) {
      ctx.out(multi && label !== null ? `${label}:${hits.length}` : String(hits.length));
    } else {
      for (const line of hits) ctx.out(line);
    }
  }
  ctx.exit(any ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * echo · printf · env · export · unset · alias · history · which · man
 * ------------------------------------------------------------------ */

const echo: CommandSpec = {
  name: 'echo',
  usage: 'echo [-n] [word...] — print words with $VAR expanded',
  run(ctx) {
    const words = ctx.args[0] === '-n' ? ctx.args.slice(1) : ctx.args;
    ctx.out(words.join(' ')); // output is line-framed; -n is accepted and implied
  },
};

const printf: CommandSpec = {
  name: 'printf',
  usage: 'printf FORMAT [args...] — %s %d %% with \\n \\t \\\\ escapes',
  run(ctx) {
    if (ctx.args.length === 0) {
      ctx.err('printf: usage: printf FORMAT [args...]');
      ctx.exit(2);
      return;
    }
    const [format, ...args] = ctx.args;
    let out = '';
    let argAt = 0;
    for (let i = 0; i < format.length; i++) {
      const c = format[i];
      if (c === '\\' && i + 1 < format.length) {
        const e = format[++i];
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : e;
      } else if (c === '%') {
        const spec = format[++i];
        if (spec === '%') out += '%';
        else if (spec === 's') out += args[argAt++] ?? '';
        else if (spec === 'd') out += String(Number.parseInt(args[argAt++] ?? '0', 10) || 0);
        else {
          out += '%' + (spec ?? '');
        }
      } else out += c;
    }
    for (const line of out.replace(/\n$/, '').split('\n')) ctx.out(line); // line-framed like every command
  },
};

const env: CommandSpec = {
  name: 'env',
  usage: 'env — print the environment',
  run(ctx) {
    for (const key of Object.keys(ctx.state.env)) ctx.out(`${key}=${ctx.state.env[key]}`);
  },
};

const exportCmd: CommandSpec = {
  name: 'export',
  usage: 'export [NAME=value...] — set environment variables (bare: print them)',
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const key of Object.keys(ctx.state.env)) ctx.out(`${key}=${ctx.state.env[key]}`);
      return;
    }
    for (const arg of ctx.args) {
      const eq = arg.indexOf('=');
      if (eq <= 0) {
        ctx.err(`export: ${arg}: not a valid assignment`);
        ctx.exit(1);
        continue;
      }
      ctx.state.env[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
  },
};

const unset: CommandSpec = {
  name: 'unset',
  usage: 'unset NAME... — remove environment variables',
  run(ctx) {
    for (const name of ctx.args) delete ctx.state.env[name];
  },
};

const alias: CommandSpec = {
  name: 'alias',
  usage: "alias [name=value...] — define or list command aliases",
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const name of Object.keys(ctx.state.aliases)) {
        ctx.out(`alias ${name}='${ctx.state.aliases[name]}'`);
      }
      return;
    }
    for (const arg of ctx.args) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        if (ctx.state.aliases[arg] === undefined) {
          ctx.err(`alias: ${arg}: not found`);
          ctx.exit(1);
        } else {
          ctx.out(`alias ${arg}='${ctx.state.aliases[arg]}'`);
        }
        continue;
      }
      ctx.state.aliases[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
  },
};

const history: CommandSpec = {
  name: 'history',
  usage: 'history — the lines this shell has run, numbered',
  run(ctx) {
    const width = String(ctx.state.history.length).length;
    for (let i = 0; i < ctx.state.history.length; i++) {
      ctx.out(`${String(i + 1).padStart(width)}  ${ctx.state.history[i]}`);
    }
  },
};

const which: CommandSpec = {
  name: 'which',
  usage: 'which NAME... — how a command name resolves (alias or built-in)',
  complete: (ctx) => ctx.commands.filter((name) => name.startsWith(ctx.word)),
  run(ctx) {
    if (ctx.args.length === 0) {
      ctx.err('which: missing operand');
      ctx.exit(1);
      return;
    }
    let missing = false;
    for (const name of ctx.args) {
      if (ctx.state.aliases[name] !== undefined) {
        ctx.out(`${name}: aliased to ${ctx.state.aliases[name]}`);
      } else if (ctx.commands.has(name)) {
        ctx.out(`${name}: shell built-in command`);
      } else {
        missing = true;
      }
    }
    if (missing) ctx.exit(1);
  },
};

/* man — short manual pages for every command this plugin adds. */
import { renderCardMan } from '../cards/commands.js';

const MAN: Record<string, string[]> = {
  pwd: ['pwd — print the working directory', '', 'SYNOPSIS', '  pwd'],
  cd: [
    'cd — change the working directory',
    '',
    'SYNOPSIS',
    '  cd [dir | - | ~]',
    '',
    'No argument goes to $HOME; `cd -` returns to the previous directory and prints it.',
  ],
  ls: [
    'ls — list directory contents',
    '',
    'SYNOPSIS',
    '  ls [-1aRh] [--color[=when]] [path...]',
    '',
    '-a adds . and .. and dotfiles, -l a long listing (mode, size, name), -h humanizes',
    'sizes, -R recurses. Directories print with a trailing / and are colored when the',
    'output is colored. Output is one entry per line (the piped-ls shape).',
  ],
  cat: ['cat — print files', '', 'SYNOPSIS', '  cat [-n] [file...]', '', '-n numbers every line `%6d<TAB>`; `-` or no files read piped input.'],
  bat: [
    'bat — cat with syntax highlighting',
    '',
    'SYNOPSIS',
    '  bat [--plain | -p] [-l LANG] [--color=when] [file...]',
    '',
    'Line numbers and a gutter by default; --plain turns them off. HTML (and xml, svg)',
    'is tokenized by a small built-in highlighter; other text passes through plain.',
  ],
  head: ['head — first lines', '', 'SYNOPSIS', '  head [-n N | -N] [file...]', '', 'Default 10 lines; several files get `==> f <==` headers.'],
  tail: [
    'tail — last lines',
    '',
    'SYNOPSIS',
    '  tail [-n N | -N] [-f] [file...]',
    '',
    '-f is simulated: it prints the last lines and returns; nothing follows.',
  ],
  wc: ['wc — count lines, words, bytes', '', 'SYNOPSIS', '  wc [-l | -w | -c] [file...]', '', 'Default prints all three counts plus the file name.'],
  grep: [
    'grep — print matching lines',
    '',
    'SYNOPSIS',
    '  grep [-nicr] PATTERN [file...]',
    '',
    '-n line numbers, -i case-insensitive, -c counts only, -r walks directories.',
    'Exit status: 0 matches found, 1 none, 2 error.',
  ],
  echo: ['echo — print words', '', 'SYNOPSIS', '  echo [-n] [word...]', '', '$VAR and $? expand (the parser does it before echo runs).'],
  printf: ['printf — formatted print', '', 'SYNOPSIS', '  printf FORMAT [args...]', '', 'Knows %s, %d, %% and the escapes \\n \\t \\\\; adds no trailing newline of its own.'],
  env: ['env — print the environment', '', 'SYNOPSIS', '  env'],
  export: ['export — set environment variables', '', 'SYNOPSIS', '  export NAME=value [NAME=value...]', '', 'Bare export prints every variable, dash-style.'],
  unset: ['unset — remove environment variables', '', 'SYNOPSIS', '  unset NAME...'],
  alias: ["alias — define or list command aliases", '', 'SYNOPSIS', "  alias [name=value...]", '', 'The first word of a command expands from here; values are split on spaces.'],
  history: ['history — the lines this shell has run', '', 'SYNOPSIS', '  history'],
  which: ['which — how a command name resolves', '', 'SYNOPSIS', '  which NAME...', '', 'Reports the alias, or `shell built-in command`; unknown names are silent.'],
  man: ['man — short manual pages', '', 'SYNOPSIS', '  man COMMAND'],
  true: ['true — do nothing, successfully (exit 0)', '', 'SYNOPSIS', '  true'],
  false: ['false — do nothing, unsuccessfully (exit 1)', '', 'SYNOPSIS', '  false'],
  help: ['help — list every registered command', '', 'SYNOPSIS', '  help'],
  clear: ['clear — wipe the transcript', '', 'SYNOPSIS', '  clear', '', 'Ctrl+L does the same.'],
  semtext: [
    'semtext — document operations over SemText files',
    '',
    'SYNOPSIS',
    '  semtext render | toc | tui | outline | filter | format | expand ...',
    '',
    'See `semtext <sub> --help` for each subcommand.',
  ],
  'render-card': renderCardMan,
  open: ['open — open a stored .html document in a new window', '', 'SYNOPSIS', '  open <file.html>'],
  mkdir: ['mkdir — make directories', '', 'SYNOPSIS', '  mkdir [-p] dir...', '', '-p creates missing parents and never complains about existing ones.'],
  rmdir: ['rmdir — remove empty directories', '', 'SYNOPSIS', '  rmdir dir...', '', 'Refuses anything but empty directories; files and non-empty dirs error.'],
  touch: ['touch — create empty files', '', 'SYNOPSIS', '  touch file...', '', 'Existing files (and directories) pass unchanged.'],
  rm: [
    'rm — remove files and directories',
    '',
    'SYNOPSIS',
    '  rm [-r | -R] [-f] file...',
    '',
    '-r removes directories with their contents; -f ignores missing files and',
    'drops the missing-operand error. Removing the working directory is refused.',
  ],
  cp: [
    'cp — copy files and directories',
    '',
    'SYNOPSIS',
    '  cp [-r | -R] src... dest',
    '',
    'A directory dest copies each src INTO it (basename kept). Directories',
    'need -r; copying a directory into itself is refused.',
  ],
};

const man: CommandSpec = {
  name: 'man',
  usage: 'man COMMAND — the short manual page',
  complete: (ctx) => ctx.commands.filter((name) => name.startsWith(ctx.word)),
  run(ctx) {
    const name = ctx.args[0];
    if (name === undefined) {
      ctx.err('What manual page do you want?');
      ctx.exit(1);
      return;
    }
    const page = MAN[name];
    if (!page) {
      ctx.err(`No manual entry for ${name}`);
      ctx.exit(1);
      return;
    }
    ctx.out(`${name.toUpperCase()}(1)                semtext-sh manual`);
    ctx.out('');
    for (const line of page) ctx.out(line);
  },
};

const trueCmd: CommandSpec = {
  name: 'true',
  usage: 'true — do nothing, successfully',
  run() {},
};

const falseCmd: CommandSpec = {
  name: 'false',
  usage: 'false — do nothing, unsuccessfully',
  run(ctx) {
    ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * mkdir · rmdir · touch · rm · cp — tree mutations
 * ------------------------------------------------------------------ */

const causeText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const mkdirCmd: CommandSpec = {
  name: 'mkdir',
  usage: 'mkdir [-p] dir...',
  run(ctx) {
    const args = expandShorts(ctx.args);
    const parents = args.includes('-p');
    const operands = args.filter((a) => !a.startsWith('-'));
    if (operands.length === 0) {
      ctx.err('mkdir: missing operand');
      return;
    }
    for (const operand of operands) {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      try {
        ctx.vfs.mkdir(path, { parents });
      } catch (cause) {
        ctx.err(`mkdir: cannot create directory '${operand}': ${causeText(cause)}`);
      }
    }
  },
};

const rmdirCmd: CommandSpec = {
  name: 'rmdir',
  usage: 'rmdir dir...',
  run(ctx) {
    if (ctx.args.length === 0) {
      ctx.err('rmdir: missing operand');
      return;
    }
    for (const operand of ctx.args) {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      try {
        ctx.vfs.rmdir(path);
      } catch (cause) {
        ctx.err(`rmdir: failed to remove '${operand}': ${causeText(cause)}`);
      }
    }
  },
};

const touchCmd: CommandSpec = {
  name: 'touch',
  usage: 'touch file...',
  run(ctx) {
    if (ctx.args.length === 0) {
      ctx.err('touch: missing file operand');
      return;
    }
    for (const operand of ctx.args) {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      if (ctx.vfs.nodeAt(path)) continue; // POSIX touch: existing nodes pass
      try {
        ctx.vfs.touch(path);
      } catch (cause) {
        ctx.err(`touch: cannot touch '${operand}': ${causeText(cause)}`);
      }
    }
  },
};

const rmCmd: CommandSpec = {
  name: 'rm',
  usage: 'rm [-r | -R] [-f] file...',
  run(ctx) {
    const args = expandShorts(ctx.args);
    let recursive = false;
    let force = false;
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-r' || a === '-R' || a === '--recursive') recursive = true;
      else if (a === '-f' || a === '--force') force = true;
      else if (a === '-') continue;
      else if (a.startsWith('-')) {
        ctx.err(`rm: invalid option -- '${a}'`);
        return;
      } else operands.push(a);
    }
    if (operands.length === 0) {
      if (!force) ctx.err('rm: missing operand'); // `rm -f` with nothing: exit 0, silent
      return;
    }
    for (const operand of operands) {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      try {
        ctx.vfs.rm(path, { recursive, force });
      } catch (cause) {
        ctx.err(`rm: cannot remove '${operand}': ${causeText(cause)}`);
      }
    }
  },
};

const cpCmd: CommandSpec = {
  name: 'cp',
  usage: 'cp [-r | -R] src... dest',
  run(ctx) {
    const args = expandShorts(ctx.args);
    let recursive = false;
    const operands: string[] = [];
    for (const a of args) {
      if (a === '-r' || a === '-R' || a === '--recursive') recursive = true;
      else if (!a.startsWith('-')) operands.push(a);
      else {
        ctx.err(`cp: invalid option -- '${a}'`);
        return;
      }
    }
    if (operands.length < 2) {
      ctx.err(
        operands.length === 0
          ? 'cp: missing file operand'
          : `cp: missing destination file operand after '${operands[0]}'`,
      );
      return;
    }
    const dest = operands[operands.length - 1];
    const destPath = ctx.vfs.resolve(ctx.state.cwd, dest);
    const destNode = ctx.vfs.nodeAt(destPath);
    const sources = operands.slice(0, -1);
    if (sources.length > 1 && (!destNode || destNode.kind !== 'dir')) {
      ctx.err(`cp: target '${dest}' is not a directory`);
      return;
    }
    for (const src of sources) {
      const srcPath = ctx.vfs.resolve(ctx.state.cwd, src);
      try {
        ctx.vfs.copy(srcPath, destPath, { recursive });
      } catch (cause) {
        ctx.err(`cp: ${causeText(cause)}`);
      }
    }
  },
};

/** Directory-only completions (cd); the engine supplies vfs + cwd. */
/** Directory-only completions (cd); the engine supplies vfs + cwd + home. */
function completeDirs(ctx: CompletionContext): string[] {
  const slash = ctx.word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
  const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
  const expanded = dirPart.startsWith('~') ? ctx.home + dirPart.slice(1) : dirPart;
  const base = resolvePath(ctx.cwd, expanded === '' ? '.' : expanded);
  const out: string[] = [];
  for (const node of ctx.vfs.list(base)) {
    if (node.kind !== 'dir' || !node.name.startsWith(rest)) continue;
    out.push(dirPart + node.name + '/');
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export const posixCommands: CommandSpec[] = [
  pwd,
  cd,
  ls,
  cat,
  bat,
  head,
  tail,
  wc,
  grep,
  echo,
  printf,
  env,
  exportCmd,
  unset,
  alias,
  history,
  which,
  man,
  trueCmd,
  falseCmd,
  mkdirCmd,
  rmdirCmd,
  touchCmd,
  rmCmd,
  cpCmd,
];
export default posixCommands;
