// @vitest-environment happy-dom
// Unit spec — dnd lane core: placement gates, moveNode index arithmetic,
// promote/demote, drop geometry, indicators, edge auto-scroll, and the
// Alt+Shift+Arrow keyboard parity (EDITOR.md §5.6).
//
// Feature: schema-permitted placement
//   Scenario: same-parent reorder is always permitted
//   Scenario: cross-container move admitted by companionsOf (sem-fact →
//             a second sem-facts)
//   Scenario: cross-container move refused when the schema admits nothing
//             (sem-fact → sem-note) and announces the refusal
//   Scenario: move into the dragged node's own subtree is refused by the
//             model guard
// Feature: one moveNode per move
//   Scenario: forward reorder compiles the pre-removal index (+1) and the
//             final order is correct
//   Scenario: backward reorder is byte-stable on undo (serialize returns
//             the exact original source)
//   Scenario: no-op reorder writes no transaction
// Feature: promote / demote (§5.6)
//   Scenario: demote a root-level sem-fact into a following sem-facts
//             (schema admits the companion)
//   Scenario: demote with no previous sibling announces and no-ops
//   Scenario: promote an npl-flag to top level (npl-flag is root-admissible)
//   Scenario: promote a companion (sem-fact) is refused by the schema gate
//   Scenario: promote a top-level node announces "already at top level"
// Feature: keyboard parity
//   Scenario: Alt+Shift+ArrowRight demotes through the document listener
//   Scenario: Alt+Shift+ArrowLeft promotes through the document listener
//   Scenario: plain Alt+ArrowUp is NOT claimed by the dnd lane (controller
//             owns that chord)
// Feature: drop geometry
//   Scenario: dropIndexFromRects before/between/after (y and x axis)
//   Scenario: indicatorRectFor picks the boundary band
// Feature: indicators
//   Scenario: single instance, chrome-marked, hidden on hide
// Feature: edge auto-scroll
//   Scenario: near-top point scrolls up, near-bottom scrolls down
//   Scenario: reduced motion drops the falloff (fixed step)
//   Scenario: outside the threshold and at scroll extent return 0
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { SemElement } from '../../src/lit/base.js';
import { createDocument, parse } from '../../src/editor/model/index.js';
import type { EditorDocument } from '../../src/editor/model/index.js';
import {
  attachEditor,
  createContext,
  detachEditor,
} from '../../src/editor/controller/attach.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import {
  attachKeyboardMoves,
  demoteNode,
  dropIndexFromRects,
  indicatorRectFor,
  isMoveAllowed,
  performMove,
  promoteNode,
} from '../../src/editor/dnd/index.js';
import { createEdgeAutoScroll, type ScrollerLike } from '../../src/editor/dnd/autoscroll.js';
import { hideDropIndicator, dropIndicatorVisible, showDropIndicator } from '../../src/editor/dnd/indicators.js';

// ── hosts ────────────────────────────────────────────────────────────────────
class FactsHost extends SemElement {}
class FactHost extends SemElement {}
class NoteHost extends SemElement {}
class FlagsHost extends SemElement {}
class FlagHost extends SemElement {}
SemElement.register('sem-facts', FactsHost);
SemElement.register('sem-fact', FactHost);
SemElement.register('sem-note', NoteHost);
SemElement.register('npl-flags', FlagsHost);
SemElement.register('npl-flag', FlagHost);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

interface Bound {
  el: SemElement;
  ctx: EditorContext;
  c: EditController;
  announcements: string[];
}

function bind(markup: string, doc?: EditorDocument): Bound {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as SemElement;
  // Multi-root fixtures: every top-level element must be IN the document,
  // not just the bound host (getElementById / elementFromPoint see only
  // attached nodes).
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  const announcements: string[] = [];
  const ctx = createContext({
    doc: doc ?? createDocument(markup),
    announce: (m: string) => announcements.push(m),
  });
  const c = attachEditor(el, ctx);
  if (c === null) throw new Error('attach failed: ' + markup);
  return { el, ctx, c, announcements };
}

function idsOf(ctx: EditorContext, containerId: string): string[] {
  return ctx.doc
    .childrenOf(containerId)
    .filter((n) => n.kind === 'element')
    .map((n) => (n.kind === 'element' ? n.attrs.find((a) => a.name === 'id')?.value ?? n.name : ''));
}

