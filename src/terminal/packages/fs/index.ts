/**
 * packages/fs — file-system utilities (packages round, LANE=pkg-fs).
 *
 * The package CHUNK (semtext-pkg-fs.js once built): dynamic-imported by
 * ./stub.ts at boot, never part of the base shell bundle. Reference
 * behaviour is GNU coreutils / BSD cal; where the emulation knowingly
 * differs the man page says so — the three structural differences of this
 * VFS are (1) nodes are `file | dir` only: no symlinks (ln/readlink), no
 * inode hard links, no stored mtimes (touch -d/-t would have nothing to
 * store) and no real permissions (chmod keeps a session-scoped mode map);
 * (2) the command path is synchronous (CORE-V2), so `sleep` cannot block
 * and `yes` cannot run forever — both validate faithfully and then
 * return, documented; (3) sizes are content bytes (the VFS has no disk
 * blocks), so du/df report bytes and -h humanizes them.
 *
 * printf, touch, true, false and which already exist in the posix plugin;
 * the registry rejects duplicate names, so they are NOT re-registered here
 * (the lane brief's extend-instead-of-duplicate rule — see the lane
 * report; extending them is a cross-lane change to posix/commands.ts).
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import type { VfsDir, VfsNode } from '../../vfs.js';
import { fsStub } from './stub.js';

/* ------------------------------------------------------------------ *
 * shared helpers (chunk-local)
 * ------------------------------------------------------------------ */

const usageOf = (name: string): string => fsStub.commands.find((c) => c.name === name)!.usage;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

