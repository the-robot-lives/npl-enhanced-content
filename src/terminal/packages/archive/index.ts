/**
 * packages/archive — binary-tool implementations (packages round,
 * LANE=pkg-archive).
 *
 * This module is the package CHUNK: dynamic-imported by ./stub.ts on
 * boot, never part of the base shell bundle. Commands: base64, md5sum,
 * sha1sum, sha256sum, sha512sum, gzip, gunzip, zcat, tar, zip, unzip.
 * Reference behaviour is GNU coreutils / Info-ZIP / GNU tar; deliberate
 * differences are called out in the man pages below (the stringly-typed
 * VFS, the line-sugared pipe, and the sync codecs — see ./bytes.ts and
 * ./deflate.ts headers).
 *
 * All commands are synchronous by construction (execLine never awaits),
 * so every pipeline stage — including binary ones — gets same-tick
 * output, and `cat f | gzip > f.gz` works.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import type { Command, PackageModule } from '../types.js';
import { archiveStub } from './stub.js';
import { base64Decode, base64Encode, bytesOf, hexOf, strOfBytes } from './bytes.js';
import { digest, digestHexLength, type SumAlgorithm } from './hashes.js';
import { deflateRaw, GzipError, gzipUnwrap, gzipWrap, inflateRaw } from './deflate.js';
import { tarCreate, tarParse, type TarEntry, type TarEntryIn } from './ustar.js';
import { zipCreate, zipParse, zipReadEntry, ZipError, type ZipEntryIn } from './zipfile.js';

/* ------------------------------------------------------------------ *
 * shared helpers (chunk-local)
 * ------------------------------------------------------------------ */

const usageOf = (name: string): string => archiveStub.commands.find((c) => c.name === name)!.usage;

/**
 * Split clustered short flags; value-taking letters keep their attached
 * value (`-k2,3` → ['-k', '2,3']). Long options, `--`, `-` and numeric
 * shorts pass through verbatim.
 */
function splitArgs(args: string[], valueLetters: string): string[] {
  const out: string[] = [];
  let endOfFlags = false;
  for (const a of args) {
    if (endOfFlags || a.length <= 2 || a[0] !== '-' || a[1] === '-' || /^-\d+$/.test(a)) {
      if (a === '--' && !endOfFlags) endOfFlags = true;
      out.push(a);
      continue;
    }
    if (valueLetters.includes(a[1]!)) {
      out.push('-' + a[1]!, a.slice(2));
    } else {
      for (const ch of a.slice(1)) out.push('-' + ch);
    }
  }
  return out;
}

function badOption(ctx: CommandContext, cmd: string, option: string): void {
  if (option.startsWith('--')) {
    ctx.err(`${cmd}: unrecognized option '${option}'`);
  } else {
    ctx.err(`${cmd}: invalid option -- '${option.replace(/^-+/, '')}'`);
  }
  ctx.err(`Try '${cmd} --help' for more information.`);
  ctx.exit(2);
}

function noSuchFile(ctx: CommandContext, cmd: string, arg: string): void {
  ctx.err(`${cmd}: ${arg}: No such file or directory`);
  ctx.exit(1);
}

/** Read one file operand's bytes, reporting through ctx on failure. */
function readOperandBytes(ctx: CommandContext, cmd: string, arg: string): Uint8Array | null {
  const path = ctx.vfs.resolve(ctx.state.cwd, arg);
  const node = ctx.vfs.nodeAt(path);
  if (!node) {
    noSuchFile(ctx, cmd, arg);
    return null;
  }
  if (node.kind === 'dir') {
    ctx.err(`${cmd}: ${arg}: Is a directory`);
    ctx.exit(1);
    return null;
  }
  return bytesOf(node.content);
}

/** Seconds-resolution now, the ustar mtime stamp. */
const nowSecs = (): number => Math.floor(Date.now() / 1000);

