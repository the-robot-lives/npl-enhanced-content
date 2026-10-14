// Unit spec — ANSI/VT tokeniser: the DOM span adapter
// (src/terminal/ansi/dom.ts, via the public barrel src/terminal/ansi/index.ts).
//
// Feature: span production
//   Scenario: plain output becomes one unstyled span
//   Scenario: SGR attributes land as vocabulary classes (bold, dim, named 16-colour)
//   Scenario: 256-index and truecolour colours land as inline rgb() styles
//   Scenario: conceal renders transparent
//   Scenario: attribute state carries across calls on one machine
//   Scenario: SGR 0 ends the styled run — later text takes the new snapshot
//   Scenario: an attribute change mid-stream splits runs at the boundary
//   Scenario: LF and TAB stay verbatim inside run text; CR and BS are dropped
//   Scenario: cursor, erase, CSI and OSC tokens never produce spans or text
//   Scenario: reset() on the machine returns new spans to defaults
// Feature: palette
//   Scenario: ansiIndexedRgb reproduces the xterm cube corners and grayscale ramp
// Feature: theme contract
//   Scenario: every class the adapter emits has a rule in ANSI_DOM_CSS (new families)
//   Scenario: the blink animation is gated behind prefers-reduced-motion
//   Scenario: no span text ever contains an escape byte

import { describe, it, expect } from 'vitest';
import {
  AnsiStateMachine,
  ansiSpans,
  ansiSpanClasses,
  ansiSpanStyle,
  ansiIndexedRgb,
  ANSI_DOM_CSS,
  applySgr,
  DEFAULT_SGR,
} from '../../src/terminal/ansi/index.js';

const spans = (text: string, machine = new AnsiStateMachine()) => ansiSpans(text, machine);

describe('span production', () => {
  it('plain output becomes one unstyled span', () => {
    expect(spans('hello world')).toEqual([
      { text: 'hello world', attrs: DEFAULT_SGR, classes: [], style: '' },
    ]);
  });

  it('SGR attributes land as vocabulary classes', () => {
    const out = spans('\x1b[1;31mcritical\x1b[0m');
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('critical');
    expect(out[0]?.classes).toContain('sem-ansi-b');
    expect(out[0]?.classes).toContain('sem-ansi-c31');
    expect(out[0]?.style).toBe('');
  });

  it('dim, italic, underline and reverse map onto their classes', () => {
    const attrs = applySgr(DEFAULT_SGR, [[2], [3], [4], [7]]);
    expect(ansiSpanClasses(attrs)).toEqual([
      'sem-ansi-dim',
      'sem-ansi-i',
      'sem-ansi-u',
      'sem-ansi-rev',
    ]);
  });

  it('256-index colours land as inline rgb() styles', () => {
    const out = spans('\x1b[38;5;196mred cube\x1b[0m');
    expect(out[0]?.classes).toEqual([]);
    expect(out[0]?.style).toBe('color:rgb(255,0,0)');
    const gray = spans('\x1b[38;5;244mmid gray\x1b[0m');
    expect(gray[0]?.style).toBe('color:rgb(128,128,128)');
  });

  it('truecolour fg and bg both land in the style string', () => {
    const out = spans('\x1b[38;2;12;34;56;48;2;78;90;12mboth\x1b[0m');
    expect(out[0]?.style).toBe('color:rgb(12,34,56);background-color:rgb(78,90,12)');
  });

  it('conceal renders transparent', () => {
    expect(ansiSpanStyle(applySgr(DEFAULT_SGR, [[8]]))).toBe('color:transparent');
  });

  it('attribute state carries across calls on one machine', () => {
    const machine = new AnsiStateMachine();
    const first = ansiSpans('\x1b[32mok', machine);
    expect(first[0]?.classes).toContain('sem-ansi-c32');
    const second = ansiSpans(' still green', machine);
    expect(second[0]?.classes).toContain('sem-ansi-c32');
  });

  it('SGR 0 ends the styled run — later text takes the new snapshot', () => {
    const out = spans('\x1b[31mred\x1b[0m plain');
    expect(out).toHaveLength(2);
    expect(out[0]?.classes).toContain('sem-ansi-c31');
    expect(out[1]?.text).toBe(' plain');
    expect(out[1]?.classes).toEqual([]);
  });

  it('an attribute change mid-stream splits runs at the boundary', () => {
    const out = spans('a\x1b[31mb');
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toBe('a');
    expect(out[0]?.attrs).toEqual(DEFAULT_SGR);
    expect(out[1]?.text).toBe('b');
    expect(out[1]?.classes).toContain('sem-ansi-c31');
  });

  it('LF and TAB stay verbatim inside run text; CR and BS are dropped', () => {
    const out = spans('one\ntwo\rthree\bfour\tfive');
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('one\ntwothreefour\tfive');
  });

  it('cursor, erase, CSI and OSC tokens never produce spans or text', () => {
    const out = spans('\x1b]0;title\x07a\x1b[2Ab\x1b[2Jc\x1b[?25ld\x1b[38;5;1m\x1b[0m');
    expect(out.map((s) => s.text).join('')).toBe('abcd');
    expect(out).toHaveLength(1);
  });

  it('reset() on the machine returns new spans to defaults', () => {
    const machine = new AnsiStateMachine();
    ansiSpans('\x1b[1;35mstyled', machine);
    machine.reset();
    const out = ansiSpans('plain again', machine);
    expect(out[0]?.attrs).toEqual(DEFAULT_SGR);
  });
});

