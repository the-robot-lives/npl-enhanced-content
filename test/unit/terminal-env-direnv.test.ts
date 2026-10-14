// Unit spec — the env + direnv lane: the declarative .envrc subset on cd
// (src/terminal/env/direnv.ts, src/terminal/plugins/posix/env-commands.ts)
//
// Feature: the evaluator (parseEnvrc)
//   Scenario: export/unset lines become ordered ops; earlier exports feed
//             later expansions; undefined vars expand to ''
//   Scenario: values quote like sh-parse words (single literal, double and
//             bare expand $VAR/${VAR}/$?, backslash escapes)
//   Scenario: comments, blanks and trailing #comments are skipped
//   Scenario: anything else is refused with line numbers — command lines
//             are warnings, never executed
// Feature: sha256Hex
//   Scenario: known vectors pin the approval hashing
// Feature: cd + direnv through the real posix plugin
//   Scenario: cd without .envrc is unchanged (no lines, exit 0)
//   Scenario: a blocked .envrc warns on stderr, loads nothing, cd still exits 0
//   Scenario: direnv allow loads it (dim line), vars live, approval persists
//             in the VFS at ~/.cache/direnv/allow/<sha256>
//   Scenario: nested dirs layer (child wins); cd out unwinds to the
//             enclosing set; hand exports beneath a layer survive
//   Scenario: direnv deny revokes (unloaded line, approval file gone)
//   Scenario: editing an approved .envrc invalidates the approval
//   Scenario: refused lines warn with line numbers; the rest still loads
//   Scenario: $? expands at load time (the pre-cd exit status)
//   Scenario: TAB_TITLE / TAB_THEME reach the chrome feed
// Feature: the commands
//   Scenario: printenv — all, named, missing exits 1
//   Scenario: direnv — status lines, bare/bogus usage exits 1, allow on a
//             dir without .envrc exits 1, completion offers subs then dirs
//   Scenario: export/unset/env still work untouched
//   Scenario: man knows direnv/printenv, cd's page documents the hook,
//             every other page still comes from the v1 man
//   Scenario: help lists the new commands

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { parseEnvrc, sha256Hex, ENVRC_LOADED, ENVRC_UNLOADED, onEnvFeed, type EnvFeed } from '../../src/terminal/env/direnv.js';

const ESC = String.fromCharCode(27);

let core: TerminalCore;

const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);
const status = (r: ExecResult): number => r.state.lastStatus;

const writeEnvrc = (dir: string, content: string): void => {
  core.vfs.mountFile(`${dir === '/' ? '' : dir}/.envrc`, content);
};

beforeEach(() => {
  core = new TerminalCore();
  const result = core.mountPlugin(posixPlugin);
  if (!result.ok) throw new Error(result.error ?? 'posix plugin failed to mount');
  core.vfs.mountFile('/projects/app/README.md', '# app\n');
});

describe('sha256Hex', () => {
  it('matches the known vectors (approval hashing is pinned)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('export A=1\n')).toHaveLength(64);
  });
});

