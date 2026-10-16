/**
 * posix-sh `sed` — the stream editor over the terminal's virtual file
 * system, plus `applyFindSed`, the plugin.ts composition line that mounts
 * find.ts and this module beside the v1 command set (the env-commands
 * pattern: commands.ts stays untouched; man pages shadow the v1 `man`).
 *
 * Fidelity: GNU wording for the common errors (`unterminated 's'
 * command`, `can't read f: …`, `strings for 'y' command are different
 * lengths`), exit 1 on usage/script errors and 2 on unreadable input
 * files, `q [code]` exit codes, BRE by default with -E/-r switching to
 * ERE, `-i[suffix]` rewriting files through the VFS (suffix keeps
 * `file+suffix` backups, writes are recorded for find -newer), and the
 * one-line GNU `a text` / POSIX `a\`-continuation text forms. The known
 * simplification: `c` over a range prints its text when the range's
 * LAST line is covered (GNU prints at the same point), and `0,/re/`
 * starts its range at line 1 like GNU without the finer edge cases.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import { noteWrite, findCmd, FIND_MAN } from './find.js';

/* ------------------------------------------------------------------ *
 * regex flavors — BRE by default, -E for ERE
 * ------------------------------------------------------------------ */

/** BRE → JS: \(\) \{\} \+ \? \| are the metachars; bare ones literal. */
function breToJs(bre: string): string {
  let out = '';
  for (let i = 0; i < bre.length; i++) {
    const c = bre[i]!;
    if (c === '\\') {
      const n = bre[++i];
      if (n === undefined) {
        out += '\\\\';
        break;
      }
      if ('(){}+?|'.includes(n)) out += n;
      else if (n === 'w') out += '\\w';
      else if (n === 'W') out += '\\W';
      else if (n === 's') out += '\\s';
      else if (n === 'S') out += '\\S';
      else if (n === 'b' || n === '<' || n === '>') out += '\\b';
      else out += '\\' + n; // \. \* \[ \$ \1..\9 keep their JS meaning
    } else if ('(){}+?|'.includes(c)) {
      out += '\\' + c;
    } else out += c;
  }
  return out;
}

function compileRe(pattern: string, ere: boolean, ci: boolean): RegExp {
  return new RegExp(ere ? pattern : breToJs(pattern), ci ? 'i' : '');
}

/** s/// regexes are always global: applyS drives exec manually (nth vs g), and a non-global regex would re-match from 0 forever. */
function compileSGlobal(pattern: string, ere: boolean, ci: boolean): RegExp {
  return new RegExp(ere ? pattern : breToJs(pattern), ci ? 'gi' : 'g');
}

/* ------------------------------------------------------------------ *
 * the parsed program
 * ------------------------------------------------------------------ */

type AddrPart =
  | { kind: 'line'; n: number }
  | { kind: 'last' }
  | { kind: 'regex'; re: RegExp };

type Addr =
  | { kind: 'single'; a: AddrPart }
  | { kind: 'range'; a: AddrPart; b: AddrPart }
  | { kind: 'step'; first: number; step: number };

type SedOp = 's' | 'y' | 'd' | 'p' | '=' | 'q' | 'a' | 'i' | 'c' | 'h' | 'H' | 'g' | 'G' | 'x';

interface SedCommand {
  op: SedOp;
  addr: Addr | null;
  neg: boolean;
  /** range runtime: is the range currently open? */
  on: boolean;
  // s
  re?: RegExp;
  jsRepl?: string;
  global?: boolean;
  nth?: number;
  pFlag?: boolean;
  wfile?: string | null;
  // y
  from?: string[];
  to?: string[];
  // a / i / c
  text?: string;
  // q
  code?: number | null;
}

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.slice(0, -1) : lines;
}

/* ------------------------------------------------------------------ *
 * the script parser
 * ------------------------------------------------------------------ */