describe('palette', () => {
  it('ansiIndexedRgb reproduces the xterm cube corners and grayscale ramp', () => {
    expect(ansiIndexedRgb(16)).toEqual({ r: 0, g: 0, b: 0 });
    expect(ansiIndexedRgb(21)).toEqual({ r: 0, g: 0, b: 255 });
    expect(ansiIndexedRgb(196)).toEqual({ r: 255, g: 0, b: 0 });
    expect(ansiIndexedRgb(231)).toEqual({ r: 255, g: 255, b: 255 });
    expect(ansiIndexedRgb(232)).toEqual({ r: 8, g: 8, b: 8 });
    expect(ansiIndexedRgb(255)).toEqual({ r: 238, g: 238, b: 238 });
  });
});

describe('theme contract', () => {
  it('every adapter-emitted class outside the pre-existing theme has a rule in ANSI_DOM_CSS', () => {
    // sem-ansi-b / sem-ansi-dim / sem-ansi-c30…37 already exist in the vocabulary
    // theme; ANSI_DOM_CSS carries the NEW families this module introduces.
    const bright = ['c90', 'c91', 'c92', 'c93', 'c94', 'c95', 'c96', 'c97'].map((suffix) => `sem-ansi-${suffix}`);
    const bg = ['bg40', 'bg41', 'bg42', 'bg43', 'bg44', 'bg45', 'bg46', 'bg47'].map((suffix) => `sem-ansi-${suffix}`);
    const bgBright = ['bg100', 'bg101', 'bg102', 'bg103', 'bg104', 'bg105', 'bg106', 'bg107'].map((suffix) => `sem-ansi-${suffix}`);
    for (const cls of ['sem-ansi-i', 'sem-ansi-u', 'sem-ansi-strike', 'sem-ansi-rev', 'sem-ansi-blink', ...bright, ...bg, ...bgBright]) {
      expect(ANSI_DOM_CSS, `missing rule for .${cls}`).toContain(`.${cls}`);
    }
  });

  it('the blink animation is gated behind prefers-reduced-motion', () => {
    expect(ANSI_DOM_CSS).toContain('@keyframes sem-ansi-blink');
    expect(ANSI_DOM_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    const gate = ANSI_DOM_CSS.slice(ANSI_DOM_CSS.indexOf('prefers-reduced-motion'));
    expect(gate).toContain('animation: none');
  });

  it('blink and rapid-blink map onto the single gated blink class', () => {
    expect(ansiSpanClasses(applySgr(DEFAULT_SGR, [[5]]))).toContain('sem-ansi-blink');
    expect(ansiSpanClasses(applySgr(DEFAULT_SGR, [[6]]))).toContain('sem-ansi-blink');
  });

  it('no span text ever contains an escape byte', () => {
    const noisy = '\x1b]0;t\x07a\x1b[31mb\x1b[2Jc\x1b[3;d\x1bPskip\x1b\\e';
    for (const span of spans(noisy)) {
      expect(span.text.includes('\x1b')).toBe(false);
    }
  });
});
