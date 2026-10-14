// @vitest-environment happy-dom
// Unit spec — the tree machine (src/terminal/tui.ts) and the document →
// tree build (src/terminal/plugins/demo/tui-tree.ts) behind `semtext tui`.
//
// Feature: the tree machine
//   Scenario: sections start open, blocks closed; the cursor is row 1
//   Scenario: Enter toggles a section; h/l fold and unfold; Left on a
//             collapsed section walks out to the parent
//   Scenario: j/k move along focusable rows and wrap; body lines are skipped
//   Scenario: g/G/Home/End jump to the ends; PgUp/PgDn page
//   Scenario: '/' opens the filter; printable keys edit it live;
//             Backspace chops; Enter/Esc close and keep the text;
//             q while filtering edits the filter instead of quitting
//   Scenario: q / Q / Escape quit; everything else is handled
// Feature: buildTuiTree
//   Scenario: headings nest with computed numbers; structural blocks sit
//             under the last heading and swallow deeper structure
//   Scenario: block labels come from the label attributes
//   Scenario: a plain document has sections and no blocks; an empty
//             document yields no roots

import { describe, it, expect } from 'vitest';
import {
  createTuiTree,
  tuiTreeKey,
  tuiTreeMove,
  tuiTreePosition,
  tuiTreeRefresh,
  tuiTreeSetExpanded,
  tuiTreeIsQuit,
  type TuiNode,
  type TuiTreeState,
} from '../../src/terminal/tui.js';
import { buildTuiTree } from '../../src/terminal/plugins/demo/tui-tree.js';
import type { KeyEvent } from '../../src/terminal/screen/types.js';

const key = (k: string, extra: Partial<KeyEvent> = {}): KeyEvent => ({
  key: k,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...extra,
});

const DOC = `<html><head><title>Ignored</title></head><body>
<h1>Auth Notes</h1>
<p>intro</p>
<h2 id="start">Getting started</h2>
<sem-properties label="Token shape"><sem-property kind="assertion">audience: wizards</sem-property></sem-properties>
<h3>Deep section</h3>
<sem-note id="n1">note text here</sem-note>
<h2 id="api">API surface</h2>
<sem-code filename="app.ex" lang="elixir">def main, do: :ok</sem-code>
</body></html>`;

const sectionsOf = (nodes: TuiNode[]): TuiNode[] => nodes.filter((n) => n.kind === 'section');
const blocksOf = (nodes: TuiNode[]): TuiNode[] => nodes.filter((n) => n.kind === 'block');