describe('parseEnvrc — the declarative subset', () => {
  it('export/unset become ordered ops; earlier exports feed later expansions', () => {
    const ops = parseEnvrc('export A=1\nexport B=${A}x\nunset A\nexport C=$B\n', {}, 0);
    expect(ops).toEqual([
      { kind: 'set', name: 'A', value: '1' },
      { kind: 'set', name: 'B', value: '1x' },
      { kind: 'unset', name: 'A' },
      { kind: 'set', name: 'C', value: '1x' },
    ]);
  });

  it('undefined vars expand to nothing, like sh', () => {
    expect(parseEnvrc('export A=$MISSING[${MISSING}]\n', {}, 0)).toEqual([{ kind: 'set', name: 'A', value: '[]' }]);
  });

  it('values quote like shell words: single literal, double and bare expand', () => {
    const ops = parseEnvrc("export LIT='$A'\nexport DBL=\"$A+$A\"\nexport BARE=$A-end\\ x\n", { A: 'z' }, 0);
    expect(ops.map((o) => (o.kind === 'set' ? o.value : o.kind))).toEqual(['$A', 'z+z', 'z-end x']);
  });

  it('$? expands to the current exit status', () => {
    expect(parseEnvrc('export S=$?\nexport T=${?}\n', {}, 3)).toEqual([
      { kind: 'set', name: 'S', value: '3' },
      { kind: 'set', name: 'T', value: '3' },
    ]);
  });

  it('comments, blanks and trailing comments are skipped', () => {
    const ops = parseEnvrc('\n   \n# whole line\n  # indented\nexport A=1 # trailing\nexport B=2\n', {}, 0);
    expect(ops).toEqual([
      { kind: 'set', name: 'A', value: '1' },
      { kind: 'set', name: 'B', value: '2' },
    ]);
  });

  it('command lines are refused with 1-based line numbers — never executed', () => {
    const text = 'export GOOD=1\necho pwned > /pwned\nrm -rf /\n';
    const ops = parseEnvrc(text, {}, 0);
    expect(ops[0]).toEqual({ kind: 'set', name: 'GOOD', value: '1' });
    expect(ops.slice(1)).toEqual([
      { kind: 'refused', line: 2, text: 'echo pwned > /pwned', reason: expect.stringContaining('no command execution') },
      { kind: 'refused', line: 3, text: 'rm -rf /', reason: expect.stringContaining('no command execution') },
    ]);
  });

  it('malformed assignments and bad names are refused, not applied', () => {
    const ops = parseEnvrc('export 9BAD=x\nexport\nunset\nexport LONE\n', {}, 0);
    expect(ops.every((op) => op.kind === 'refused')).toBe(true);
    expect(ops.map((op) => (op.kind === 'refused' ? op.line : -1))).toEqual([1, 2, 3, 4]);
  });
});