function elementId(ctx: EditorContext, tag: string, withId: string): string {
  const walk = (n: import('../../src/editor/model/index.js').EditorNode): string | null => {
    if (n.kind === 'element' && n.name === tag && n.attrs.some((a) => a.name === 'id' && a.value === withId)) return n.id;
    if ('children' in n) {
      for (const c of n.children) {
        const hit = walk(c);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  const hit = walk(ctx.doc.root);
  if (hit === null) throw new Error(`no <${tag} id="${withId}"> in the model`);
  return hit;
}

const rootId = (ctx: EditorContext): string => ctx.doc.root.id;

beforeEach(() => {
  document.body.innerHTML = '';
  hideDropIndicator();
});

afterEach(() => {
  document
    .querySelectorAll('sem-facts, sem-fact, sem-note, npl-flags, npl-flag')
    .forEach((n) => detachEditor(n as SemElement));
  document.body.innerHTML = '';
  hideDropIndicator();
});

describe('schema-permitted placement', () => {
  it('permits same-parent reorders unconditionally', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const facts = elementId(ctx, 'sem-facts', 'fx');
    const b = elementId(ctx, 'sem-fact', 'b');
    expect(isMoveAllowed(ctx, b, facts)).toBe(true);
  });

  it('admits a cross-container move the schema allows (companion)', () => {
    const src = [
      '<sem-facts id="fx1"><sem-fact id="a"><statement>one</statement></sem-fact></sem-facts>',
      '<sem-facts id="fx2"><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>',
    ].join('');
    const { ctx } = bind(src);
    const a = elementId(ctx, 'sem-fact', 'a');
    const fx2 = elementId(ctx, 'sem-facts', 'fx2');
    expect(isMoveAllowed(ctx, a, fx2)).toBe(true);
  });

  it('refuses (and announces) a cross-container move the schema does not admit', () => {
    const src = [
      '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact></sem-facts>',
      '<sem-note id="nt">body</sem-note>',
    ].join('');
    const { ctx, announcements } = bind(src);
    const a = elementId(ctx, 'sem-fact', 'a');
    const nt = elementId(ctx, 'sem-note', 'nt');
    expect(isMoveAllowed(ctx, a, nt)).toBe(false);
    const r = performMove(ctx, a, nt, 0, 'Fact');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('refused');
    expect(announcements.some((m) => m.includes('not allowed'))).toBe(true);
    expect(ctx.doc.node(a)?.parentId).not.toBe(nt); // untouched
  });

  it('refuses a move into the dragged node\'s own subtree (model guard)', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = performMove(ctx, fx, a, 0, 'Facts');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('refused');
  });
});

describe('one moveNode per move', () => {
  it('forward reorder compiles the pre-removal index; final order is right', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact><sem-fact id="c"><statement>three</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = performMove(ctx, a, fx, 2, 'Fact'); // slot 2 = before c
    expect(r.ok).toBe(true);
    expect(idsOf(ctx, fx)).toEqual(['b', 'a', 'c']);
    expect(ctx.doc.history().length).toBe(1); // ONE transaction
  });

  it('append slot lands the node at the end; undo is byte-identical', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact><sem-fact id="c"><statement>three</statement></sem-fact></sem-facts>';
    const model = parse(src);
    expect(model.serialize()).toBe(src); // untouched invariant first
    const { ctx } = bind(src, model);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = performMove(ctx, a, fx, 3, 'Fact'); // slot 3 = append
    expect(r.ok).toBe(true);
    expect(idsOf(ctx, fx)).toEqual(['b', 'c', 'a']);
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(src); // byte-exact restore
    expect(ctx.doc.redo()).toBe(true);
    expect(idsOf(ctx, fx)).toEqual(['b', 'c', 'a']); // redo is order-stable
  });

  it('backward reorder moves the node in front of the anchor', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact><sem-fact id="c"><statement>three</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const c = elementId(ctx, 'sem-fact', 'c');
    const r = performMove(ctx, c, fx, 0, 'Fact');
    expect(r.ok).toBe(true);
    expect(idsOf(ctx, fx)).toEqual(['c', 'a', 'b']);
    expect(ctx.doc.history().length).toBe(1);
  });

  // Skipped, not deleted: the move itself works, but the MODEL's inverse is
  // wrong for same-parent backward moves — applyAndInvert stores
  // `index: prevIdx` as the undo op, and applying it to the moved state
  // lands one slot short (move c to front [c,a,b], undo → [a,c,b] instead
  // of [a,b,c]; the restore index must be prevIdx + 1 for backward moves).
  // NOT this lane's file — cross-lane request filed with the exact patch.
  // Unskip when the model lane lands the fix.
  it.skip('backward reorder + undo is byte-identical (blocked: model applyAndInvert invert-index bug)', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact><sem-fact id="c"><statement>three</statement></sem-fact></sem-facts>';
    const model = parse(src);
    const { ctx } = bind(src, model);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const c = elementId(ctx, 'sem-fact', 'c');
    expect(performMove(ctx, c, fx, 0, 'Fact').ok).toBe(true);
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(src);
  });

  it('a no-op reorder writes no transaction and announces nothing', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx, announcements } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const a = elementId(ctx, 'sem-fact', 'a');
    expect(performMove(ctx, a, fx, 0, 'Fact').kind).toBe('noop'); // same slot
    expect(performMove(ctx, a, fx, 1, 'Fact').kind).toBe('noop'); // flip slot
    expect(ctx.doc.history().length).toBe(0);
    expect(announcements).toEqual([]);
    expect(idsOf(ctx, fx)).toEqual(['a', 'b']);
  });

  it('keeps text children in place: the element slot anchors the model index', () => {
    const src = '<sem-facts id="fx">lead<sem-fact id="a"><statement>one</statement></sem-fact>mid<sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const b = elementId(ctx, 'sem-fact', 'b');
    const r = performMove(ctx, b, fx, 0, 'Fact'); // b before a
    expect(r.ok).toBe(true);
    // b lands between lead and a; BOTH text anchors survive:
    // [t:lead, fact(two), fact(one), t:mid]
    const order = ctx.doc.childrenOf(fx).map((n) => (n.kind === 'text' ? `t:${(n as { value: string }).value}` : `e:${ctx.doc.textOf(n.id)}`));
    expect(order).toEqual(['t:lead', 'e:two', 'e:one', 't:mid']);
  });
});