/** GNU -h style: powers of 1024, one decimal only when it matters. */
function humanBytes(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1024) return String(n);
  const units = ['K', 'M', 'G', 'T', 'P', 'E'];
  let value = n;
  let unit = '';
  for (const u of units) {
    if (Math.abs(value) < 1024) break;
    value /= 1024;
    unit = u;
  }
  const scaled = Math.abs(value) < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${scaled}${unit}`;
}

const gnuHint = (ctx: CommandContext, cmd: string): void => {
  ctx.err(`Try '${cmd} --help' for more information.`);
};

interface Walked {
  flags: Set<string>;
  values: Map<string, string>;
  operands: string[];
}

/**
 * GNU-ish option walker: short flags cluster (`-as`), value letters take
 * an attached value (`-L2`) or the next word (`-L 2`), `--` ends flags
 * and `--help`/`--long[=value]` work (`-h` is NOT reserved — du/df use it
 * for humanize). Numeric-led words (`-3`,
 * `-0.5`) pass through as operands — `seq -3`, `sleep -1`, `test -3 -eq
 * -3` style operands must not eat the option path. Unknown options
 * report GNU-style ('invalid option', 'unrecognized option', 'option
 * requires an argument') and exit 1; null tells the caller to stop.
 */
function walkArgs(
  ctx: CommandContext,
  cmd: string,
  args: readonly string[],
  opts: { flagLetters?: string; valueLetters?: string; longFlags?: string[]; longValues?: string[] },
): Walked | null {
  const { flagLetters = '', valueLetters = '', longFlags = [], longValues = [] } = opts;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  const bad = (message: string, token: string): null => {
    ctx.err(`${cmd}: ${message}${token === '' ? '' : ` '${token}'`}`);
    gnuHint(ctx, cmd);
    ctx.exit(1);
    return null;
  };
  let i = 0;
  let endOfFlags = false;
  while (i < args.length) {
    const a = args[i]!;
    if (endOfFlags || a === '-' || /^-\d/.test(a) || /^-\.\d/.test(a) || !a.startsWith('-')) {
      operands.push(a);
      i++;
      continue;
    }
    if (a === '--') {
      endOfFlags = true;
      i++;
      continue;
    }
    if (a === '--help') {
      flags.add('--help');
      i++;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (longValues.includes(name)) {
        const value = eq !== -1 ? a.slice(eq + 1) : args[++i];
        if (value === undefined) return bad(`option '${name}' requires an argument`, name);
        values.set(name, value);
      } else if (longFlags.includes(name)) {
        flags.add(name);
      } else {
        return bad(`unrecognized option`, a);
      }
      i++;
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const ch = a[j]!;
      if (valueLetters.includes(ch)) {
        const attached = a.slice(j + 1);
        const value = attached !== '' ? attached : args[++i];
        if (value === undefined) return bad(`option requires an argument -- '${ch}'`, '');
        values.set('-' + ch, value);
        break;
      }
      if (flagLetters.includes(ch)) {
        flags.add('-' + ch);
      } else {
        return bad(`invalid option -- '${ch}'`, '');
      }
    }
    i++;
  }
  return { flags, values, operands };
}

/** Resolve an operand against the cwd. */
const resolve = (ctx: CommandContext, path: string): string => ctx.vfs.resolve(ctx.state.cwd, path);

const nodeAt = (ctx: CommandContext, path: string): VfsNode | null => ctx.vfs.nodeAt(resolve(ctx, path));

/** GNU wording for a missing operand path. */
function cannotAccess(ctx: CommandContext, cmd: string, path: string, verb = 'cannot access'): void {
  ctx.err(`${cmd}: ${verb} '${path}': No such file or directory`);
}

/* modes — session-scoped (the VFS stores no permission bits) ---------- */

const modes = new Map<string, number>();

const modeOf = (ctx: CommandContext, abs: string, node: VfsNode): number =>
  modes.get(abs) ?? (node.kind === 'dir' ? 0o755 : 0o644);

function rwx(mode: number): string {
  const tri = (shift: number): string => {
    const m = (mode >> shift) & 7;
    return (m & 4 ? 'r' : '-') + (m & 2 ? 'w' : '-') + (m & 1 ? 'x' : '-');
  };
  return tri(6) + tri(3) + tri(0);
}

const octalOf = (mode: number): string => mode.toString(8).padStart(4, '0');

/* backend naming ------------------------------------------------------ */

function backendName(ctx: CommandContext, path: string): { id: string; mountpoint: string } {
  const backend = ctx.vfs.backendFor(resolve(ctx, path));
  return backend ? { id: backend.id, mountpoint: backend.mountpoint } : { id: 'memory', mountpoint: '/' };
}

/** Sum of file bytes under an absolute path. */
function treeBytes(ctx: CommandContext, abs: string): number {
  const node = ctx.vfs.nodeAt(abs);
  if (node === null) return 0;
  if (node.kind === 'file') return byteLength(node.content);
  return node.children.reduce((sum, child) => sum + treeBytes(ctx, ctx.vfs.resolve(abs, child.name)), 0);
}

/* ------------------------------------------------------------------ *
 * mv — move (rename) files
 * ------------------------------------------------------------------ */

const mv: CommandSpec = {
  name: 'mv',
  usage: usageOf('mv'),
  complete: (ctx) => ['-f', '-n', '-v', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'mv', ctx.args, { flagLetters: 'fnv' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      for (const line of [
        usageOf('mv'),
        '',
        'Move (rename) SOURCE to DEST, or move every SOURCE into an',
        'existing DEST directory. -n skips existing destinations (this',
        'shell has no prompt channel, so -f is accepted as a no-op),',
        "-v prints each move as 'src -> dst'.",
      ]) ctx.out(line);
      return;
    }
    if (operands.length === 0) {
      ctx.err('mv: missing file operand');
      ctx.exit(1);
      return;
    }
    if (operands.length === 1) {
      ctx.err(`mv: missing destination file operand after '${operands[0]}'`);
      ctx.exit(1);
      return;
    }
    const destArg = operands[operands.length - 1]!;
    const destAbs = resolve(ctx, destArg);
    const sources = operands.slice(0, -1);
    const destNode = ctx.vfs.nodeAt(destAbs);
    if (sources.length > 1 && destNode?.kind !== 'dir') {
      ctx.err(`mv: target '${destArg}' is not a directory`);
      ctx.exit(1);
      return;
    }
    let failed = false;
    for (const src of sources) {
      const srcAbs = resolve(ctx, src);
      const node = ctx.vfs.nodeAt(srcAbs);
      if (node === null) {
        cannotAccess(ctx, 'mv', src, 'cannot stat');
        failed = true;
        continue;
      }
      const targetAbs = destNode?.kind === 'dir' ? ctx.vfs.resolve(destAbs, node.name) : destAbs;
      if (targetAbs === srcAbs) {
        ctx.err(`mv: '${src}' and '${destArg}' are the same file`);
        failed = true;
        continue;
      }
      if (flags.has('-n') && ctx.vfs.nodeAt(targetAbs) !== null) continue;
      const parent = ctx.vfs.nodeAt(ctx.vfs.resolve(targetAbs, '..'));
      if (parent?.kind !== 'dir') {
        ctx.err(`mv: cannot move '${src}' to '${destArg}': No such file or directory`);
        failed = true;
        continue;
      }
      try {
        ctx.vfs.rename(srcAbs, targetAbs);
        if (flags.has('-v')) {
          const display = destNode?.kind === 'dir' ? `${destArg.replace(/\/+$/, '')}/${node.name}` : destArg;
          ctx.out(`'${src}' -> '${display}'`);
        }
        const saved = modes.get(srcAbs); // a moved node keeps its chmod value
        if (saved !== undefined) {
          modes.delete(srcAbs);
          modes.set(targetAbs, saved);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        ctx.err(`mv: cannot move '${src}' to '${destArg}': ${message}`);
        failed = true;
      }
    }
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * ln / readlink — the VFS has no symlink node kind
 * ------------------------------------------------------------------ */

const ln: CommandSpec = {
  name: 'ln',
  usage: usageOf('ln'),
  complete: (ctx) => ['-s', '-f', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'ln', ctx.args, { flagLetters: 'sf' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('ln'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('ln: missing file operand');
      ctx.exit(1);
      return;
    }
    if (operands.length === 1) {
      ctx.err(`ln: missing destination file operand after '${operands[0]}'`);
      ctx.exit(1);
      return;
    }
    const link = operands[operands.length - 1]!;
    ctx.err(`ln: failed to create ${flags.has('-s') ? 'symbolic link' : 'hard link'} '${link}': Operation not supported`);
    ctx.err("ln: this VFS stores 'file | dir' nodes only — no symlinks, no hard links");
    ctx.exit(1);
  },
};

const readlink: CommandSpec = {
  name: 'readlink',
  usage: usageOf('readlink'),
  complete: (ctx) => ['-f', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'readlink', ctx.args, { flagLetters: 'f' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('readlink'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('readlink: missing operand');
      ctx.exit(1);
      return;
    }
    if (flags.has('-f')) {
      // No symlinks exist, so canonicalization is plain normalization;
      // GNU -f still requires every component but the last to exist.
      for (const op of operands) {
        const abs = resolve(ctx, op);
        const parent = ctx.vfs.nodeAt(ctx.vfs.resolve(abs, '..'));
        if (parent?.kind !== 'dir') {
          ctx.err(`readlink: ${op}: No such file or directory`);
          ctx.exit(1);
          return;
        }
        ctx.out(abs);
      }
      return;
    }
    ctx.err(`readlink: ${operands[0]}: not a symbolic link`);
    ctx.err('readlink: this VFS stores no symlink nodes — nothing can ever be one');
    ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * chmod — mode bits, session-scoped
 * ------------------------------------------------------------------ */

const chmod: CommandSpec = {
  name: 'chmod',
  usage: usageOf('chmod'),
  complete: (ctx) => ['-R', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'chmod', ctx.args, { flagLetters: 'R' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      for (const line of [
        usageOf('chmod'),
        '',
        'Octal modes only (0644-style). The VFS has no permission',
        'metadata: the mode is recorded in a SESSION-SCOPED map that',
        'stat reads — it never persists to a backend. -R recurses.',
      ]) ctx.out(line);
      return;
    }
    if (operands.length === 0) {
      ctx.err('chmod: missing operand');
      gnuHint(ctx, 'chmod');
      ctx.exit(1);
      return;
    }
    const modeArg = operands[0]!;
    const targets = operands.slice(1);
    if (targets.length === 0) {
      ctx.err(`chmod: missing operand after '${modeArg}'`);
      ctx.exit(1);
      return;
    }
    const mode = /^(?:0o)?([0-7]{3,4})$/.exec(modeArg);
    if (mode === null) {
      ctx.err(`chmod: invalid mode: '${modeArg}'`);
      ctx.err('chmod: this build accepts octal modes only (symbolic modes are not implemented)');
      ctx.exit(1);
      return;
    }
    const bits = parseInt(mode[1]!, 8) & 0o777;
    let failed = false;
    const apply = (abs: string, display: string): void => {
      const node = ctx.vfs.nodeAt(abs);
      if (node === null) {
        cannotAccess(ctx, 'chmod', display);
        failed = true;
        return;
      }
      modes.set(abs, bits);
      if (flags.has('-R') && node.kind === 'dir') {
        for (const child of ctx.vfs.list(abs)) apply(ctx.vfs.resolve(abs, child.name), `${display.replace(/\/+$/, '')}/${child.name}`);
      }
    };
    for (const target of targets) apply(resolve(ctx, target), target);
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * stat
 * ------------------------------------------------------------------ */

const stat: CommandSpec = {
  name: 'stat',
  usage: usageOf('stat'),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'stat', ctx.args, {});
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('stat'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('stat: missing operand');
      gnuHint(ctx, 'stat');
      ctx.exit(1);
      return;
    }
    let failed = false;
    operands.forEach((op, index) => {
      const abs = resolve(ctx, op);
      const node = ctx.vfs.nodeAt(abs);
      if (node === null) {
        ctx.err(`stat: cannot stat '${op}': No such file or directory`);
        failed = true;
        return;
      }
      if (index > 0) ctx.out('');
      const size = node.kind === 'file' ? byteLength(node.content) : 4096;
      const kind = node.kind === 'dir' ? 'directory' : 'regular file';
      const mode = modeOf(ctx, abs, node);
      const backend = backendName(ctx, abs);
      ctx.out(`  File: ${abs}`);
      ctx.out(`  Size: ${size}${' '.repeat(Math.max(1, 13 - String(size).length))}Kind: ${kind}`);
      ctx.out(`Access: (${octalOf(mode)}/${rwx(mode)})`);
      ctx.out(`Backend: ${backend.id} (${backend.mountpoint})`);
    });
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * tree
 * ------------------------------------------------------------------ */

const tree: CommandSpec = {
  name: 'tree',
  usage: usageOf('tree'),
  complete: (ctx) => ['-a', '-d', '-L', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'tree', ctx.args, { flagLetters: 'ad', valueLetters: 'L' });
    if (parsed === null) return;
    const { flags, values, operands } = parsed;
    if (flags.has('--help')) {
      for (const line of [
        usageOf('tree'),
        '',
        'Recursively lists each DIR (default .). Dot entries hide',
        'until -a; -d lists directories only; -L LEVEL caps the depth',
        '(1 = immediate children). Ends with a summary line.',
      ]) ctx.out(line);
      return;
    }
    let level = Infinity;
    if (values.has('-L')) {
      const n = Number(values.get('-L'));
      if (!Number.isInteger(n) || n < 1) {
        ctx.err('tree: Invalid level, must be greater than 0.');
        ctx.exit(1);
        return;
      }
      level = n;
    }
    const roots = operands.length > 0 ? operands : ['.'];
    let failed = false;
    for (const root of roots) {
      const abs = resolve(ctx, root);
      const node = ctx.vfs.nodeAt(abs);
      if (node === null) {
        ctx.err(`tree: ${root}: No such file or directory`);
        failed = true;
        continue;
      }
      let dirs = 0;
      let files = 0;
      const visible = (child: VfsNode): boolean =>
        (flags.has('-a') || !child.name.startsWith('.')) && (!flags.has('-d') || child.kind === 'dir');
      const walk = (dir: VfsDir, prefix: string, depth: number): void => {
        const children = dir.children.filter(visible).sort((a, b) => a.name.localeCompare(b.name));
        children.forEach((child, i) => {
          const last = i === children.length - 1;
          ctx.out(prefix + (last ? '└── ' : '├── ') + child.name + (child.kind === 'dir' ? '/' : ''));
          if (child.kind === 'file') files++;
          else dirs++;
          if (child.kind === 'dir' && depth + 1 < level) {
            walk(child, prefix + (last ? '    ' : '│   '), depth + 1);
          }
        });
      };
      ctx.out(root);
      if (node.kind === 'dir') walk(node, '', 1); // -L 1 must still list children
      const dWord = dirs === 1 ? 'directory' : 'directories';
      const fWord = files === 1 ? 'file' : 'files';
      ctx.out(`${dirs} ${dWord}, ${files} ${fWord}`);
    }
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * du
 * ------------------------------------------------------------------ */

const du: CommandSpec = {
  name: 'du',
  usage: usageOf('du'),
  complete: (ctx) => ['-a', '-s', '-h', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'du', ctx.args, { flagLetters: 'ash' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      for (const line of [
        usageOf('du'),
        '',
        'Sums content BYTES (no disk blocks exist in the VFS).',
        'Without -s every subdirectory prints post-order, then the',
        'operand; -s prints totals only; -a also lists files; -h',
        'humanizes (K/M/G, powers of 1024).',
      ]) ctx.out(line);
      return;
    }
    const roots = operands.length > 0 ? operands : ['.'];
    let failed = false;
    let rootDisplay = '';
    const sizeOf = (abs: string): number => {
      const node = ctx.vfs.nodeAt(abs);
      if (node === null) return -1;
      if (node.kind === 'file') return byteLength(node.content);
      return node.children.reduce((sum, child) => sum + Math.max(0, sizeOf(ctx.vfs.resolve(abs, child.name))), 0);
    };
    const emit = (abs: string, display: string): void => {
      const size = sizeOf(abs);
      if (size < 0) {
        ctx.err(`du: cannot access '${display}': No such file or directory`);
        failed = true;
        return;
      }
      ctx.out(`${flags.has('-h') ? humanBytes(size) : String(size)}\t${display}`);
    };
    const walk = (abs: string, display: string): void => {
      const node = ctx.vfs.nodeAt(abs);
      if (node === null) {
        emit(abs, display); // produces the access error
        return;
      }
      if (node.kind === 'file') {
        // File operands always print (GNU du), even without -a; -a is for
        // files FOUND INSIDE directories.
        if (display === rootDisplay || flags.has('-a')) emit(abs, display);
        return;
      }
      for (const child of node.children) {
        walk(ctx.vfs.resolve(abs, child.name), display + (display.endsWith('/') ? '' : '/') + child.name);
      }
      emit(abs, display);
    };
    for (const root of roots) {
      const abs = resolve(ctx, root);
      if (flags.has('-s')) emit(abs, root);
      else {
        rootDisplay = root;
        walk(abs, root);
      }
    }
    if (failed) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * df — per-backend usage
 * ------------------------------------------------------------------ */

const df: CommandSpec = {
  name: 'df',
  usage: usageOf('df'),
  complete: (ctx) => ['-h', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'df', ctx.args, { flagLetters: 'h' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      for (const line of [
        usageOf('df'),
        '',
        "One line per mounted backend (or the backend covering each",
        "PATH): id, Used bytes, and '-' for Avail/Capacity — no backend",
        "exposes a quota, and guessing would be dishonest. 'memory'",
        'names the plain in-tree VFS when nothing is mounted.',
      ]) ctx.out(line);
      return;
    }
    const seen = new Map<string, { id: string; mountpoint: string }>();
    if (operands.length > 0) {
      for (const op of operands) {
        const info = backendName(ctx, op);
        seen.set(info.mountpoint, info);
      }
    } else {
      for (const [mountpoint, backend] of ctx.vfs.mounts) {
        seen.set(mountpoint, { id: backend.id, mountpoint });
      }
      if (seen.size === 0) seen.set('/', { id: 'memory', mountpoint: '/' });
    }
    const rows = [...seen.values()].map((info) => ({ ...info, used: treeBytes(ctx, info.mountpoint) }));
    const show = (n: number): string => (flags.has('-h') ? humanBytes(n) : String(n));
    const pad = (text: string, width: number): string => text + ' '.repeat(Math.max(1, width - text.length));
    const idWidth = Math.max(10, ...rows.map((r) => r.id.length));
    const usedWidth = Math.max(4, ...rows.map((r) => show(r.used).length));
    ctx.out(pad('Filesystem', idWidth + 2) + pad('Used', usedWidth + 2) + 'Avail Capacity Mounted on');
    for (const row of rows) {
      ctx.out(pad(row.id, idWidth + 2) + pad(show(row.used), usedWidth + 2) + pad('-', 6) + pad('-', 9) + row.mountpoint);
    }
  },
};

/* ------------------------------------------------------------------ *
 * file — magic sniffing
 * ------------------------------------------------------------------ */

const PNG_SIG = '\u0089PNG\r\n\u001a\n';
const GZIP_SIG = '\u001f\u008b';
const ZIP_SIG = 'PK\u0003\u0004';

function sniffText(content: string): string {
  const head = content.slice(0, 4096);
  const lowered = head.toLowerCase();
  if (lowered.startsWith('<?xml')) return 'XML document text';
  if (lowered.startsWith('<!doctype html') || lowered.startsWith('<html')) {
    return lowered.includes('<sem-') ? 'SemText HTML document text' : 'HTML document text';
  }
  const trimmed = content.trim();
  if (trimmed !== '' && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      JSON.parse(content);
      return 'JSON text data';
    } catch {
      /* not JSON after all */
    }
  }
  if (head.startsWith('#!')) {
    const interp = head.split('\n', 1)[0]!.replace(/^#!\s*/, '').trim();
    return `${interp} script text executable`;
  }
  if (content.includes('\u0000')) return 'data';
  const charset = /^[\t\n\r\f\v\u0020-\u007e]*$/.test(content) ? 'ASCII text' : 'UTF-8 Unicode text';
  if (!content.includes('\n')) return `${charset}, with no line terminators`;
  return content.includes('\r\n') ? `${charset}, with CRLF line terminators` : charset;
}

function sniff(name: string, content: string): string {
  if (content.startsWith(PNG_SIG)) {
    const width = (content.charCodeAt(16) ?? 0) * 256 + (content.charCodeAt(17) ?? 0);
    const height = (content.charCodeAt(20) ?? 0) * 256 + (content.charCodeAt(21) ?? 0);
    return `PNG image data, ${width} x ${height}`;
  }
  if (content.startsWith(GZIP_SIG)) return 'gzip compressed data';
  if (content.startsWith(ZIP_SIG)) return 'Zip archive data';
  if (content.length >= 262 && content.slice(257, 262) === 'ustar') return 'POSIX tar archive';
  if (name.endsWith('.sem.html')) return 'SemText HTML document text';
  return sniffText(content);
}

const file: CommandSpec = {
  name: 'file',
  usage: usageOf('file'),
  complete: (ctx) => ['-b', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'file', ctx.args, { flagLetters: 'b' });
    if (parsed === null) return;
    const { flags, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('file'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('file: missing operand');
      gnuHint(ctx, 'file');
      ctx.exit(1);
      return;
    }
    for (const op of operands) {
      let description: string;
      if (op === '-') {
        description = sniff('-', ctx.stdin ?? '');
      } else {
        const node = nodeAt(ctx, op);
        if (node === null) {
          ctx.err(`${op}: No such file or directory`);
          continue; // GNU file reports and keeps exit 0
        }
        if (node.kind === 'dir') {
          ctx.err(`${op}: Is a directory`);
          continue;
        }
        description = sniff(op, node.content);
      }
      ctx.out(flags.has('-b') ? description : `${op}: ${description}`);
    }
    ctx.exit(0); // GNU file keeps exit 0 even when files were missing
  },
};

/* ------------------------------------------------------------------ *
 * realpath / basename / dirname
 * ------------------------------------------------------------------ */

const realpath: CommandSpec = {
  name: 'realpath',
  usage: usageOf('realpath'),
  run(ctx: CommandContext): void {
    const operands = ctx.args.filter((a) => a !== '--help');
    if (ctx.args.includes('--help')) {
      ctx.out(usageOf('realpath'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('realpath: missing operand');
      ctx.exit(1);
      return;
    }
    let failed = false;
    for (const op of operands) {
      const abs = resolve(ctx, op);
      if (ctx.vfs.nodeAt(abs) === null) {
        ctx.err(`realpath: ${op}: No such file or directory`);
        failed = true;
        continue;
      }
      ctx.out(abs);
    }
    if (failed) ctx.exit(1);
  },
};

const basename: CommandSpec = {
  name: 'basename',
  usage: usageOf('basename'),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'basename', ctx.args, { flagLetters: 'a', valueLetters: 's' });
    if (parsed === null) return;
    const { flags, values, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('basename'));
      return;
    }
    const names = flags.has('-a') || values.has('-s') ? operands : operands.slice(0, 1);
    const suffix = values.get('-s') ?? (flags.has('-a') ? undefined : operands[1]);
    if (names.length === 0) {
      ctx.err('basename: missing operand');
      gnuHint(ctx, 'basename');
      ctx.exit(1);
      return;
    }
    if (!flags.has('-a') && !values.has('-s') && operands.length > 2) {
      ctx.err(`basename: extra operand '${operands[2]}'`);
      ctx.exit(1);
      return;
    }
    for (const name of names) {
      let base = name.replace(/\/+$/, '');
      if (base === '') base = '/';
      const lastSlash = base.lastIndexOf('/');
      base = lastSlash === -1 ? base : base.slice(lastSlash + 1);
      if (base === '') base = '/';
      if (suffix !== undefined && suffix !== '' && base !== suffix && base.endsWith(suffix)) {
        base = base.slice(0, -suffix.length);
      }
      ctx.out(base);
    }
  },
};

const dirname: CommandSpec = {
  name: 'dirname',
  usage: usageOf('dirname'),
  run(ctx: CommandContext): void {
    const operands = ctx.args.filter((a) => a !== '--help');
    if (ctx.args.includes('--help')) {
      ctx.out(usageOf('dirname'));
      return;
    }
    if (operands.length === 0) {
      ctx.err('dirname: missing operand');
      gnuHint(ctx, 'dirname');
      ctx.exit(1);
      return;
    }
    for (const name of operands) {
      let dir = name.replace(/\/+$/, '');
      if (dir === '') dir = '/';
      const lastSlash = dir.lastIndexOf('/');
      if (lastSlash === -1) {
        ctx.out('.');
        continue;
      }
      let out = dir.slice(0, lastSlash + 1).replace(/\/+$/, '');
      if (out === '') out = '/';
      ctx.out(out);
    }
  },
};

/* ------------------------------------------------------------------ *
 * mktemp
 * ------------------------------------------------------------------ */

const TEMP_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const mktemp: CommandSpec = {
  name: 'mktemp',
  usage: usageOf('mktemp'),
  complete: (ctx) => ['-d', '-p', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'mktemp', ctx.args, { flagLetters: 'd', valueLetters: 'p' });
    if (parsed === null) return;
    const { flags, values, operands } = parsed;
    if (flags.has('--help')) {
      ctx.out(usageOf('mktemp'));
      return;
    }
    if (operands.length > 1) {
      ctx.err('mktemp: too many templates');
      gnuHint(ctx, 'mktemp');
      ctx.exit(1);
      return;
    }
    // Errors name the USER's template (GNU), so validate before adding a
    // default directory.
    let template = operands[0] ?? 'tmp.XXXXXXXXXX';
    const runs = [...template.matchAll(/X{6,}/g)];
    const lastRun = runs[runs.length - 1];
    if (lastRun === undefined) {
      ctx.err(`mktemp: too few X's in template '${template}'`);
      ctx.exit(1);
      return;
    }
    const defaulted = operands[0] === undefined && values.get('-p') === undefined;
    if (!template.includes('/')) {
      // No directory in the template: GNU uses TMPDIR (here always /tmp);
      // the bare VFS starts empty, so the default parent is provisioned.
      template = `${(values.get('-p') ?? '/tmp').replace(/\/+$/, '')}/${template}`;
      if (defaulted && ctx.vfs.nodeAt('/tmp') === null) ctx.vfs.mkdir('/tmp');
    }
    const dir = flags.has('-d');
    for (let attempt = 0; attempt < 100; attempt++) {
      const made = template.replace(lastRun[0], () => {
        let suffix = '';
        for (let i = 0; i < lastRun[0].length; i++) {
          suffix += TEMP_CHARS[Math.floor(Math.random() * TEMP_CHARS.length)];
        }
        return suffix;
      });
      const abs = resolve(ctx, made);
      if (ctx.vfs.nodeAt(abs) !== null) continue;
      const parent = ctx.vfs.nodeAt(ctx.vfs.resolve(abs, '..'));
      if (parent?.kind !== 'dir') {
        ctx.err(`mktemp: Failed to create file via template '${template}': No such file or directory`);
        ctx.exit(1);
        return;
      }
      if (dir) ctx.vfs.mkdir(abs);
      else ctx.vfs.touch(abs);
      ctx.out(abs);
      return;
    }
    ctx.err(`mktemp: Failed to create file via template '${template}': Too many links`);
    ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * type — how the shell resolves a word
 * ------------------------------------------------------------------ */

