// Unit spec — editor model: ops, transactions, undo/redo, events, mapping
//
// BRIEF §1/§2: each op applies surgically (untouched nodes byte-identical),
// every op inverts exactly (undo restores trivia byte-exactly, including
// entity spellings and quote styles), transactions batch, and selection
// mapping survives entity boundaries.

import { describe, expect, it, vi } from 'vitest';
import {
  createDocument,
  mapDecodedToRaw,
  mapRawToDecoded,
  parse,
} from '../../src/editor/model/document.js';
import type {
  EditorDocument,
  ElementNode,
  TextNode,
} from '../../src/editor/model/types.js';

const TRIVIA_DOC =
  '<sem-note   variant="tip"  data-note="a &amp; b"  collapsed >\n' +
  '  Note with &#38; entity and  spacing.\n' +
  '</sem-note  >\n';

const asElement = (doc: EditorDocument, id: string): ElementNode => {
  const n = doc.node(id);
  if (!n || n.kind !== 'element') throw new Error(`element ${id} expected`);
  return n;
};
const asText = (doc: EditorDocument, id: string): TextNode => {
  const n = doc.node(id);
  if (!n || n.kind !== 'text') throw new Error(`text ${id} expected`);
  return n;
};

/** First node of `kind` in document order ('' if none). */
function firstOf(doc: EditorDocument, kind: 'element' | 'text'): string {
  const walk = (n: { kind: string; children?: unknown[]; id: string }): string => {
    if (n.kind === kind) return n.id;
    for (const c of (n.children ?? []) as Array<{ kind: string; children?: unknown[]; id: string }>) {
      const found = walk(c);
      if (found) return found;
    }
    return '';
  };
  return walk(doc.root as never);
}

/** Root's first element child (root children[0] when it is an element). */
function rootElement(doc: EditorDocument): ElementNode {
  const first = doc.root.children[0];
  if (!first || first.kind !== 'element') throw new Error('root element expected');
  return first;
}

describe('setText', () => {
  it('re-emits only the edited node canonically; undo restores trivia byte-exactly', () => {
    const doc = createDocument(TRIVIA_DOC);
    const textId = firstOf(doc, 'text');
    doc.apply({ type: 'setText', node: textId, value: 'Replaced &' });
    const after = doc.serialize();
    expect(after).toContain('Replaced &amp;');
    // untouched trivia (attr order/quotes/spacing, close-tag space) survives
    expect(after).toContain('<sem-note   variant="tip"  data-note="a &amp; b"  collapsed >');
    expect(doc.undo()).toBe(true);
    expect(doc.serialize()).toBe(TRIVIA_DOC);
    expect(doc.redo()).toBe(true);
    expect(doc.serialize()).toBe(after);
  });

  it('undo restores the authored entity spelling, not the decoded value', () => {
    const doc = createDocument('<p>&#38; &amp; &sect;</p>');
    const textId = firstOf(doc, 'text');
    doc.apply({ type: 'setText', node: textId, value: 'plain' });
    expect(doc.serialize()).toBe('<p>plain</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>&#38; &amp; &sect;</p>');
  });

  it('coalesced edits merge into one undo entry', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    doc.apply({ type: 'setText', node: textId, value: 'ab' }, { coalesce: 'typing' });
    doc.apply({ type: 'setText', node: textId, value: 'abc' }, { coalesce: 'typing' });
    expect(doc.canUndo()).toBe(true);
    doc.undo();
    expect(doc.canUndo()).toBe(false); // both merged into the single entry
    expect(doc.serialize()).toBe('<p>a</p>');
  });
});