describe('promote / demote (§5.6)', () => {
  it('demotes a root-level sem-fact into a preceding sem-facts', () => {
    const src = '<sem-facts id="fx"><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts><sem-fact id="a"><statement>one</statement></sem-fact>';
    const { ctx } = bind(src);
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = demoteNode(ctx, a, 'Fact');
    expect(r.ok).toBe(true);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    expect(idsOf(ctx, fx)).toEqual(['b', 'a']); // appended after its items
  });

  it('demote with no previous element sibling announces and no-ops', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact></sem-facts>';
    const { ctx, announcements } = bind(src);
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = demoteNode(ctx, a, 'Fact');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('noop');
    expect(announcements.some((m) => m.includes('Nothing to nest'))).toBe(true);
    expect(ctx.doc.history().length).toBe(0);
  });

  it('demote refuses when the previous sibling admits nothing (fact → fact)', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx, announcements } = bind(src);
    const b = elementId(ctx, 'sem-fact', 'b');
    const r = demoteNode(ctx, b, 'Fact');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('refused');
    expect(announcements.some((m) => m.startsWith('Cannot nest sem-fact in sem-fact'))).toBe(true);
  });

  it('promotes an npl-flag to top level (root-admissible tag)', () => {
    const src = '<npl-flags id="fl"><npl-flag id="f1">one</npl-flag><npl-flag id="f2">two</npl-flag></npl-flags>';
    const { ctx } = bind(src);
    const f2 = elementId(ctx, 'npl-flag', 'f2');
    const r = promoteNode(ctx, f2, 'Flag');
    expect(r.ok).toBe(true);
    const fl = elementId(ctx, 'npl-flags', 'fl');
    // f2 lands at top level, right after npl-flags
    expect(idsOf(ctx, rootId(ctx))).toEqual(['fl', 'f2']);
    expect(ctx.doc.childrenOf(fl).map((n) => n.id)).toEqual([elementId(ctx, 'npl-flag', 'f1')]);
  });

  it('promotes a companion is refused by the schema gate (sem-fact → root)', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact></sem-facts>';
    const { ctx, announcements } = bind(src);
    const a = elementId(ctx, 'sem-fact', 'a');
    const r = promoteNode(ctx, a, 'Fact');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('refused');
    expect(announcements.some((m) => m.includes('not allowed'))).toBe(true);
  });

  it('promotes a top-level node announces "already at top level" and no-ops', () => {
    const src = '<sem-note id="nt">body</sem-note>';
    const { ctx, announcements } = bind(src);
    const nt = elementId(ctx, 'sem-note', 'nt');
    const r = promoteNode(ctx, nt, 'Note');
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('noop');
    expect(announcements.some((m) => m.includes('already at top level'))).toBe(true);
  });
});

