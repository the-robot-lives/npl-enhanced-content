// Unit spec — the InputModel against a fake host
// (src/terminal/input/input-model.ts, CORE-V2 §7). The host is the seam:
// mode, metrics and line mapping are injected, so the whole routing
// surface (keys, context-menu interception, paste, wheel gating, sendKeys)
// tests with no DOM at all.
//
// Feature: key routing
//   Scenario: a normalized key dispatches to the host in either mode
//   Scenario: ContextMenu key and Shift+F10 open the menu and never dispatch
// Feature: sendKeys — the one programmatic path
//   Scenario: literal text and tokens flow through the same dispatch as physical keys
//   Scenario: handleSingleKey keeps v1 playback's bare names working
//   Scenario: a bad spec throws InputSpecError
// Feature: paste
//   Scenario: cooked mode inserts the bracketed text
//   Scenario: raw mode hands the text to the host verbatim
//   Scenario: IME commits insert into cooked; raw gets them as paste
// Feature: mouse
//   Scenario: reporting apps get press/drag/release with cell coordinates
//   Scenario: without reporting, drag selects in absolute-line space
//   Scenario: wheel goes to the app on reporting or alt screen, else to viewport scroll
//   Scenario: right-click opens the terminal menu; Shift+right-click passes through
// Feature: copySelection
//   Scenario: extracts through the host's line source and copies

import { describe, expect, it } from 'vitest';
import { InputModel, type InputHost } from '../../src/terminal/input/input-model.js';
import { InputSpecError } from '../../src/terminal/input/keys.js';
import type { CellMetrics, KeyEvent, Mods, MouseEventInfo } from '../../src/terminal/input/types.js';

/** A recording fake of the integrating element's input-facing surface. */
function fakeHost(over: Partial<InputHost> = {}): InputHost & {
  keys: KeyEvent[];
  mouse: MouseEventInfo[];
  scrolled: number[];
  inserted: string[];
  pasted: string[];
  menus: Array<{ x: number; y: number } | undefined>;
  raw: boolean;
  alt: boolean;
} {
  const host = {
    keys: [] as KeyEvent[],
    mouse: [] as MouseEventInfo[],
    scrolled: [] as number[],
    inserted: [] as string[],
    pasted: [] as string[],
    menus: [] as Array<{ x: number; y: number } | undefined>,
    raw: false,
    alt: false,
    dispatchKey(ev: KeyEvent): void {
      host.keys.push(ev);
    },
    isRawMode: () => host.raw,
    isAltScreen: () => host.alt,
    insertCooked(text: string): void {
      host.inserted.push(text);
    },
    pasteRaw(text: string): void {
      host.pasted.push(text);
    },
    dispatchMouse(info: MouseEventInfo): void {
      host.mouse.push(info);
    },
    onWheelScroll(dy: number): boolean {
      host.scrolled.push(dy);
      return true;
    },
    rowToAbsoluteLine: (row: number): number => row + 100, // an offset proves the mapping ran
    metrics(): CellMetrics {
      return { cellWidth: 10, cellHeight: 20, cols: 80, rows: 24 };
    },
    getLineText: (line: number): string => `line-${line}`,
    openContextMenu(anchor?: { x: number; y: number }): void {
      host.menus.push(anchor);
    },
    ...over,
  };
  return host;
}

const noMods: Mods = { ctrl: false, alt: false, shift: false, meta: false };
const ev = (key: string, over: Partial<Mods> = {}): KeyEvent => ({ key, ...noMods, ...over });

describe('key routing', () => {
  it('dispatches normalized keys to the host in either mode', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleKey(ev('a'));
    model.handleKey(ev('ArrowUp'));
    model.raw = true;
    model.handleKey(ev('q'));
    expect(host.keys.map((k) => k.key)).toEqual(['a', 'ArrowUp', 'q']);
    expect(host.menus).toEqual([]);
  });

  it('intercepts ContextMenu and Shift+F10 as chrome — apps never see them', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleKey(ev('ContextMenu'));
    model.handleKey(ev('F10', { shift: true }));
    expect(host.keys).toEqual([]);
    expect(host.menus.length).toBe(2);
    // Plain F10, and every other key, still dispatches.
    model.handleKey(ev('F10'));
    expect(host.keys.map((k) => k.key)).toEqual(['F10']);
  });
});

describe('sendKeys — the one programmatic path', () => {
  it('flows literal text and tokens through the same dispatch as physical keys', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.sendKeys('ls<Enter>');
    expect(host.keys.map((k) => k.key)).toEqual(['l', 's', 'Enter']);
  });

  it('keeps v1 playback bare names working via handleSingleKey', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleSingleKey('Enter');
    model.handleSingleKey('ArrowDown');
    model.handleSingleKey('q');
    expect(host.keys.map((k) => k.key)).toEqual(['Enter', 'ArrowDown', 'q']);
  });

  it('throws InputSpecError on a bad spec instead of typing garbage', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    expect(() => model.sendKeys('<Bogus>')).toThrow(InputSpecError);
    expect(host.keys).toEqual([]); // nothing partial was injected
  });
});

