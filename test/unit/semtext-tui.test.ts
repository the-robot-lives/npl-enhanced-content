// @vitest-environment happy-dom
// Unit spec — the flashcard view state machine (src/terminal/tui.ts) and
// the `semtext tui` command side (cards from records, the TuiAction).
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
//   Scenario: emits a tui action with cards when colored; a summary line always
//   Scenario: piped (color off) prints the summary and emits nothing
//   Scenario: an empty document errors, exit 1

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

  it('emits a tui action with cards when the output is a terminal', () => {
    const r = core.execLine('semtext tui demo/token-rotation.html');
    expect(r.actions).toHaveLength(1);
    const action = r.actions[0] as { kind: string; title: string; cards: TuiCard[] };
    expect(action.kind).toBe('tui');
    expect(action.title).toBe('Token Rotation');
    expect(action.cards.length).toBeGreaterThan(3);
    expect(action.cards.every((c) => c.front !== '' && c.back !== '')).toBe(true);
    expect(out(r).join(' ')).toMatch(/tui: Token Rotation — \d+ cards/);
  });

  it('piped (color off) prints the summary line and emits no action', () => {
    const r = core.execLine('semtext tui demo/token-rotation.html | cat');
    expect(r.actions).toEqual([]);
    expect(out(r).join(' ')).toMatch(/tui: Token Rotation — \d+ cards/);
  });

  it('a document with no records errors, exit 1', () => {
    core.vfs.mountFile('/blank.html', '<html><body><p>nothing semantic here</p></body></html>');
    expect(errs(core.execLine('semtext tui /blank.html')).join(' ')).toMatch(/no records/);
    expect(core.state.lastStatus).toBe(1);
  });
});
