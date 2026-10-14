// Pure-state tests for src/agent/tui-state.ts — the full decision layer
// of `semtext tui`, exercised without any terminal. If these pass, the
// runner only has to be trusted for byte translation and painting.

import { describe, it, expect } from 'vitest';
import {
  createState,
  visibleRows,
  current,
  rawSource,
  move,
  toggle,
  toggleRaw,
  searchStart,
  searchKey,
  searchBackspace,
  searchCancel,
  searchNext,
  handleKey,
  quit
} from '../../src/agent/tui-state.js';

// A three-level outline: two sections, one holding a nested record.
const OUTLINE = [
  {
    id: 'h-intro', type: 'section', label: 'Intro', summary: 'Intro', level: 1,
    blocks: 1, idSource: 'authored', children: []
  },
  {
    id: 'h-details', type: 'section', label: 'Details', summary: 'Details', level: 1,
    blocks: 2, idSource: 'authored',
    children: [
      {
        id: 'f-one', type: 'sem-fact', label: 'Fact one', summary: 'Fact one', level: 0,
        blocks: 1, idSource: 'authored', children: []
      }
    ]
  }
];

const SOURCES = new Map([
  ['h-intro', '<h1 id="h-intro">Intro</h1>'],
  ['h-details', '<h2 id="h-details">Details</h2>…'],
  ['f-one', '<div class="sem-fact" id="f-one">…</div>']
]);

function fresh() {
  return createState(OUTLINE, SOURCES);
}

describe('tui state — initial view', () => {
  it('starts collapsed at the first row', () => {
    const s = fresh();
    expect(s.cursor).toBe(0);
    expect(s.shouldQuit).toBe(false);
    expect(visibleRows(s).map((r) => r.node.id)).toEqual(['h-intro', 'h-details']);
  });

  it('current() returns the cursor row', () => {
    const s = fresh();
    expect(current(s).node.id).toBe('h-intro');
  });
});

describe('tui state — navigation', () => {
  it('j/k and arrows move and clamp at both ends', () => {
    let s = fresh();
    handleKey(s, 'j');
    expect(current(s).node.id).toBe('h-details');
    handleKey(s, 'j');
    handleKey(s, 'j'); // past the end
    expect(current(s).node.id).toBe('h-details');
    handleKey(s, 'k');
    handleKey(s, 'k');
    handleKey(s, 'k'); // before the start
    expect(current(s).node.id).toBe('h-intro');
    handleKey(s, 'down');
    expect(current(s).node.id).toBe('h-details');
    handleKey(s, 'up');
    expect(current(s).node.id).toBe('h-intro');
  });

  it('moving on an empty document does not crash', () => {
    const s = createState([]);
    handleKey(s, 'j');
    expect(current(s)).toBeNull();
  });
});

describe('tui state — expand/collapse', () => {
  it('Enter expands a node and reveals its children', () => {
    let s = fresh();
    handleKey(s, 'down'); // h-details
    handleKey(s, 'enter');
    expect(visibleRows(s).map((r) => r.node.id)).toEqual(['h-intro', 'h-details', 'f-one']);
    expect(s.status).toMatch(/expanded h-details/);
  });

  it('Enter collapses again and clamps the cursor', () => {
    let s = fresh();
    handleKey(s, 'down');
    handleKey(s, 'enter'); // expand h-details
    handleKey(s, 'down'); // onto f-one
    expect(current(s).node.id).toBe('f-one');
    handleKey(s, 'up'); // back to h-details
    handleKey(s, 'enter'); // collapse it under the cursor
    expect(visibleRows(s).map((r) => r.node.id)).toEqual(['h-intro', 'h-details']);
    expect(current(s).node.id).toBe('h-details');
    handleKey(s, 'enter');
    handleKey(s, 'up');
    handleKey(s, 'up'); // clamped at top
    expect(current(s).node.id).toBe('h-intro');
  });

  it('search reveals a match hidden under collapsed nodes', () => {
    let s = fresh(); // everything collapsed: f-one is not visible
    expect(visibleRows(s).map((r) => r.node.id)).toEqual(['h-intro', 'h-details']);
    handleKey(s, '/');
    for (const ch of 'fact one') handleKey(s, ch);
    expect(current(s).node.id).toBe('f-one');
    expect(visibleRows(s).map((r) => r.node.id)).toEqual(['h-intro', 'h-details', 'f-one']);
  });

  it('Enter on a leaf reports and does not throw', () => {
    const s = fresh();
    handleKey(s, 'enter'); // h-intro has no children
    expect(s.status).toMatch(/leaf/);
    expect(visibleRows(s).length).toBe(2);
  });
});