/** `rwxr-xr-x`-style mode string for `tar -tv`. */
function modeString(mode: number, isDir: boolean): string {
  const bit = (n: number, ch: string): string => (mode & n ? ch : '-');
  const triplet = (r: number, w: number, x: number): string => bit(r, 'r') + bit(w, 'w') + bit(x, 'x');
  return (isDir ? 'd' : '-') + triplet(0o400, 0o200, 0o100) + triplet(0o40, 0o20, 0o10) + triplet(0o4, 0o2, 0o1);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** GNU tar -tv date column: `2026-10-17 09:41`. */
function tarDate(mtimeSecs: number): string {
  const d = new Date(mtimeSecs * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * base64
 * ------------------------------------------------------------------ */

const base64Command: CommandSpec = {
  name: 'base64',
  usage: usageOf('base64'),
  complete: (ctx) => ['-d', '--decode', '-w', '--wrap', '-i', '--ignore-garbage', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const args = splitArgs(ctx.args, 'w');
    let decode = false;
    let wrap = 76;
    let ignoreGarbage = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--') {
        operands.push(...args.slice(i + 1));
        break;
      }
      if (a === '-d' || a === '--decode') decode = true;
      else if (a === '-i' || a === '--ignore-garbage') ignoreGarbage = true;
      else if (a === '-w' || a === '--wrap') wrap = Number(args[++i] ?? '');
      else if (a.startsWith('--wrap=')) wrap = Number(a.slice(7));
      else if (a === '--help' || a === '-h') {
        ctx.out(usageOf('base64'));
        ctx.out('Encode (-d decodes): 76-column output, 0 disables wrapping.');
        return;
      } else if (a.startsWith('-') && a !== '-') {
        badOption(ctx, 'base64', a);
        return;
      } else operands.push(a);
    }
    if (!Number.isInteger(wrap) || wrap < 0) {
      ctx.err('base64: invalid wrap size');
      ctx.exit(1);
      return;
    }

    // Gather input: files concatenate (GNU encodes the concatenation).
    let text = '';
    if (operands.length === 0) {
      if (ctx.stdin === null) {
        ctx.err('base64: no input (pipe one in, or name a file)');
        ctx.exit(1);
        return;
      }
      text = ctx.stdin;
    } else {
      const parts: string[] = [];
      for (const arg of operands) {
        const path = ctx.vfs.resolve(ctx.state.cwd, arg);
        const content = arg === '-' ? (ctx.stdin ?? '') : ctx.vfs.read(path);
        if (content === null) {
          noSuchFile(ctx, 'base64', arg);
          return;
        }
        parts.push(content);
      }
      text = parts.join('');
    }

    if (decode) {
      const result = base64Decode(text, ignoreGarbage);
      if (typeof result === 'string') {
        ctx.err(`base64: ${result}`);
        ctx.exit(1);
        return;
      }
      ctx.out(strOfBytes(result));
      return;
    }
    for (const line of base64Encode(bytesOf(text), wrap)) ctx.out(line);
  },
};

/* ------------------------------------------------------------------ *
 * the *sum family
 * ------------------------------------------------------------------ */

interface SumOptions {
  check: boolean;
  binary: boolean;
  tag: boolean;
}

function parseSumArgs(ctx: CommandContext, cmd: string, valueLetters: string): { opts: SumOptions; operands: string[] } | null {
  const opts: SumOptions = { check: false, binary: false, tag: false };
  const operands: string[] = [];
  const args = splitArgs(ctx.args, valueLetters);
  let endOfFlags = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (endOfFlags || a === '-' || !a.startsWith('-')) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      endOfFlags = true;
    } else if (a === '-c' || a === '--check') opts.check = true;
    else if (a === '-b' || a === '--binary') opts.binary = true;
    else if (a === '-t' || a === '--text') opts.binary = false;
    else if (a === '--tag') opts.tag = true;
    else if (a === '--help' || a === '-h') {
      ctx.out(usageOf(cmd));
      ctx.out('-c verifies a checksum file (name: OK / FAILED), -b marks binary.');
      return null;
    } else {
      badOption(ctx, cmd, a);
      return null;
    }
  }
  return { opts, operands };
}

function makeSumCommand(algo: SumAlgorithm): CommandSpec {
  const cmd = `${algo}sum`;
  return {
    name: cmd,
    usage: usageOf(cmd),
    complete: (ctx) => ['-c', '--check', '-b', '--binary', '-t', '--text', '--tag', '--help'].filter((f) => f.startsWith(ctx.word)),
    run(ctx: CommandContext): void {
      const parsed = parseSumArgs(ctx, cmd, '');
      if (parsed === null) return;
      const { opts, operands } = parsed;

      if (!opts.check) {
        const marker = opts.binary ? ' *' : '  ';
        const lineFor = (hex: string, name: string): string => (opts.tag ? `${algo.toUpperCase()} (${name}) = ${hex}` : `${hex}${marker}${name}`);
        if (operands.length === 0) {
          if (ctx.stdin === null) {
            ctx.err(`${cmd}: no input (pipe one in, or name a file)`);
            ctx.exit(1);
            return;
          }
          ctx.out(lineFor(hexOf(digest(algo, bytesOf(ctx.stdin))), '-'));
          return;
        }
        for (const arg of operands) {
          const bytes = readOperandBytes(ctx, cmd, arg);
          if (bytes === null) continue;
          ctx.out(lineFor(hexOf(digest(algo, bytes)), arg));
        }
        return;
      }

      // Check mode: verify a checksum listing (GNU or --tag format).
      const listings: string[] = [];
      if (operands.length === 0) {
        if (ctx.stdin === null) {
          ctx.err(`${cmd}: no checksum file (pipe one in, or name one)`);
          ctx.exit(1);
          return;
        }
        listings.push(ctx.stdin);
      } else {
        for (const arg of operands) {
          const content = ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, arg));
          if (content === null) {
            noSuchFile(ctx, cmd, arg);
            return;
          }
          listings.push(content);
        }
      }
      const hexLen = digestHexLength[algo];
      const lineRe = new RegExp(`^([0-9a-fA-F]{${hexLen}}) ([ *])(.+)$`);
      const tagRe = new RegExp(`^${algo.toUpperCase()} \\((.+)\\) = ([0-9a-fA-F]{${hexLen}})$`);
      let ok = 0;
      let mismatched = 0;
      let unread = 0;
      let improper = 0;
      for (const listing of listings) {
        for (const rawLine of listing.split('\n')) {
          if (rawLine === '') continue;
          const line = rawLine.replace(/\\(.)/g, '$1'); // GNU \-escapes decoded loosely
          const m = lineRe.exec(line);
          const t = m === null ? tagRe.exec(line) : null;
          const hex = m !== null ? m[1]! : t !== null ? t[2]! : null;
          const name = m !== null ? m[3]! : t !== null ? t[1]! : null;
          if (hex === null || name === null) {
            improper++;
            continue;
          }
          const bytes = ctx.vfs.read(ctx.vfs.resolve(ctx.state.cwd, name));
          if (bytes === null) {
            ctx.err(`${cmd}: ${name}: No such file or directory`);
            ctx.err(`${name}: FAILED open or read`);
            unread++;
            continue;
          }
          if (hexOf(digest(algo, bytesOf(bytes))) === hex.toLowerCase()) {
            ctx.out(`${name}: OK`);
            ok++;
          } else {
            ctx.out(`${name}: FAILED`);
            mismatched++;
          }
        }
      }
      if (unread > 0) {
        ctx.err(`${cmd}: WARNING: ${unread} listed ${unread === 1 ? 'file' : 'files'} could not be read`);
      }
      if (mismatched > 0) {
        ctx.err(`${cmd}: WARNING: ${mismatched} computed checksum${mismatched === 1 ? ' did' : 's did'} NOT match`);
      } else if (improper > 0 && ok + unread > 0) {
        ctx.err(`${cmd}: WARNING: ${improper} lines are improperly formatted`);
      } else if (improper > 0 && ok + mismatched + unread === 0) {
        ctx.err(`${cmd}: no properly formatted checksum lines`);
      }
      if (mismatched + unread > 0) ctx.exit(1);
      else if (improper > 0) ctx.exit(2);
    },
  };
}

