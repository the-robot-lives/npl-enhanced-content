/**
 * posix-sh `find` — walk the virtual file system with a GNU-shaped
 * predicate/action expression. Companion to sed.ts, which composes the
 * plugin's command list (the env-commands pattern: commands.ts stays
 * untouched; the registration line lives in plugin.ts).
 *
 * Fidelity: paths print as given (`.` starts `./…`), GNU preorder by
 * default with -delete flipping to depth-last so children are removed
 * before their parent, fnmatch globs for -name/-iname (leading dots
 * match `*`), -size in 512-byte default blocks with ceil rounding
 * (+n/-n strict), -exec dispatching REGISTERED commands through a child
 * CommandContext (`{}` replaced; bare `;` runs per match, `+` after a
 * lone `{}` batches one invocation), GNU-ish error wording and exit 1
 * on any error.
 *
 * Timestamps: VfsNodes carry no mtimes, so -newer compares a logical
 * write-sequence — noteWrite() bumps a file's rank (sed -i records
 * through it); files never recorded rank oldest. If the Vfs ever grows
 * real times this maps straight onto them.
 */

import type { CommandContext, CommandSpec } from '../../terminal-core.js';
import type { VfsFile, VfsNode } from '../../vfs.js';

/* ------------------------------------------------------------------ *
 * logical mtimes — the -newer write sequence
 * ------------------------------------------------------------------ */

const writeSeq = new WeakMap<VfsFile, number>();
let writes = 0;

/** Record one write to `node` (sed -i does; a future Vfs hook would too). */
export function noteWrite(node: VfsFile): void {
  writeSeq.set(node, ++writes);
}

function mtimeOf(node: VfsNode): number {
  return node.kind === 'file' ? (writeSeq.get(node) ?? 0) : 0;
}

/* ------------------------------------------------------------------ *
 * fnmatch globs (-name / -iname)
 * ------------------------------------------------------------------ */

/** fnmatch → RegExp, full-string: * and ? stop at /, [...] classes, \x literal. */
export function globToRegExp(glob: string, ci = false): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '\\') {
      re += (glob[i + 1] ?? '\\').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (c === '[') {
      let j = i + 1;
      let neg = false;
      if (glob[j] === '!' || glob[j] === '^') {
        neg = true;
        j++;
      }
      if (glob[j] === ']') j++; // a leading ] is a literal member
      while (j < glob.length && glob[j] !== ']') j++;
      if (j >= glob.length) {
        re += '\\['; // unterminated class: literal [
        continue;
      }
      let cls = glob.slice(i + 1, j);
      if (neg) cls = cls.slice(1);
      re += '[' + (neg ? '^' : '') + cls.replace(/[\\]/g, '\\\\') + ']';
      i = j;
    } else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, ci ? 'i' : '');
}

/* ------------------------------------------------------------------ *
 * the expression: predicates and actions, implicit AND, in order
 * ------------------------------------------------------------------ */

interface FindVisit {
  /** The path as printed (starts render as `.`/`./a`, `/docs/a`, `docs/a`). */
  display: string;
  abs: string;
  node: VfsNode;
  depth: number;
}

type FindItem =
  | { kind: 'pred'; flag: string; test: (v: FindVisit) => boolean }
  | { kind: 'print' }
  | { kind: 'delete' }
  | { kind: 'exec'; words: string[]; plus: boolean };

const joinAbs = (base: string, name: string): string => (base === '/' ? `/${name}` : `${base}/${name}`);
const joinDisplay = (base: string, name: string): string =>
  base === '' ? name : base === '/' ? `/${name}` : base === '.' ? `./${name}` : `${base}/${name}`;

/* ------------------------------------------------------------------ *
 * find
 * ------------------------------------------------------------------ */