const type: CommandSpec = {
  name: 'type',
  usage: usageOf('type'),
  complete: (ctx) => ['-a', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'type', ctx.args, { flagLetters: 'a' });
    if (parsed === null) return;
    const { operands } = parsed;
    if (flagsHelp(operands, parsed.flags)) {
      for (const line of [
        usageOf('type'),
        '',
        "Prints what the shell would run for each NAME: an alias",
        "('NAME is aliased to `expansion`') and/or a registered",
        'command ("NAME is a shell command (usage)"). -a lists every',
        'resolution; unknown names exit 1.',
      ]) ctx.out(line);
      return;
    }
    if (operands.length === 0) {
      ctx.err('type: missing operand');
      ctx.exit(1);
      return;
    }
    let failed = false;
    for (const name of operands) {
      const alias = ctx.state.aliases[name];
      const command = ctx.commands.get(name);
      if (alias !== undefined) ctx.out(`${name} is aliased to \`${alias}\``);
      if (command !== undefined) ctx.out(`${name} is a shell command (${command.usage})`);
      if (alias === undefined && command === undefined) {
        ctx.err(`type: ${name}: not found`);
        failed = true;
      }
    }
    if (failed) ctx.exit(1);
  },
};

const flagsHelp = (operands: string[], flags: Set<string>): boolean =>
  flags.has('--help') && operands.length === 0;