function parseScript(chunk: string, exprNo: number, ere: boolean): SedCommand[] {
  const cmds: SedCommand[] = [];
  let i = 0;
  const lastRe: { re: RegExp | null } = { re: null }; // `//` reuses the previous regex
  const err = (msg: string): never => {
    throw new Error(`sed: -e expression #${exprNo}, char ${i + 1}: ${msg}`);
  };
  const compile = (pat: string): RegExp => {
    try {
      return compileRe(pat, ere, false);
    } catch {
      return err(`invalid regular expression '${pat}'`);
    }
  };

  const parseAddrPart = (): { part: AddrPart; plainNumber: boolean } | null => {
    const c = chunk[i];
    if (c === undefined) return null;
    if (c === '$') {
      i++;
      return { part: { kind: 'last' }, plainNumber: false };
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < chunk.length && chunk[j]! >= '0' && chunk[j]! <= '9') j++;
      const n = Number(chunk.slice(i, j));
      i = j;
      return { part: { kind: 'line', n }, plainNumber: true };
    }
    if (c === '/') {
      i++;
      let pat = '';
      while (i < chunk.length && chunk[i] !== '/') {
        if (chunk[i] === '\\' && i + 1 < chunk.length) {
          pat += chunk[i]! + chunk[i + 1];
          i += 2;
          continue;
        }
        pat += chunk[i]!;
        i++;
      }
      if (chunk[i] !== '/') err('unterminated address regex');
      i++;
      if (pat === '') {
        if (!lastRe.re) return err('no previous regular expression');
        return { part: { kind: 'regex', re: lastRe.re }, plainNumber: false };
      }
      const re = compile(pat);
      lastRe.re = re;
      return { part: { kind: 'regex', re }, plainNumber: false };
    }
    return null;
  };

  /** One s/// or y/// body up to the unescaped delimiter (escapes kept). */
  const readPart = (delim: string, op: string): string => {
    let part = '';
    while (i < chunk.length) {
      const ch = chunk[i]!;
      if (ch === delim) {
        i++;
        return part;
      }
      if (ch === '\n') err(`unterminated '${op}' command`);
      if (ch === '\\' && i + 1 < chunk.length) {
        part += '\\' + chunk[i + 1]!;
        i += 2;
        continue;
      }
      part += ch;
      i++;
    }
    return err(`unterminated '${op}' command`);
  };

  /** a/i/c text: GNU one-liner or POSIX `a\` with continuation lines. */
  const parseText = (): string => {
    while (chunk[i] === ' ' || chunk[i] === '\t') i++;
    if (chunk[i] !== '\\') {
      let end = i;
      while (end < chunk.length && chunk[end] !== '\n') end++;
      const text = chunk.slice(i, end);
      i = end;
      return text;
    }
    i++;
    if (chunk[i] === '\n') i++; // POSIX form: the text begins on the next line
    const parts: string[] = [];
    for (;;) {
      let cur = '';
      while (i < chunk.length && chunk[i] !== '\n') {
        cur += chunk[i]!;
        i++;
      }
      const more = cur.endsWith('\\');
      parts.push(more ? cur.slice(0, -1) : cur);
      if (!more) break;
      i++;
      if (i >= chunk.length) break;
    }
    return parts.join('\n');
  };

  while (i < chunk.length) {
    const lead = chunk[i]!;
    if (lead === ' ' || lead === '\t' || lead === '\n' || lead === ';') {
      i++;
      continue;
    }

    let addr: Addr | null = null;
    const first = parseAddrPart();
    if (first !== null) {
      if (chunk[i] === ',') {
        i++;
        const second = parseAddrPart() ?? err('unterminated address');
        addr = { kind: 'range', a: first.part, b: second.part };
      } else if (chunk[i] === '~' && first.plainNumber) {
        i++;
        let j = i;
        while (j < chunk.length && chunk[j]! >= '0' && chunk[j]! <= '9') j++;
        if (j === i) err('unterminated address');
        const step = Number(chunk.slice(i, j));
        i = j;
        if (step <= 0) err('number less than zero');
        addr = { kind: 'step', first: Number((first.part as { n: number }).n), step };
      } else {
        addr = { kind: 'single', a: first.part };
      }
    }

    let neg = false;
    if (chunk[i] === '!') {
      neg = true;
      i++;
    }
    if (i >= chunk.length) err('missing command');
    const op = chunk[i] as SedOp;
    i++;
    const base = { addr, neg, on: false };

    switch (op) {
      case 's': {
        const delim = chunk[i];
        if (delim === undefined || delim === '\n' || delim === ' ' || delim === '\t' || delim === ';') {
          err("unterminated 's' command");
        }
        i++;
        const pat = readPart(delim, 's');
        const repl = readPart(delim, 's');
        let global = false;
        let nth: number | undefined;
        let pFlag = false;
        let ci = false;
        let wfile: string | null = null;
        while (i < chunk.length && !' \t\n;'.includes(chunk[i]!)) {
          const f = chunk[i]!;
          if (f === 'g') global = true;
          else if (f === 'i' || f === 'I') ci = true;
          else if (f === 'p') pFlag = true;
          else if (f === 'w') {
            i++;
            while (chunk[i] === ' ' || chunk[i] === '\t') i++;
            let end = i;
            while (end < chunk.length && chunk[end] !== ';' && chunk[end] !== '\n') end++;
            wfile = chunk.slice(i, end);
            i = end;
            if (wfile === '') err("no filename given for 'w' command");
          } else if (f >= '0' && f <= '9') {
            let j = i;
            while (j < chunk.length && chunk[j]! >= '0' && chunk[j]! <= '9') j++;
            nth = Number(chunk.slice(i, j));
            i = j;
            if (nth === 0) err("number option to 's' command may not be zero");
          } else err(`unknown option to 's'`);
        }
        let re: RegExp;
        try {
          re = compileSGlobal(pat, ere, ci);
        } catch {
          return err(`invalid regular expression '${pat}'`);
        }
        cmds.push({ ...base, op, re, jsRepl: sedReplToJs(repl), global, nth, pFlag, wfile });
        break;
      }
      case 'y': {
        const delim = chunk[i];
        if (delim === undefined || delim === '\n') err("unterminated 'y' command");
        i++;
        const from = unescapeY(readPart(delim, 'y')).split('');
        const to = unescapeY(readPart(delim, 'y')).split('');
        if (from.length !== to.length) err("strings for 'y' command are different lengths");
        cmds.push({ ...base, op, from, to });
        break;
      }
      case 'd':
      case 'p':
      case '=':
      case 'h':
      case 'H':
      case 'g':
      case 'G':
      case 'x':
        cmds.push({ ...base, op });
        break;
      case 'q': {
        let code: number | null = null;
        let j = i;
        while (j < chunk.length && chunk[j]! >= '0' && chunk[j]! <= '9') j++;
        if (j > i) {
          code = Number(chunk.slice(i, j));
          i = j;
        }
        cmds.push({ ...base, op, code });
        break;
      }
      case 'a':
      case 'i':
      case 'c':
        cmds.push({ ...base, op, text: parseText() });
        break;
      default:
        err(`unknown command: '${op}'`);
    }
  }
  return cmds;
}