describe('cd + direnv through the real posix plugin', () => {
  it('cd without .envrc is exactly v1: no extra lines, exit 0', () => {
    const r = core.execLine('cd projects');
    expect(out(r)).toEqual([]);
    expect(errs(r)).toEqual([]);
    expect(status(r)).toBe(0);
  });

  it('a blocked .envrc warns on stderr, loads nothing, cd still exits 0', () => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\n');
    const r = core.execLine('cd projects/app');
    expect(errs(r)[0]).toContain('/projects/app/.envrc is blocked');
    expect(errs(r)[0]).toContain('direnv allow');
    expect(out(r)).toEqual([]);
    expect(status(r)).toBe(0);
    expect(out(core.execLine('printenv APP_ENV'))).toEqual([]);
    expect(status(core.execLine('printenv APP_ENV'))).toBe(1);
  });

  it('direnv allow loads it: dim line, vars live, approval persisted in the VFS', () => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\nexport TOKEN=abc\n');
    core.execLine('cd projects/app');
    const r = core.execLine('direnv allow');
    expect(out(r)).toContain(ENVRC_LOADED);
    expect(out(core.execLine('echo $APP_ENV/$TOKEN'))).toEqual(['test/abc']);
    const hash = sha256Hex('export APP_ENV=test\nexport TOKEN=abc\n');
    expect(core.vfs.read(`/.cache/direnv/allow/${hash}`)).toBe('/projects/app');
    const st = core.execLine('direnv status');
    expect(out(st)).toEqual([
      'direnv status (semtext-sh declarative subset)',
      '  allow-list: /.cache/direnv/allow',
      '  loaded .envrc: /projects/app',
      '  .envrc (/projects/app): allowed',
    ]);
  });

  it('nested dirs layer (child wins); cd out unwinds to the enclosing set', () => {
    writeEnvrc('/projects', 'export BASE=outer\nexport SHARED=from-parent\n');
    writeEnvrc('/projects/app', 'export BASE=inner\nunset SHARED\n');
    core.execLine('cd projects');
    core.execLine('direnv allow');
    expect(out(core.execLine('echo $BASE/$SHARED'))).toEqual(['outer/from-parent']);
    const deeper = core.execLine('cd app'); // app not approved yet
    expect(errs(deeper)[0]).toContain('/projects/app/.envrc is blocked');
    expect(out(core.execLine('echo $BASE/$SHARED'))).toEqual(['outer/from-parent']); // parent layer persists
    core.execLine('direnv allow'); // approve app's own .envrc, load it on top
    expect(out(core.execLine('echo $BASE/$SHARED'))).toEqual(['inner/']); // child overrode + unset
    core.execLine('export USERSET=keep');
    const r = core.execLine('cd /');
    expect(out(r)).toContain(ENVRC_UNLOADED);
    expect(out(core.execLine('echo $BASE-$USERSET'))).toEqual(['-keep']);
    expect(status(core.execLine('printenv BASE'))).toBe(1);
    expect(out(core.execLine('direnv status'))).toContain('  loaded .envrc: (none)');
  });

  it('direnv deny revokes: unloaded line, approval file gone, next cd blocked again', () => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\n');
    core.execLine('cd projects/app');
    core.execLine('direnv allow');
    expect(out(core.execLine('printenv APP_ENV'))).toEqual(['test']);
    const hash = sha256Hex('export APP_ENV=test\n');
    const r = core.execLine('direnv deny');
    expect(out(r)).toContain(ENVRC_UNLOADED);
    expect(core.vfs.read(`/.cache/direnv/allow/${hash}`)).toBe(null);
    expect(out(core.execLine('printenv APP_ENV'))).toEqual([]);
    core.execLine('cd /');
    expect(errs(core.execLine('cd projects/app'))[0]).toContain('is blocked');
  });

  it('editing an approved .envrc invalidates the approval (hash mismatch)', () => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\n');
    core.execLine('cd projects/app');
    core.execLine('direnv allow');
    writeEnvrc('/projects/app', 'export APP_ENV=pwned\n');
    core.execLine('cd /');
    const r = core.execLine('cd projects/app');
    expect(errs(r)[0]).toContain('is blocked');
    expect(out(core.execLine('printenv APP_ENV'))).toEqual([]);
  });

  it('refused lines warn with line numbers; the rest of the file still loads', () => {
    writeEnvrc('/projects/app', 'export GOOD=1\nsomecommand arg\nexport ALSO=2\n');
    core.execLine('cd projects/app');
    const r = core.execLine('direnv allow');
    expect(out(r)).toContain(ENVRC_LOADED);
    expect(errs(r)[0]).toContain('/projects/app/.envrc:2');
    expect(errs(r)[0]).toContain('somecommand arg');
    expect(out(core.execLine('echo $GOOD-$ALSO'))).toEqual(['1-2']);
    expect(status(r)).toBe(0); // approval succeeded; the warning does not fail direnv allow
  });

  it('$? expands at load time with the running shell exit status', () => {
    writeEnvrc('/projects/app', 'export FROM_STATUS=$?\n');
    core.execLine('cd projects/app'); // blocked, nothing loads yet
    core.execLine('false'); // lastStatus = 1
    core.execLine('direnv allow'); // the load runs inside this command, seeing $?'s 1
    expect(out(core.execLine('printenv FROM_STATUS'))).toEqual(['1']);
  });

  it('TAB_TITLE / TAB_THEME reach the chrome feed (and nothing else)', () => {
    writeEnvrc('/projects/app', 'export TAB_TITLE=Reports\nexport PLAIN=1\n');
    const feeds: EnvFeed[] = [];
    const stop = onEnvFeed((feed) => feeds.push(feed));
    try {
      core.execLine('cd projects/app');
      core.execLine('direnv allow');
    } finally {
      stop();
    }
    expect(feeds).toEqual([{ dir: '/projects/app', vars: { TAB_TITLE: 'Reports' } }]);
  });

  it('unrelated cds never touch the feed', () => {
    const feeds: EnvFeed[] = [];
    const stop = onEnvFeed((feed) => feeds.push(feed));
    core.execLine('cd projects');
    core.execLine('cd /');
    stop();
    expect(feeds).toEqual([]);
  });
});

