// Unit spec — ANSI/VT tokeniser: SGR state (src/terminal/ansi/sgr.ts).
//
// Feature: splitCsiParams
//   Scenario: an empty body is one empty group (SGR with no params = reset)
//   Scenario: semicolon groups and colon subparameters both split
//   Scenario: empty slots become null and malformed pieces stay null (never NaN)
// Feature: applySgr — attributes
//   Scenario: 1 bold, 2 dim, 3 italic, 4 underline, 5/6 blink, 7 reverse, 8 conceal, 9 strikeout
//   Scenario: 0 resets to defaults, later params in the same sequence still apply
//   Scenario: 22/23/24/25/27/28/29 clear their flags individually
//   Scenario: snapshots are frozen and the previous one is never mutated
// Feature: applySgr — colours
//   Scenario: 30–37/39 foreground, 40–47/49 background, 90–97/100–107 bright
//   Scenario: 38;5;n and 38:5:n indexed; 38;2;r;g;b and 38:2:r:g:b truecolour
//   Scenario: xterm's 38:2::r:g:b (empty colourspace slot) parses
//   Scenario: a malformed extended colour is consumed without losing the colour
//   Scenario: 58/59 underline colour — parameters consumed, colour untouched
// Feature: unknown parameters
//   Scenario: unknown codes (10, 26, 51, 200) are ignored, state unchanged

import { describe, it, expect } from 'vitest';
import { applySgr, splitCsiParams } from '../../src/terminal/ansi/sgr.js';
import { DEFAULT_SGR } from '../../src/terminal/ansi/types.js';
import type { AnsiColor } from '../../src/terminal/ansi/types.js';

const rgb = (r: number, g: number, b: number): AnsiColor => ({ kind: 'rgb', r, g, b });
const indexed = (n: number): AnsiColor => ({ kind: 'indexed', n });

describe('splitCsiParams', () => {
  it('an empty body is one empty group — SGR with no parameters resets', () => {
    expect(splitCsiParams('')).toEqual([[]]);
  });

  it('splits semicolon groups and colon subparameters', () => {
    expect(splitCsiParams('1;38:5:196;4')).toEqual([[1], [38, 5, 196], [4]]);
    expect(splitCsiParams('38;5;196')).toEqual([[38], [5], [196]]);
  });

  it('empty slots become null; malformed pieces stay null', () => {
    expect(splitCsiParams('1;;4')).toEqual([[1], [], [4]]);
    expect(splitCsiParams('38:2::7;0:255')).toEqual([[38, 2, null, 7], [0, 255]]);
    expect(splitCsiParams('x;y')).toEqual([[null], [null]]);
  });
});

describe('applySgr — attributes', () => {
  it('turns each single flag on', () => {
    expect(applySgr(DEFAULT_SGR, [[1]]).bold).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[2]]).dim).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[3]]).italic).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[4]]).underline).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[5]]).blink).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[6]]).rapidBlink).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[7]]).reverse).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[8]]).conceal).toBe(true);
    expect(applySgr(DEFAULT_SGR, [[9]]).strikeout).toBe(true);
  });

  it('SGR 0 resets, and later parameters in the same sequence still apply', () => {
    const bright = applySgr(DEFAULT_SGR, [[1], [31]]);
    expect(bright.bold).toBe(true);
    const after = applySgr(bright, [[0], [34]]);
    expect(after).toEqual({ ...DEFAULT_SGR, fg: { kind: 'named', code: 34 } });
  });

  it('an empty group acts as SGR 0', () => {
    const on = applySgr(DEFAULT_SGR, [[4]]);
    expect(applySgr(on, [[]])).toEqual(DEFAULT_SGR);
  });

  it('22/23/24/25/27/28/29 clear their flags individually', () => {
    const all = applySgr(DEFAULT_SGR, [[1], [2], [3], [4], [5], [7], [8], [9]]);
    expect(applySgr(all, [[22]])).toMatchObject({ bold: false, dim: false, italic: true });
    expect(applySgr(all, [[23]])).toMatchObject({ italic: false, bold: true });
    expect(applySgr(all, [[24]])).toMatchObject({ underline: false, bold: true });
    expect(applySgr(all, [[25]])).toMatchObject({ blink: false, rapidBlink: false, bold: true });
    expect(applySgr(all, [[27]])).toMatchObject({ reverse: false, bold: true });
    expect(applySgr(all, [[28]])).toMatchObject({ conceal: false, bold: true });
    expect(applySgr(all, [[29]])).toMatchObject({ strikeout: false, bold: true });
  });

  it('SGR 4 with an explicit 0 subparameter turns underline off', () => {
    expect(applySgr(DEFAULT_SGR, [[4, 0]]).underline).toBe(false);
    expect(applySgr(DEFAULT_SGR, [[4, 3]]).underline).toBe(true);
  });

  it('snapshots are frozen and the previous one is never mutated', () => {
    const first = applySgr(DEFAULT_SGR, [[1]]);
    const second = applySgr(first, [[31]]);
    expect(Object.isFrozen(second)).toBe(true);
    expect(first.bold).toBe(true);
    expect(first.fg).toEqual({ kind: 'default' });
  });
});