/* ------------------------------------------------------------------ *
 * date
 * ------------------------------------------------------------------ */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface DateParts {
  y: number; m: number; d: number; h: number; min: number; s: number; w: number;
}

function dateParts(date: Date, utc: boolean): DateParts {
  const g = utc
    ? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCDay()]
    : [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getDay()];
  return { y: g[0]!, m: g[1]!, d: g[2]!, h: g[3]!, min: g[4]!, s: g[5]!, w: g[6]! };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function tzName(utc: boolean): string {
  if (utc) return 'UTC';
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Local';
  } catch {
    return 'Local';
  }
}

function formatDateTime(date: Date, utc: boolean, fmt: string): string {
  const p = dateParts(date, utc);
  const startOfYear = utc ? Date.UTC(p.y, 0, 1) : new Date(p.y, 0, 1).getTime();
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const offsetMin = utc ? 0 : -date.getTimezoneOffset();
  const offSign = offsetMin < 0 ? '-' : '+';
  const offAbs = Math.abs(offsetMin);
  const hh12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const specs: Record<string, string> = {
    Y: String(p.y),
    C: pad2(Math.floor(p.y / 100)),
    y: pad2(p.y % 100),
    m: pad2(p.m + 1),
    d: pad2(p.d),
    e: String(p.d).padStart(2, ' '),
    H: pad2(p.h),
    I: pad2(hh12),
    M: pad2(p.min),
    S: pad2(p.s),
    p: p.h < 12 ? 'AM' : 'PM',
    P: p.h < 12 ? 'am' : 'pm',
    a: DAYS[p.w]!,
    A: DAYS_LONG[p.w]!,
    b: MONTHS[p.m]!,
    h: MONTHS[p.m]!,
    B: MONTHS_LONG[p.m]!,
    j: String(dayOfYear).padStart(3, '0'),
    u: String(p.w === 0 ? 7 : p.w),
    w: String(p.w),
    Z: tzName(utc),
    z: `${offSign}${pad2(Math.floor(offAbs / 60))}${pad2(offAbs % 60)}`,
    s: String(Math.floor(date.getTime() / 1000)),
    n: '\n',
    t: '\t',
    '%': '%',
    F: `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`,
    T: `${pad2(p.h)}:${pad2(p.min)}:${pad2(p.s)}`,
    D: `${pad2(p.m + 1)}/${pad2(p.d)}/${pad2(p.y % 100)}`,
    R: `${pad2(p.h)}:${pad2(p.min)}`,
    c: `${DAYS[p.w]} ${MONTHS[p.m]} ${pad2(p.d)} ${pad2(p.h)}:${pad2(p.min)}:${pad2(p.s)} ${p.y}`,
    x: `${pad2(p.m + 1)}/${pad2(p.d)}/${pad2(p.y % 100)}`,
    X: `${pad2(p.h)}:${pad2(p.min)}:${pad2(p.s)}`,
  };
  let out = '';
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== '%') {
      out += fmt[i];
      continue;
    }
    const spec = fmt[i + 1];
    if (spec === undefined) {
      out += '%';
      break;
    }
    out += specs[spec] ?? `%${spec}`;
    i++;
  }
  return out;
}

/** Date-only strings parse as UTC midnight in every mode (documented);
 *  date-times parse as UTC under -u and local otherwise, like GNU. */
function parseDateArg(text: string, utc: boolean): Date | null {
  if (text === 'now') return new Date();
  const epoch = /^@(-?\d+)$/.exec(text);
  if (epoch !== null) return new Date(Number(epoch[1]) * 1000);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/.exec(text);
  if (iso !== null) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const d = Number(iso[3]);
    if (iso[4] === undefined) return new Date(Date.UTC(y, mo, d));
    const h = Number(iso[4]);
    const mi = Number(iso[5]);
    const s = Number(iso[6] ?? 0);
    return utc ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s);
  }
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (slash !== null) return new Date(Date.UTC(Number(slash[1]), Number(slash[2]) - 1, Number(slash[3])));
  return null;
}

