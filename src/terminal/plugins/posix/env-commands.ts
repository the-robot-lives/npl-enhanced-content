/**
 * posix-sh env additions — `printenv`, `direnv`, and the direnv hooks on
 * `cd` and `man` (CORE-V2 §12). Lives beside commands.ts but does not
 * edit it: the v1 command file stays untouched, and this module composes
 * the plugin's command list in plugin.ts (the one registration line).
 *
 * How the hooks work without touching commands.ts: `applyEnvDirenv`
 * wraps the v1 `cd` and `man` CommandSpecs in place —
 *
 *   - cd: after the v1 run moves the directory, the direnv session
 *     syncs the `.envrc` chain (load/unwind, dim comment line, blocked
 *     warnings). cd's own exit status is re-asserted 0 when it moved:
 *     direnv warnings are advisory and must not fail navigation.
 *   - man: pages defined here (direnv, printenv, and the direnv-aware
 *     cd page) win; every other page falls through to the v1 man.
 *
 * The direnv state itself lives in src/terminal/env/direnv.ts (one
 * session per ShellState, a WeakMap away from the frozen state shape).
 */

import type { CommandContext, CommandSpec, CompletionContext } from '../../terminal-core.js';
import { direnvSession, type DirenvReport } from '../../env/direnv.js';

/* ------------------------------------------------------------------ *
 * printenv
 * ------------------------------------------------------------------ */

const printenv: CommandSpec = {
  name: 'printenv',
  usage: 'printenv [NAME...] — print environment values (all, or named)',
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const key of Object.keys(ctx.state.env)) ctx.out(`${key}=${ctx.state.env[key]}`);
      return;
    }
    let missing = false;
    for (const name of ctx.args) {
      const value = ctx.state.env[name];
      if (value === undefined) missing = true; // real printenv: silent, exit 1
      else ctx.out(value);
    }
    if (missing) ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * direnv
 * ------------------------------------------------------------------ */

const DIRENV_SUBS = ['allow', 'deny', 'status'];

/** Directory-only completions for `direnv allow|deny <dir>` (cd's helper shape). */
function completeDirenvDirs(ctx: CompletionContext): string[] {
  const slash = ctx.word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : ctx.word.slice(0, slash + 1);
  const rest = slash === -1 ? ctx.word : ctx.word.slice(slash + 1);
  const expanded = dirPart.startsWith('~') ? ctx.home + dirPart.slice(1) : dirPart;
  const base = ctx.vfs.resolve(ctx.cwd, expanded === '' ? '.' : expanded);
  const found: string[] = [];
  for (const node of ctx.vfs.list(base)) {
    if (node.kind !== 'dir' || !node.name.startsWith(rest)) continue;
    found.push(dirPart + node.name + '/');
  }
  return found.sort((a, b) => a.localeCompare(b));
}

const direnvCmd: CommandSpec = {
  name: 'direnv',
  usage: 'direnv [allow | deny | status] [dir] — approve, revoke, or report .envrc loading',
  complete(ctx) {
    if (ctx.args.length === 0) return DIRENV_SUBS.filter((sub) => sub.startsWith(ctx.word));
    return completeDirenvDirs(ctx);
  },
  run(ctx) {
    const sub = ctx.args[0];
    if (sub === undefined) {
      ctx.err('usage: direnv allow [dir] | deny [dir] | status');
      ctx.exit(1);
      return;
    }
    const session = direnvSession(ctx.state, ctx.vfs);
    if (sub === 'status') {
      for (const line of session.statusLines()) ctx.out(line);
      return;
    }
    if (sub === 'allow' || sub === 'deny') {
      const target = ctx.args[1];
      const dir = target === undefined ? ctx.state.cwd : ctx.vfs.resolve(ctx.state.cwd, target);
      const ok = sub === 'allow' ? session.allow(dir, ctx) : session.deny(dir, ctx);
      if (!ok) {
        ctx.err(`direnv: ${target ?? '.'}: no .envrc in ${dir}`);
        ctx.exit(1);
        return;
      }
      if (sub === 'allow') ctx.exit(0); // approval succeeded; skipped-line warnings must not fail it
      return;
    }
    ctx.err(`direnv: unknown subcommand "${sub}" (want allow | deny | status)`);
    ctx.exit(1);
  },
};