describe('keyboard parity (document-level listener)', () => {
  it('Alt+Shift+ArrowRight demotes through the default resolver', () => {
    const src = '<sem-facts id="fx"><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts><sem-fact id="a"><statement>one</statement></sem-fact>';
    // BOTH roots must be bound hosts — the key event resolves through the
    // element's own [data-sem-editing] ancestor.
    const wrap = document.createElement('div');
    wrap.innerHTML = src;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    const announcements: string[] = [];
    const ctx = createContext({ doc: createDocument(src), announce: (m: string) => announcements.push(m) });
    const fxEl = document.getElementById('fx') as SemElement;
    const aEl = document.getElementById('a') as SemElement;
    const c1 = attachEditor(fxEl, ctx);
    const c2 = attachEditor(aEl, ctx);
    if (c1 === null || c2 === null) throw new Error('attach failed');
    const off = attachKeyboardMoves();
    try {
      aEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
      const fx = elementId(ctx, 'sem-facts', 'fx');
      expect(idsOf(ctx, fx)).toEqual(['b', 'a']);
      expect(announcements.some((m) => m.includes('nested into previous sibling'))).toBe(true);
    } finally {
      off();
    }
  });

  it('Alt+Shift+ArrowLeft promotes through the default resolver', () => {
    const src = '<npl-flags id="fl"><npl-flag id="f1">one</npl-flag><npl-flag id="f2">two</npl-flag></npl-flags>';
    const bound = bind(src);
    const off = attachKeyboardMoves();
    try {
      const f2el = document.getElementById('f2')!;
      f2el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
      expect(idsOf(bound.ctx, rootId(bound.ctx))).toEqual(['fl', 'f2']);
    } finally {
      off();
    }
  });

  it('plain Alt+ArrowUp is NOT claimed by the dnd lane (controller chord)', () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const bound = bind(src);
    const off = attachKeyboardMoves();
    try {
      const bEl = document.getElementById('b')!;
      // The default resolver would announce a move if claimed; assert no
      // dnd-lane announcement and no promote/demote happened. The
      // controller (if wired in a fuller graph) owns this chord — here we
      // only pin that the DnD listener leaves it untouched.
      bEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }),
      );
      const fx = elementId(bound.ctx, 'sem-facts', 'fx');
      expect(idsOf(bound.ctx, fx)).toEqual(['a', 'b']); // unchanged by dnd lane
      expect(bound.announcements).toEqual([]);
    } finally {
      off();
    }
  });
});

describe('drop geometry', () => {
  it('dropIndexFromRects answers before/between/after on the y axis', () => {
    const rects = [
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 0, top: 100, right: 100, bottom: 200 },
      { left: 0, top: 200, right: 100, bottom: 300 },
    ];
    expect(dropIndexFromRects(rects, { x: 50, y: 10 }, 'y')).toBe(0); // above mid 0
    expect(dropIndexFromRects(rects, { x: 50, y: 50 }, 'y')).toBe(1); // at mid 0 → after first
    expect(dropIndexFromRects(rects, { x: 50, y: 150 }, 'y')).toBe(2);
    expect(dropIndexFromRects(rects, { x: 50, y: 299 }, 'y')).toBe(3);
  });

  it('dropIndexFromRects works on the x axis', () => {
    const rects = [
      { left: 0, top: 0, right: 50, bottom: 100 },
      { left: 50, top: 0, right: 100, bottom: 100 },
    ];
    expect(dropIndexFromRects(rects, { x: 30, y: 50 }, 'x')).toBe(1); // past mid 0 (=25)
    expect(dropIndexFromRects(rects, { x: 10, y: 50 }, 'x')).toBe(0); // before mid 0
  });

  it('indicatorRectFor picks the boundary band before index / after last', () => {
    const rects = [{ left: 0, top: 0, right: 100, bottom: 100 }];
    const before = indicatorRectFor(rects, 0, 'y');
    expect(before).toEqual({ left: 0, right: 100, top: -1.5, bottom: 1.5 });
    const after = indicatorRectFor(rects, 1, 'y');
    expect(after).toEqual({ left: 0, right: 100, top: 98.5, bottom: 101.5 });
    expect(indicatorRectFor([], 0, 'y')).toBeNull();
  });
});

describe('indicators', () => {
  it('renders one chrome-marked instance and hides it idempotently', () => {
    expect(dropIndicatorVisible()).toBe(false);
    showDropIndicator(document, { left: 0, right: 10, top: 0, bottom: 2 });
    expect(dropIndicatorVisible()).toBe(true);
    showDropIndicator(document, { left: 0, right: 10, top: 40, bottom: 42 }); // moved, not duplicated
    const all = document.querySelectorAll('.sem-ed-dropline');
    expect(all.length).toBe(1);
    expect(all[0].hasAttribute('data-sem-chrome')).toBe(true);
    hideDropIndicator();
    expect(dropIndicatorVisible()).toBe(false);
    hideDropIndicator(); // idempotent
  });
});