const date: CommandSpec = {
  name: 'date',
  usage: usageOf('date'),
  complete: (ctx) => ['-u', '-d', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'date', ctx.args, { flagLetters: 'u', valueLetters: 'd' });
    if (parsed === null) return;
    const { flags, values, operands } = parsed;
    if (operands.length === 0 && flags.has('--help')) {
      ctx.out(usageOf('date'));
      return;
    }
    const utc = flags.has('-u');
    let when = new Date();
    if (values.has('-d')) {
      const text = values.get('-d')!;
      const parsedDate = parseDateArg(text, utc);
      if (parsedDate === null || Number.isNaN(parsedDate.getTime())) {
        ctx.err(`date: invalid date '${text}'`);
        ctx.exit(1);
        return;
      }
      when = parsedDate;
    }
    const formatArg = operands.find((op) => op.startsWith('+'));
    if (formatArg !== undefined) {
      ctx.out(formatDateTime(when, utc, formatArg.slice(1)));
      return;
    }
    const p = dateParts(when, utc);
    ctx.out(`${DAYS[p.w]} ${MONTHS[p.m]} ${pad2(p.d)} ${pad2(p.h)}:${pad2(p.min)}:${pad2(p.s)} ${tzName(utc)} ${p.y}`);
  },
};

/* ------------------------------------------------------------------ *
 * cal
 * ------------------------------------------------------------------ */

function monthLines(year: number, month: number): string[] {
  const title = `${MONTHS_LONG[month]!} ${year}`;
  const lines = [' '.repeat(Math.max(0, Math.floor((20 - title.length) / 2))) + title, 'Su Mo Tu We Th Fr Sa'];
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let cells = '   '.repeat(firstDay);
  for (let day = 1; day <= days; day++) {
    cells += String(day).padStart(2, ' ') + (day === days || (firstDay + day) % 7 === 0 ? '' : ' ');
    if ((firstDay + day) % 7 === 0 && day !== days) {
      lines.push(cells.replace(/\s+$/, ''));
      cells = '';
    }
  }
  if (cells !== '') lines.push(cells.replace(/\s+$/, ''));
  return lines;
}

function yearLines(year: number): string[] {
  const out = [String(year).padStart(31)];
  for (let row = 0; row < 4; row++) {
    const months = [0, 1, 2].map((i) => monthLines(year, row * 3 + i));
    const height = Math.max(...months.map((m) => m.length));
    out.push(months.map((m) => (m[0] ?? '').padEnd(20)).join('  ').replace(/\s+$/, ''));
    out.push(months.map((m) => (m[1] ?? '').padEnd(20)).join('  ').replace(/\s+$/, ''));
    for (let line = 2; line < height; line++) {
      out.push(months.map((m) => (m[line] ?? '').padEnd(20)).join('  ').replace(/\s+$/, ''));
    }
  }
  return out;
}

function parseMonth(word: string): number | null {
  if (/^\d{1,2}$/.test(word)) {
    const n = Number(word);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  const lower = word.toLowerCase();
  if (lower.length >= 3) {
    const byName = MONTHS_LONG.findIndex((m) => m.toLowerCase().startsWith(lower));
    if (byName !== -1) return byName;
  }
  const byShort = MONTHS.findIndex((m) => m.toLowerCase() === lower);
  if (byShort !== -1) return byShort;
  return null;
}

const cal: CommandSpec = {
  name: 'cal',
  usage: usageOf('cal'),
  run(ctx: CommandContext): void {
    const operands = ctx.args.filter((a) => a !== '--help');
    if (ctx.args.includes('--help')) {
      ctx.out(usageOf('cal'));
      return;
    }
    const now = new Date();
    if (operands.length === 0) {
      for (const line of monthLines(now.getFullYear(), now.getMonth())) ctx.out(line);
      return;
    }
    if (operands.length === 1) {
      const word = operands[0]!;
      if (/^\d{3,}$/.test(word) && Number(word) >= 1000) {
        for (const line of yearLines(Number(word))) ctx.out(line);
        return;
      }
      const month = parseMonth(word);
      if (month === null) {
        ctx.err(`cal: invalid month: '${word}'`);
        ctx.exit(1);
        return;
      }
      for (const line of monthLines(now.getFullYear(), month)) ctx.out(line);
      return;
    }
    const month = parseMonth(operands[0]!);
    if (month === null) {
      ctx.err(`cal: invalid month: '${operands[0]}'`);
      ctx.exit(1);
      return;
    }
    const year = Number(operands[1]);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      ctx.err(`cal: invalid year: '${operands[1]}'`);
      ctx.exit(1);
      return;
    }
    for (const line of monthLines(year, month)) ctx.out(line);
  },
};

/* ------------------------------------------------------------------ *
 * sleep — validates the duration; the sync core cannot block
 * ------------------------------------------------------------------ */

const sleep: CommandSpec = {
  name: 'sleep',
  usage: usageOf('sleep'),
  run(ctx: CommandContext): void {
    const operands = ctx.args.filter((a) => a !== '--help');
    if (ctx.args.includes('--help')) {
      for (const line of [
        usageOf('sleep'),
        '',
        'Accepts the GNU spellings (decimals, s/m/h/d suffixes) and',
        'then RETURNS AT ONCE: the shell executes commands',
        'synchronously (CORE-V2), so blocking would freeze the tab.',
      ]) ctx.out(line);
      return;
    }
    if (operands.length === 0) {
      ctx.err('sleep: missing operand');
      gnuHint(ctx, 'sleep');
      ctx.exit(1);
      return;
    }
    for (const op of operands) {
      if (!/^\d+(?:\.\d+)?[smhd]?$/.test(op)) {
        ctx.err(`sleep: invalid time interval '${op}'`);
        ctx.exit(1);
        return;
      }
    }
    // Validated. There is no yield point to sleep across (CORE-V2).
  },
};

/* ------------------------------------------------------------------ *
 * seq
 * ------------------------------------------------------------------ */

const SEQ_LIMIT = 100_000;

