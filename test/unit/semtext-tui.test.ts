// @vitest-environment happy-dom
// Unit spec — the flashcard view state machine (src/terminal/tui.ts, kept
// for the element overlay) and the `semtext tui` command side: the grid
// app spawn on a tty, the plain outline listing when piped.
//
// Feature: the TUI state machine
//   Scenario: createTuiState starts on card 1, collapsed, unfiltered
//   Scenario: tuiMove walks and wraps; moving collapses the card
//   Scenario: tuiToggle expands and collapses
//   Scenario: the filter narrows visible cards and clamps the cursor;
//             movement works over visible cards only
//   Scenario: '/' opens the filter row; closing keeps the filter text
//   Scenario: q / Q / Escape are close keys; tuiPosition is 1-based
// Feature: `semtext tui` (the command)
//   Scenario: spawns the semtext-tui app when the output is a terminal
//   Scenario: piped prints the plain outline listing and emits nothing
//   Scenario: a document with nothing to browse errors, exit 1

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTuiState,
  tuiMove,
  tuiToggle,
  tuiSetFilter,
  tuiOpenFilter,
  tuiCloseFilter,
  tuiIsClose,
  tuiPosition,
  type TuiCard,
} from '../../src/terminal/tui.js';
import { TerminalCore, type ExecResult } from '../../src/terminal/terminal-core.js';
import { posixPlugin } from '../../src/terminal/plugins/posix/plugin.js';
import { demoPlugin } from '../../src/terminal/plugins/demo/plugin.js';

const cards: TuiCard[] = [
  { front: 'front one', back: 'back one', meta: '#a kind=x' },
  { front: 'front two', back: 'back two', meta: '' },
  { front: 'front three', back: 'back three', meta: '#c' },
];

describe('the TUI state machine', () => {
  it('starts on card 1, collapsed, unfiltered, with everything visible', () => {
    const state = createTuiState(cards, 'My Doc');
    expect(state.title).toBe('My Doc');
    expect(state.index).toBe(0);
    expect(state.expanded).toBe(false);
    expect(state.filter).toBe('');
    expect(state.filtering).toBe(false);
    expect(state.visible).toEqual([0, 1, 2]);
    expect(tuiPosition(state)).toBe('card 1/3');
  });

  it('tuiMove walks, wraps at both ends, and collapses the card', () => {
    const state = createTuiState(cards);
    tuiToggle(state);
    tuiMove(state, 1);
    expect(state.index).toBe(1);
    expect(state.expanded).toBe(false); // moving collapses
    tuiMove(state, 1);
    expect(state.index).toBe(2);
    tuiMove(state, 1); // wrap to the first
    expect(state.index).toBe(0);
    tuiMove(state, -1); // and back to the last
    expect(state.index).toBe(2);
  });

  it('tuiToggle flips expansion in place', () => {
    const state = createTuiState(cards);
    tuiToggle(state);
    expect(state.expanded).toBe(true);
    tuiToggle(state);
    expect(state.expanded).toBe(false);
  });

  it('the filter narrows visible cards and clamps the cursor onto them', () => {
    const state = createTuiState(cards);
    tuiSetFilter(state, 'TWO'); // case-insensitive, front or back
    expect(state.visible).toEqual([1]);
    expect(state.index).toBe(1);
    expect(tuiPosition(state)).toBe('card 1/1');
  });

  it('movement works over the visible cards only', () => {
    const state = createTuiState(cards);
    tuiSetFilter(state, 'three');
    tuiMove(state, 1); // one visible card: wraps onto itself
    expect(state.index).toBe(2);
    tuiSetFilter(state, 'zzz-no-match');
    expect(state.visible).toEqual([]);
    tuiMove(state, 1); // no-op with nothing visible
    expect(tuiPosition(state)).toBe('card 0/0');
  });

  it("opening '/' sets filtering; closing keeps the filter text", () => {
    const state = createTuiState(cards);
    tuiOpenFilter(state);
    expect(state.filtering).toBe(true);
    tuiSetFilter(state, 'one');
    tuiCloseFilter(state);
    expect(state.filtering).toBe(false);
    expect(state.filter).toBe('one'); // kept for re-opening
    expect(state.visible).toEqual([0]);
  });

  it('q, Q and Escape are close keys; nothing else is', () => {
    expect(tuiIsClose('q')).toBe(true);
    expect(tuiIsClose('Q')).toBe(true);
    expect(tuiIsClose('Escape')).toBe(true);
    expect(tuiIsClose('j')).toBe(false);
    expect(tuiIsClose('Enter')).toBe(false);
  });
});

describe('`semtext tui` — the command side', () => {
  let core: TerminalCore;
  const out = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stdout').map((l) => l.text);
  const errs = (r: ExecResult): string[] => r.lines.filter((l) => l.kind === 'stderr').map((l) => l.text);

  beforeEach(() => {
    core = new TerminalCore();
    for (const plugin of [posixPlugin, demoPlugin]) {
      const result = core.mountPlugin(plugin);
      if (!result.ok) throw new Error(result.error ?? 'mount failed');
    }
  });

  it('spawns the semtext-tui app when the output is a terminal', () => {
    const r = core.execLine('semtext tui demo/token-rotation.html');
    expect(r.actions).toHaveLength(1);
    const action = r.actions[0] as { kind: string; app: { id: string } };
    expect(action.kind).toBe('app');
    expect(action.app.id).toBe('semtext-tui');
    expect(out(r)).toEqual([]); // the app owns the screen; no transcript noise
  });

  it('piped prints the plain outline listing and emits no action', () => {
    const r = core.execLine('semtext tui demo/token-rotation.html | cat');
    expect(r.actions).toEqual([]);
    const lines = out(r);
    expect(lines[0]).toBe('tui: Token Rotation');
    expect(lines.join('\n')).toMatch(/^\s*1\s+\S/m); // a numbered section row
  });

  it('a document with nothing to browse errors, exit 1', () => {
    core.vfs.mountFile('/blank.html', '<html><body><p>nothing semantic here</p></body></html>');
    expect(errs(core.execLine('semtext tui /blank.html')).join(' ')).toMatch(/nothing to browse/);
    expect(core.state.lastStatus).toBe(1);
  });
});