describe('attributes', () => {
  it('setAttr adds canonically-escaped attrs without disturbing authored ones', () => {
    const doc = createDocument(TRIVIA_DOC);
    const id = firstOf(doc, 'element');
    doc.apply({ type: 'setAttr', node: id, name: 'href', value: 'a?x=1&y=2' });
    const after = doc.serialize();
    expect(after).toContain('href="a?x=1&amp;y=2"');
    expect(after).toContain('variant="tip"');
    doc.undo();
    expect(doc.serialize()).toBe(TRIVIA_DOC);
  });

  it('setAttr preserves single-quoted style when editing an authored attr', () => {
    const doc = createDocument("<p class='k' data-x='1'>t</p>");
    const id = firstOf(doc, 'element');
    doc.apply({ type: 'setAttr', node: id, name: 'data-x', value: "it's" });
    expect(doc.serialize()).toBe("<p class='k' data-x='it&apos;s'>t</p>");
    doc.undo();
    expect(doc.serialize()).toBe("<p class='k' data-x='1'>t</p>");
  });

  it('removeAttr removes exactly the named attr (case-insensitive) and undo restores trivia', () => {
    const doc = createDocument(TRIVIA_DOC);
    const id = firstOf(doc, 'element');
    doc.apply({ type: 'removeAttr', node: id, name: 'DATA-NOTE' });
    const after = doc.serialize();
    expect(after).not.toContain('data-note');
    expect(after).toContain('collapsed');
    doc.undo();
    expect(doc.serialize()).toBe(TRIVIA_DOC);
  });
});

describe('structure ops', () => {
  it('insertNode places a created node; undo removes it', () => {
    const doc = createDocument('<p>one</p>');
    const p = rootElement(doc);
    const child = doc.createElement({
      tag: 'sem-note',
      attrs: [],
      children: [doc.createText('two')],
    });
    doc.apply({ type: 'insertNode', parent: p.id, index: 1, node: child });
    expect(doc.serialize()).toBe('<p>one<sem-note>two</sem-note></p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>one</p>');
  });

  it('removeNode detaches the subtree; undo reattaches it at the same index', () => {
    const doc = createDocument('<p>a<em>b</em>c</p>');
    const p = rootElement(doc);
    const em = asElement(doc, doc.childrenOf(p.id)[1]?.id ?? '');
    doc.apply({ type: 'removeNode', node: em.id });
    expect(doc.serialize()).toBe('<p>ac</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>a<em>b</em>c</p>');
  });

  it('moveNode relocates nodes; undo moves them back', () => {
    const doc = createDocument('<div><p>one</p><p>two</p></div>');
    const div = rootElement(doc);
    const one = doc.childrenOf(div.id)[0];
    if (!one) throw new Error('child expected');
    doc.apply({ type: 'moveNode', node: one.id, parent: div.id, index: 2 });
    expect(doc.serialize()).toBe('<div><p>two</p><p>one</p></div>');
    doc.undo();
    expect(doc.serialize()).toBe('<div><p>one</p><p>two</p></div>');
  });

  it('wrap inserts the wrapper around a node; unwrap inverts it', () => {
    const doc = createDocument('<p>a<em>b</em>c</p>');
    const p = rootElement(doc);
    const emId = doc.childrenOf(p.id)[1]?.id;
    if (!emId) throw new Error('em expected');
    const tx = doc.apply({ type: 'wrap', node: emId, wrapper: { tag: 'strong', attrs: [], children: [] } });
    const strongId = tx.touched.find((id) => id !== emId);
    if (!strongId) throw new Error('wrapper id expected');
    expect(doc.serialize()).toBe('<p>a<strong><em>b</em></strong>c</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>a<em>b</em>c</p>');
    doc.redo();
    expect(doc.serialize()).toBe('<p>a<strong><em>b</em></strong>c</p>');
    // redo re-created the wrapper: bytes are stable, ids are re-allocated
    const em2 = doc.node(emId);
    if (!em2 || !em2.parentId) throw new Error('em parent expected');
    doc.apply({ type: 'unwrap', node: em2.parentId });
    expect(doc.serialize()).toBe('<p>a<em>b</em>c</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>a<strong><em>b</em></strong>c</p>');
  });

  it('replaceSubtree swaps nodes; undo restores the original subtree', () => {
    const doc = createDocument('<p>a<em>b</em>c</p>');
    const p = rootElement(doc);
    const emId = doc.childrenOf(p.id)[1]?.id;
    if (!emId) throw new Error('em expected');
    const repl = doc.createElement({ tag: 'strong', attrs: [], children: [doc.createText('b')] });
    doc.apply({ type: 'replaceSubtree', node: emId, replacement: repl });
    expect(doc.serialize()).toBe('<p>a<strong>b</strong>c</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>a<em>b</em>c</p>');
  });
});