function numStr(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

function fmtFloat(fmt: string, n: number): string | null {
  const m = /^%[+-]?(?:(\d+)(?:\.(\d+))?)?[gfe]$/.exec(fmt);
  if (m === null) return null;
  const width = Number(m[1] ?? 0);
  const prec = Number(m[2] ?? 6);
  const kind = fmt.charAt(fmt.length - 1);
  const body = kind === 'f' ? n.toFixed(prec) : kind === 'e' ? n.toExponential(prec) : numStr(n);
  return width > body.length ? body.padStart(width, ' ') : body;
}

const seq: CommandSpec = {
  name: 'seq',
  usage: usageOf('seq'),
  complete: (ctx) => ['-w', '-f', '-s', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const parsed = walkArgs(ctx, 'seq', ctx.args, { flagLetters: 'w', valueLetters: 'fs' });
    if (parsed === null) return;
    const { flags, values, operands } = parsed;
    if (operands.length === 0 && flags.has('--help')) {
      ctx.out(usageOf('seq'));
      return;
    }
    if (operands.length === 0 || operands.length > 3) {
      ctx.err(operands.length === 0 ? 'seq: missing operand' : `seq: extra operand '${operands[3]}'`);
      ctx.exit(1);
      return;
    }
    const nums = operands.map((op) => {
      const n = Number(op);
      if (op === '' || Number.isNaN(n)) {
        ctx.err(`seq: invalid floating point argument '${op}'`);
        ctx.exit(1);
        return null;
      }
      return n;
    });
    if (nums.some((n) => n === null)) return;
    const [first, incr, last] =
      nums.length === 1 ? [1, 1, nums[0]!] : nums.length === 2 ? [nums[0]!, 1, nums[1]!] : [nums[0]!, nums[1]!, nums[2]!];
    if (incr === 0) {
      ctx.err("seq: invalid Zero increment value: '0'");
      ctx.exit(1);
      return;
    }
    const format = values.get('-f');
    if (format !== undefined && fmtFloat(format, first) === null) {
      ctx.err(`seq: invalid format '${format}'`);
      ctx.exit(1);
      return;
    }
    // -w equalizes total field width (sign included) to the widest
    // operand's formatted length — our documented reading of GNU's rule.
    const fieldWidth = Math.max(numStr(first).length, numStr(last).length);
    const render = (n: number): string => {
      if (format !== undefined) return fmtFloat(format, n)!;
      const text = numStr(n);
      const [intPart, fracPart] = text.split('.');
      const signed = intPart!.startsWith('-');
      const intDigits = signed ? intPart!.slice(1) : intPart!;
      const target = Math.max(
        1,
        fieldWidth - (signed ? 1 : 0) - (fracPart !== undefined ? fracPart.length + 1 : 0),
      );
      return (signed ? '-' : '') + intDigits.padStart(target, '0') + (fracPart !== undefined ? '.' + fracPart : '');
    };
    const separator = values.get('-s') ?? '\n';
    const perLine = separator === '\n';
    let emitted = '';
    const emit = (n: number): void => {
      if (perLine) ctx.out(render(n));
      else emitted = emitted === '' ? render(n) : emitted + separator + render(n);
    };
    let count = 0;
    const limit = last + Number.EPSILON * Math.abs(last);
    const floor = last - Number.EPSILON * Math.abs(last);
    if (incr > 0) {
      for (let n = first; n <= limit; n += incr) {
        if (++count > SEQ_LIMIT) return seqOverflow(ctx);
        emit(n);
      }
    } else {
      for (let n = first; n >= floor; n += incr) {
        if (++count > SEQ_LIMIT) return seqOverflow(ctx);
        emit(n);
      }
    }
    if (!perLine && emitted !== '') ctx.out(emitted);
  },
};

function seqOverflow(ctx: CommandContext): void {
  ctx.err(`seq: output limit reached (${SEQ_LIMIT} lines); the sync shell would wedge on more`);
  ctx.exit(1);
}

/* ------------------------------------------------------------------ *
 * yes — bounded emission (the sync core cannot be interrupted)
 * ------------------------------------------------------------------ */

const YES_BUDGET = 1000;

const yes: CommandSpec = {
  name: 'yes',
  usage: usageOf('yes'),
  run(ctx: CommandContext): void {
    if (ctx.args.includes('--help')) {
      for (const line of [
        usageOf('yes'),
        '',
        'Prints STRING (default y) repeatedly — capped at 1000 lines:',
        'stages run synchronously on buffered strings, so a true',
        'infinite stream would hang the browser.',
      ]) ctx.out(line);
      return;
    }
    const operands = ctx.args.filter((a) => a !== '--help');
    const line = operands.length > 0 ? operands.join(' ') : 'y';
    for (let i = 0; i < YES_BUDGET; i++) ctx.out(line);
    ctx.err(`yes: emission budget reached (${YES_BUDGET} lines) — the sync shell cannot stream forever`);
    ctx.exit(0);
  },
};

/* ------------------------------------------------------------------ *
 * expr — GNU expr does no getopt; args are expression tokens
 * ------------------------------------------------------------------ */

const isIntegerText = (text: string): boolean => /^[+-]?\d+$/.test(text.trim());

function exprRegex(pattern: string): RegExp | null {
  // BRE-flavoured: \( \) are capture groups, bare ( ) are literals;
  // matching is anchored at the start, like GNU expr.
  const js = pattern.replace(/\\\(/g, '§').replace(/\\\)/g, '¥').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/§/g, '(').replace(/¥/g, ')');
  try {
    return new RegExp('^' + js);
  } catch {
    return null;
  }
}

function exprMatch(value: string, pattern: string): string {
  const re = exprRegex(pattern);
  if (re === null) throw new Error('Invalid regular expression');
  const m = re.exec(value);
  if (m === null) return '0';
  return m[1] !== undefined ? m[1] : String(m[0].length);
}

function exprEval(tokens: string[]): string {
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string => tokens[pos++] ?? '';

  const parseOr = (): string => {
    let left = parseAnd();
    while (peek() === '|') {
      next();
      const right = parseAnd();
      left = left !== '' && left !== '0' ? left : right;
    }
    return left;
  };
  const parseAnd = (): string => {
    let left = parseCompare();
    while (peek() === '&') {
      next();
      const right = parseCompare();
      left = left !== '' && left !== '0' && right !== '' && right !== '0' ? left : '0';
    }
    return left;
  };
  const parseCompare = (): string => {
    let left = parseAdd();
    while (['=', '==', '!=', '<', '<=', '>', '>='].includes(peek() ?? '')) {
      const op = next();
      const right = parseAdd();
      const numeric = isIntegerText(left) && isIntegerText(right);
      const a: number | string = numeric ? Number(left.trim()) : left;
      const b: number | string = numeric ? Number(right.trim()) : right;
      const result =
        op === '=' || op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
      left = result ? '1' : '0';
    }
    return left;
  };
  const parseAdd = (): string => {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rightText = parseMul();
      if (!isIntegerText(left) || !isIntegerText(rightText)) throw new Error('non-integer argument');
      const a = Number(left.trim());
      const b = Number(rightText.trim());
      left = String(op === '+' ? a + b : a - b);
    }
    return left;
  };
  const parseMul = (): string => {
    let left = parseMatch();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const rightText = parseMatch();
      if (!isIntegerText(left) || !isIntegerText(rightText)) throw new Error('non-integer argument');
      const a = Number(left.trim());
      const b = Number(rightText.trim());
      if ((op === '/' || op === '%') && b === 0) throw new Error('division by zero');
      left = String(op === '*' ? a * b : op === '/' ? Math.trunc(a / b) : a - Math.trunc(a / b) * b);
    }
    return left;
  };
  const parseMatch = (): string => {
    let left = parsePrimary();
    while (peek() === ':' || peek() === 'match') {
      next();
      const pattern = parsePrimary();
      left = exprMatch(left, pattern);
    }
    return left;
  };
  const parsePrimary = (): string => {
    const token = next();
    if (token === '') throw new Error('syntax error');
    if (token === '(') {
      const value = parseOr();
      if (next() !== ')') throw new Error('syntax error');
      return value;
    }
    if (token === 'length') return String([...parsePrimary()].length);
    if (token === 'match') {
      const value = parsePrimary();
      const pattern = parsePrimary();
      return exprMatch(value, pattern);
    }
    if (token === 'substr') {
      const value = parsePrimary();
      const startText = parsePrimary();
      const lenText = parsePrimary();
      if (!isIntegerText(startText) || !isIntegerText(lenText)) throw new Error('non-integer argument');
      const chars = [...value];
      const start = Number(startText.trim());
      const len = Number(lenText.trim());
      const from = Math.max(0, start - 1);
      return chars.slice(from, from + Math.max(0, len)).join('');
    }
    if (token === 'index') {
      const value = parsePrimary();
      const charsText = parsePrimary();
      const idx = [...value].findIndex((ch) => [...charsText].includes(ch));
      return String(idx + 1);
    }
    if (['|', '&', ')', ':'].includes(token)) throw new Error('syntax error');
    return token;
  };
  const value = parseOr();
  if (pos < tokens.length) throw new Error('syntax error');
  return value;
}

const expr: CommandSpec = {
  name: 'expr',
  usage: usageOf('expr'),
  run(ctx: CommandContext): void {
    if (ctx.args.includes('--help')) {
      for (const line of [
        usageOf('expr'),
        '',
        'Integer arithmetic (+ - * / %), comparisons, | & with GNU',
        'precedence and ( ) grouping; string ops length, substr,',
        'index, match and TOKEN : REGEX (BRE, anchored). Exit 0 when',
        'the value is non-null and non-zero, 1 otherwise, 2 on errors.',
      ]) ctx.out(line);
      return;
    }
    const operands = ctx.args; // expression tokens — no option parsing
    if (operands.length === 0) {
      ctx.err('expr: syntax error');
      ctx.exit(2);
      return;
    }
    let value: string;
    try {
      value = exprEval(operands);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      ctx.err(message === 'non-integer argument' ? 'expr: non-integer argument'
        : message === 'division by zero' ? 'expr: division by zero'
        : message === 'Invalid regular expression' ? 'expr: Invalid regular expression'
        : 'expr: syntax error');
      ctx.exit(2);
      return;
    }
    ctx.out(value);
    ctx.exit(value !== '' && value !== '0' ? 0 : 1);
  },
};

/* ------------------------------------------------------------------ *
 * test — condition evaluation ([ cannot register: NAME_PATTERN)
 * ------------------------------------------------------------------ */

function testPath(ctx: CommandContext, op: string, path: string): boolean {
  const node = ctx.vfs.nodeAt(resolve(ctx, path));
  switch (op) {
    case '-e':
      return node !== null;
    case '-f':
      return node?.kind === 'file';
    case '-d':
      return node?.kind === 'dir';
    case '-s':
      return node?.kind === 'file' && byteLength(node.content) > 0;
    case '-r':
      return node !== null;
    case '-w': {
      if (node === null) return false;
      const backend = ctx.vfs.backendFor(resolve(ctx, path));
      return backend === null || backend.writable;
    }
    case '-x':
      return node?.kind === 'dir'; // traversal only — no exec bits exist
    default:
      return false;
  }
}