describe('tui state — raw source', () => {
  it('r opens the raw panel showing the current node source', () => {
    let s = fresh();
    handleKey(s, 'r');
    expect(s.raw).toBe(true);
    expect(rawSource(s)).toContain('<h1 id="h-intro">');
    handleKey(s, 'r');
    expect(s.raw).toBe(false);
  });

  it('raw source follows the cursor and resolves lazily', () => {
    let s = fresh();
    handleKey(s, 'down');
    handleKey(s, 'r');
    expect(rawSource(s)).toContain('<h2 id="h-details">');
  });
});

describe('tui state — search', () => {
  it('/ opens the prompt; typing jumps to the first match', () => {
    let s = fresh();
    handleKey(s, '/');
    expect(s.searching).toBe(true);
    for (const ch of 'fact') handleKey(s, ch);
    expect(s.query).toBe('fact');
    expect(s.matches.length).toBeGreaterThan(0);
    expect(current(s).node.id).toBe('f-one');
  });

  it('matching is case-insensitive and covers label + id + type', () => {
    let s = fresh();
    handleKey(s, '/');
    for (const ch of 'DETAILS') handleKey(s, ch);
    expect(current(s).node.id).toBe('h-details');
  });

  it('no query match reports and leaves the cursor alone', () => {
    let s = fresh();
    handleKey(s, 'down'); // h-details
    handleKey(s, '/');
    for (const ch of 'zzz') handleKey(s, ch);
    expect(s.matches).toEqual([]);
    expect(s.status).toMatch(/no matches/);
    expect(current(s).node.id).toBe('h-details');
  });

  it('backspace edits the query and recomputes', () => {
    let s = fresh();
    handleKey(s, '/');
    for (const ch of 'factzzz') handleKey(s, ch);
    expect(s.matches).toEqual([]);
    handleKey(s, 'backspace');
    handleKey(s, 'backspace');
    handleKey(s, 'backspace');
    expect(s.query).toBe('fact');
    expect(s.matches.length).toBeGreaterThan(0);
  });

  it('Enter cycles through matches; n also cycles', () => {
    let s = fresh();
    handleKey(s, '/');
    for (const ch of 'h-') handleKey(s, ch); // both headings match
    const first = current(s).node.id;
    handleKey(s, 'enter');
    expect(current(s).node.id).not.toBe(first);
    const second = current(s).node.id;
    handleKey(s, 'n');
    expect(current(s).node.id).toBe(first); // wrapped
    handleKey(s, 'n');
    expect(current(s).node.id).toBe(second);
  });

  it('Esc cancels; q typed in the prompt is query text, not quit', () => {
    let s = fresh();
    handleKey(s, '/');
    handleKey(s, 'q');
    expect(s.query).toBe('q');
    expect(s.shouldQuit).toBe(false);
    handleKey(s, 'esc');
    expect(s.searching).toBe(false);
    expect(s.query).toBe('');
    expect(s.shouldQuit).toBe(false);
  });

  it('searchCancel clears matches', () => {
    let s = fresh();
    searchStart(s);
    for (const ch of 'fact') searchKey(s, ch);
    expect(s.matches.length).toBeGreaterThan(0);
    searchCancel(s);
    expect(s.matches).toEqual([]);
  });

  it('searchNext on a dead query recomputes without crashing', () => {
    const s = fresh();
    searchNext(s);
    expect(s.cursor).toBe(0);
  });
});

describe('tui state — quit and dispatch', () => {
  it('q quits outside the prompt; ctrl-c quits anywhere', () => {
    let s = fresh();
    handleKey(s, 'q');
    expect(s.shouldQuit).toBe(true);
    s = fresh();
    handleKey(s, '/');
    handleKey(s, 'esc');
    handleKey(s, 'ctrl-c');
    expect(s.shouldQuit).toBe(true);
  });

  it('q inside the prompt does not quit', () => {
    const s = fresh();
    handleKey(s, '/');
    handleKey(s, 'q');
    expect(s.shouldQuit).toBe(false);
  });

  it('unhandled named keys are ignored', () => {
    const s = fresh();
    handleKey(s, 'f5');
    expect(s.cursor).toBe(0);
    expect(s.shouldQuit).toBe(false);
  });

  it('direct helpers behave like their key counterparts', () => {
    let s = fresh();
    move(s, 1);
    expect(current(s).node.id).toBe('h-details');
    s = fresh();
    toggleRaw(s);
    expect(s.raw).toBe(true);
    s = fresh();
    quit(s);
    expect(s.shouldQuit).toBe(true);
  });
});
