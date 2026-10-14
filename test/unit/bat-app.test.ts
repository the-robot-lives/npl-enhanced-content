// Unit spec — the bat pager app (CORE-V2 §6, round-2 LANE=bat)
//
// Feature: the CommandSpec.app hook
//   Scenario: a tty invocation claims the screen; every error path declines
//   Scenario: stdin pages; --plain pages bare
// Feature: the pager
//   Scenario: the first paint is header + gutter + status bar
//   Scenario: syntax colour lands as cell attrs, not just text
//   Scenario: long lines truncate — frame row k is entry top+k (no wrap desync)
//   Scenario: ↑/↓/PgUp/PgDn/Home/End/g/G move the window
//   Scenario: q / :q / Esc exit through the runner
//   Scenario: / searches with highlight, n/N step and wrap
//   Scenario: wheel deltas scroll; resize repaints at the new metrics
//   Scenario: the landing-script contract — the deck source is on screen

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineText, Screen } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import { RawLine } from '../../src/terminal/line/discipline.js';
import { AppRunner } from '../../src/terminal/app/runner.js';
import { Vfs } from '../../src/terminal/vfs.js';
import { ATTR, COLOR_DEFAULT, type KeyEvent } from '../../src/terminal/screen/types.js';
import { stringWidth } from '../../src/terminal/screen/width.js';
import { batApp } from '../../src/terminal/apps/bat/bat-app.js';
import type { CommandContext, CommandSpec, ShellState } from '../../src/terminal/terminal-core.js';

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

/** Spawn whatever batApp(ctx) returns through the real runner. */
const harness = (ctx: CommandContext) => {
  const app = batApp(ctx);
  if (app === null) throw new Error('batApp declined — test expected a claim');
  const screen = new Screen({ scrollback: 100 });
  const feed = new ScreenFeed(screen);
  const exits: Array<[number, string | null]> = [];
  const runner = new AppRunner(feed, screen, new RawLine(), (code, crash) => exits.push([code, crash]));
  expect(runner.spawn(app)).toBe(true);
  return { app, screen, runner, exits };
};

const frame = (screen: Screen): string[] =>
  Array.from({ length: screen.rows }, (_, r) => lineText(screen.alternate.lines[r]!));

const key = (k: string): KeyEvent => ({ key: k, ctrl: false, alt: false, shift: false, meta: false });

const press = (runner: AppRunner, keys: string): void => {
  for (const k of keys) runner.key(key(k));
};

const named = (runner: AppRunner, keys: string[]): void => {
  for (const k of keys) runner.key(key(k));
};

const HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<sem-facts view-as="flashcards">',
  '  <sem-fact>',
  '    <statement>first</statement>',
  '  </sem-fact>',
  '</sem-facts>',
  'tail line',
  '',
].join('\n');

const PAGE60 = Array.from({ length: 60 }, (_, i) => (i === 2 || i === 9 || i === 49 ? `fact ${i + 1}` : `line ${i + 1}`)).join('\n');

describe('the CommandSpec.app hook', () => {
  it('matches the CommandSpec.app signature (type pin)', () => {
    const spec: Pick<CommandSpec, 'app'> = { app: batApp };
    expect(typeof spec.app).toBe('function');
  });

  it('declines every path run() must report', () => {
    expect(batApp(makeCtx(['nope.html'], {}))).toBeNull(); // missing file
    expect(batApp(makeCtx(['demo'], {}, { dirs: ['/demo'] }))).toBeNull(); // operand is a directory
    expect(batApp(makeCtx(['--bogus', '/demo/x.html'], { '/demo/x.html': HTML }))).toBeNull();
    expect(batApp(makeCtx([], {}))).toBeNull(); // no operands, no stdin
    expect(batApp(makeCtx(['/demo/x.html'], { '/demo/x.html': HTML }, { color: false }))).toBeNull(); // piped
  });

  it('pages stdin when no operands are given', () => {
    const { screen } = harness(makeCtx([], {}, { stdin: 'piped text\n' }));
    expect(frame(screen)[0]).toBe('File: stdin');
    expect(frame(screen)[1]).toContain('piped text');
  });
});