/* ------------------------------------------------------------------ *
 * gzip / gunzip / zcat
 * ------------------------------------------------------------------ */

interface GzipOptions {
  stdout: boolean;
  decompress: boolean;
  keep: boolean;
  test: boolean;
  verbose: boolean;
  force: boolean;
}

const GZIP_SUFFIXES = ['.gz', '.tgz', '.taz'];
/** GNU refuses to double-compress these; .tgz/.taz map to .tar on unpack. */
const GZIP_RESERVE = ['.gz', '.tgz', '.taz', '.z', '.Z', '.bz2', '.bz', '.zip', '.xz', '.lzma'];

function gzipFail(ctx: CommandContext, name: string, cause: unknown, code = 1): void {
  const message = cause instanceof Error ? cause.message : String(cause);
  ctx.err(`gzip: ${name}: ${message}`);
  ctx.exit(code);
}

function percent(before: number, after: number): string {
  if (before === 0) return '  0.0';
  return ((1 - after / before) * 100).toFixed(1).padStart(5, ' ');
}

function gzipRunner(ctx: CommandContext, cmd: string, defaults: Partial<GzipOptions>): void {
  const opts: GzipOptions = { stdout: false, decompress: false, keep: false, test: false, verbose: false, force: false, ...defaults };
  const operands: string[] = [];
  const args = splitArgs(ctx.args, '');
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a === '-c' || a === '--stdout' || a === '--to-stdout') opts.stdout = true;
    else if (a === '-d' || a === '--decompress' || a === '--uncompress') opts.decompress = true;
    else if (a === '-k' || a === '--keep') opts.keep = true;
    else if (a === '-t' || a === '--test') opts.test = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-f' || a === '--force') opts.force = true;
    else if (/^-[1-9]$/.test(a) || a === '--fast' || a === '--best') {
      // one algorithm; levels accepted for GNU compatibility
    } else if (a === '--help' || a === '-h') {
      ctx.out(usageOf(cmd));
      ctx.out('-c stdout, -d decompress, -k keep, -t test, -v verbose; -1..-9 accepted.');
      return;
    } else if (a === '-r' || a === '--recursive') {
      ctx.err(`gzip: ${cmd}: -r is not supported — name the files (the VFS has no globbing here)`);
      ctx.exit(2);
      return;
    } else if (a.startsWith('-') && a !== '-') {
      badOption(ctx, cmd, a);
      return;
    } else operands.push(a);
  }

  /** Shell line sugar: binary through a pipe/redirect gains one '\n' (and a
   *  clean stream ends exactly at `end`) — both are fine, anything else is
   *  GNU's "trailing garbage ignored". */
  const isSugarTail = (bytes: Uint8Array, end: number): boolean => {
    const tail = bytes.length - end;
    return tail === 0 || (tail === 1 && bytes[end] === 0x0a);
  };

  const emitDecoded = (label: string, bytes: Uint8Array): void => {
    try {
      const { raw, end } = gzipUnwrap(bytes);
      ctx.out(strOfBytes(raw));
      if (!isSugarTail(bytes, end)) {
        ctx.err(`gzip: ${label}: decompression OK, trailing garbage ignored`);
        ctx.exit(2);
      }
    } catch (cause) {
      if (cause instanceof GzipError) {
        gzipFail(ctx, label, cause);
        return;
      }
      throw cause;
    }
  };

  if (operands.length === 0) {
    if (ctx.stdin === null) {
      ctx.err(`${cmd}: no input (pipe one in, or name a file)`);
      ctx.exit(1);
      return;
    }
    if (opts.test) {
      ctx.err('gzip: --test operates on files, not stdin');
      ctx.exit(1);
      return;
    }
    if (opts.decompress) {
      emitDecoded('stdin', bytesOf(ctx.stdin));
      return;
    }
    ctx.out(strOfBytes(gzipWrap(bytesOf(ctx.stdin))));
    return;
  }

  for (const arg of operands) {
    const path = ctx.vfs.resolve(ctx.state.cwd, arg);
    const node = ctx.vfs.nodeAt(path);
    if (!node) {
      noSuchFile(ctx, 'gzip', arg);
      continue;
    }
    if (node.kind === 'dir') {
      ctx.err(`gzip: ${arg}: Is a directory`);
      ctx.exit(1);
      continue;
    }
    const input = bytesOf(node.content);

    if (opts.test) {
      try {
        gzipUnwrap(input);
      } catch (cause) {
        if (cause instanceof GzipError) {
          gzipFail(ctx, arg, cause);
          continue;
        }
        throw cause;
      }
      continue;
    }

    if (!opts.decompress) {
      const lower = arg.toLowerCase();
      if (GZIP_SUFFIXES.some((s) => lower.endsWith(s))) {
        ctx.err(`gzip: ${arg} already has .gz suffix -- unchanged`);
        ctx.exit(2);
        continue;
      }
      if (GZIP_RESERVE.some((s) => lower.endsWith(s)) && !opts.force) {
        ctx.err(`gzip: ${arg} has a reserved archive suffix (use -f to compress anyway)`);
        ctx.exit(2);
        continue;
      }
      const wrapped = gzipWrap(input);
      const target = arg + '.gz';
      if (opts.stdout) {
        ctx.out(strOfBytes(wrapped));
        continue;
      }
      ctx.vfs.mountFile(path + '.gz', strOfBytes(wrapped));
      if (opts.verbose) ctx.err(`${arg}: ${percent(input.length, wrapped.length)}% -- replaced with ${target}`);
      if (!opts.keep) ctx.vfs.rm(path);
      continue;
    }

    // Decompress a file operand.
    const lower = arg.toLowerCase();
    const stem = lower.endsWith('.tgz') ? arg.slice(0, -4) + '.tar' : lower.endsWith('.taz') ? arg.slice(0, -4) + '.tar' : lower.endsWith('.gz') ? arg.slice(0, -3) : null;
    if (stem === null) {
      ctx.err(`gzip: ${arg}: unknown suffix -- ignored`);
      ctx.exit(2);
      continue;
    }
    try {
      const { raw, end } = gzipUnwrap(input);
      const decoded = strOfBytes(raw);
      if (opts.stdout) {
        ctx.out(decoded);
      } else {
        ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, stem), decoded);
        if (opts.verbose) ctx.err(`${arg}: ${percent(input.length, raw.length)}% -- replaced with ${stem}`);
        if (!opts.keep) ctx.vfs.rm(path);
      }
      if (!isSugarTail(input, end)) {
        ctx.err(`gzip: ${arg}: decompression OK, trailing garbage ignored`);
        ctx.exit(2);
      }
    } catch (cause) {
      if (cause instanceof GzipError) {
        gzipFail(ctx, arg, cause);
        continue;
      }
      throw cause;
    }
  }
}