describe('canApply guards', () => {
  it('rejects moves into own subtree, root removal, and bad indexes', () => {
    const doc = createDocument('<div><p>a<em>b</em></p></div>');
    const div = rootElement(doc);
    const p = asElement(doc, doc.childrenOf(div.id)[0]?.id ?? '');
    const em = doc.childrenOf(p.id)[1];
    if (!em) throw new Error('em expected');
    expect(doc.canApply({ type: 'moveNode', node: p.id, parent: em.id, index: 0 }).ok).toBe(false);
    expect(doc.canApply({ type: 'removeNode', node: div.id }).ok).toBe(true);
    expect(doc.canApply({ type: 'removeNode', node: doc.root.id }).ok).toBe(false);
    expect(
      doc.canApply({ type: 'insertNode', parent: div.id, index: 9, node: doc.createText('x') }).ok,
    ).toBe(false);
    expect(doc.canApply({ type: 'setText', node: 'nope', value: 'x' }).ok).toBe(false);
  });

  it('apply throws on rejected ops', () => {
    const doc = createDocument('<p>a</p>');
    expect(() => doc.apply({ type: 'removeNode', node: doc.root.id })).toThrow();
  });
});

describe('transactions', () => {
  it('batch into one undo entry and one change event', () => {
    const doc = createDocument('<p>a</p>');
    const p = rootElement(doc);
    const textId = firstOf(doc, 'text');
    const changes: number[] = [];
    doc.on('change', () => changes.push(doc.version));
    doc.transaction('edit', (tx) => {
      tx.push({ type: 'setText', node: textId, value: 'b' });
      tx.push({ type: 'setAttr', node: p.id, name: 'class', value: 'x' });
    });
    expect(changes).toHaveLength(1);
    doc.undo();
    expect(doc.serialize()).toBe('<p>a</p>');
    expect(doc.canUndo()).toBe(false);
  });

  it('a rejected op inside a transaction leaves the tree unchanged', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    expect(() =>
      doc.transaction('bad', (tx) => {
        tx.push({ type: 'setText', node: textId, value: 'b' });
        tx.push({ type: 'setText', node: 'ghost', value: 'c' });
      }),
    ).toThrow();
    expect(doc.serialize()).toBe('<p>a</p>');
    expect(doc.canUndo()).toBe(false);
  });

  it('openTransaction abort discards the span: no history entry, no change event', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    const onChange = vi.fn();
    doc.on('change', onChange);
    const span = doc.openTransaction('scratch');
    span.push({ type: 'setText', node: textId, value: 'scratch' });
    expect(span.committed).toBe(false);
    span.abort();
    expect(onChange).not.toHaveBeenCalled();
    expect(doc.serialize()).toBe('<p>a</p>');
    expect(doc.canUndo()).toBe(false);
  });

  it('openTransaction commit behaves like transaction()', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    const span = doc.openTransaction('manual');
    span.push({ type: 'setText', node: textId, value: 'b' });
    const tx = span.commit();
    expect(span.committed).toBe(true);
    expect(tx.label).toBe('manual');
    expect(doc.serialize()).toBe('<p>b</p>');
    doc.undo();
    expect(doc.serialize()).toBe('<p>a</p>');
  });
});

