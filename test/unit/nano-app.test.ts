// Unit spec — the nano editor app (CORE-V2 §6, round-3 LANE=nano)
//
// Feature: the nano CommandSpec
//   Scenario: the app hook claims the tty; every decline falls to run()
//   Scenario: run() reports GNU-shaped errors and refuses without a tty
// Feature: the editor frame
//   Scenario: first paint — title bar, buffer, status note, two-row footer
//   Scenario: syntax colour lands as cell attrs for HTML-family files
//   Scenario: long lines scroll sideways — row k is line top+k, no wrap
// Feature: editing
//   Scenario: typing, Enter, Backspace, Delete edit the buffer
//   Scenario: ^O writes (prompt for name), save-as retargets the path
//   Scenario: ^X exits; modified asks Y/N; Esc cancels; y saves then exits
//   Scenario: ^K cuts lines into one chunk; ^U pastes them back
//   Scenario: Alt+U undoes runs; Alt+E redoes them
//   Scenario: ^W searches, Alt+W repeats, matches highlight in reverse
// Feature: navigation
//   Scenario: arrows wrap across line ends; Ctrl+A/E and Home/End jump
//   Scenario: PgUp/PgDn page the cursor; the view follows
//   Scenario: mouse click places the cursor; the wheel scrolls
// Feature: modes and surfaces
//   Scenario: ^G toggles a help overlay; any key returns (key consumed)
//   Scenario: Alt+C reports the cursor location
//   Scenario: read-only mounts open read-only and refuse edits
//   Scenario: a11ySummary announces file, position and state

import { describe, expect, it } from 'vitest';
import { lineText, Screen } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import { RawLine } from '../../src/terminal/line/discipline.js';
import { AppRunner } from '../../src/terminal/app/runner.js';
import { Vfs, type VfsBackend } from '../../src/terminal/vfs.js';
import { ATTR, COLOR_DEFAULT, type App, type KeyEvent, type MouseEvent } from '../../src/terminal/screen/types.js';
import { stringWidth } from '../../src/terminal/screen/width.js';
import { nanoApp } from '../../src/terminal/apps/nano/nano-app.js';
import { nanoCommand } from '../../src/terminal/apps/nano/nano-command.js';
import type { CommandContext, ShellState } from '../../src/terminal/terminal-core.js';

const state = (cwd = '/'): ShellState => ({
  cwd,
  env: { HOME: '/home/t' },
  aliases: {},
  history: [],
  oldpwd: null,
  lastStatus: 0,
});

const makeCtx = (
  args: string[],
  files: Record<string, string> = {},
  opts: { color?: boolean; stdin?: string | null; dirs?: string[] } = {},
): CommandContext => {
  const vfs = new Vfs();
  for (const dir of opts.dirs ?? []) vfs.mkdir(dir, { parents: true });
  for (const [path, content] of Object.entries(files)) vfs.mountFile(path, content);
  return {
    args,
    stdin: opts.stdin ?? null,
    vfs,
    state: state(),
    color: opts.color ?? true,
    commands: new Map(),
    out: () => {},
    err: () => {},
    emit: () => {},
    exit: () => {},
  };
};

/** A read-only backend for the /ro mountpoint. */
const readOnlyBackend = (): VfsBackend => ({
  id: 'ro',
  writable: false,
  mountpoint: '/ro',
  stat: async () => null,
  read: async () => null,
  write: async () => {},
  mkdirp: async () => {},
  rm: async () => {},
  rename: async () => {},
  list: async () => [],
});

/** Spawn an app through the real runner (default: the editor directly). */
const harness = (
  ctx: CommandContext,
  spawn: (c: CommandContext) => App | null = (c) => nanoApp(c),
) => {
  const app = spawn(ctx);
  if (app === null) throw new Error('nano app declined — test expected a claim');
  const screen = new Screen({ scrollback: 100 });
  const feed = new ScreenFeed(screen);
  const exits: Array<[number, string | null]> = [];
  const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
  expect(runner.spawn(app)).toBe(true);
  return { app, screen, runner, exits, vfs: ctx.vfs };
};