/** s replacement → JS template: & → $&, \1 → $1, \n, \t, \\, \&. */
function sedReplToJs(repl: string): string {
  let out = '';
  for (let k = 0; k < repl.length; k++) {
    const c = repl[k]!;
    if (c === '\\' && k + 1 < repl.length) {
      const n = repl[++k]!;
      if (n >= '1' && n <= '9') out += '$' + n;
      else if (n === '0') out += '$&';
      else if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === '\\') out += '\\\\';
      else out += n; // \& and any other escaped char: literal
    } else if (c === '&') out += '$&';
    else if (c === '$') out += '$$';
    else out += c;
  }
  return out;
}

/** Expand a JS template against one match ($& $1..$9 $$). */
function expandRepl(jsRepl: string, m: RegExpExecArray): string {
  return jsRepl.replace(/\$(&|\$|\d)/g, (_whole, g: string) =>
    g === '&' ? m[0] : g === '$' ? '$' : (m[Number(g)] ?? ''),
  );
}

/** y's strings know \n and \\ (GNU). */
function unescapeY(s: string): string {
  let out = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if (c === '\\' && k + 1 < s.length) {
      const n = s[++k]!;
      out += n === 'n' ? '\n' : n;
    } else out += c;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * the engine
 * ------------------------------------------------------------------ */

function partHit(p: AddrPart, ln: number, total: number, line: string): boolean {
  if (p.kind === 'line') return ln === p.n;
  if (p.kind === 'last') return ln === total;
  return p.re.test(line);
}

/** Does `cmd`'s address cover line `ln`? (Advances open-range state.) */
function addrHit(cmd: SedCommand, ln: number, total: number, line: string): boolean {
  const addr = cmd.addr;
  if (!addr) return true;
  switch (addr.kind) {
    case 'single':
      return partHit(addr.a, ln, total, line);
    case 'step': {
      const first = addr.first === 0 ? addr.step : addr.first;
      return ln >= first && (ln - first) % addr.step === 0;
    }
    case 'range': {
      if (!cmd.on) {
        // GNU 0,/re/: a line-0 start opens the range at line 1.
        const aHit = addr.a.kind === 'line' && addr.a.n === 0 ? ln === 1 : partHit(addr.a, ln, total, line);
        if (!aHit) return false;
        cmd.on = !partHit(addr.b, ln, total, line);
        return true;
      }
      cmd.on = !partHit(addr.b, ln, total, line);
      return true;
    }
  }
}

function applyS(cmd: SedCommand, ps: string): { ps: string; changed: boolean } {
  const nth = cmd.nth ?? 1;
  const re = cmd.re!;
  re.lastIndex = 0;
  let count = 0;
  let changed = false;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ps)) !== null) {
    if (m[0].length === 0 && m.index === ps.length) break; // String.replace stops here; exec would match once more
    count++;
    const take = cmd.global ? count >= nth : count === nth;
    if (take) {
      result += ps.slice(last, m.index) + expandRepl(cmd.jsRepl!, m);
      last = m.index + m[0].length;
      changed = true;
    }
    if (m[0].length === 0) re.lastIndex++;
    if (!cmd.global && count >= nth) break;
  }
  if (!changed) return { ps, changed };
  return { ps: result + ps.slice(last), changed };
}

