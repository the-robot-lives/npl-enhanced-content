// @vitest-environment happy-dom
// Unit spec — the `semtext tui` grid app (src/terminal/tui-app.ts): paint
// into a real Screen through a recording AppContext, keys through the
// machine's table, mouse focus/expand + wheel, resize, and teardown.
//
// Feature: the grid app
//   Scenario: start paints the header, the tree, and the key hint; hides
//             the cursor and asks for mouse reporting
//   Scenario: the cursor row paints reverse (stored, never baked)
//   Scenario: q exits 0 and stop() restores cursor visibility
//   Scenario: '/' filters live; the hint row reflects the mode
//   Scenario: a click focuses a row and expands a collapsed block
//   Scenario: the wheel scrolls the window when rows overflow
//   Scenario: resize repaints at the new size

import { describe, it, expect } from 'vitest';
import { Screen, lineText } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import { ATTR } from '../../src/terminal/screen/types.js';
import type { AppContext, KeyEvent, MouseEvent, ScreenWriter, StatusTone } from '../../src/terminal/screen/types.js';
import { createTuiApp } from '../../src/terminal/tui-app.js';
import { buildTuiTree } from '../../src/terminal/plugins/demo/tui-tree.js';

const DOC = `<html><body>
<h1>Auth Notes</h1>
<h2 id="start">Getting started</h2>
<sem-properties label="Token shape"><sem-property>audience: wizards</sem-property></sem-properties>
<h2 id="api">API surface</h2>
<sem-note>note body text</sem-note>
</body></html>`;

const key = (k: string, extra: Partial<KeyEvent> = {}): KeyEvent => ({
  key: k,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...extra,
});

const press = (row: number, col = 0): MouseEvent => ({
  kind: 'press',
  button: 0,
  col,
  row,
  ctrl: false,
  alt: false,
  shift: false,
  dx: 0,
  dy: 0,
});

const wheel = (dy: number): MouseEvent => ({
  kind: 'wheel',
  button: 0,
  col: 0,
  row: 0,
  ctrl: false,
  alt: false,
  shift: false,
  dx: 0,
  dy,
});

interface Harness {
  app: ReturnType<typeof createTuiApp>;
  screen: Screen;
  ctx: AppContext;
  row(i: number): string;
  exits: number[];
  titles: string[];
  statuses: { text: string; tone?: StatusTone }[];
  mouse: boolean[];
}

/** A 60-col screen: header row 0, tree rows 2…, hint row (rows-1). */
function harness(doc = DOC, rows = 6): Harness {
  const screen = new Screen({ cols: 60, rows });
  const feed = new ScreenFeed(screen);
  // the runner's ScreenWriter shape: writes go through the feed, the
  // cursor mutators live on the screen's CursorState (runner.ts #context)
  const writer: ScreenWriter = {
    write: (text: string): void => feed.write(text),
    writeln: (text = ''): void => feed.write(`${text}\r\n`),
    moveTo: (col: number, row: number): void => screen.moveCursor(row, col),
    eraseDisplay: (mode: 0 | 1 | 2 = 0): void => screen.eraseDisplay(mode),
    eraseLine: (mode: 0 | 1 | 2 = 0): void => screen.eraseLine(mode),
    setCursorVisible: (visible: boolean): void => {
      screen.cursor.visible = visible;
    },
    setCursorStyle: (style: 'block' | 'bar' | 'underline'): void => {
      screen.cursor.style = style;
    },
  };
  const exits: number[] = [];
  const titles: string[] = [];
  const statuses: { text: string; tone?: StatusTone }[] = [];
  const mouse: boolean[] = [];
  const ctx: AppContext = {
    screen: writer,
    get cols() {
      return screen.cols;
    },
    get rows() {
      return screen.rows;
    },
    setTitle: (t: string) => titles.push(t),
    setStatus: (text: string, tone?: StatusTone) => statuses.push({ text, tone }),
    requestMouse: (on: boolean) => mouse.push(on),
    exit: (code = 0) => exits.push(code),
  };
  const built = buildTuiTree(doc);
  const app = createTuiApp(built.roots, built.title);
  const row = (i: number): string => lineText(screen.primary.lines[i]!);
  return { app, screen, ctx, row, exits, titles, statuses, mouse };
}