const gzipCommand: CommandSpec = {
  name: 'gzip',
  usage: usageOf('gzip'),
  complete: (ctx) => ['-c', '-d', '-k', '-t', '-v', '-f', '--stdout', '--decompress', '--keep', '--test', '--help'].filter((f) => f.startsWith(ctx.word)),
  run: (ctx) => gzipRunner(ctx, 'gzip', {}),
};

const gunzipCommand: CommandSpec = {
  name: 'gunzip',
  usage: usageOf('gunzip'),
  complete: gzipCommand.complete,
  run: (ctx) => gzipRunner(ctx, 'gunzip', { decompress: true }),
};

const zcatCommand: CommandSpec = {
  name: 'zcat',
  usage: usageOf('zcat'),
  complete: gzipCommand.complete,
  run: (ctx) => gzipRunner(ctx, 'zcat', { decompress: true, stdout: true }),
};

/* ------------------------------------------------------------------ *
 * tar
 * ------------------------------------------------------------------ */

interface TarInvocation {
  mode: 'create' | 'extract' | 'list';
  file: string | null;
  verbose: boolean;
  gzip: boolean;
  dir: string | null;
  operands: string[];
}

function parseTarArgs(ctx: CommandContext): TarInvocation | null {
  const inv: TarInvocation = { mode: 'create', file: null, verbose: false, gzip: false, dir: null, operands: [] };
  let mode: TarInvocation['mode'] | null = null;
  const args = splitArgs(ctx.args, 'fC');
  let endOfFlags = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (endOfFlags || a === '-' || !a.startsWith('-')) {
      inv.operands.push(a);
      continue;
    }
    if (a === '--') {
      endOfFlags = true;
    } else if (a === '-c' || a === '--create') mode = 'create';
    else if (a === '-x' || a === '--extract' || a === '--get') mode = 'extract';
    else if (a === '-t' || a === '--list') mode = 'list';
    else if (a === '-f' || a === '--file') inv.file = args[++i] ?? null;
    else if (a.startsWith('--file=')) inv.file = a.slice(7);
    else if (a === '-v' || a === '--verbose') inv.verbose = true;
    else if (a === '-z' || a === '--gzip' || a === '--gunzip') inv.gzip = true;
    else if (a === '-C' || a === '--directory') inv.dir = args[++i] ?? null;
    else if (a.startsWith('--directory=')) inv.dir = a.slice(12);
    else if (a === '--help' || a === '-h') {
      ctx.out(usageOf('tar'));
      ctx.out('One of -c/-x/-t, then -f ARCHIVE (- = stdin/stdout), -v, -z, -C DIR.');
      return null;
    } else if (['-r', '-u', '-A', '-d', '--append', '--update', '--diff', '--compare', '--delete'].includes(a)) {
      ctx.err(`tar: ${a}: not supported (create, list and extract only)`);
      ctx.exit(2);
      return null;
    } else {
      badOption(ctx, 'tar', a);
      return null;
    }
  }
  if (mode === null) {
    ctx.err("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options");
    ctx.exit(2);
    return null;
  }
  inv.mode = mode;
  return inv;
}

/** Read the archive bytes: the -f operand, else piped stdin. */
function tarArchiveBytes(ctx: CommandContext, file: string | null): Uint8Array | null {
  if (file !== null && file !== '-') {
    const bytes = readOperandBytes(ctx, 'tar', file);
    return bytes;
  }
  if (ctx.stdin === null) {
    ctx.err('tar: no archive (use -f ARCHIVE, or pipe one in)');
    ctx.exit(2);
    return null;
  }
  return bytesOf(ctx.stdin);
}