describe('paste', () => {
  it('cooked mode inserts the bracketed text', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handlePaste('one\ntwo');
    expect(host.inserted).toEqual([`one⏎two`]);
    expect(host.pasted).toEqual([]);
  });

  it('raw mode hands the text to the host verbatim', () => {
    const host = fakeHost();
    host.raw = true;
    const model = new InputModel(host);
    model.handlePaste('one\ntwo');
    expect(host.pasted).toEqual(['one\ntwo']);
    expect(host.inserted).toEqual([]);
  });

  it('IME commits insert into cooked and arrive as paste in raw', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleComposition('update', 'かな');
    model.handleComposition('end', 'かな');
    expect(host.inserted).toEqual(['かな']);
    host.raw = true;
    model.handleComposition('end', 'かんじ');
    expect(host.pasted).toEqual(['かんじ']);
  });
});

describe('mouse', () => {
  it('reporting apps receive press/drag/release with cell coordinates', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.setMouseReporting(true);
    model.handleMouseDown(25, 45, 0, noMods); // cell (2, 2)
    model.handleMouseMove(5, 5, noMods); // cell (0, 0)
    model.handleMouseUp(25, 45, 0, noMods);
    expect(host.mouse).toEqual([
      { kind: 'press', col: 2, row: 2, button: 0, dx: 0, dy: 0, ctrl: false, alt: false, shift: false },
      { kind: 'drag', col: 0, row: 0, button: 0, dx: 0, dy: 0, ctrl: false, alt: false, shift: false },
      { kind: 'release', col: 2, row: 2, button: 0, dx: 0, dy: 0, ctrl: false, alt: false, shift: false },
    ]);
  });

  it('without reporting, drag selects in absolute-line space', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleMouseDown(5, 5, 0, noMods); // row 0 → absolute line 100
    model.handleMouseMove(25, 45, noMods); // row 2 → 102
    model.handleMouseUp(25, 45, 0, noMods);
    expect(host.mouse).toEqual([]); // no app reporting
    expect(model.selection.ordered()).toEqual({
      start: { line: 100, col: 0 },
      end: { line: 102, col: 2 },
    });
  });

  it('Alt-drag selects rectangular', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleMouseDown(5, 5, 0, { ...noMods, alt: true });
    expect(model.selection.rectangular).toBe(true);
  });

  it('wheel reaches the app on reporting or alt screen, else the viewport scrolls', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.handleWheel(0, -120, noMods);
    expect(host.scrolled).toEqual([-120]);
    expect(host.mouse).toEqual([]);
    host.alt = true; // raw mode runs on the alternate screen (§6.2) — wheel belongs to the app
    model.handleWheel(0, 120, noMods);
    expect(host.mouse).toEqual([
      { kind: 'wheel', button: 0, col: 0, row: 0, dx: 0, dy: 120, ctrl: false, alt: false, shift: false },
    ]);
    expect(host.scrolled).toEqual([-120]);
    host.alt = false;
    model.setMouseReporting(true);
    model.handleWheel(10, 0, noMods);
    expect(host.mouse.at(-1)).toMatchObject({ kind: 'wheel', dx: 10, dy: 0 });
  });

  it('right-click opens the terminal menu; Shift+right-click passes through', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    expect(model.handleContextMenu(30, 40, false)).toBe(true);
    expect(host.menus).toEqual([{ x: 30, y: 40 }]);
    expect(model.handleContextMenu(30, 40, true)).toBe(false); // native menu
    expect(host.menus.length).toBe(1);
  });

  it('the menu keeps winning while app mouse reporting is active (§7.3)', () => {
    const host = fakeHost();
    const model = new InputModel(host);
    model.setMouseReporting(true);
    model.handleContextMenu(1, 2, false);
    expect(host.menus).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('copySelection', () => {
  it('extracts through the host line source and copies', async () => {
    const host = fakeHost();
    const model = new InputModel(host);
    expect(await model.copySelection({ writeText: async () => undefined })).toBe(false); // nothing selected
    model.handleMouseDown(0, 0, 0, noMods); // absolute line 100, col 0
    model.handleMouseMove(40, 0, noMods); // col 4
    const written: string[] = [];
    const ok = await model.copySelection({
      writeText: async (text) => {
        written.push(text);
      },
    });
    expect(ok).toBe(true);
    expect(written).toEqual(['line-100'.slice(0, 5)]);
  });
});