const findCmd: CommandSpec = {
  name: 'find',
  usage:
    'find [path...] [-name glob] [-type f|d] [-maxdepth n] [-newer f] [-size ±n[bck]] [-print] [-delete] [-exec cmd {} ;]',
  run(ctx) {
    const args = ctx.args;
    const items: FindItem[] = [];
    const starts: string[] = [];
    let maxdepth = Number.MAX_SAFE_INTEGER;
    let mindepth = 0;
    let bad = false;

    const fail = (line: string): void => {
      ctx.err(line);
      bad = true;
    };

    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (!a.startsWith('-')) {
        if (items.length > 0) {
          fail(`find: paths must precede expression: \`${a}\``);
          return;
        }
        starts.push(a);
        continue;
      }
      const next = (): string | null => {
        const v = args[++i];
        if (v === undefined) {
          fail(`find: missing argument to '${a}'`);
          return null;
        }
        return v;
      };
      switch (a) {
        case '-name':
        case '-iname': {
          const glob = next();
          if (glob === null) return;
          let re: RegExp;
          try {
            re = globToRegExp(glob, a === '-iname');
          } catch {
            fail(`find: invalid pattern '${glob}'`);
            return;
          }
          items.push({ kind: 'pred', flag: a, test: (v) => re.test(v.node.name) });
          break;
        }
        case '-type': {
          const t = next();
          if (t === null) return;
          if (t !== 'f' && t !== 'd') {
            fail(`find: invalid argument '${t}' to '-type'`);
            return;
          }
          const want = t === 'f' ? 'file' : 'dir';
          items.push({ kind: 'pred', flag: a, test: (v) => v.node.kind === want });
          break;
        }
        case '-maxdepth':
        case '-mindepth': {
          const raw = next();
          if (raw === null) return;
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0) {
            fail(`find: invalid number '${raw}' for '${a}'`);
            return;
          }
          if (a === '-maxdepth') maxdepth = n;
          else mindepth = n;
          break;
        }
        case '-newer': {
          const ref = next();
          if (ref === null) return;
          const refPath = ctx.vfs.resolve(ctx.state.cwd, ref);
          const refNode = ctx.vfs.nodeAt(refPath);
          if (!refNode) {
            fail(`find: '${ref}': No such file or directory`);
            return;
          }
          const refTime = mtimeOf(refNode);
          items.push({ kind: 'pred', flag: a, test: (v) => mtimeOf(v.node) > refTime });
          break;
        }
        case '-size': {
          const spec = next();
          if (spec === null) return;
          const m = /^([+-]?)(\d+)([bck]?)$/.exec(spec);
          if (!m) {
            fail(`find: invalid argument '${spec}' to '-size'`);
            return;
          }
          const unit = m[3] === 'c' ? 1 : m[3] === 'k' ? 1024 : 512;
          const want = Number(m[2]);
          const cmp = m[1] === '+' ? (u: number) => u > want : m[1] === '-' ? (u: number) => u < want : (u: number) => u === want;
          items.push({
            kind: 'pred',
            flag: a,
            // dirs carry a (nominal) dir-block size like ext4's 4096 — GNU
            // -size never sees a directory as 0.
            test: (v) => cmp(Math.ceil((v.node.kind === 'file' ? v.node.content.length : 4096) / unit)),
          });
          break;
        }
        case '-print':
          items.push({ kind: 'print' });
          break;
        case '-delete':
          items.push({ kind: 'delete' });
          break;
        case '-exec': {
          const words: string[] = [];
          let braces = 0;
          let plus = false;
          let closed = false;
          while (i + 1 < args.length) {
            const w = args[++i]!;
            if (w === ';') {
              closed = true;
              break;
            }
            if (w === '+' && words[words.length - 1] === '{}') {
              closed = true;
              plus = true;
              break;
            }
            if (w === '{}') braces++;
            words.push(w);
          }
          if (!closed || words.length === 0) {
            fail(`find: missing argument to '-exec'`);
            return;
          }
          if (plus && braces !== 1) {
            fail('find: only one instance of {} is supported with -exec ... +');
            return;
          }
          items.push({ kind: 'exec', words, plus });
          break;
        }
        default:
          fail(`find: unknown predicate '${a}'`);
          return;
      }
    }

    if (starts.length === 0) starts.push('.');
    // No action in the chain ⇒ implicit -print (POSIX); predicates alone
    // must still print their matches.
    if (!items.some((item) => item.kind !== 'pred')) items.push({ kind: 'print' });

    /** Run one -exec invocation (argv words, paths substituted for {}). */
    const execOnce = (item: Extract<FindItem, { kind: 'exec' }>, paths: string[]): boolean => {
      const cmd = item.words[0]!;
      const spec = ctx.commands.get(cmd);
      if (!spec) {
        fail(`find: '${cmd}': No such file or directory`);
        return false;
      }
      const argv = item.words.map((w) => (w === '{}' ? paths : [w])).flat();
      let childStatus = 0;
      const child: CommandContext = {
        args: argv.slice(1),
        stdin: null,
        vfs: ctx.vfs,
        state: ctx.state,
        color: false,
        commands: ctx.commands,
        out: (text) => ctx.out(text),
        err: (text) => ctx.err(text),
        emit: (action) => ctx.emit(action),
        exit: (code) => {
          childStatus = code;
        },
      };
      try {
        spec.run(child); // -exec never spawns full-screen apps
      } catch (cause) {
        fail(`find: '${cmd}': ${cause instanceof Error ? cause.message : String(cause)}`);
        return false;
      }
      return childStatus === 0;
    };

    const depthLast = items.some((item) => item.kind === 'delete');
    const plusBatch: Array<{ item: Extract<FindItem, { kind: 'exec' }>; paths: string[] }> = items
      .filter((item): item is Extract<FindItem, { kind: 'exec' }> => item.kind === 'exec' && item.plus)
      .map((item) => ({ item, paths: [] }));

    /** Predicates + actions for one visited node; false = chain stopped. */
    const evaluate = (v: FindVisit): boolean => {
      for (const item of items) {
        if (item.kind === 'pred') {
          if (!item.test(v)) return false;
          continue;
        }
        if (item.kind === 'print') {
          ctx.out(v.display);
          continue;
        }
        if (item.kind === 'delete') {
          if (v.abs === '/' || v.display === '.' || v.display === '..') {
            fail(`find: cannot delete '${v.display}': Is a directory`);
            return false;
          }
          if (!ctx.vfs.nodeAt(v.abs)) return false; // already gone
          try {
            // -delete on a dir is rmdir: the -depth walk emptied it first.
            if (v.node.kind === 'dir') ctx.vfs.rmdir(v.abs);
            else ctx.vfs.rm(v.abs, { recursive: false });
          } catch (cause) {
            fail(`find: cannot delete '${v.display}': ${cause instanceof Error ? cause.message : String(cause)}`);
            return false;
          }
          continue;
        }
        if (item.plus) {
          plusBatch.find((b) => b.item === item)!.paths.push(v.display);
          continue; // predicate result decided after the walk
        }
        if (!execOnce(item, [v.display])) return false;
      }
      return true;
    };

    const walk = (abs: string, display: string, depth: number): void => {
      const node = ctx.vfs.nodeAt(abs);
      if (!node) return; // vanished mid-walk (an earlier -delete/-exec)
      const visit = (): void => {
        if (depth >= mindepth && !bad) evaluate({ display, abs, node, depth });
      };
      if (!depthLast) visit();
      if (node.kind === 'dir' && depth < maxdepth) {
        // Deterministic walk order: children sort by name with a leading
        // dot stripped (hidden files collate by their letters), plain
        // byte compare otherwise.
        const key = (n: string): string => (n.startsWith('.') ? n.slice(1) : n);
        const kids = [...node.children].sort((a, b) => {
          const ka = key(a.name);
          const kb = key(b.name);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        for (const child of kids) {
          walk(joinAbs(abs, child.name), joinDisplay(display, child.name), depth + 1);
        }
      }
      if (depthLast) visit(); // -delete implies -depth: children go first
    };

    for (const start of starts) {
      const abs = ctx.vfs.resolve(ctx.state.cwd, start);
      const node = ctx.vfs.nodeAt(abs);
      if (!node) {
        fail(`find: '${start}': No such file or directory`);
        continue;
      }
      walk(abs, start, 0);
    }

    for (const batch of plusBatch) {
      if (batch.paths.length === 0 || bad) continue;
      if (!execOnce(batch.item, batch.paths)) bad = true; // a nonzero child fails a `+` run (GNU)
    }

    ctx.exit(bad ? 1 : 0);
  },
};

/* ------------------------------------------------------------------ *
 * man
 * ------------------------------------------------------------------ */

export const FIND_MAN = [
  'find — walk the file system',
  '',
  'SYNOPSIS',
  '  find [path...] [-name glob] [-iname glob] [-type f|d]',
  '       [-maxdepth n] [-mindepth n] [-newer file] [-size [+|-]n[bck]]',
  '       [-print] [-delete] [-exec cmd {} ; | +]',
  '',
  'Predicates combine with implicit AND, in the order given; with no',
  'action -print is implied. Paths print as given (a `.` start prints',
  '`./…`). -name/-iname take fnmatch globs (* and ? also match leading',
  'dots). -size counts 512-byte blocks by default, c bytes, k kibibytes',
  '(sizes round up to whole blocks); +n is more than, -n less than.',
  '-newer compares write order (logical mtimes: in-place edits rank',
  'newer than untouched files). -exec runs a registered command per',
  'match with {} replaced by the path (`;` ends it); `-exec cmd {} +`',
  'batches all matches into one invocation and fails if the command',
  'exits nonzero. -delete removes matches, children before parents, and',
  'refuses `.` and `/`. Exit 1 on any error, 0 otherwise.',
];

export { findCmd };