function testEval(ctx: CommandContext, tokens: string[]): boolean {
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  /** Consume one token; empty strings are VALID operands ('test -z ''), a
   *  missing one is the error. */
  const take = (): string => {
    if (pos >= tokens.length) throw new Error('argument expected');
    return tokens[pos++]!;
  };
  const parseOr = (): boolean => {
    let left = parseAnd();
    while (peek() === '-o') {
      next();
      left = parseAnd() || left;
    }
    return left;
  };
  const parseAnd = (): boolean => {
    let left = parseNot();
    while (peek() === '-a') {
      next();
      left = parseNot() && left;
    }
    return left;
  };
  const parseNot = (): boolean => {
    if (peek() === '!') {
      next();
      return !parseNot();
    }
    return parsePrimary();
  };
  const parsePrimary = (): boolean => {
    const token = take();
    if (token === '(') {
      const value = parseOr();
      if (pos >= tokens.length || tokens[pos++] !== ')') throw new Error("')' expected");
      return value;
    }
    const second = peek();
    if (second !== undefined && ['=', '!='].includes(second)) {
      next();
      const right = take();
      return second === '=' ? token === right : token !== right;
    }
    if (second !== undefined && ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(second)) {
      next();
      const right = take();
      if (!/^[+-]?\d+$/.test(token) || !/^[+-]?\d+$/.test(right)) throw new Error('integer expression expected');
      const a = Number(token);
      const b = Number(right);
      return second === '-eq' ? a === b : second === '-ne' ? a !== b : second === '-lt' ? a < b : second === '-le' ? a <= b : second === '-gt' ? a > b : a >= b;
    }
    // Unary file operators lead their operand (token, not second).
    if (['-e', '-f', '-d', '-s', '-r', '-w', '-x'].includes(token)) {
      return testPath(ctx, token, take());
    }
    if (['-z', '-n'].includes(token)) {
      const value = take();
      return token === '-z' ? value === '' : value !== '';
    }
    if (second !== undefined && second.startsWith('-')) {
      throw new Error(`${second}: unary operator expected`);
    }
    return token !== ''; // POSIX: one arg is true when it is non-null
  };
  const next = (): string => tokens[pos++] ?? '';
  const result = parseOr();
  if (pos < tokens.length) throw new Error('too many arguments');
  return result;
}

const test: CommandSpec = {
  name: 'test',
  usage: usageOf('test'),
  complete: (ctx) => ['-e', '-f', '-d', '-z', '-n', '--help'].filter((f) => f.startsWith(ctx.word)),
  run(ctx: CommandContext): void {
    const operands = ctx.args.filter((a) => a !== '--help');
    if (ctx.args.includes('--help') && operands.length === 0) {
      for (const line of [
        usageOf('test'),
        '',
        'File tests: -e -f -d -s, plus -r (exists), -w (backend',
        'writable) and -x (directories only). Strings: -z -n, = !=.',
        'Integers: -eq -ne -lt -le -gt -ge. Connectives: ! -a -o ( ).',
        'Exit 0 true / 1 false / 2 error. `[` cannot be registered.',
      ]) ctx.out(line);
      return;
    }
    if (operands.length === 0) {
      ctx.exit(1); // bare `test` is false, per POSIX
      return;
    }
    let result: boolean;
    try {
      result = testEval(ctx, operands);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      ctx.err(`test: ${message}`);
      ctx.exit(2);
      return;
    }
    ctx.exit(result ? 0 : 1);
  },
};

/* ------------------------------------------------------------------ *
 * exports
 * ------------------------------------------------------------------ */

export const commands: CommandSpec[] = [
  mv, ln, chmod, stat, tree, du, df, file, realpath, basename, dirname,
  mktemp, readlink, type, date, cal, sleep, seq, yes, expr, test,
];

export default commands;