/** Filter entries by GNU member semantics (exact name or under a dir). */
function memberSelected(name: string, members: string[]): boolean {
  if (members.length === 0) return true;
  return members.some((m) => {
    const dir = m.endsWith('/') ? m : m + '/';
    return name === m || name === dir || name.startsWith(dir);
  });
}

function stripLeadingSlashes(name: string): { name: string; stripped: boolean } {
  const stripped = name.startsWith('/');
  return { name: name.replace(/^\/+/, ''), stripped };
}

function walkTarTree(ctx: CommandContext, path: string, name: string, out: TarEntryIn[], verbose: boolean): boolean {
  const node = ctx.vfs.nodeAt(path);
  if (!node) {
    ctx.err(`tar: ${path}: Cannot stat: No such file or directory`);
    return false;
  }
  if (node.kind === 'file') {
    out.push({ name, type: 'file', data: bytesOf(node.content), mode: 0o644, mtime: nowSecs() });
    if (verbose) ctx.out(name);
    return true;
  }
  out.push({ name: name.endsWith('/') ? name : name + '/', type: 'dir', mode: 0o755, mtime: nowSecs() });
  if (verbose) ctx.out(name.endsWith('/') ? name : name + '/');
  let ok = true;
  for (const child of ctx.vfs.list(path)) {
    const childName = (name.endsWith('/') ? name.slice(0, -1) : name) + '/' + child.name;
    if (!walkTarTree(ctx, path === '/' ? `/${child.name}` : `${path}/${child.name}`, childName, out, verbose)) ok = false;
  }
  return ok;
}

const tarCommand: CommandSpec = {
  name: 'tar',
  usage: usageOf('tar'),
  complete: (ctx) => ['-c', '-x', '-t', '-f', '-v', '-z', '-C', '--create', '--extract', '--list', '--file', '--gzip', '--directory', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const inv = parseTarArgs(ctx);
    if (inv === null) return;
    let failed = false;
    const fail = (): void => {
      failed = true;
      ctx.exit(2);
    };

    /* ── create ── */
    if (inv.mode === 'create') {
      if (inv.operands.length === 0) {
        ctx.err('tar: Cowardly refusing to create an empty archive');
        fail();
        return;
      }
      const entries: TarEntryIn[] = [];
      let warnedStripping = false;
      for (const operand of inv.operands) {
        if (operand === '-') {
          ctx.err('tar: "-" is not a file operand here');
          fail();
          return;
        }
        // One -C per invocation (documented in the man page): create
        // re-bases later operands relative to it.
        const baseDir = inv.dir !== null ? ctx.vfs.resolve(ctx.state.cwd, inv.dir) : ctx.state.cwd;
        const path = ctx.vfs.resolve(baseDir, operand);
        const rel = path.startsWith(baseDir === '/' ? '/' : baseDir + '/') ? path.slice(baseDir === '/' ? 1 : baseDir.length + 1) : operand;
        const strip = stripLeadingSlashes(rel);
        if (strip.stripped && !warnedStripping) {
          ctx.err("tar: Removing leading `/' from member names");
          warnedStripping = true;
        }
        if (strip.name === '') {
          ctx.err('tar: cannot archive the root directory');
          fail();
          return;
        }
        if (!walkTarTree(ctx, path, strip.name, entries, inv.verbose)) fail();
      }
      let archive = tarCreate(entries);
      if (inv.gzip) archive = gzipWrap(archive);
      if (inv.file !== null && inv.file !== '-') {
        ctx.vfs.mountFile(ctx.vfs.resolve(ctx.state.cwd, inv.file), strOfBytes(archive));
      } else {
        ctx.out(strOfBytes(archive));
      }
      return;
    }

    /* ── list / extract ── */
    const bytes = tarArchiveBytes(ctx, inv.file);
    if (bytes === null) return;
    let archiveBytes = bytes;
    if (inv.gzip || (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      try {
        archiveBytes = gzipUnwrap(bytes).raw;
      } catch (cause) {
        if (cause instanceof GzipError) {
          ctx.err(`tar: ${cause.message}`);
          fail();
          return;
        }
        throw cause;
      }
    }
    let entries: TarEntry[];
    try {
      entries = tarParse(archiveBytes);
    } catch (cause) {
      ctx.err(`tar: ${cause instanceof Error ? cause.message : String(cause)}`);
      fail();
      return;
    }

    for (const member of inv.operands) {
      if (!entries.some((e) => memberSelected(e.name, [member]))) {
        ctx.err(`tar: ${member}: Not found in archive`);
        ctx.err('tar: Exiting with failure status due to previous errors');
        fail();
        return;
      }
    }

    const extractRoot = inv.dir !== null ? ctx.vfs.resolve(ctx.state.cwd, inv.dir) : ctx.state.cwd;

    for (const entry of entries) {
      if (!memberSelected(entry.name, inv.operands)) continue;
      const display = entry.name.replace(/\/+$/, '');
      if (inv.mode === 'list') {
        if (inv.verbose) {
          const size = entry.type === 'dir' ? 0 : entry.size;
          ctx.out(`${modeString(entry.mode, entry.type === 'dir')} 0/0 ${String(size).padStart(8)} ${tarDate(entry.mtime)} ${entry.name}`);
        } else {
          ctx.out(entry.name);
        }
        continue;
      }
      // extract
      if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) {
        ctx.err(`tar: ${entry.name}: Member name contains '..'`);
        fail();
        continue;
      }
      if (entry.type === 'link') {
        ctx.err(`tar: ${display}: skipping (the VFS has no links)`);
        fail();
        continue;
      }
      const target = ctx.vfs.resolve(extractRoot, display);
      if (entry.type === 'dir') {
        ctx.vfs.mkdir(target, { parents: true });
      } else {
        ctx.vfs.mountFile(target, strOfBytes(entry.data ?? new Uint8Array()));
      }
      if (inv.verbose) ctx.out(display);
    }
  },
};