describe('history + events', () => {
  it('history() reports entries oldest-first with undone flags and depth', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    doc.apply({ type: 'setText', node: textId, value: '1' });
    doc.apply({ type: 'setText', node: textId, value: '2' });
    const h = doc.history();
    expect(h).toHaveLength(2);
    expect(h[0]?.depth).toBe(1);
    expect(h[1]?.depth).toBe(0);
    doc.undo();
    expect(doc.history()[1]?.undone).toBe(true);
    doc.redo();
    doc.clearHistory();
    expect(doc.history()).toHaveLength(0);
    expect(doc.canUndo()).toBe(false);
  });

  it('fires history events with canUndo/canRedo transitions', () => {
    const doc = createDocument('<p>a</p>');
    const textId = firstOf(doc, 'text');
    const seen: Array<[boolean, boolean]> = [];
    doc.on('history', (e) => seen.push([e.canUndo, e.canRedo]));
    doc.apply({ type: 'setText', node: textId, value: 'b' });
    doc.undo();
    doc.redo();
    expect(seen).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });
});

describe('selection mapping', () => {
  it('posToOffset/offsetToPos round-trip across entity boundaries', () => {
    const doc = createDocument('<p>ab&sect;c</p>');
    const textId = firstOf(doc, 'text');
    const raw = asText(doc, textId).raw;
    // decoded text is `ab§c` (4 units); raw is `ab&sect;c` (9 bytes)
    expect(mapRawToDecoded(raw, 2)).toBe(2);
    expect(mapRawToDecoded(raw, 3)).toBe(2); // inside &sect;
    expect(mapRawToDecoded(raw, 9)).toBe(4); // end
    for (const decoded of [0, 1, 2, 3, 4]) {
      const rawOff = mapDecodedToRaw(raw, decoded);
      if (rawOff === null) throw new Error('map failed');
      const off = doc.posToOffset({ node: textId, offset: decoded });
      expect(off).not.toBeNull();
      const back = doc.offsetToPos(off as number);
      if (!back) throw new Error('no position');
      // interior positions round-trip exactly; end-of-text resolves to the
      // equivalent parent boundary (rounds left) — same caret, same offset
      if (decoded === 4) {
        expect(doc.posToOffset(back)).toBe(off);
      } else {
        expect(back).toEqual({ node: textId, offset: decoded });
      }
    }
  });

  it('elementAtOffset finds the deepest element containing an offset', () => {
    const doc = createDocument('<div><p>hi</p></div>');
    expect(doc.elementAtOffset(6)?.name).toBe('p');
    expect(doc.elementAtOffset(1)?.name).toBe('div');
  });

  it('offsetToPos rejects out-of-range offsets', () => {
    const doc = createDocument('<p>hi</p>');
    expect(doc.offsetToPos(-1)).toBeNull();
    expect(doc.offsetToPos(999)).toBeNull();
  });
});

describe('clone', () => {
  it('is an independent deep snapshot with the same ids and source', () => {
    const doc = createDocument(TRIVIA_DOC);
    const twin = doc.clone();
    expect(twin.serialize()).toBe(TRIVIA_DOC);
    const textId = firstOf(twin, 'text');
    twin.apply({ type: 'setText', node: textId, value: 'changed' });
    expect(doc.serialize()).toBe(TRIVIA_DOC); // original untouched
    expect(twin.serialize()).not.toBe(TRIVIA_DOC);
  });
});

describe('range refresh', () => {
  it('ranges stay accurate after edits (serialize refreshes)', () => {
    const doc = createDocument('<p>ab</p>');
    const p = rootElement(doc);
    const textId = firstOf(doc, 'text');
    doc.apply({ type: 'setText', node: textId, value: 'abcdefghij' });
    doc.serialize();
    expect(doc.rangeOf(textId)).toEqual({ start: 3, end: 13 });
    expect(doc.rangeOf(p.id)).toEqual({ start: 0, end: 17 });
  });
});

describe('deterministic ids', () => {
  it('parse() produces identical id assignments for identical sources', () => {
    const collect = (doc: EditorDocument): string[] => {
      const out: string[] = [];
      const walk = (n: { id: string; children?: unknown[] }): void => {
        out.push(n.id);
        for (const c of (n.children ?? []) as Array<{ id: string; children?: unknown[] }>) walk(c);
      };
      walk(doc.root as never);
      return out;
    };
    expect(collect(parse('<p><em>x</em></p>'))).toEqual(collect(parse('<p><em>x</em></p>')));
  });
});