describe('the tree machine', () => {
  const make = (): TuiTreeState => {
    const built = buildTuiTree(DOC);
    return createTuiTree(built.roots, built.title);
  };

  it('sections start open, blocks closed; the cursor is on the first section', () => {
    const state = make();
    expect(state.title).toBe('Auth Notes');
    // visible: h1, h2 Getting started, its block, h3 Deep section, its
    // block, h2 API surface, its block — collapsed blocks are still rows,
    // only their bodies hide
    const focusable = state.rows.filter((r) => r.focusable);
    expect(focusable).toHaveLength(7);
    expect(focusable.every((r) => r.bodyLine === null)).toBe(true); // no open bodies
    expect(focusable.filter((r) => r.node.kind === 'block').every((r) => !r.expanded)).toBe(true);
    expect(state.cursor).toBe(focusable[0]!.node.id);
    expect(tuiTreePosition(state)).toBe('row 1/7');
  });

  it('Enter toggles; h folds and l unfolds; Left on a folded child walks out', () => {
    const state = make();
    expect(tuiTreeKey(state, key('Enter'), 24)).toBe('handled');
    // the root collapsed: only the root row remains
    expect(state.rows).toHaveLength(1);
    tuiTreeKey(state, key('Enter'), 24);
    expect(state.rows).toHaveLength(7);

    // fold the section under the cursor (h): 1.1 + its two children hide
    tuiTreeMove(state, 1); // onto 1.1 Getting started
    tuiTreeKey(state, key('h'), 24);
    expect(state.rows).toHaveLength(4);
    tuiTreeKey(state, key('ArrowLeft'), 24); // parent jump: onto the root
    expect(tuiTreePosition(state)).toBe('row 1/4');
    // the root itself folds and unfolds symmetrically — but 1.1 keeps its
    // own folded state: re-opening a parent never re-opens children
    tuiTreeKey(state, key('h'), 24);
    expect(state.rows).toHaveLength(1);
    tuiTreeKey(state, key('l'), 24);
    expect(state.rows).toHaveLength(4); // 1.1 still folded
    tuiTreeKey(state, key('ArrowDown'), 24); // onto 1.1
    tuiTreeKey(state, key('l'), 24);
    expect(state.rows).toHaveLength(7);
  });

  it('j/k move along focusable rows and wrap at the ends', () => {
    const state = make();
    tuiTreeKey(state, key('j'), 24);
    expect(tuiTreePosition(state)).toBe('row 2/7');
    tuiTreeKey(state, key('G'), 24);
    expect(tuiTreePosition(state)).toBe('row 7/7');
    tuiTreeKey(state, key('j'), 24); // wraps to the first
    expect(tuiTreePosition(state)).toBe('row 1/7');
    tuiTreeKey(state, key('k'), 24); // and back to the last
    expect(tuiTreePosition(state)).toBe('row 7/7');
    tuiTreeKey(state, key('ArrowDown'), 24); // wraps the other way
    expect(tuiTreePosition(state)).toBe('row 1/7');
  });

  it('expanding a block shows body lines the cursor skips', () => {
    const state = make();
    tuiTreeMove(state, 1); // 1.1
    tuiTreeMove(state, 1); // the Token shape block
    const before = state.rows.length;
    tuiTreeKey(state, key('Enter'), 24); // open the block body
    expect(state.rows.length).toBeGreaterThan(before);
    const bodyRows = state.rows.filter((r) => r.bodyLine !== null);
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.every((r) => r.focusable === false)).toBe(true);
    // the cursor never lands on a body line
    tuiTreeMove(state, 1);
    expect(state.rows.find((r) => r.focusable && r.node.id === state.cursor)?.bodyLine).toBeNull();
  });

  it('g/G and Home/End jump; PgUp/PgDn page', () => {
    const state = make();
    tuiTreeKey(state, key('G'), 24);
    expect(tuiTreePosition(state)).toBe('row 7/7');
    tuiTreeKey(state, key('g'), 24);
    expect(tuiTreePosition(state)).toBe('row 1/7');
    tuiTreeKey(state, key('End'), 24);
    expect(tuiTreePosition(state)).toBe('row 7/7');
    tuiTreeKey(state, key('Home'), 24);
    expect(tuiTreePosition(state)).toBe('row 1/7');
    tuiTreeKey(state, key('PageDown'), 3);
    expect(tuiTreePosition(state)).toBe('row 3/7'); // a page of 3 moves rows-1
    tuiTreeKey(state, key('PageUp'), 3);
    expect(tuiTreePosition(state)).toBe('row 1/7');
  });

  it("the filter: '/' opens, typing narrows live, Backspace chops, Enter closes", () => {
    const state = make();
    tuiTreeKey(state, key('/'), 24);
    expect(state.filtering).toBe(true);
    for (const ch of 'deep') tuiTreeKey(state, key(ch), 24);
    expect(state.filter).toBe('deep');
    // matches keep their path: the matching section + its ancestors
    const labels = state.rows.filter((r) => r.focusable).map((r) => r.node.label);
    expect(labels).toContain('Deep section');
    expect(labels).toContain('Getting started'); // the readable path
    tuiTreeKey(state, key('Backspace'), 24);
    expect(state.filter).toBe('dee');
    tuiTreeKey(state, key('Enter'), 24);
    expect(state.filtering).toBe(false);
    expect(state.filter).toBe('dee'); // kept for re-opening
  });

  it('q while filtering edits the filter; after closing it quits', () => {
    const state = make();
    tuiTreeKey(state, key('/'), 24);
    expect(tuiTreeKey(state, key('q'), 24)).toBe('handled');
    expect(state.filter).toBe('q');
    tuiTreeKey(state, key('Enter'), 24);
    expect(tuiTreeKey(state, key('q'), 24)).toBe('quit');
  });

  it('Escape quits; Ctrl+N/Ctrl+P move; unknown keys are handled', () => {
    const state = make();
    expect(tuiTreeKey(state, key('Escape'), 24)).toBe('quit');
    expect(tuiTreeKey(state, key('j', { ctrl: true }), 24)).toBe('handled');
    expect(tuiTreePosition(state)).toBe('row 2/7');
    expect(tuiTreeKey(state, key('p', { ctrl: true }), 24)).toBe('handled');
    expect(tuiTreePosition(state)).toBe('row 1/7');
    expect(tuiTreeKey(state, key('l', { ctrl: true }), 24)).toBe('handled'); // repaint
    expect(tuiTreeKey(state, key('F1'), 24)).toBe('handled');
  });

  it('tuiTreeIsQuit mirrors the close keys', () => {
    expect(tuiTreeIsQuit('q')).toBe(true);
    expect(tuiTreeIsQuit('Q')).toBe(true);
    expect(tuiTreeIsQuit('Escape')).toBe(true);
    expect(tuiTreeIsQuit('j')).toBe(false);
  });

  it('SetExpanded(false) on a folded section still leaves the tree consistent', () => {
    const state = make();
    tuiTreeRefresh(state);
    tuiTreeSetExpanded(state, false); // fold the root from row 1
    expect(state.rows).toHaveLength(1);
    tuiTreeSetExpanded(state, true);
    expect(state.rows).toHaveLength(7);
  });
});