/* ------------------------------------------------------------------ *
 * zip
 * ------------------------------------------------------------------ */

const zipCommand: CommandSpec = {
  name: 'zip',
  usage: usageOf('zip'),
  complete: (ctx) => ['-r', '-q', '-0', '-9', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    let recurse = false;
    let quiet = false;
    let store = false;
    const operands: string[] = [];
    const args = splitArgs(ctx.args, '');
    for (const a of args) {
      if (a === '--') {
        operands.push(...args.slice(args.indexOf(a) + 1));
        break;
      }
      if (a === '-r') recurse = true;
      else if (a === '-q') quiet = true;
      else if (a === '-0') store = true;
      else if (a === '-9' || a === '-1') {
        /* one algorithm */
      } else if (a === '-e' || a.startsWith('--')) {
        if (a === '--help' || a === '-h') {
          ctx.out(usageOf('zip'));
          ctx.out('ARCHIVE first; -r recurses, -0 stores, -q quiets. No encryption.');
          return;
        }
        ctx.err(a === '-e' ? 'zip: encryption is not supported' : `zip: unsupported option ${a}`);
        ctx.exit(16);
        return;
      } else if (a.startsWith('-') && a !== '-') {
        badOption(ctx, 'zip', a);
        return;
      } else operands.push(a);
    }
    const [archive, ...paths] = operands;
    if (archive === undefined || paths.length === 0) {
      ctx.err(`zip: usage: ${usageOf('zip')}`);
      ctx.exit(16);
      return;
    }
    const archivePath = ctx.vfs.resolve(ctx.state.cwd, archive);
    if (ctx.vfs.nodeAt(archivePath)?.kind === 'dir') {
      ctx.err(`zip: ${archive}: Is a directory`);
      ctx.exit(2);
      return;
    }

    // Rebuild-from-contents merge: existing members keep their data,
    // same-named new paths replace them (zip updates in place).
    const entries = new Map<string, ZipEntryIn>();
    const existing = ctx.vfs.read(archivePath);
    if (existing !== null) {
      try {
        for (const entry of zipParse(bytesOf(existing))) {
          const data = zipReadEntry(bytesOf(existing), entry);
          entries.set(entry.name, { name: entry.name, data, mode: entry.mode || (entry.isDir ? 0o755 : 0o644), store: true });
        }
      } catch (cause) {
        ctx.err(`zip: ${archive}: ${cause instanceof ZipError ? cause.message : 'not a zip archive (refusing to overwrite)'}`);
        ctx.exit(2);
        return;
      }
    }

    let added = 0;
    let warnedStripping = false;
    const addPath = (operand: string): void => {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      const node = ctx.vfs.nodeAt(path);
      if (!node) {
        ctx.err(`zip warning: name not matched: ${operand}`);
        return;
      }
      const strip = stripLeadingSlashes(operand);
      if (strip.stripped && !warnedStripping) {
        ctx.err("zip: stripping leading `/' from member names");
        warnedStripping = true;
      }
      if (node.kind === 'file') {
        entries.set(strip.name, { name: strip.name, data: bytesOf(node.content), mode: 0o644, store });
        if (!quiet) ctx.out(`  adding: ${strip.name} (${store ? 'stored' : 'deflated'})`);
        added++;
        return;
      }
      if (!recurse) {
        entries.set(strip.name.endsWith('/') ? strip.name : strip.name + '/', { name: strip.name.endsWith('/') ? strip.name : strip.name + '/', data: new Uint8Array(), mode: 0o755, store: true });
        if (!quiet) ctx.out(`  adding: ${strip.name}/ (stored 0%)`);
        added++;
        return;
      }
      const walk = (dirPath: string, name: string): void => {
        entries.set(name + '/', { name: name + '/', data: new Uint8Array(), mode: 0o755, store: true });
        if (!quiet) ctx.out(`  adding: ${name}/ (stored 0%)`);
        for (const child of ctx.vfs.list(dirPath)) {
          const childPath = dirPath === '/' ? `/${child.name}` : `${dirPath}/${child.name}`;
          if (child.kind === 'dir') walk(childPath, name + '/' + child.name);
          else {
            const content = ctx.vfs.read(childPath) ?? '';
            const childName = name + '/' + child.name;
            entries.set(childName, { name: childName, data: bytesOf(content), mode: 0o644, store });
            if (!quiet) ctx.out(`  adding: ${childName} (${store ? 'stored' : 'deflated'})`);
          }
        }
      };
      walk(path, strip.name);
      added++;
    };
    for (const path of paths) addPath(path);

    if (added === 0 && entries.size === 0) {
      ctx.err(`zip error: Nothing to do! (${archive})`);
      ctx.exit(12);
      return;
    }
    if (added === 0) {
      ctx.err(`zip warning: name not matched: nothing updated (${archive})`);
      ctx.exit(12);
      return;
    }
    const bytes = zipCreate([...entries.values()]);
    ctx.vfs.mountFile(archivePath, strOfBytes(bytes));
  },
};

/* ------------------------------------------------------------------ *
 * unzip
 * ------------------------------------------------------------------ */