describe('the semtext tui grid app', () => {
  it('start paints header, tree, hint; hides the cursor and asks for mouse', () => {
    const h = harness();
    h.app.start(h.ctx);
    expect(h.mouse).toEqual([true]);
    expect(h.titles).toEqual(['Auth Notes — semtext tui']);
    expect(h.row(0)).toContain('semtext tui — Auth Notes');
    expect(h.row(0)).toContain('5 rows'); // the row count sits in the header
    expect(h.row(2)).toContain('1 Auth Notes');
    expect(h.row(3)).toContain('1.1 Getting started');
    expect(h.row(5)).toContain('j/k'); // the key hint
    expect(h.screen.cursor.visible).toBe(false);
  });

  it('the cursor row paints reverse (stored, never baked)', () => {
    const h = harness();
    h.app.start(h.ctx);
    const first = h.screen.primary.lines[2]!.attrs[0]!;
    expect(first & ATTR.REVERSE).toBe(ATTR.REVERSE);
    const other = h.screen.primary.lines[3]!.attrs[0]!;
    expect(other & ATTR.REVERSE).toBe(0);
  });

  it('q exits 0; stop() restores cursor visibility', () => {
    const h = harness();
    h.app.start(h.ctx);
    h.app.key(key('q'));
    expect(h.exits).toEqual([0]);
    h.app.stop();
    expect(h.screen.cursor.visible).toBe(true);
  });

  it("'/' filters live and the hint row reflects the mode", () => {
    const h = harness();
    h.app.start(h.ctx);
    h.app.key(key('/'));
    expect(h.row(5)).toContain('filter:');
    h.app.key(key('a'));
    h.app.key(key('u'));
    h.app.key(key('t'));
    h.app.key(key('h'));
    expect(h.row(5)).toContain('auth');
    // the matching root stays visible with its path
    expect(h.row(2)).toContain('Auth Notes');
    h.app.key(key('Enter'));
    expect(h.row(5)).toContain('j/k'); // the hint is back
  });

  it('a click focuses a row and expands a collapsed block in place', () => {
    const h = harness(DOC, 10); // taller screen: the opened body fits
    h.app.start(h.ctx);
    expect(h.row(4)).toContain('Token shape'); // the folded block row
    h.app.mouse(press(4)); // tree row 2 = the block
    expect(h.row(4)).toContain('Token shape');
    expect(h.row(5)).toContain('audience'); // its body opened beneath it
  });

  it('the wheel scrolls when the tree overflows the window', () => {
    const h = harness('<html><body><h1>T</h1><h2>a</h2><sem-note>one</sem-note><h2>b</h2><sem-note>two</sem-note><h2>c</h2><sem-note>three</sem-note></body></html>');
    h.app.start(h.ctx);
    expect(h.row(2)).toContain('1 T');
    h.app.mouse(wheel(2)); // 3 visible rows, more below
    expect(h.row(2)).not.toContain('1 T'); // the window moved
    h.app.mouse(wheel(-9)); // clamps back to the top
    expect(h.row(2)).toContain('1 T');
  });

  it('resize repaints at the new geometry', () => {
    const h = harness();
    h.app.start(h.ctx);
    h.screen.resize(70, 10);
    h.app.resize();
    expect(h.row(0)).toContain('semtext tui — Auth Notes');
    expect(h.row(9)).toContain('j/k'); // the hint moved to the new last row
  });

  it('find() opens the filter; Escape from the hint quits via the machine', () => {
    const h = harness();
    h.app.start(h.ctx);
    h.app.find();
    expect(h.row(5)).toContain('filter:');
    h.app.key(key('Escape'));
    expect(h.row(5)).toContain('j/k'); // Escape ended the filter, not the app
    expect(h.exits).toEqual([]);
    h.app.key(key('Escape')); // now it quits
    expect(h.exits).toEqual([0]);
  });
});
