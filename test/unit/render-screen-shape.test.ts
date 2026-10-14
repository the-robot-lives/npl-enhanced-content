// Unit spec — renderer lane: the paint-screen adapter + fixtures
// (src/terminal/render/screen-shape.ts).
//
// Feature: buildPaintScreen (fixture)
//   Scenario: rows become lines; blanks pad to the grid
//   Scenario: a wide character takes two cells — base width 2 + width-0 continuation
//   Scenario: wrapped flags ride through; cursor and selection pass through
// Feature: screenView (real ScreenModel adapter)
//   Scenario: lineAt materializes SoA cells (code, width, attrs, colors)
//   Scenario: rowOfLine resolves the viewport row of a live line ref
//   Scenario: absoluteLineAt offsets by viewportTop
//   Scenario: the cursor maps into viewport space or nulls when scrolled off
//   Scenario: selection passes through as a one-element list
//   Scenario: rgbOf resolves palette, cube, truecolor and default refs
// Feature: range helpers
//   Scenario: normalizeRange orders endpoints
//   Scenario: colsOnLine clamps to the row and normalizes
//   Scenario: rangeOverlapsLine tests membership

import { describe, it, expect } from 'vitest';
import {
  buildPaintScreen,
  colsOnLine,
  defaultRgb,
  normalizeRange,
  rangeOverlapsLine,
  screenView,
  type ScreenModel,
} from '../../src/terminal/render/screen-shape.js';
import { ATTR } from '../../src/terminal/screen/types.js';

/* ---------------------------------------------------------------- *
 * helpers
 * ---------------------------------------------------------------- */

/** Minimal SoA Line builder shaped like the screen model's storage. */
function makeLine(cols: number, text: string, opts: { wrapped?: boolean; attrs?: number; fg?: number } = {}) {
  const codes = new Uint32Array(cols);
  const widths = new Uint8Array(cols).fill(1);
  const fg = new Uint16Array(cols).fill(opts.fg ?? 0xffff);
  const bg = new Uint16Array(cols).fill(0xffff);
  const attrs = new Uint16Array(cols).fill(opts.attrs ?? 0);
  for (let i = 0; i < Math.min(cols, text.length); i++) codes[i] = text.charCodeAt(i);
  return {
    cols, codes, widths, fg, bg, attrs,
    combining: null,
    wrapped: opts.wrapped ?? false,
    dirty: false,
    stale: false,
  };
}

/** Minimal ScreenModel stub carrying only what screenView reads. */
function makeModel(lines: ReturnType<typeof makeLine>[], opts: { cols?: number; top?: number; cursorLine?: number; cursorCol?: number; visible?: boolean; selection?: never } = {}) {
  const cols = opts.cols ?? (lines[0]?.cols ?? 80);
  const rows = lines.length;
  return {
    cols,
    rows,
    active: { kind: 'primary' as const, rows, cols, lines },
    cursor: { line: opts.cursorLine ?? rows - 1, col: opts.cursorCol ?? 0, visible: opts.visible ?? true, style: 'block' as const },
    selection: null,
    viewportTop: () => opts.top ?? 0,
    totalLines: () => (opts.top ?? 0) + rows,
  } as unknown as ScreenModel;
}

/* ---------------------------------------------------------------- *
 * buildPaintScreen
 * ---------------------------------------------------------------- */

describe('buildPaintScreen (fixture)', () => {
  it('rows become lines; blanks pad to the grid', () => {
    const screen = buildPaintScreen(['ab', 'c'], { cols: 4 });
    expect(screen.rows).toBe(2);
    expect(screen.cols).toBe(4);
    const row = screen.lineAt(0);
    expect(row?.cell(0).code).toBe('a'.charCodeAt(0));
    expect(row?.cell(3).code).toBe(0);
    expect(screen.lineAt(2)).toBeNull();
  });

  it('a wide character takes two cells — base width 2 + width-0 continuation', () => {
    const screen = buildPaintScreen(['漢x'], { cols: 4 });
    const row = screen.lineAt(0)!;
    expect(row.cell(0).width).toBe(2);
    expect(row.cell(1).width).toBe(0);
    expect(row.cell(2).code).toBe('x'.charCodeAt(0));
  });

  it('wrapped flags ride through; cursor and selection pass through', () => {
    const cursor = { row: 0, col: 1, visible: true, style: 'block' as const };
    const selection = [{ start: { line: 0, col: 0 }, end: { line: 1, col: 2 } }];
    const screen = buildPaintScreen([
      { text: 'ab', wrapped: true },
      'cd',
    ], { cursor, selection });
    expect(screen.lineAt(0)?.wrapped).toBe(true);
    expect(screen.lineAt(1)?.wrapped).toBe(false);
    expect(screen.cursor()).toEqual(cursor);
    expect(screen.selection()).toEqual(selection);
    expect(screen.rowOfLine(screen.lineAt(1)!)).toBe(1);
  });
});

/* ---------------------------------------------------------------- *
 * screenView
 * ---------------------------------------------------------------- */