describe('buildTuiTree', () => {
  it('nests headings with computed numbers; structural blocks swallow deeper structure', () => {
    const built = buildTuiTree(DOC);
    expect(built.roots).toHaveLength(1);
    const root = built.roots[0]!;
    expect(root.kind).toBe('section');
    expect(root.number).toBe('1');
    expect(root.label).toBe('Auth Notes');
    expect(sectionsOf(root.children).map((s) => s.number)).toEqual(['1.1', '1.2']);

    const start = sectionsOf(root.children)[0]!;
    expect(start.id).toBe('start');
    expect(start.children).toHaveLength(2); // block + the h3 section
    const shape = blocksOf(start.children)[0]!;
    expect(shape.label).toBe('Token shape');
    expect(shape.body.length).toBeGreaterThan(0); // record text or the plain render
    // the swallowed sem-property is a body line, not a sibling row
    expect(blocksOf(start.children)).toHaveLength(1);

    const deep = sectionsOf(start.children)[0]!;
    expect(deep.number).toBe('1.1.1');
    expect(blocksOf(deep.children)[0]!.label).toBe('note text here');
    expect(blocksOf(deep.children)[0]!.meta).toContain('n1');

    const api = sectionsOf(root.children)[1]!;
    expect(blocksOf(api.children)[0]!.label).toBe('app.ex');
  });

  it('a plain document has sections but no blocks', () => {
    const built = buildTuiTree('<html><body><h1>Only</h1><p>hello</p></body></html>');
    expect(built.roots).toHaveLength(1);
    expect(blocksOf(built.roots[0]!.children)).toHaveLength(0);
    expect(built.roots[0]!.label).toBe('Only');
  });

  it('an empty document yields no roots', () => {
    const built = buildTuiTree('<html><body></body></html>');
    expect(built.roots).toHaveLength(0);
    expect(built.title).toBe('document');
  });
});