interface RunOpts {
  noAutoPrint: boolean;
}

/** One sed pass over a line stream. `quit` reports q's optional code. */
function runSed(
  cmds: SedCommand[],
  lines: string[],
  opts: RunOpts,
  emit: (line: string) => void,
  wbuf: Map<string, string[]>,
  quit: { code: number | null },
): void {
  const hold = { s: '' };
  let stopped = false;
  const emitLines = (text: string): void => {
    for (const line of text.split('\n')) emit(line);
  };
  for (let idx = 0; idx < lines.length && !stopped; idx++) {
    const ln = idx + 1;
    const total = lines.length;
    let ps = lines[idx]!;
    let deleted = false;
    let replaced: string | null = null;
    let appended: string | null = null;
    for (const cmd of cmds) {
      if (addrHit(cmd, ln, total, ps) === cmd.neg) continue;
      switch (cmd.op) {
        case 's': {
          const r = applyS(cmd, ps);
          ps = r.ps;
          if (r.changed) {
            if (cmd.pFlag) emit(ps);
            if (cmd.wfile) {
              const got = wbuf.get(cmd.wfile) ?? [];
              got.push(ps);
              wbuf.set(cmd.wfile, got);
            }
          }
          break;
        }
        case 'y': {
          const map = new Map<string, string>();
          for (let k = 0; k < cmd.from!.length; k++) map.set(cmd.from![k]!, cmd.to![k]!);
          ps = [...ps].map((c) => map.get(c) ?? c).join('');
          break;
        }
        case 'd':
          deleted = true;
          break;
        case 'p':
          emit(ps);
          break;
        case '=':
          emit(String(ln));
          break;
        case 'a':
          appended = cmd.text!;
          break;
        case 'i':
          emit(cmd.text!);
          break;
        case 'c': {
          // final line of the address coverage prints the text; earlier
          // range lines are simply dropped
          const last =
            cmd.addr === null || cmd.addr.kind !== 'range'
              ? true
              : cmd.addr.b.kind === 'line'
                ? ln === cmd.addr.b.n
                : cmd.addr.b.kind === 'last'
                  ? ln === total
                  : cmd.addr.b.re.test(ps);
          if (last) replaced = cmd.text!;
          else deleted = true;
          break;
        }
        case 'h':
          hold.s = ps;
          break;
        case 'H':
          hold.s = hold.s === '' ? ps : hold.s + '\n' + ps;
          break;
        case 'g':
          ps = hold.s;
          break;
        case 'G':
          ps = ps === '' ? hold.s : ps + '\n' + hold.s;
          break;
        case 'x': {
          const t = ps;
          ps = hold.s;
          hold.s = t;
          break;
        }
        case 'q':
          stopped = true;
          quit.code = cmd.code ?? null;
          break;
      }
      if (deleted || stopped || replaced !== null) break;
    }
    if (replaced !== null) emitLines(replaced);
    else if (!deleted && !opts.noAutoPrint) emitLines(ps);
    if (appended !== null) emitLines(appended);
  }
}