export const manPages: Record<string, string[]> = {
  mv: [
    'MV(1)                     semtext-sh manual',
    '',
    'NAME',
    '     mv — move (rename) files',
    '',
    'SYNOPSIS',
    '     mv [-fnv] SOURCE... DEST',
    '',
    'DESCRIPTION',
    '     Renames SOURCE, or moves every SOURCE into an existing DEST',
    '     directory. -n skips existing destinations (no prompts exist,',
    "     so -f is a no-op); -v prints each move as 'src -> dst'.",
    '     Errors match GNU mv wording; exit 1 on any failure. A chmod',
    '     mode travels with the node.',
  ],
  ln: [
    'LN(1)                     semtext-sh manual',
    '',
    'NAME',
    '     ln — create links (NOT SUPPORTED by this VFS)',
    '',
    'SYNOPSIS',
    '     ln [-sf] TARGET... LINK',
    '',
    'DESCRIPTION',
    "     The VFS node model is 'file | dir' only: there are no symlink",
    '     or inode hard links to create. ln validates its operands',
    '     (missing operands error GNU-style) and then reports',
    "     'Operation not supported' with exit 1. -s/-f pick the wording.",
    '     See readlink for the matching resolution command.',
  ],
  chmod: [
    'CHMOD(1)                  semtext-sh manual',
    '',
    'NAME',
    '     chmod — change file mode bits (session-scoped)',
    '',
    'SYNOPSIS',
    '     chmod [-R] OCTAL-MODE FILE...',
    '',
    'DESCRIPTION',
    '     Records an octal mode (0644-style, 3-4 digits) per path in a',
    '     SESSION-SCOPED map: the VFS has no permission metadata, so',
    '     modes reset when the chunk reloads and never persist to a',
    '     backend. stat shows the recorded value; ls does not. -R',
    "     recurses. Symbolic modes ('u+x') are not implemented and",
    '     error honestly. Defaults: files 0644, directories 0755.',
  ],
  stat: [
    'STAT(1)                   semtext-sh manual',
    '',
    'NAME',
    '     stat — display file status',
    '',
    'SYNOPSIS',
    '     stat FILE...',
    '',
    'DESCRIPTION',
    '     Per operand: the resolved path, Size in bytes (directories',
    '     report the conventional 4096), Kind, the access mode',
    '     (chmod-recorded or the 0644/0755 default, with an rwx',
    '     rendering) and the VFS backend that would persist it (memory',
    '     means the plain in-tree VFS). No timestamps exist: the VFS',
    '     stores none. Exit 1 if any operand is missing.',
  ],
  tree: [
    'TREE(1)                   semtext-sh manual',
    '',
    'NAME',
    '     tree — list contents of directories in a tree-like format',
    '',
    'SYNOPSIS',
    '     tree [-ad] [-L LEVEL] [DIR...]',
    '',
    'DESCRIPTION',
    '     Recursively lists each DIR (default .) with box-drawing',
    '     branches and a summary line. Dot entries are hidden until -a;',
    '     -d lists directories only; -L LEVEL caps the depth (1 =',
    '     immediate children). Children sort with localeCompare;',
    '     directories print a trailing slash.',
  ],
  du: [
    'DU(1)                     semtext-sh manual',
    '',
    'NAME',
    '     du — estimate file space usage',
    '',
    'SYNOPSIS',
    '     du [-ash] [FILE|DIR...]',
    '',
    'DESCRIPTION',
    '     Sums content bytes. Unlike GNU du there are no disk blocks:',
    '     plain numbers are BYTES (GNU defaults to 1K blocks — this man',
    '     page is the contract). Without -s every subdirectory of each',
    '     operand prints post-order, then the operand; -s prints only',
    '     each operand total; -a also lists files; -h humanizes (K/M/G,',
    '     powers of 1024).',
  ],
  df: [
    'DF(1)                     semtext-sh manual',
    '',
    'NAME',
    '     df — report mounted-backend usage',
    '',
    'SYNOPSIS',
    '     df [-h] [PATH...]',
    '',
    'DESCRIPTION',
    '     One line per mounted VFS backend (or the backend covering',
    '     each PATH): its id, Used bytes of the subtree under its',
    "     mountpoint, and '-' for Avail and Capacity — no backend",
    '     exposes a quota, and guessing would be dishonest. memory',
    '     names the plain in-tree VFS when nothing is mounted. -h',
    '     humanizes the Used column.',
  ],
  file: [
    'FILE(1)                   semtext-sh manual',
    '',
    'NAME',
    '     file — determine file type by content',
    '',
    'SYNOPSIS',
    '     file [-b] [FILE...]        (- reads piped stdin)',
    '',
    'DESCRIPTION',
    '     Magic-sniffs each file: PNG (with dimensions), gzip, Zip,',
    '     POSIX tar (ustar), XML, HTML vs SemText HTML (<sem- elements',
    '     or a .sem.html name), JSON, shebang scripts, data (NUL',
    '     bytes), and ASCII/UTF-8 text (noting CRLF or a missing final',
    '     newline). Missing files and directories report on stderr',
    '     like GNU file and leave the exit status 0. -b omits the',
    '     filename prefix.',
  ],
  realpath: [
    'REALPATH(1)               semtext-sh manual',
    '',
    'NAME',
    '     realpath — print the resolved absolute path',
    '',
    'SYNOPSIS',
    '     realpath FILE...',
    '',
    'DESCRIPTION',
    '     Normalizes each operand against the cwd (.., ., duplicate',
    '     slashes) and prints it. Every operand must exist — there are',
    '     no symlinks to resolve (the VFS has none), so pure string',
    '     normalization is the whole truth. Missing operands report',
    '     GNU-style and exit 1.',
  ],
  basename: [
    'BASENAME(1)               semtext-sh manual',
    '',
    'NAME',
    '     basename — strip directory and suffix from a name',
    '',
    'SYNOPSIS',
    '     basename NAME [SUFFIX]',
    '     basename -a NAME...   /   basename -s SUFFIX NAME...',
    '',
    'DESCRIPTION',
    '     Prints the final path segment, trailing slashes removed',
    "     ('/' stays '/'). A SUFFIX operand (or -s) is stripped only",
    '     when the result stays non-empty. -a treats every operand as',
    '     a name. Extra operands without -a error, exit 1.',
  ],
  dirname: [
    'DIRNAME(1)                semtext-sh manual',
    '',
    'NAME',
    '     dirname — strip the last segment from a name',
    '',
    'SYNOPSIS',
    '     dirname NAME...',
    '',
    'DESCRIPTION',
    '     Prints each name with its final segment and any trailing',
    "     slashes removed ('a/b/' -> 'a', 'x' -> '.', '/a' -> '/',",
    "     '/' -> '/'). Every operand is processed, like GNU dirname.",
  ],
  mktemp: [
    'MKTEMP(1)                 semtext-sh manual',
    '',
    'NAME',
    '     mktemp — create a temporary file or directory',
    '',
    'SYNOPSIS',
    '     mktemp [-d] [-p DIR] [TEMPLATE]',
    '',
    'DESCRIPTION',
    '     Creates a uniquely named empty file (or directory with -d)',
    "     and prints its path. TEMPLATE needs a run of six or more X's",
    '     (default tmp.XXXXXXXXXX, created under /tmp when it names no',
    '     directory); the last X-run is replaced with random',
    '     [a-zA-Z0-9]. -p DIR supplies the base directory for bare',
    '     templates.',
  ],
  readlink: [
    'READLINK(1)               semtext-sh manual',
    '',
    'NAME',
    '     readlink — resolve links (the VFS has none)',
    '',
    'SYNOPSIS',
    '     readlink [-f] FILE...',
    '',
    'DESCRIPTION',
    "     Without -f: every operand reports 'not a symbolic link' —",
    '     this VFS stores no symlink nodes, so nothing can ever be one.',
    '     With -f: prints the canonicalized absolute path (no symlink',
    '     step to resolve); every component but the last must exist,',
    "     else 'No such file or directory'.",
  ],
  type: [
    'TYPE(1)                   semtext-sh manual',
    '',
    'NAME',
    '     type — how the shell resolves a command word',
    '',
    'SYNOPSIS',
    '     type [-a] NAME...',
    '',
    'DESCRIPTION',
    '     For each NAME prints what the shell would run: an alias',
    "     ('NAME is aliased to `expansion`') and/or a registered",
    '     command ("NAME is a shell command (usage)"). -a lists every',
    '     resolution. Unknown names report "type: NAME: not found" and',
    '     exit 1. See also which (posix plugin) for the terse form.',
  ],
  date: [
    'DATE(1)                   semtext-sh manual',
    '',
    'NAME',
    '     date — print or format the system date and time',
    '',
    'SYNOPSIS',
    '     date [-u] [-d DATE] [+FORMAT]',
    '',
    'DESCRIPTION',
    '     Prints the current time (local, or UTC with -u) GNU-style,',
    '     or formats with +FORMAT (strftime subset: %Y %C %y %m %d %e',
    '     %H %I %M %S %p %P %a %A %b %B %h %j %u %w %Z %z %s %n %t %%',
    '     %F %T %D %R %c %x %X; unknown specs pass through). -d parses',
    "     'now', '@epoch', ISO 'YYYY-MM-DD[ HH:MM[:SS]]' and",
    "     'YYYY/MM/DD'. Date-only strings parse as UTC midnight;",
    '     date-times parse as UTC under -u, local time otherwise.',
  ],
  cal: [
    'CAL(1)                    semtext-sh manual',
    '',
    'NAME',
    '     cal — print a calendar',
    '',
    'SYNOPSIS',
    '     cal [[MONTH] YEAR]   (also: cal YEAR — a full-year sheet)',
    '',
    'DESCRIPTION',
    '     Sunday-first month grid: the current month with no operands;',
    '     one numeric operand of 3+ digits (>= 1000) is a YEAR sheet,',
    '     otherwise a month of the current year; MONTH may be 1-12 or',
    "     a name ('October', 'oct', 3+ letters). Weeks start",
    "     'Su Mo Tu We Th Fr Sa'. The BSD today-highlight needs markup",
    '     this transcript does not have, so it is omitted.',
  ],
  sleep: [
    'SLEEP(1)                  semtext-sh manual',
    '',
    'NAME',
    '     sleep — validate a duration (does not block)',
    '',
    'SYNOPSIS',
    '     sleep SECONDS[s|m|h|d]...',
    '',
    'DESCRIPTION',
    '     Accepts the GNU spellings (decimals, s/m/h/d suffixes,',
    '     several operands; errors match GNU) and then RETURNS AT ONCE:',
    '     the shell executes commands synchronously (CORE-V2), so',
    '     there is no yield point to sleep across — blocking would',
    '     freeze the browser tab. Scripts can rely on validation, not',
    '     on time passing.',
  ],
  seq: [
    'SEQ(1)                    semtext-sh manual',
    '',
    'NAME',
    '     seq — print a sequence of numbers',
    '',
    'SYNOPSIS',
    '     seq [-w] [-f FMT] [-s SEP] [FIRST [INCR]] LAST',
    '',
    'DESCRIPTION',
    '     Floats supported; INCR may be negative (never 0). -s joins',
    '     with a custom separator (default newline); -w zero-pads the',
    '     integer part to the widest operand; -f takes a printf float',
    '     form (%[+-][width][.prec] f/g/e). GNU differs knowingly:',
    "     output is capped at 100000 lines ('output limit reached',",
    '     exit 1) because the sync shell would wedge materializing',
    '     more.',
  ],
  yes: [
    'YES(1)                    semtext-sh manual',
    '',
    'NAME',
    '     yes — repeat a string (bounded emission)',
    '',
    'SYNOPSIS',
    '     yes [STRING]',
    '',
    'DESCRIPTION',
    '     Prints STRING (default y) repeatedly. KNOWING DEVIATION: the',
    '     emission is capped at 1000 lines with a one-line note — the',
    '     shell runs pipeline stages synchronously on buffered',
    '     strings, so a true infinite stream would hang the browser',
    '     and Ctrl+C could never interrupt it. `yes | head -n 3` still',
    '     demos right.',
  ],
  expr: [
    'EXPR(1)                   semtext-sh manual',
    '',
    'NAME',
    '     expr — evaluate an expression',
    '',
    'SYNOPSIS',
    '     expr EXPRESSION',
    '',
    'DESCRIPTION',
    '     Integer arithmetic (+ - * / %), comparisons (= == != < <= >',
    '     >=), boolean | & with GNU precedence and ( ) grouping',
    '     (shell-escape * and parens). String ops: length, substr S L',
    '     (1-based), index, match TOKEN REGEX and TOKEN : REGEX —',
    '     BRE-anchored, \\( \\) groups capture. Exit 0 when the value',
    '     is non-null and non-zero, 1 otherwise, 2 on errors (syntax',
    '     error, non-integer argument, division by zero).',
  ],
  test: [
    'TEST(1)                   semtext-sh manual',
    '',
    'NAME',
    '     test — evaluate a conditional expression',
    '',
    'SYNOPSIS',
    '     test EXPRESSION',
    '',
    'DESCRIPTION',
    '     Exits 0 (true) / 1 (false) / 2 (error). File tests: -e -f -d',
    '     -s plus -r (exists), -w (backend writable) and -x',
    '     (directories only — no exec bits exist). Strings: -z -n,',
    '     = !=. Integers: -eq -ne -lt -le -gt -ge. Connectives: !, -a,',
    '     -o, ( ). The `[` spelling cannot be registered — the shell',
    '     command-name pattern ([a-z][a-z0-9-]*) rejects it — so test',
    '     is the only form.',
  ],
};

/** The chunk shape, re-exported for loader type checks and tests. */
export const pkg: import('../types.js').PackageModule = { commands, manPages };