describe('applySgr — colours', () => {
  it('30–37/39 foreground, 40–47/49 background, 90–97/100–107 bright', () => {
    expect(applySgr(DEFAULT_SGR, [[31]]).fg).toEqual({ kind: 'named', code: 31 });
    expect(applySgr(DEFAULT_SGR, [[31]]).bg).toEqual({ kind: 'default' });
    expect(applySgr(DEFAULT_SGR, [[44]]).bg).toEqual({ kind: 'named', code: 44 });
    expect(applySgr(DEFAULT_SGR, [[92]]).fg).toEqual({ kind: 'named', code: 92 });
    expect(applySgr(DEFAULT_SGR, [[103]]).bg).toEqual({ kind: 'named', code: 103 });
    expect(applySgr(DEFAULT_SGR, [[39]]).fg).toEqual({ kind: 'default' });
    expect(applySgr(DEFAULT_SGR, [[49]]).bg).toEqual({ kind: 'default' });
  });

  it('indexed colours arrive in both semicolon and colon forms', () => {
    expect(applySgr(DEFAULT_SGR, [[38], [5], [196]]).fg).toEqual(indexed(196));
    expect(applySgr(DEFAULT_SGR, [[38, 5, 196]]).fg).toEqual(indexed(196));
    expect(applySgr(DEFAULT_SGR, [[48], [5], [21]]).bg).toEqual(indexed(21));
    expect(applySgr(DEFAULT_SGR, [[48, 5, 21]]).bg).toEqual(indexed(21));
  });

  it('truecolour arrives in both forms', () => {
    expect(applySgr(DEFAULT_SGR, [[38], [2], [7], [0], [255]]).fg).toEqual(rgb(7, 0, 255));
    expect(applySgr(DEFAULT_SGR, [[38, 2, 7, 0, 255]]).fg).toEqual(rgb(7, 0, 255));
    expect(applySgr(DEFAULT_SGR, [[48, 2, null, 7, 0, 255]]).bg).toEqual(rgb(7, 0, 255));
  });

  it('a malformed extended colour is consumed without clobbering the colour or following params', () => {
    // broken mode: xterm-faithful — the 38 and its mode group are consumed
    // together, so fg stays default and a following group still applies.
    const broken = applySgr(DEFAULT_SGR, [[38], [31]]);
    expect(broken.fg).toEqual({ kind: 'default' });
    expect(applySgr(DEFAULT_SGR, [[38], [31], [1]]).bold).toBe(true);
    // out-of-range index: colour unchanged, sequence consumed
    const keep = applySgr(DEFAULT_SGR, [[31], [38, 5, 999]]);
    expect(keep.fg).toEqual({ kind: 'named', code: 31 });
    // truncated at end of sequence: colour unchanged
    expect(applySgr(DEFAULT_SGR, [[38]]).fg).toEqual({ kind: 'default' });
  });

  it('58/59 underline colour: parameters consumed, colours untouched', () => {
    const red = applySgr(DEFAULT_SGR, [[31]]);
    const underlineColour = applySgr(red, [[58], [5], [196]]);
    expect(underlineColour.fg).toEqual({ kind: 'named', code: 31 });
    expect(applySgr(red, [[59]]).fg).toEqual({ kind: 'named', code: 31 });
  });
});

describe('applySgr — unknown parameters', () => {
  it('unknown codes are ignored and state is unchanged', () => {
    for (const code of [10, 26, 51, 200, -1]) {
      expect(applySgr(DEFAULT_SGR, [[code]])).toEqual(DEFAULT_SGR);
    }
  });
});
