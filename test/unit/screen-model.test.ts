// Unit spec — the Screen model (CORE-V2 §4)
//
// Feature: the grid
//   Scenario: autowrap splits at the column, the wrapped flag marks continuations
//   Scenario: a wide glyph never straddles the right margin
//   Scenario: combining marks fold onto the base cell
// Feature: the scrollback ring
//   Scenario: scrolled-off lines land in the ring with stable absolute lines
//   Scenario: eviction clips a live selection instead of invalidating it
// Feature: damage
//   Scenario: writes mark dirty lines once; takeDamage resets the batch
// Feature: resize + reflow
//   Scenario: primary re-wraps via wrapped flags; the cursor keeps its place
// Feature: alternate screen
//   Scenario: enter/exit restores the primary exactly
// Feature: clear
//   Scenario: clearViewport empties the view, keeps the scrollback

import { describe, it, expect } from 'vitest';
import { Screen, lineText } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import { ATTR } from '../../src/terminal/screen/types.js';

const text = (screen: Screen, abs: number): string => {
  const line = screen.lineAt(abs);
  return line === null ? '' : lineText(line);
};

describe('the grid', () => {
  it('autowrap splits at the column; wrapped marks continuations', () => {
    const screen = new Screen({ cols: 20, rows: 4, scrollback: 50 });
    screen.print('abcdefghijklmnopqrstUVWXYZ');
    expect(screen.primary.lines[0]?.wrapped).toBe(true);
    expect(screen.primary.lines[1]?.wrapped).toBe(false);
    expect(text(screen, 0)).toBe('abcdefghijklmnopqrst');
    expect(text(screen, screen.viewportTop() + 1)).toBe('UVWXYZ');
  });

  it('a wide glyph never straddles the right margin', () => {
    const screen = new Screen({ cols: 20, rows: 4, scrollback: 10 });
    screen.print('ab');
    screen.print('漢');
    expect(text(screen, screen.viewportTop())).toBe('ab漢');
    expect(screen.cursor.col).toBe(4);
    screen.print('c'.repeat(15)); // col 19 = margin → next wide wraps
    screen.print('漢');
    expect(text(screen, screen.viewportTop())).toBe('ab漢' + 'c'.repeat(15));
    expect(text(screen, screen.viewportTop() + 1)).toBe('漢'); // last cell left blank
  });

  it('combining marks fold onto the base cell', () => {
    const screen = new Screen({ cols: 10, rows: 2, scrollback: 5 });
    screen.print('e\u0301'); // e + combining acute (NFD e-acute)
    const line = screen.primary.lines[0]!;
    expect(line.combining?.get(0)).toEqual([0x0301]);
    expect(text(screen, screen.viewportTop())).toBe('e\u0301');
    expect(screen.cursor.col).toBe(1); // one cell, two code points
  });
});

describe('the scrollback ring', () => {
  it('scrolled-off lines land in the ring; absolute lines stay stable', () => {
    const screen = new Screen({ cols: 10, rows: 2, scrollback: 50 });
    const feed = new ScreenFeed(screen);
    feed.write('one\r\ntwo\r\nthree\r\nfour');
    expect(text(screen, 0)).toBe('one');
    expect(text(screen, 1)).toBe('two');
    expect(text(screen, 2)).toBe('three');
    expect(screen.totalLines()).toBe(4);
  });

  it('eviction clips a live selection instead of invalidating it', () => {
    const screen = new Screen({ cols: 10, rows: 2, scrollback: 2 });
    const feed = new ScreenFeed(screen);
    feed.write('one\r\ntwo\r\nthree\r\nfour');
    // ring holds three/two… capacity 2 → oldest evicted; select lines 1-2
    screen.setSelection({ start: { line: 1, col: 0 }, end: { line: 2, col: 3 } });
    feed.write('\r\nfive');
    const sel = screen.selection;
    expect(sel).not.toBeNull();
    expect(sel!.end.line).toBeLessThanOrEqual(screen.totalLines() - 1);
    if (sel!.start.line < 0) expect.fail('selection start below zero');
  });
});

describe('damage', () => {
  it('writes mark dirty lines once; takeDamage resets the batch', () => {
    const screen = new Screen({ cols: 10, rows: 3, scrollback: 5 });
    screen.print('abc');
    const batch = screen.takeDamage();
    expect(batch.lines.size).toBeGreaterThan(0);
    expect(screen.takeDamage().lines.size).toBe(0);
    expect(batch.cursor).toBe(true);
  });
});

describe('resize + reflow', () => {
  it('primary re-wraps; the cursor keeps its logical place', () => {
    const screen = new Screen({ cols: 10, rows: 4, scrollback: 50 });
    screen.print('one two three four');
    screen.resize(5, 4);
    const all = Array.from({ length: screen.totalLines() }, (_, i) => text(screen, i)).join('|');
    expect(all.replace(/\|/g, '')).toBe('one two three four');
    // cursor sits on the last logical row's viewport row
    expect(screen.cursorRow).toBeLessThan(screen.rows);
    screen.resize(20, 4); // unwrap
    expect(text(screen, screen.viewportTop()).trim()).toBe('one two three four');
  });
});

describe('the alternate screen', () => {
  it('enter/exit restores the primary exactly', () => {
    const screen = new Screen({ cols: 10, rows: 3, scrollback: 5 });
    screen.print('primary');
    screen.moveCursor(2, 4);
    screen.saveCursor();
    screen.enterAlternate();
    expect(screen.altScreen).toBe(true);
    screen.print('ALT');
    expect(text(screen, 0)).toBe('primary'); // ring untouched by alt writes
    screen.exitAlternate();
    expect(screen.altScreen).toBe(false);
    expect(text(screen, screen.viewportTop())).toBe('primary');
    expect(screen.cursorRow).toBe(2);
    expect(screen.cursor.col).toBe(4);
  });
});

describe('clear', () => {
  it('clearViewport empties the view, keeps the scrollback', () => {
    const screen = new Screen({ cols: 20, rows: 4, scrollback: 50 });
    const feed = new ScreenFeed(screen);
    feed.write('one\r\ntwo\r\nthree\r\nfour\r\nfive'); // 'one' scrolls into the ring
    expect(text(screen, 0)).toBe('one');
    screen.clearViewport();
    expect(text(screen, screen.viewportTop())).toBe(''); // view empty
    expect(text(screen, 0)).toBe('one'); // ring kept
  });
});

describe('pen + SGR fold', () => {
  it('SGR lands as attr bits and palette refs', () => {
    const screen = new Screen({ cols: 10, rows: 2, scrollback: 5 });
    const feed = new ScreenFeed(screen);
    feed.write('\x1b[1;31mA\x1b[0mB');
    const line = screen.primary.lines[0]!;
    expect(line.attrs[0]! & ATTR.BOLD).not.toBe(0);
    expect(line.fg[0]!).toBe(1); // SGR 31 → palette 1
    expect(line.attrs[1]!).toBe(0);
    expect(line.fg[1]!).toBe(0xffff); // reset to default
  });
});