/** Info-ZIP member selection: glob (`*`, `?`) or exact name. */
function zipMemberMatch(name: string, pattern: string): boolean {
  const re = new RegExp(
    '^' +
      [...pattern]
        .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
  return re.test(name);
}

const unzipCommand: CommandSpec = {
  name: 'unzip',
  usage: usageOf('unzip'),
  complete: (ctx) => ['-l', '-o', '-n', '-q', '-d', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    let list = false;
    let quiet = false;
    let neverOverwrite = false;
    let dir: string | null = null;
    const operands: string[] = [];
    const args = splitArgs(ctx.args, 'd');
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-l' || a === '--list') list = true;
      else if (a === '-q' || a === '--quiet') quiet = true;
      else if (a === '-o' || a === '--overwrite') {
        /* overwrite is the VFS default */
      } else if (a === '-n' || a === '--never-overwrite') neverOverwrite = true;
      else if (a === '-d' || a === '--exdir') dir = args[++i] ?? null;
      else if (a === '--help' || a === '-h') {
        ctx.out(usageOf('unzip'));
        ctx.out('ARCHIVE first, then member globs. -l lists, -d DIR extracts into DIR.');
        return;
      } else if (a.startsWith('-') && a !== '-') {
        badOption(ctx, 'unzip', a);
        return;
      } else operands.push(a);
    }
    const [archive, ...members] = operands;
    if (archive === undefined) {
      ctx.err('UnZip 6.00: archive name required');
      ctx.exit(10);
      return;
    }
    const archivePath = ctx.vfs.resolve(ctx.state.cwd, archive);
    const raw = ctx.vfs.read(archivePath);
    if (raw === null) {
      ctx.err(`unzip: cannot find ${archive}`);
      ctx.exit(9);
      return;
    }
    const bytes = bytesOf(raw);
    let entries;
    try {
      entries = zipParse(bytes);
    } catch (cause) {
      ctx.err(cause instanceof ZipError ? `unzip: cannot find zipfile directory in ${archive} (${cause.message})` : `unzip: ${archive}: not a zip file`);
      ctx.exit(9);
      return;
    }

    const matched = entries.filter((e) => members.length === 0 || members.some((m) => zipMemberMatch(e.name, m)));
    for (const member of members) {
      if (!entries.some((e) => zipMemberMatch(e.name, member))) ctx.err(`caution: filename not matched: ${member}`);
    }
    if (members.length > 0 && matched.length === 0) {
      ctx.exit(11);
      return;
    }

    if (list) {
      ctx.out(`Archive:  ${archive}`);
      ctx.out('  Length      Date    Time    Name');
      ctx.out('---------  ---------- -----   ----');
      let total = 0;
      let files = 0;
      for (const entry of matched) {
        const d = entry.dosDate;
        const t = entry.dosTime;
        const date = `${1980 + ((d >> 9) & 0x7f)}-${pad2((d >> 5) & 0x0f)}-${pad2(d & 0x1f)}`;
        const time = `${pad2((t >> 11) & 0x1f)}:${pad2((t >> 5) & 0x3f)}`;
        ctx.out(`${String(entry.usize).padStart(9)}  ${date} ${time}   ${entry.name}`);
        if (!entry.isDir) {
          total += entry.usize;
          files++;
        }
      }
      ctx.out('---------                   -------');
      ctx.out(`${String(total).padStart(9)}                   ${files} ${files === 1 ? 'file' : 'files'}`);
      return;
    }

    const root = dir !== null ? ctx.vfs.resolve(ctx.state.cwd, dir) : ctx.state.cwd;
    for (const entry of matched) {
      if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) {
        ctx.err(`unzip: ${entry.name}: illegal member name (absolute or ..)`);
        ctx.exit(2);
        continue;
      }
      const target = ctx.vfs.resolve(root, entry.name.replace(/\/+$/, ''));
      if (entry.isDir) {
        ctx.vfs.mkdir(target, { parents: true });
        continue;
      }
      if (neverOverwrite && ctx.vfs.nodeAt(target) !== null) {
        if (!quiet) ctx.out(`   skipping: ${entry.name}`);
        continue;
      }
      try {
        const data = zipReadEntry(bytes, entry);
        ctx.vfs.mountFile(target, strOfBytes(data));
        if (!quiet) ctx.out(`  ${entry.method === 8 ? 'inflating' : 'extracting'}: ${entry.name}`);
      } catch (cause) {
        if (cause instanceof ZipError) {
          ctx.err(`unzip: ${cause.message}`);
          ctx.exit(2);
          continue;
        }
        throw cause;
      }
    }
  },
};

/* ------------------------------------------------------------------ *
 * exports (the PackageModule shape)
 * ------------------------------------------------------------------ */

export const commands: Command[] = [
  base64Command,
  makeSumCommand('md5'),
  makeSumCommand('sha1'),
  makeSumCommand('sha256'),
  makeSumCommand('sha512'),
  gzipCommand,
  gunzipCommand,
  zcatCommand,
  tarCommand,
  zipCommand,
  unzipCommand,
];

export default commands;