/* ------------------------------------------------------------------ *
 * the cd wrapper — .envrc syncs on every successful directory change
 * ------------------------------------------------------------------ */

/** Wrap the v1 `cd` so an approved `.envrc` chain loads on arrival. */
export function withDirenvCd(cd: CommandSpec): CommandSpec {
  return {
    ...cd,
    run(ctx: CommandContext) {
      const before = ctx.state.cwd;
      cd.run(ctx);
      if (ctx.state.cwd === before) return; // cd failed (or was a no-op): its status stands
      direnvSession(ctx.state, ctx.vfs).sync(ctx.state.cwd, ctx as CommandContext & DirenvReport);
      ctx.exit(0); // cd succeeded; direnv warnings are advisory, never a failed cd
    },
  };
}

/* ------------------------------------------------------------------ *
 * the man wrapper — this module's pages win, then the v1 man
 * ------------------------------------------------------------------ */

const DIRENV_MAN = [
  'direnv — approve and report .envrc directory environments',
  '',
  'SYNOPSIS',
  '  direnv allow [dir] | deny [dir] | status',
  '',
  '.envrc files are declarative only: `export NAME=value`, `unset NAME`,',
  'comments and blanks. Any other line is skipped with a stderr warning —',
  'no command execution, by design. Values quote like shell words (single',
  'quotes literal, double quotes expand $VAR at load).',
  '',
  'An .envrc does not load until approved: `direnv allow` (cwd) or',
  '`direnv allow <dir>`. Approvals are content-hashed and persisted under',
  '~/.cache/direnv/allow, so editing the file un-approves it. `direnv deny`',
  'revokes. Entering a nested directory layers its .envrc on the parent;',
  'leaving unwinds to the enclosing set. cd prints one dim',
  '`direnv: loaded .envrc` line when the chain moves.',
];

const PRINTENV_MAN = [
  'printenv — print environment values',
  '',
  'SYNOPSIS',
  '  printenv [NAME...]',
  '',
  'No names: every variable, KEY=value dash-style. Named: one value per',
  'line; a missing name prints nothing and exits 1.',
];

const CD_MAN = [
  'cd — change the working directory',
  '',
  'SYNOPSIS',
  '  cd [dir | - | ~]',
  '',
  'No argument goes to $HOME; `cd -` returns to the previous directory and prints it.',
  '',
  'Arriving in a directory whose .envrc is approved applies it (see direnv);',
  'the load prints one dim `direnv: loaded .envrc` line. A blocked .envrc',
  'warns on stderr and does not load — cd itself still succeeds.',
];

const ENV_MAN_PAGES: Record<string, string[]> = {
  cd: CD_MAN,
  direnv: DIRENV_MAN,
  printenv: PRINTENV_MAN,
};

/** Wrap the v1 `man` with this module's pages (they shadow same-named ones). */
export function withEnvMan(man: CommandSpec): CommandSpec {
  return {
    ...man,
    run(ctx: CommandContext) {
      const name = ctx.args[0];
      const page = name === undefined ? undefined : ENV_MAN_PAGES[name];
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

/* ------------------------------------------------------------------ *
 * composition — the plugin.ts registration line
 * ------------------------------------------------------------------ */

/**
 * The plugin command list: v1 commands with cd/man wrapped, plus
 * printenv and direnv. Defensive on the v1 names — a missing cd or man
 * degrades to just the additions rather than breaking the mount.
 */
export function applyEnvDirenv(commands: CommandSpec[]): CommandSpec[] {
  const wrapped = commands.map((spec) => {
    if (spec.name === 'cd') return withDirenvCd(spec);
    if (spec.name === 'man') return withEnvMan(spec);
    return spec;
  });
  return [...wrapped, printenv, direnvCmd];
}