describe('the commands', () => {
  beforeEach(() => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\n');
    core.state.env.SEED = 's1';
  });

  it('printenv: bare prints KEY=value, named prints values, missing exits 1', () => {
    const all = out(core.execLine('printenv'));
    expect(all).toContain('SEED=s1');
    expect(all).toContain('HOME=/');
    expect(out(core.execLine('printenv SEED'))).toEqual(['s1']);
    const r = core.execLine('printenv SEED MISSING OTHER');
    expect(out(r)).toEqual(['s1']);
    expect(status(r)).toBe(1);
  });

  it('direnv: bare usage exits 1, unknown sub exits 1, allow without .envrc exits 1', () => {
    const bare = core.execLine('direnv');
    expect(errs(bare)[0]).toContain('usage: direnv allow');
    expect(status(bare)).toBe(1);
    const bogus = core.execLine('direnv explode');
    expect(errs(bogus)[0]).toContain('unknown subcommand');
    expect(status(bogus)).toBe(1);
    const nowhere = core.execLine('direnv allow projects');
    expect(errs(nowhere)[0]).toContain('no .envrc in /projects');
    expect(status(nowhere)).toBe(1);
  });

  it('direnv allow takes a dir argument and loads the chain above it too', () => {
    writeEnvrc('/projects', 'export BASE=outer\n');
    core.execLine('cd projects/app');
    const r = core.execLine('direnv allow /projects');
    expect(errs(r)[0]).toContain('/projects/app/.envrc is blocked'); // child still denied
    expect(out(core.execLine('echo $BASE'))).toEqual(['outer']);
    core.execLine('direnv allow');
    expect(out(core.execLine('echo $BASE/$APP_ENV'))).toEqual(['outer/test']);
  });

  it('export / unset / env still work exactly as before', () => {
    core.execLine('export MINE=1');
    expect(out(core.execLine('printenv MINE'))).toEqual(['1']);
    core.execLine('unset MINE');
    expect(status(core.execLine('printenv MINE'))).toBe(1);
    const env = out(core.execLine('env'));
    expect(env.some((line) => line.startsWith('SHELL='))).toBe(true);
  });

  it('man knows direnv and printenv; cd documents the hook; other pages fall through', () => {
    expect(out(core.execLine('man direnv'))).toContain('direnv — approve and report .envrc directory environments');
    expect(out(core.execLine('man printenv'))[0]).toContain('PRINTENV(1)');
    const cdMan = out(core.execLine('man cd'));
    expect(cdMan.join('\n')).toContain('direnv: loaded .envrc');
    expect(out(core.execLine('man pwd'))).toContain('pwd — print the working directory');
    expect(errs(core.execLine('man nosuch'))[0]).toContain('No manual entry for nosuch');
  });

  it('help lists the new commands', () => {
    const help = out(core.execLine('help')).join('\n');
    expect(help).toContain('direnv [allow | deny | status]');
    expect(help).toContain('printenv [NAME...]');
  });

  it('direnv completes its subcommands, then directory arguments', () => {
    const spec = core.commandSpec('direnv')!;
    expect(spec.complete!({ args: [], word: 'a', commands: [], vfs: core.vfs, cwd: '/', home: '/' })).toEqual(['allow']);
    core.vfs.mountFile('/projects/sub/keep.txt', 'x');
    expect(spec.complete!({ args: ['allow'], word: 'pro', commands: [], vfs: core.vfs, cwd: '/', home: '/' })).toEqual([
      'projects/', // immediate children, the v1 cd-completer shape
    ]);
  });
});

describe('layer corner cases', () => {
  it('the root .envrc joins the chain when present', () => {
    writeEnvrc('/', 'export ROOT=1\n');
    core.execLine('direnv allow');
    expect(out(core.execLine('printenv ROOT'))).toEqual(['1']);
    expect(out(core.execLine('direnv status'))).toContain('  loaded .envrc: /');
  });

  it('cd - prints where it went, then the direnv line (v1 output first)', () => {
    writeEnvrc('/projects/app', 'export APP_ENV=test\n');
    core.execLine('cd projects/app');
    core.execLine('direnv allow');
    core.execLine('cd /');
    const r = core.execLine('cd -');
    expect(out(r)).toEqual(['/projects/app', ENVRC_LOADED]);
    expect(out(core.execLine('printenv APP_ENV'))).toEqual(['test']);
  });

  it('a denied parent blocks every deeper .envrc (containment)', () => {
    writeEnvrc('/projects', 'export BASE=outer\n');
    writeEnvrc('/projects/app', 'export APP_ENV=inner\n');
    core.execLine('cd projects/app');
    const first = core.execLine('direnv allow'); // approves app's file; sync stops at the blocked parent
    expect(errs(first)[0]).toContain('/projects/.envrc is blocked');
    expect(out(core.execLine('echo $BASE-$APP_ENV'))).toEqual(['-']);
    core.execLine('direnv allow /projects'); // approve the parent; both layers load (app was already approved)
    expect(out(core.execLine('echo $BASE-$APP_ENV'))).toEqual(['outer-inner']);
  });
});
