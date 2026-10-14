// Unit spec — the mouse half of the input model
// (src/terminal/input/mouse.ts, CORE-V2 §7.3, §4.3, §9). Pure data: pixels
// in, cells and report strings out; a fake getLine drives extractText.
//
// Feature: cellFromPoint
//   Scenario: floors the pixel offset onto the grid
//   Scenario: clamps to the viewport on both axes
// Feature: SGR-1006 encoding
//   Scenario: buttons 0/1/2; motion adds 32; mods add 4/8/16
//   Scenario: wheel encodes 64/65 by direction
//   Scenario: sgrSequence is <btn;col;row M|m> with 1-based coordinates
// Feature: SelectionState
//   Scenario: begin/extend/end track a stream selection, ordered start ≤ end
//   Scenario: a backwards drag normalizes to start-at-top-left
//   Scenario: rectangular (Alt) selection bounds corners
//   Scenario: extractText slices stream and rectangular selections
//   Scenario: clip degrades a live selection to the retained window
//   Scenario: an empty or absent selection extracts nothing

import { describe, expect, it } from 'vitest';
import {
  SelectionState,
  cellFromPoint,
  sgrButtonNumber,
  sgrSequence,
  sgrWheelButton,
} from '../../src/terminal/input/mouse.js';
import { NO_MODS, type CellMetrics, type Mods } from '../../src/terminal/input/types.js';

const metrics: CellMetrics = { cellWidth: 9, cellHeight: 18, cols: 80, rows: 24 };
const mods = (over: Partial<Mods> = {}): Mods => ({ ...NO_MODS, ...over });
/** The screen contract's flat MouseEvent, defaults for the no-mods left click. */
const base = { button: 0 as 0, col: 0, row: 0, ctrl: false, alt: false, shift: false, dx: 0, dy: 0 };

describe('cellFromPoint', () => {
  it('floors the pixel offset onto the grid', () => {
    expect(cellFromPoint(0, 0, metrics)).toEqual({ col: 0, row: 0 });
    expect(cellFromPoint(8.9, 17.9, metrics)).toEqual({ col: 0, row: 0 });
    expect(cellFromPoint(9, 18, metrics)).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint(9 * 10 + 8, 18 * 5 + 3, metrics)).toEqual({ col: 10, row: 5 });
  });
  it('clamps to the viewport on both axes', () => {
    expect(cellFromPoint(-50, -1, metrics)).toEqual({ col: 0, row: 0 });
    expect(cellFromPoint(90_000, 90_000, metrics)).toEqual({ col: 79, row: 23 });
  });
});

describe('SGR-1006 encoding', () => {
  it('encodes buttons 0/1/2 and stacks modifier bits (4 shift, 8 meta, 16 ctrl)', () => {
    expect(sgrButtonNumber('press', 0, NO_MODS)).toBe(0);
    expect(sgrButtonNumber('press', 1, NO_MODS)).toBe(1);
    expect(sgrButtonNumber('press', 2, NO_MODS)).toBe(2);
    expect(sgrButtonNumber('press', 0, mods({ shift: true }))).toBe(4);
    expect(sgrButtonNumber('press', 0, mods({ meta: true }))).toBe(8);
    expect(sgrButtonNumber('press', 0, mods({ ctrl: true }))).toBe(16);
    expect(sgrButtonNumber('press', 2, mods({ ctrl: true, shift: true }))).toBe(22);
  });
  it('adds 32 for drag and encodes wheel as 64 + direction', () => {
    expect(sgrButtonNumber('drag', 0, NO_MODS)).toBe(32);
    expect(sgrButtonNumber('drag', 0, mods({ ctrl: true }))).toBe(48);
    expect(sgrWheelButton(-120, NO_MODS)).toBe(64); // up
    expect(sgrWheelButton(120, NO_MODS)).toBe(65); // down
    expect(sgrWheelButton(120, mods({ shift: true }))).toBe(69);
  });
  it('sgrSequence renders <btn;col;row M|m> with 1-based coordinates', () => {
    expect(sgrSequence({ ...base, kind: 'press', col: 0, row: 0 })).toBe('<0;1;1M');
    expect(sgrSequence({ ...base, kind: 'release', col: 9, row: 4 })).toBe('<0;10;5m');
    expect(sgrSequence({ ...base, kind: 'drag', col: 3, row: 2 })).toBe('<32;4;3M');
    expect(sgrSequence({ ...base, kind: 'wheel', col: 1, row: 1, dy: 120 })).toBe('<65;2;2M'); // wheel reports its cell
  });
});

describe('SelectionState', () => {
  it('tracks begin/extend/end and orders start ≤ end', () => {
    const s = new SelectionState();
    expect(s.ordered()).toBeNull();
    s.begin(10, 4);
    expect(s.ordered()).toEqual({ start: { line: 10, col: 4 }, end: { line: 10, col: 4 } });
    s.extend(12, 7);
    expect(s.ordered()).toEqual({ start: { line: 10, col: 4 }, end: { line: 12, col: 7 } });
    s.end();
    expect(s.dragging).toBe(false);
    expect(s.ordered()).not.toBeNull(); // the range survives for copy
    s.clear();
    expect(s.ordered()).toBeNull();
  });

  it('normalizes a backwards drag to start-at-top-left', () => {
    const s = new SelectionState();
    s.begin(20, 30);
    s.extend(18, 2);
    expect(s.ordered()).toEqual({ start: { line: 18, col: 2 }, end: { line: 20, col: 30 } });
  });

  it('bounds rectangular selections by corners', () => {
    const s = new SelectionState();
    s.begin(10, 30, true); // anchor top-right…
    s.extend(14, 5); // …dragged to bottom-left
    expect(s.ordered()).toEqual({ start: { line: 10, col: 5 }, end: { line: 14, col: 30 } });
  });

  it('extractText slices stream selections over logical lines', () => {
    const s = new SelectionState();
    const lines = ['hello world', 'second line', 'third'];
    const get = (line: number): string => lines[line] ?? '';
    s.begin(0, 6);
    expect(s.extractText(get)).toBe(''); // a click without a drag copies nothing
    s.extend(2, 3);
    expect(s.extractText(get)).toBe('world\nsecond line\nthir');
    s.clear();
    expect(s.extractText(get)).toBe('');
  });

  it('extractText slices rectangular selections per line', () => {
    const s = new SelectionState();
    const lines = ['aaaa bbbb', 'cccc dddd'];
    s.begin(0, 5, true);
    s.extend(1, 8);
    expect(s.extractText((line) => lines[line] ?? '')).toBe('bbbb\ndddd');
  });

  it('clip degrades a live selection to the retained window, clearing when empty', () => {
    const s = new SelectionState();
    s.begin(0, 2);
    s.extend(10, 8);
    s.clip(5, 20); // line 0 evicted: the anchor clamps to the oldest retained line
    expect(s.ordered()).toEqual({ start: { line: 5, col: 0 }, end: { line: 10, col: 8 } });
    s.clip(30, 40); // nothing left in range at all
    expect(s.ordered()).toBeNull();
  });

  it('isEmpty reports absent and single-cell selections', () => {
    const s = new SelectionState();
    expect(s.isEmpty()).toBe(true);
    s.begin(3, 3);
    expect(s.isEmpty()).toBe(true); // a click without a drag is not a selection
    s.clear();
    s.begin(1, 0, true);
    s.extend(1, 0); // a zero-size rectangle is still one cell
    expect(s.isEmpty()).toBe(false);
  });
});
