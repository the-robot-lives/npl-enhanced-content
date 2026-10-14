// Unit spec — renderer lane: selection geometry + viewport text
// (src/terminal/render/selection.ts).
//
// Feature: lineText
//   Scenario: blank cells render as spaces; width-0 continuation cells are skipped
//   Scenario: combining marks ride their base character
// Feature: viewportText
//   Scenario: rows join with newlines, trailing spaces trim per row
//   Scenario: wrapped continuations join without a newline
//   Scenario: a selection slice restricts each row's span
//   Scenario: absent rows are skipped
// Feature: selectionRowRuns
//   Scenario: one range fans out into per-row runs, reverse order normalized
//   Scenario: rows outside the range produce no runs

import { describe, it, expect } from 'vitest';
import { buildPaintScreen, type PaintScreen } from '../../src/terminal/render/screen-shape.js';
import { lineText, selectionRowRuns, viewportText } from '../../src/terminal/render/selection.js';
import type { SelectionRange } from '../../src/terminal/screen/types.js';

const range = (sl: number, sc: number, el: number, ec: number): SelectionRange => ({
  start: { line: sl, col: sc },
  end: { line: el, col: ec },
});

describe('lineText', () => {
  it('blank cells render as spaces; width-0 continuation cells are skipped', () => {
    const screen = buildPaintScreen(['a 漢b'], { cols: 6 });
    const row = screen.lineAt(0)!;
    // 'a', ' ', '漢'(wide, col2) + width-0 col3, 'b' col4, blank col5
    expect(lineText(row)).toBe('a 漢b ');
  });

  it('combining marks ride their base character', () => {
    const screen = buildPaintScreen(['e'], { cols: 2 });
    const row = screen.lineAt(0)!;
    // Inject a combining acute onto cell 0 through the fixture's cells.
    const cell = row.cell(0);
    cell.combining.push(0x0301);
    // Raw code points serialize as stored — no NFC normalization (v1 parity).
    expect(lineText(row)).toBe('e\u0301 ');
  });
});

describe('viewportText', () => {
  it('rows join with newlines, trailing spaces trim per row', () => {
    const screen = buildPaintScreen(['ab   ', 'cd  '], { cols: 5 });
    expect(viewportText(screen)).toBe('ab\ncd');
  });

  it('wrapped continuations join without a newline', () => {
    // §4.3: the wrap flag rides the CONTINUATION line.
    const screen = buildPaintScreen([
      { text: 'hel' },
      { text: 'lo', wrapped: true },
      'next',
    ], { cols: 4 });
    expect(viewportText(screen)).toBe('hello\nnext');
  });

  it("a selection slice restricts each row's span", () => {
    const screen = buildPaintScreen(['abcdef', 'ghijkl'], { cols: 6 });
    const slice = range(0, 2, 1, 3); // row0 cols2.., row1 ..3
    expect(viewportText(screen, slice)).toBe('cdef\nghi');
  });

  it('absent rows are skipped', () => {
    const screen: PaintScreen = buildPaintScreen(['a', 'b'], { cols: 2 });
    // Make row 0 absent (no line, no abs) — the fixture API can't, so go via
    // a thin delegating wrapper that hides row 0.
    const masked: PaintScreen = {
      ...screen,
      lineAt: (row) => (row === 0 ? null : screen.lineAt(row)),
      absoluteLineAt: (row) => (row === 0 ? null : screen.absoluteLineAt(row)),
    };
    expect(viewportText(masked)).toBe('b');
  });
});

describe('selectionRowRuns', () => {
  it('one range fans out into per-row runs, reverse order normalized', () => {
    const screen = buildPaintScreen(['aaaa', 'bbbb', 'cccc'], { cols: 4 });
    const runs = selectionRowRuns(screen, [range(2, 2, 0, 1)]);
    expect(runs).toEqual([
      { row: 0, from: 1, to: 4 },
      { row: 1, from: 0, to: 4 },
      { row: 2, from: 0, to: 2 },
    ]);
  });

  it('rows outside the range produce no runs', () => {
    const screen = buildPaintScreen(['aaaa', 'bbbb', 'cccc'], { cols: 4 });
    expect(selectionRowRuns(screen, [range(1, 1, 1, 3)])).toEqual([{ row: 1, from: 1, to: 3 }]);
    expect(selectionRowRuns(screen, [range(5, 0, 6, 0)])).toEqual([]);
  });
});