/** Drain microtasks so a resolved dynamic import hands off to the editor. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const frame = (screen: Screen): string[] =>
  Array.from({ length: screen.rows }, (_, r) => lineText(screen.alternate.lines[r]!));

const key = (k: string, mods: Partial<Pick<KeyEvent, 'ctrl' | 'alt' | 'shift' | 'meta'>> = {}): KeyEvent => ({
  key: k,
  ctrl: mods.ctrl ?? false,
  alt: mods.alt ?? false,
  shift: mods.shift ?? false,
  meta: mods.meta ?? false,
});

const press = (runner: AppRunner, keys: string): void => {
  for (const k of keys) runner.key(key(k));
};

const ctrl = (runner: AppRunner, k: string): void => runner.key(key(k, { ctrl: true }));

const alt = (runner: AppRunner, k: string): void => runner.key(key(k, { alt: true }));

const mouse = (kind: MouseEvent['kind'], col: number, row: number, dy = 0): MouseEvent => ({
  kind,
  button: 0,
  col,
  row,
  ctrl: false,
  alt: false,
  shift: false,
  dx: 0,
  dy,
});

const TEXT = ['first line', 'second line', 'third line'].join('\n');
const PAGE60 = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
const HTML = ['<!doctype html>', '<html lang="en">', '<body>hi</body>', '</html>'].join('\n');

describe('the nano CommandSpec', () => {
  it('pins the CommandSpec shape: run + lazy app + completion', () => {
    expect(nanoCommand.name).toBe('nano');
    expect(nanoCommand.app).not.toBe(nanoApp); // app hook is the lazy stub…
    expect(typeof nanoCommand.app).toBe('function'); // …not the chunk
    expect(typeof nanoCommand.run).toBe('function');
    expect(typeof nanoCommand.complete).toBe('function');
  });

  it('declines every path run() must report', () => {
    expect(nanoApp(makeCtx(['--bogus', 'x.html'], { '/x.html': HTML }))).toBeNull(); // option
    expect(nanoApp(makeCtx(['a.txt', 'b.txt'], { '/a.txt': 'a', '/b.txt': 'b' }))).toBeNull(); // two operands
    expect(nanoApp(makeCtx(['/demo'], {}, { dirs: ['/demo'] }))).toBeNull(); // directory
    expect(nanoApp(makeCtx(['x.html'], { '/x.html': HTML }, { color: false }))).toBeNull(); // piped
  });

  it('opens a missing file as a new buffer and accepts stdin', () => {
    const a = nanoApp(makeCtx(['draft.md'], {}));
    expect(a).not.toBeNull();
    expect(a!.path).toBe('/draft.md');
    const b = nanoApp(makeCtx([], {}, { stdin: 'piped\n' }));
    expect(b).not.toBeNull();
    expect(b!.lines).toEqual(['piped']);
  });

  it('run() reports GNU-shaped errors and refuses without a tty', () => {
    const errs: string[] = [];
    const codes: number[] = [];
    const capture = (ctx: Omit<CommandContext, 'err' | 'exit'>): CommandContext => ({
      ...ctx,
      err: (line) => errs.push(line),
      exit: (code) => codes.push(code),
    });
    nanoCommand.run(capture(makeCtx([], {}, { color: false })));
    expect(errs).toEqual(['nano: standard input is not a terminal']);
    expect(codes).toEqual([1]);
    errs.length = 0;
    codes.length = 0;
    nanoCommand.run(capture(makeCtx(['--wat'], {})));
    expect(errs).toEqual(["nano: unrecognized option '--wat'"]);
    expect(codes).toEqual([2]);
    errs.length = 0;
    codes.length = 0;
    nanoCommand.run(capture(makeCtx(['/demo'], {}, { dirs: ['/demo'] })));
    expect(errs).toEqual(['nano: /demo: Is a directory']);
    expect(codes).toEqual([1]);
    errs.length = 0;
    codes.length = 0;
    nanoCommand.run(capture(makeCtx(['a', 'b'], {})));
    expect(errs).toEqual(['nano: opening more than one file at a time is not supported']);
    expect(codes).toEqual([1]);
  });
});

describe('the editor frame', () => {
  it('first paint: title bar, buffer, status note, two-row footer', () => {
    const { screen } = harness(makeCtx(['demo.txt'], { '/demo.txt': TEXT }));
    const rows = frame(screen);
    expect(rows[0]).toContain('nano');
    expect(rows[0]).toContain('demo.txt');
    expect(rows[1]).toBe('first line');
    expect(rows[2]).toBe('second line');
    expect(rows[3]).toBe('third line');
    expect(rows[screen.rows - 3]).toContain('[ Read 3 lines ]');
    expect(rows[screen.rows - 2]).toContain('^G Help');
    expect(rows[screen.rows - 2]).toContain('^O Write Out');
    expect(rows[screen.rows - 1]).toContain('^X Exit');
    expect(rows[screen.rows - 1]).toContain('^U Paste');
    for (const row of rows) expect(stringWidth(row)).toBeLessThanOrEqual(screen.cols);
  });

  it('syntax colour lands as cell attrs for HTML-family files', () => {
    const { screen } = harness(makeCtx(['page.html'], { '/page.html': HTML }));
    const rows = frame(screen);
    const tagRow = rows.findIndex((text) => text.includes('<html'));
    expect(tagRow).toBeGreaterThan(0);
    const line = screen.alternate.lines[tagRow]!;
    expect(Array.from(line.fg).some((fg) => fg !== COLOR_DEFAULT)).toBe(true);
  });

  it('long lines scroll sideways — row k is line top+k, no wrap', () => {
    const long = 'x'.repeat(120) + ' END';
    const { screen, runner, app } = harness(makeCtx(['long.txt'], { '/long.txt': long }));
    const rows = frame(screen);
    expect(rows[1]).not.toContain('END'); // clipped at 80 cols
    runner.key(key('End')); // ride to the end of the 124-char line
    const after = frame(screen);
    expect(after[1].endsWith('END')).toBe(true);
    expect(app.a11ySummary!()).toContain('column 125'); // insertion column at EOL
    for (const row of after) expect(stringWidth(row)).toBeLessThanOrEqual(screen.cols);
  });
});

describe('editing', () => {
  it('typing, Enter, Backspace, Delete edit the buffer', () => {
    const { app, runner } = harness(makeCtx(['t.txt'], { '/t.txt': 'ab\ncd' }));
    runner.key(key('End'));
    press(runner, 'X');
    expect(app.lines).toEqual(['abX', 'cd']);
    ctrl(runner, 'e');
    runner.key(key('Enter'));
    expect(app.lines).toEqual(['abX', '', 'cd']);
    runner.key(key('Backspace')); // join the empty line back
    expect(app.lines).toEqual(['abX', 'cd']);
    runner.key(key('Delete')); // delete at EOL joins next line
    expect(app.lines).toEqual(['abXcd']);
    expect(app.modified).toBe(true);
  });

  it('^O writes (prompt for name); save-as retargets the path', () => {
    const h = harness(makeCtx(['notes.txt'], { '/notes.txt': 'one' }));
    h.runner.key(key('End'));
    press(h.runner, 'two');
    expect(h.app.lines).toEqual(['onetwo']);
    ctrl(h.runner, 'o');
    let rows = frame(h.screen);
    expect(rows[h.screen.rows - 3]).toContain('File Name to Write: notes.txt');
    h.runner.key(key('Enter'));
    expect((h.vfs.nodeAt('/notes.txt') as { content: string }).content).toBe('onetwo');
    rows = frame(h.screen);
    expect(rows[h.screen.rows - 3]).toContain('[ Wrote 1 line to notes.txt ]');
    expect(h.app.modified).toBe(false);

    // Save-as: write the same buffer under a new name; the path follows.
    const h2 = harness(makeCtx([], {})); // untitled
    press(h2.runner, 'fresh');
    ctrl(h2.runner, 'o');
    press(h2.runner, 'made.txt');
    h2.runner.key(key('Enter'));
    expect((h2.vfs.nodeAt('/made.txt') as { content: string }).content).toBe('fresh');
    expect(h2.app.path).toBe('/made.txt');
  });

  it('^X exits; modified asks Y/N; Esc cancels; y saves then exits', () => {
    const a = harness(makeCtx(['a.txt'], { '/a.txt': 'one' }));
    ctrl(a.runner, 'x');
    expect(a.exits).toEqual([[0, null]]); // unmodified: silent exit

    const b = harness(makeCtx(['b.txt'], { '/b.txt': 'one' }));
    b.runner.key(key('End'));
    press(b.runner, 'two');
    expect(b.app.lines).toEqual(['onetwo']);
    ctrl(b.runner, 'x');
    expect(b.exits).toEqual([]); // prompt up
    expect(frame(b.screen)[b.screen.rows - 3]).toContain('Save modified buffer?');
    b.runner.key(key('Escape'));
    expect(b.exits).toEqual([]); // cancelled
    expect(b.app.lines).toEqual(['onetwo']);
    ctrl(b.runner, 'x');
    b.runner.key(key('y'));
    expect(b.exits).toEqual([[0, null]]);
    expect((b.vfs.nodeAt('/b.txt') as { content: string }).content).toBe('onetwo');

    const c = harness(makeCtx(['c.txt'], { '/c.txt': 'one' }));
    c.runner.key(key('End'));
    press(c.runner, 'two');
    ctrl(c.runner, 'x');
    c.runner.key(key('n'));
    expect(c.exits).toEqual([[0, null]]);
    expect((c.vfs.nodeAt('/c.txt') as { content: string }).content).toBe('one'); // discard
  });

  it('^K cuts lines into one chunk; ^U pastes them back', () => {
    const { app, runner } = harness(makeCtx(['k.txt'], { '/k.txt': 'one\ntwo\nthree' }));
    ctrl(runner, 'k');
    expect(app.lines).toEqual(['two', 'three']);
    ctrl(runner, 'k');
    expect(app.lines).toEqual(['three']);
    ctrl(runner, 'u');
    expect(app.lines).toEqual(['one', 'two', 'three']);
  });

  it('Alt+U undoes runs; Alt+E redoes them', () => {
    const { app, runner } = harness(makeCtx(['u.txt'], { '/u.txt': '' }));
    press(runner, 'abc'); // one coalesced insert run
    expect(app.lines).toEqual(['abc']);
    alt(runner, 'u');
    expect(app.lines).toEqual(['']);
    alt(runner, 'e');
    expect(app.lines).toEqual(['abc']);
    alt(runner, 'u');
    expect(app.lines).toEqual(['']);
    alt(runner, 'u');
    expect(app.lines).toEqual(['']);
  });

  it('^W searches, Alt+W repeats, matches highlight in reverse', () => {
    const h = harness(makeCtx(['s.txt'], { '/s.txt': 'alpha beta gamma beta' }));
    ctrl(h.runner, 'w');
    press(h.runner, 'beta');
    h.runner.key(key('Enter'));
    expect(h.app.a11ySummary!()).toContain('column 7');
    const row = h.screen.alternate.lines[1]!;
    const reversed: number[] = [];
    for (let c = 0; c < row.cols; c++) if ((row.attrs[c]! & ATTR.REVERSE) !== 0) reversed.push(c);
    expect(reversed).toEqual([6, 7, 8, 9]); // 'beta' at cell 6 (0-based)
    alt(h.runner, 'w'); // repeat: wraps to the second beta
    expect(h.app.a11ySummary!()).toContain('column 18');
    ctrl(h.runner, 'w');
    expect(frame(h.screen)[h.screen.rows - 3]).toContain('Search: beta'); // prefilled
    for (let i = 0; i < 4; i++) h.runner.key(key('Backspace'));
    press(h.runner, 'zzz');
    h.runner.key(key('Enter'));
    expect(frame(h.screen)[h.screen.rows - 3]).toContain('"zzz" not found');
  });
});

describe('navigation', () => {
  it('arrows wrap across line ends; Ctrl+A/E and Home/End jump', () => {
    const { app, runner } = harness(makeCtx(['n.txt'], { '/n.txt': 'ab\ncd' }));
    runner.key(key('End'));
    runner.key(key('ArrowRight')); // wraps to the next line start
    expect(app.a11ySummary!()).toContain('line 2 of 2, column 1');
    runner.key(key('ArrowLeft')); // wraps back to the previous line end
    expect(app.a11ySummary!()).toContain('line 1 of 2, column 3');
    ctrl(runner, 'a');
    expect(app.a11ySummary!()).toContain('column 1');
    runner.key(key('Home'));
    expect(app.a11ySummary!()).toContain('column 1');
    ctrl(runner, 'e');
    expect(app.a11ySummary!()).toContain('column 3');
    runner.key(key('End'));
    expect(app.a11ySummary!()).toContain('column 3');
  });

  it('PgUp/PgDn page the cursor; the view follows', () => {
    const { app, screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    runner.key(key('PageDown'));
    expect(app.a11ySummary!()).toContain('line 19 of 60');
    runner.key(key('PageDown'));
    expect(app.a11ySummary!()).toContain('line 37 of 60');
    expect(frame(screen)[1]).toContain('line 18'); // top scrolled with the cursor
    runner.key(key('PageUp'));
    runner.key(key('PageUp'));
    expect(app.a11ySummary!()).toContain('line 1 of 60');
    expect(frame(screen)[1]).toContain('line 1');
  });

  it('mouse click places the cursor; the wheel scrolls', () => {
    const { app, screen, runner } = harness(makeCtx(['m.txt'], { '/m.txt': PAGE60 }));
    runner.mouse(mouse('press', 3, 2)); // edit row 2 = buffer line 2, cell 3
    expect(app.a11ySummary!()).toContain('line 2 of 60, column 4');
    runner.mouse(mouse('wheel', 0, 5, 3)); // wheel down 3 lines
    expect(frame(screen)[1]).toContain('line 4'); // top = 3
    runner.mouse(mouse('wheel', 0, 5, -99)); // clamp at the top
    expect(frame(screen)[1]).toContain('line 1');
  });
});

describe('modes and surfaces', () => {
  it('^G toggles a help overlay; any key returns (key consumed)', () => {
    const { app, screen, runner } = harness(makeCtx(['h.txt'], { '/h.txt': 'keep' }));
    ctrl(runner, 'g');
    const help = frame(screen);
    expect(help[1]).toContain('key bindings');
    expect(help[1]).not.toContain('keep');
    expect(app.a11ySummary!()).toBe('nano: key bindings');
    runner.key(key('x')); // consumed by the overlay, not inserted
    expect(app.lines).toEqual(['keep']);
    expect(frame(screen)[1]).toContain('keep');
  });

  it('Alt+C reports the cursor location', () => {
    const { screen, runner } = harness(makeCtx(['loc.txt'], { '/loc.txt': PAGE60 }));
    runner.key(key('PageDown'));
    alt(runner, 'c');
    expect(frame(screen)[screen.rows - 3]).toContain('Line 19 of 60');
    expect(frame(screen)[screen.rows - 3]).toContain('col 1');
  });

  it('read-only mounts open read-only and refuse edits', () => {
    const ctx = makeCtx(['/ro/doc.txt'], { '/ro/doc.txt': 'locked\n' });
    ctx.vfs.attachBackend(readOnlyBackend());
    const h = harness(ctx);
    expect(frame(h.screen)[h.screen.rows - 3]).toContain('[ File is read-only ]');
    press(h.runner, 'nope');
    expect(h.app.lines).toEqual(['locked']);
    expect(frame(h.screen)[h.screen.rows - 3]).toContain('[ File is read-only ]');
    ctrl(h.runner, 'o');
    expect(frame(h.screen)[h.screen.rows - 3]).toContain('[ File is read-only ]');
    ctrl(h.runner, 'x');
    expect(h.exits).toEqual([[0, null]]); // never modified: exits without asking
  });

  it('a11ySummary announces file, position and state', () => {
    const { app, runner } = harness(makeCtx(['a11y.txt'], { '/a11y.txt': 'one\ntwo' }));
    expect(app.a11ySummary!()).toContain('editing a11y.txt');
    expect(app.a11ySummary!()).toContain('unmodified');
    press(runner, 'X');
    expect(app.a11ySummary!()).toContain('modified');
    ctrl(runner, 'o');
    expect(app.a11ySummary!()).toContain('answering file name to write: a11y.txt');
    runner.key(key('Escape'));
    ctrl(runner, 'w');
    expect(app.a11ySummary!()).toContain('answering search:');
  });
});

describe('the lazy command stub', () => {
  it('buffers keys/paste until the editor chunk resolves, then delegates', async () => {
    const h = harness(makeCtx(['lazy.txt'], { '/lazy.txt': '' }), (c) => nanoCommand.app!(c)!);
    // Same tick as spawn: the import microtask has not run — these buffer.
    expect(h.app.a11ySummary!()).toBe('nano: loading');
    h.runner.key(key('o'));
    h.runner.key(key('k'));
    h.runner.paste('hey');
    await flush();
    // Hand-off complete: buffered events replayed in order.
    expect(h.app.a11ySummary!()).toContain('nano: editing lazy.txt');
    expect(frame(h.screen)[1]).toContain('okhey');
    // Live delegation after the hand-off.
    h.runner.key(key('End'));
    press(h.runner, '!');
    expect(frame(h.screen)[1]).toContain('okhey!');
    expect(h.exits).toEqual([]);
  });

  it('replays Ctrl+X pressed before the hand-off (exit still lands)', async () => {
    const h = harness(makeCtx(['late.txt'], { '/late.txt': 'x' }), (c) => nanoCommand.app!(c)!);
    ctrl(h.runner, 'x'); // buffered: unmodified buffer exits without prompting
    await flush();
    expect(h.exits).toEqual([[0, null]]);
  });

  it('stop before the hand-off never starts the editor', async () => {
    const h = harness(makeCtx(['gone.txt'], { '/gone.txt': 'x' }), (c) => nanoCommand.app!(c)!);
    h.runner.requestInterrupt(); // the terminal layer's Ctrl+C: teardown now
    await flush();
    expect(h.exits).toEqual([[130, null]]);
  });

  it('declines exactly where run() errors (same validation, no dupes)', () => {
    const bad = makeCtx(['-x'], {}, { color: true });
    expect(nanoCommand.app!(bad)).toBeNull();
    const two = makeCtx(['a', 'b'], {}, { color: true });
    expect(nanoCommand.app!(two)).toBeNull();
    const piped = makeCtx(['a.txt'], { '/a.txt': 'x' }, { color: false });
    expect(nanoCommand.app!(piped)).toBeNull();
  });
});