describe('screenView (real ScreenModel adapter)', () => {
  it('lineAt materializes SoA cells (code, width, attrs, colors)', () => {
    const model = makeModel([makeLine(4, 'ab', { attrs: ATTR.BOLD, fg: 3 })]);
    const view = screenView(model);
    const cell = view.lineAt(0)!.cell(1);
    expect(cell.code).toBe('b'.charCodeAt(0));
    expect(cell.width).toBe(1);
    expect(cell.attrs).toBe(ATTR.BOLD);
    expect(cell.fg).toBe(3);
    expect(cell.bg).toBe(0xffff);
  });

  it('rowOfLine resolves the viewport row of a live line ref', () => {
    const lines = [makeLine(4, 'a'), makeLine(4, 'b'), makeLine(4, 'c')];
    const view = screenView(makeModel(lines));
    expect(view.rowOfLine(lines[1])).toBe(1);
    expect(view.rowOfLine(makeLine(4, 'zz'))).toBeNull();
  });

  it('absoluteLineAt offsets by viewportTop', () => {
    const view = screenView(makeModel([makeLine(4, 'a'), makeLine(4, 'b')], { top: 40 }));
    expect(view.absoluteLineAt(0)).toBe(40);
    expect(view.absoluteLineAt(1)).toBe(41);
    expect(view.absoluteLineAt(2)).toBeNull();
  });

  it('the cursor maps into viewport space, or nulls when scrolled off', () => {
    const visible = screenView(makeModel([makeLine(4, 'a')], { cursorLine: 0, cursorCol: 2, top: 0 }));
    expect(visible.cursor()).toEqual({ row: 0, col: 2, visible: true, style: 'block' });
    const gone = screenView(makeModel([makeLine(4, 'a')], { cursorLine: -1, top: 0 }));
    expect(gone.cursor()).toBeNull();
  });

  it('selection passes through as a one-element list', () => {
    const model = makeModel([makeLine(4, 'a')]);
    const range = { start: { line: 0, col: 0 }, end: { line: 0, col: 1 } };
    (model as { selection: unknown }).selection = range;
    expect(screenView(model).selection()).toEqual([range]);
    expect(screenView(makeModel([makeLine(4, 'a')])).selection()).toEqual([]);
  });

  it('rgbOf resolves palette, cube, truecolor and default refs', () => {
    const view = screenView(makeModel([makeLine(2, 'a')]), {
      ansiRgb: (i) => (i === 1 ? { r: 1, g: 2, b: 3 } : null),
      truecolorAt: (slot) => (slot === 0 ? [9, 8, 7] : null),
    });
    expect(view.rgbOf(1, 'fg')).toEqual({ r: 1, g: 2, b: 3 });
    expect(view.rgbOf(0, 'fg')).toBeNull(); // themed slot the stub can't resolve
    expect(view.rgbOf(196, 'fg')).toEqual({ r: 0xff, g: 0x00, b: 0x00 }); // xterm 196 = cube corner red
    expect(view.rgbOf(0x8000, 'fg')).toEqual({ r: 9, g: 8, b: 7 });
    expect(view.rgbOf(0x8040, 'fg')).toBeNull(); // unbacked truecolor slot
    expect(view.rgbOf(0xffff, 'fg')).toBeNull(); // theme default — renderer composes
  });
});

describe('range helpers', () => {
  it('normalizeRange orders endpoints', () => {
    const a = { line: 3, col: 5 };
    const b = { line: 1, col: 9 };
    expect(normalizeRange({ start: a, end: b })).toEqual({ start: b, end: a });
    expect(normalizeRange({ start: b, end: a })).toEqual({ start: b, end: a });
  });

  it('colsOnLine clamps to the row and normalizes', () => {
    const range = { start: { line: 0, col: 2 }, end: { line: 2, col: 9 } };
    expect(colsOnLine(range, 0, 80)).toEqual({ from: 2, to: 80 });
    expect(colsOnLine(range, 2, 80)).toEqual({ from: 0, to: 9 });
    expect(colsOnLine(range, 1, 80)).toEqual({ from: 0, to: 80 });
    expect(colsOnLine(range, 3, 80)).toEqual({ from: 0, to: 0 });
  });

  it('rangeOverlapsLine tests membership', () => {
    const range = { start: { line: 1, col: 0 }, end: { line: 2, col: 0 } };
    expect(rangeOverlapsLine(range, 1)).toBe(true);
    expect(rangeOverlapsLine(range, 2)).toBe(true);
    expect(rangeOverlapsLine(range, 0)).toBe(false);
    expect(rangeOverlapsLine(range, 3)).toBe(false);
  });
});

describe('defaultRgb (cube table)', () => {
  it('reproduces xterm cube corners', () => {
    expect(defaultRgb(16)).toEqual({ r: 0, g: 0, b: 0 });
    expect(defaultRgb(196)).toEqual({ r: 0xff, g: 0x00, b: 0x00 }); // xterm 196 = cube corner red
    expect(defaultRgb(231)).toEqual({ r: 0xff, g: 0xff, b: 0xff });
    expect(defaultRgb(255)).toEqual({ r: 0xee, g: 0xee, b: 0xee }); // gray ramp top: (255-232)*10+8
    expect(defaultRgb(999)).toBeNull();
  });
});