export const manPages: Record<string, string[]> = {
  base64: [
    'base64 — encode/decode data as base64 (RFC 4648)',
    '',
    'SYNOPSIS',
    '  base64 [-d] [-w COLS] [-i] [file...]',
    '',
    'Encodes files (or stdin) with 76-column wrapping, like GNU coreutils;',
    '-w 0 disables wrapping, -i skips non-alphabet input bytes when',
    'decoding, -d decodes (newlines in the input are structure, not data).',
    '',
    'VFS note: file content is a string; text encodes as its UTF-8 bytes',
    '(matching GNU on real text) and binary strings — char codes ≤ 0xff —',
    'encode 1:1, so archives round-trip byte for byte.',
  ],
  md5sum: [
    'md5sum — MD5 message digest (RFC 1321)',
    '',
    'SYNOPSIS',
    '  md5sum [-b | -t] [--tag] [file...]   ·   md5sum -c CHECKFILE',
    '',
    'Prints "<digest>  <name>" per file (`-` for stdin; ` *` with -b,',
    'BSD-style --tag lines also available). -c verifies a listing:',
    '<name>: OK / <name>: FAILED per line, exit 0/1/2 like GNU (1 =',
    'mismatch or unreadable, 2 = improperly formatted lines). The digest',
    'is a pure implementation cross-checked against WebCrypto in tests.',
  ],
  sha1sum: [
    'sha1sum — SHA-1 message digest (FIPS 180-4)',
    '',
    'SYNOPSIS',
    '  sha1sum [-b | -t] [--tag] [file...]   ·   sha1sum -c CHECKFILE',
    '',
    'Same shape as md5sum — see that page; the digest is 40 hex digits.',
  ],
  sha256sum: [
    'sha256sum — SHA-256 message digest (FIPS 180-4)',
    '',
    'SYNOPSIS',
    '  sha256sum [-b | -t] [--tag] [file...]   ·   sha256sum -c CHECKFILE',
    '',
    'Same shape as md5sum — see that page; the digest is 64 hex digits.',
  ],
  sha512sum: [
    'sha512sum — SHA-512 message digest (FIPS 180-4)',
    '',
    'SYNOPSIS',
    '  sha512sum [-b | -t] [--tag] [file...]   ·   sha512sum -c CHECKFILE',
    '',
    'Same shape as md5sum — see that page; the digest is 128 hex digits.',
  ],
  gzip: [
    'gzip — compress files in the gzip format (RFC 1952)',
    '',
    'SYNOPSIS',
    '  gzip [-cdfktv] [-1..-9] [file...]',
    '',
    'File mode replaces each file with file.gz (-k keeps, -v reports the',
    'ratio); stdin compresses to stdout. -c forces stdout. -1..-9 and',
    '--fast/--best are accepted; there is one algorithm, a synchronous',
    'greedy-LZ77/fixed-Huffman DEFLATE a few percent off zlib level 6 —',
    'the format is standard, so real gzip reads it (verified against',
    'Node zlib in tests).',
    '',
    'Binary through a pipe or redirect carries the shell\'s one trailing',
    'newline; the matching decompressors ignore exactly that byte and',
    'report any other trailing data GNU-style ("trailing garbage").',
  ],
  gunzip: [
    'gunzip — decompress gzip files',
    '',
    'SYNOPSIS',
    '  gunzip [-cfkv] [file...]',
    '',
    'gzip -d: file.gz is replaced by file (.tgz/.taz unpack to .tar);',
    'stdin decompresses to stdout. Verifies CRC32 and length, accepts',
    'FNAME/FCOMMENT/FEXTRA/FHCRC headers, warns on trailing garbage.',
  ],
  zcat: [
    'zcat — decompress gzip files to stdout',
    '',
    'SYNOPSIS',
    '  zcat [file...]',
    '',
    'gzip -cd: never modifies files, always writes the decompressed bytes',
    'to stdout ("cat" through the decompressor). Non-gzip input is an',
    'error, like GNU.',
  ],
  tar: [
    'tar — create, list and extract ustar archives (POSIX 1003.1)',
    '',
    'SYNOPSIS',
    '  tar -c [-f ARCHIVE] [-v] [-z] [-C DIR] PATH...',
    '  tar -t [-f ARCHIVE] [-v] [-z] [MEMBER...]',
    '  tar -x [-f ARCHIVE] [-v] [-z] [-C DIR] [MEMBER...]',
    '',
    'ustar format with the prefix field for long names, checksums, and',
    'the two-zero-block terminator; -z wraps the archive in gzip. GNU',
    'long-name (L) and pax (x) path records are honoured on read, so',
    'archives from GNU tar and macOS bsdtar both extract. Members with',
    "'..' or absolute names are refused; hard/symlinks are skipped with",
    'a note (the VFS has no links). No -f, or -f -: stdin/stdout.',
    'One -C per invocation (create re-bases later operands; extract',
    'extracts into it).',
  ],
  zip: [
    'zip — create/update PKZIP archives',
    '',
    'SYNOPSIS',
    '  zip [-r] [-q] [-0] ARCHIVE PATH...',
    '',
    'ARCHIVE comes first (Info-ZIP order). -r recurses directories;',
    'without it a directory contributes its entry only. Each entry is',
    'deflated (raw DEFLATE, method 8) or stored (method 0, -0 forces it),',
    'whichever is smaller. An existing archive is UPDATED: its members',
    'are carried over and same-named paths replaced (the archive is',
    'rewritten, so timestamps and per-entry bytes may change). No',
    'encryption (-e refuses), no zip64.',
  ],
  unzip: [
    'unzip — list/extract PKZIP archives',
    '',
    'SYNOPSIS',
    '  unzip [-l] [-o | -n] [-q] [-d DIR] ARCHIVE [MEMBER...]',
    '',
    'Members are selected by exact name or glob (* and ?); -l prints the',
    'Info-ZIP listing; -d extracts into DIR. Extraction overwrites by',
    'default (-o makes that explicit; -n skips existing files). Sizes,',
    'methods and CRCs come from the central directory (streamed archives',
    'with data descriptors read fine); CRC mismatches report and exit 2.',
    'Exit codes follow Info-ZIP: 0 ok, 9 archive missing/invalid, 10 bad',
    'usage, 11 no members matched.',
  ],
};

/** The chunk shape, for loader type checks and tests. */
export const pkg: PackageModule = { commands, manPages };