describe('the pager', () => {
  it('first paint: header, gutter, status bar', () => {
    const { screen } = harness(makeCtx(['demo/x.html'], { '/demo/x.html': HTML }));
    const rows = frame(screen);
    expect(rows[0]).toBe('File: demo/x.html');
    expect(rows[1]).toContain('1 │ <!doctype html>');
    expect(rows[2]).toContain('2 │ <html lang="en">');
    expect(rows[screen.rows - 1]).toContain('lines 1-8 of 8');
    expect(rows[screen.rows - 1]).toContain('/ search');
  });

  it('syntax colour lands as cell attrs', () => {
    const { screen } = harness(makeCtx(['demo/x.html'], { '/demo/x.html': HTML }));
    const rows = frame(screen);
    const tagRow = rows.findIndex((text) => text.includes('<sem-facts'));
    expect(tagRow).toBeGreaterThan(0);
    const line = screen.alternate.lines[tagRow]!;
    expect(Array.from(line.fg).some((fg) => fg !== COLOR_DEFAULT)).toBe(true);
  });

  it('long lines truncate — row k is entry top+k, no wrap desync', () => {
    const long = `${'x'.repeat(200)} end`;
    const text = ['head', long, 'tail'].join('\n');
    const { screen } = harness(makeCtx(['long.txt'], { '/long.txt': text }));
    const rows = frame(screen);
    for (const row of rows) expect(stringWidth(row)).toBeLessThanOrEqual(screen.cols);
    expect(rows[2]).toContain('2 │ ');
    expect(rows[2]).toContain('xxxx');
    expect(rows[3]).toContain('3 │ tail');
  });

  it('arrow / page / home / end navigation', () => {
    const { screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    const bar = (): string => frame(screen)[screen.rows - 1] ?? '';
    expect(bar()).toContain('lines 1-22 of 60'); // header + lines 1..22
    named(runner, ['ArrowDown', 'ArrowDown', 'ArrowDown']);
    expect(bar()).toContain('lines 3-25 of 60');
    runner.key(key('PageDown'));
    expect(bar()).toContain('lines 25-47 of 60'); // one context line kept
    runner.key(key('PageUp'));
    expect(bar()).toContain('lines 3-25 of 60');
    runner.key(key('End'));
    expect(bar()).toContain('lines 38-60 of 60');
    runner.key(key('g'));
    expect(bar()).toContain('lines 1-22 of 60');
    runner.key(key('G'));
    expect(bar()).toContain('lines 38-60 of 60');
    runner.key(key('Home'));
    expect(bar()).toContain('lines 1-22 of 60');
  });

  it('q, :q and Esc exit through the runner', () => {
    const a = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    a.runner.key(key('q'));
    expect(a.exits).toEqual([[0, null]]);
    expect(a.screen.altScreen).toBe(false);

    const b = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    press(b.runner, ':q');
    b.runner.key(key('Enter'));
    expect(b.exits).toEqual([[0, null]]);

    const c = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    c.runner.key(key('Escape'));
    expect(c.exits).toEqual([[0, null]]);
  });

  it(':wq is refused with a note; the app stays live', () => {
    const { screen, runner, exits } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    press(runner, ':wq');
    runner.key(key('Enter'));
    expect(exits).toEqual([]);
    expect(frame(screen)[screen.rows - 1]).toContain('unknown command: :wq');
  });

  it('/ searches with highlight; n/N step and wrap', () => {
    const { screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    press(runner, '/');
    expect(frame(screen)[screen.rows - 1]!.startsWith('/')).toBe(true);
    named(runner, ['F', 'A', 'C', 'T']); // case-insensitive
    runner.key(key('Enter'));
    expect(frame(screen)[0]).toContain('fact 3');
    // REVERSE on the hit cells; the current hit is bold too
    const line = screen.alternate.lines[0]!;
    const at = lineText(line).indexOf('fact');
    expect(line.attrs[at]! & ATTR.REVERSE).toBeTruthy();
    expect(line.attrs[at]! & ATTR.BOLD).toBeTruthy();
    runner.key(key('n')); // next hit: row 10
    expect(frame(screen)[0]).toContain('fact 10');
    runner.key(key('N')); // back to the first hit
    expect(frame(screen)[0]).toContain('fact 3');
    runner.key(key('N')); // wraps backwards to the last hit
    const rowsAfter = frame(screen);
    const hitRow = rowsAfter.findIndex((r) => r.includes('fact 50'));
    expect(hitRow).toBeGreaterThan(0); // clamped to the last page, still visible
    const hitLine = screen.alternate.lines[hitRow]!;
    const hitAt = lineText(hitLine).indexOf('fact 50');
    expect(hitLine.attrs[hitAt]! & ATTR.REVERSE).toBeTruthy();
  });

  it('a missing pattern reports and keeps the pager alive', () => {
    const { screen, runner, exits } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    press(runner, '/zzz');
    runner.key(key('Enter'));
    expect(exits).toEqual([]);
    expect(frame(screen)[screen.rows - 1]).toContain('no match: /zzz');
  });

  it('an empty pattern clears the highlights', () => {
    const { screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    press(runner, '/fact');
    runner.key(key('Enter'));
    runner.key(key('/')); // prefilled with the last pattern
    named(runner, ['Backspace', 'Backspace', 'Backspace', 'Backspace']);
    runner.key(key('Enter'));
    expect(frame(screen)[screen.rows - 1]).not.toContain('/fact');
  });

  it('wheel deltas scroll (§7.3 app reporting)', () => {
    const { screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    runner.mouse({ kind: 'wheel', button: 0, col: 0, row: 0, ctrl: false, alt: false, shift: false, dx: 0, dy: 5 });
    expect(frame(screen)[screen.rows - 1]).toContain('lines 5-27 of 60');
    runner.mouse({ kind: 'wheel', button: 0, col: 0, row: 0, ctrl: false, alt: false, shift: false, dx: 0, dy: -50 });
    expect(frame(screen)[screen.rows - 1]).toContain('lines 1-22 of 60');
  });

  it('resize repaints at the new metrics', () => {
    const { screen, runner } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    screen.resize(40, 10);
    runner.onScreenResized(40, 10);
    const rows = frame(screen);
    expect(rows).toHaveLength(10);
    for (const row of rows) expect(stringWidth(row)).toBeLessThanOrEqual(40);
    expect(rows[9]).toContain('of 60');
  });

  it('a11ySummary announces the window (§9)', () => {
    const { app } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    expect(app.a11ySummary!()).toContain('pager: lines 1 to 22 of 60');
  });

  it('find() opens the search prompt (§8.5 Find… verb)', () => {
    const { app, screen } = harness(makeCtx(['p.txt'], { '/p.txt': PAGE60 }));
    app.find!();
    expect(frame(screen)[screen.rows - 1]!.startsWith('/')).toBe(true);
  });

  it('--plain pages bare: no header, no gutter, no colour', () => {
    const { screen } = harness(makeCtx(['--plain', '/demo/x.html'], { '/demo/x.html': HTML }));
    const rows = frame(screen);
    expect(rows[0]).not.toContain('File:');
    expect(rows[0]).toContain('<!doctype html>');
    expect(rows[0]).not.toContain('│');
    const line = screen.alternate.lines[2]!;
    expect(Array.from(line.fg).every((fg) => fg === COLOR_DEFAULT)).toBe(true);
  });
});

describe('the landing-script contract', () => {
  it('bat demo/example-deck.sem.html puts the deck source on screen', () => {
    const deck = readFileSync(
      new URL('../../src/terminal/plugins/demo/files/example-deck.sem.html', import.meta.url),
      'utf8',
    );
    const { screen, runner } = harness(makeCtx(['demo/example-deck.sem.html'], { '/demo/example-deck.sem.html': deck }));
    const onScreen = frame(screen).join('\n');
    expect(onScreen).toContain('sem-facts');
    expect(onScreen).toContain('view-as="flashcards"');
    runner.key(key('q'));
  });
});