/* ------------------------------------------------------------------ *
 * sed
 * ------------------------------------------------------------------ */

const SED_USAGE = 'Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...';

export const sedCmd: CommandSpec = {
  name: 'sed',
  usage: 'sed [-n] [-E] [-i[suffix]] [-e script]... [file...] — stream editor',
  run(ctx) {
    const args = ctx.args;
    const scripts: Array<{ text?: string; file?: string }> = [];
    let noAutoPrint = false;
    let ere = false;
    let inplace = false;
    let suffix: string | null = null;
    let separate = false;
    const operands: string[] = [];
    let endOfOpts = false;
    const usageErr = (msg: string): void => {
      ctx.err(`sed: ${msg}`);
      ctx.err(SED_USAGE);
      ctx.exit(1);
    };

    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (endOfOpts || a === '-' || !a.startsWith('-')) {
        operands.push(a);
        continue;
      }
      if (a === '--') {
        endOfOpts = true;
        continue;
      }
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const name = eq === -1 ? a : a.slice(0, eq);
        const val = eq === -1 ? undefined : a.slice(eq + 1);
        if (name === '--quiet' || name === '--silent') noAutoPrint = true;
        else if (name === '--regexp-extended') ere = true;
        else if (name === '--separate') separate = true;
        else if (name === '--in-place') {
          inplace = true;
          suffix = val ?? null;
        } else if (name === '--expression' || name === '--file') {
          if (val === undefined) {
            usageErr(`option '${name}' requires an argument`);
            return;
          }
          scripts.push(name === '--expression' ? { text: val } : { file: val });
        } else {
          usageErr(`unrecognized option '${a}'`);
          return;
        }
        continue;
      }
      // clustered short options; -e/-f/-i eat the rest of the cluster
      let j = 1;
      while (j < a.length) {
        const c = a[j]!;
        if (c === 'n') noAutoPrint = true;
        else if (c === 'E' || c === 'r') ere = true;
        else if (c === 's') separate = true;
        else if (c === 'e' || c === 'f') {
          const arg = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (arg === undefined) {
            usageErr(`option requires an argument -- '${c}'`);
            return;
          }
          scripts.push(c === 'e' ? { text: arg } : { file: arg });
          j = a.length;
          break;
        } else if (c === 'i') {
          inplace = true;
          suffix = j + 1 < a.length ? a.slice(j + 1) : null;
          j = a.length;
          break;
        } else {
          usageErr(`invalid option -- '${c}'`);
          return;
        }
        j++;
      }
    }

    if (scripts.length === 0) {
      const first = operands.shift();
      if (first === undefined) {
        usageErr('no script given');
        return;
      }
      scripts.push({ text: first });
    }

    const cmds: SedCommand[] = [];
    for (let s = 0; s < scripts.length; s++) {
      const sc = scripts[s]!;
      let text = sc.text ?? '';
      if (sc.file !== undefined) {
        const content = ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, sc.file));
        if (content === null) {
          ctx.err(`sed: can't read ${sc.file}: No such file or directory`);
          ctx.exit(2);
          return;
        }
        text = content;
      }
      try {
        cmds.push(...parseScript(text, s + 1, ere));
      } catch (cause) {
        ctx.err(cause instanceof Error ? cause.message : String(cause));
        ctx.exit(1);
        return;
      }
    }

    let failed = false;
    const load = (arg: string): { content: string; path: string | null } | null => {
      if (arg === '-') return { content: ctx.stdin ?? '', path: null };
      const path = ctx.vfs.resolve(ctx.state.cwd, arg);
      const node = ctx.vfs.nodeAt(path);
      if (!node) {
        ctx.err(`sed: can't read ${arg}: No such file or directory`);
        failed = true;
        return null;
      }
      if (node.kind === 'dir') {
        ctx.err(`sed: read error on ${arg}: Is a directory`);
        failed = true;
        return null;
      }
      return { content: node.content, path };
    };

    const inputs =
      operands.length === 0
        ? ctx.stdin === null
          ? null
          : [{ content: ctx.stdin, path: null }]
        : operands.map(load).filter((s): s is { content: string; path: string | null } => s !== null);
    if (inputs === null) {
      ctx.err('sed: no input (pipe one in, or name a file)');
      ctx.exit(1);
      return;
    }

    const wbuf = new Map<string, string[]>();
    const quit: { code: number | null } = { code: null };

    /** One stream: emit straight to stdout, or (with -i) into the file. */
    const runOne = (content: string, path: string | null): void => {
      const collected: string[] = [];
      const emit =
        !inplace
          ? (line: string): void => ctx.out(line)
          : path === null
            ? () => {} // -i on piped stdin: processed, discarded (GNU behavior)
            : (line: string): void => {
              collected.push(line);
            };
      runSed(cmds, linesOf(content), { noAutoPrint }, emit, wbuf, quit);
      if (!inplace || path === null) return;
      let result = collected.map((line) => line + '\n').join('');
      if (result !== '' && !content.endsWith('\n') && result.endsWith('\n')) result = result.slice(0, -1);
      try {
        if (suffix !== null && suffix !== '') ctx.vfs.mountFile(path + suffix, content);
        noteWrite(ctx.vfs.mountFile(path, result));
      } catch (cause) {
        ctx.err(`sed: cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
        failed = true;
      }
    };

    if (inplace || separate) {
      for (const input of inputs) {
        for (const cmd of cmds) cmd.on = false; // each file is its own stream
        runOne(input.content, input.path);
      }
    } else {
      const lines = inputs.flatMap((input) => linesOf(input.content));
      for (const cmd of cmds) cmd.on = false;
      runSed(cmds, lines, { noAutoPrint }, (line) => ctx.out(line), wbuf, quit);
    }

    // w files truncate at the start of the run and flush once at the end
    for (const [file, got] of wbuf) {
      try {
        ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, file), got.map((line) => line + '\n').join(''));
      } catch (cause) {
        ctx.err(`sed: cannot write ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
        failed = true;
      }
    }

    ctx.exit(failed ? 2 : (quit.code ?? 0));
  },
};