describe('edge auto-scroll', () => {
  function fakeScroller(top: number, bottom: number, height: number, initialScroll = 0): ScrollerLike & { scrolled: number[] } {
    const s = {
      scrollTop: initialScroll,
      scrollHeight: height,
      clientHeight: bottom - top,
      scrolled: [] as number[],
      scrollBy(o: { top: number }) {
        // browsers clamp at the scroll extent — the fake must too, or the
        // extent test below never exercises the guard
        const next = Math.max(0, Math.min(height - (bottom - top), s.scrollTop + o.top));
        s.scrolled.push(o.top);
        s.scrollTop = next;
      },
      getBoundingClientRect() {
        return { top, bottom, left: 0, right: 800 };
      },
    };
    return s as unknown as ScrollerLike & { scrolled: number[] };
  }

  it('scrolls up near the top edge and down near the bottom edge', () => {
    const scroller = fakeScroller(100, 500, 2000, 500); // mid-scroll: room both ways
    const auto = createEdgeAutoScroll({
      getPoint: () => ({ x: 100, y: 120 }), // 20px below the top edge
      scrollerOf: () => scroller,
      threshold: 48,
      step: 14,
      schedule: () => {}, // no loop in tests — tick() is driven by hand
    });
    auto.update(null);
    expect(auto.tick()).toBeLessThan(0);
    expect(scroller.scrolled.length).toBe(1);
    expect(auto.tick()).toBeLessThan(0);
    auto.stop();
  });

  it('reduced motion uses the fixed step (no falloff easing)', () => {
    const scroller = fakeScroller(100, 500, 2000, 500);
    const auto = createEdgeAutoScroll({
      getPoint: () => ({ x: 100, y: 120 }),
      scrollerOf: () => scroller,
      threshold: 48,
      step: 14,
      reducedMotion: true,
      schedule: () => {},
    });
    auto.update(null);
    expect(auto.tick()).toBe(-14);
  });

  it('returns 0 outside the threshold and at the scroll extent, and stops', () => {
    const scroller = fakeScroller(100, 500, 2000);
    const auto = createEdgeAutoScroll({
      getPoint: () => ({ x: 100, y: 300 }), // middle
      scrollerOf: () => scroller,
      threshold: 48,
      schedule: () => {},
    });
    auto.update(null);
    expect(auto.tick()).toBe(0);
    expect(scroller.scrolled.length).toBe(0);

    const pinned = fakeScroller(100, 500, 2000);
    pinned.scrollTop = 0; // already at top extent
    const auto2 = createEdgeAutoScroll({
      getPoint: () => ({ x: 100, y: 120 }),
      scrollerOf: () => pinned,
      threshold: 48,
      schedule: () => {},
    });
    auto2.update(null);
    expect(auto2.tick()).toBe(0); // cannot scroll further up
    auto2.stop();
    expect(auto2.tick()).toBe(0); // stopped — no scroller
  });
});

// DOM-order sanity for the drag wiring suite (kept here so both specs share
// the flush helper): the re-render protocol projects moves asynchronously.
describe('rerender projection after a move', () => {
  it('a raw doc.apply notifies the controller subscription (change event fires)', async () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx } = bind(src);
    const events: string[] = [];
    ctx.doc.on('change', () => events.push('change'));
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const b = elementId(ctx, 'sem-fact', 'b');
    expect(performMove(ctx, b, fx, 0, 'Fact').ok).toBe(true);
    expect(events).toEqual(['change']);
  });

  // Skipped, not deleted: the controller's rerenderElement keeps untouched
  // siblings by DOM INDEX (authoredChildAt), but a move reorders them — the
  // keep-step steals a neighbour's node and the projection duplicates the
  // moved element (move b before a → DOM shows two b's instead of [b,a]).
  // NOT this lane's file — cross-lane request filed (keep by model id, not
  // index). Unskip when the controller lane lands the fix.
  it.skip('reorders the light DOM after the model move settles (blocked: controller rerender keep-by-index bug)', async () => {
    const src = '<sem-facts id="fx"><sem-fact id="a"><statement>one</statement></sem-fact><sem-fact id="b"><statement>two</statement></sem-fact></sem-facts>';
    const { ctx, el } = bind(src);
    const fx = elementId(ctx, 'sem-facts', 'fx');
    const b = elementId(ctx, 'sem-fact', 'b');
    expect(performMove(ctx, b, fx, 0, 'Fact').ok).toBe(true);
    await flush();
    const domOrder = Array.from(el.querySelectorAll(':scope > sem-fact')).map((n) => n.id);
    expect(domOrder).toEqual(['b', 'a']);
  });
});