/* ------------------------------------------------------------------ *
 * man
 * ------------------------------------------------------------------ */

export const SED_MAN = [
  'sed — stream editor',
  '',
  'SYNOPSIS',
  '  sed [-n] [-E] [-i[suffix]] [-e script]... [-f file] [file...]',
  '',
  'With no -e/-f, the first word after the options is the script. Files',
  'feed one stream (`-s` runs each separately); `-` or no files reads',
  'piped input. Commands: s///replacements with g, i, Nth, p and w file',
  'flags, y/src/dst/, d, p, q [code], =, a text, i text, c text (GNU',
  'one-liner or `a\\` + continuation lines), and the hold space h H g G',
  'x. Addresses: line numbers, $, /re/, n,m ranges, n~step, each',
  'negatable with !. Patterns are BRE by default (\\( \\) \\{ \\} \\+',
  '\\? \\|) and ERE under -E. -n drops the automatic print. -i[suffix]',
  'rewrites files in place, keeping file+suffix backups; in-place edits',
  'rank as new for find -newer. Exit 0, 1 on usage/script errors, 2',
  'when an input file cannot be read.',
];

/* ------------------------------------------------------------------ *
 * composition — the plugin.ts registration line
 * ------------------------------------------------------------------ */

const FIND_SED_MAN: Record<string, string[]> = { find: FIND_MAN, sed: SED_MAN };

/** Wrap the (possibly already wrapped) `man` with this module's pages. */
export function withFindSedMan(man: CommandSpec): CommandSpec {
  return {
    ...man,
    run(ctx: CommandContext) {
      const name = ctx.args[0];
      const page = name === undefined ? undefined : FIND_SED_MAN[name];
      if (page) {
        ctx.out(`${name.toUpperCase()}(1)                semtext-sh manual`);
        ctx.out('');
        for (const line of page) ctx.out(line);
        return;
      }
      man.run(ctx);
    },
  };
}

/**
 * The plugin command list: the incoming commands (v1 + env additions,
 * their man already wrapped) with man wrapped again for find/sed pages,
 * plus the two commands. Same composition pattern as applyEnvDirenv.
 */
export function applyFindSed(commands: CommandSpec[]): CommandSpec[] {
  const wrapped = commands.map((spec) => (spec.name === 'man' ? withFindSedMan(spec) : spec));
  return [...wrapped, findCmd, sedCmd];
}
