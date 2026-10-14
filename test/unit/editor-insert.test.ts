// @vitest-environment happy-dom
// Unit spec — the insert lane's pure core (EDITOR.md §5.5): placement
// gates, request→target normalization, the catalog, snippet interpolation
// (wizard field→stop binding), and the one-op insert verb.
import { describe, expect, it } from 'vitest';

import { createDocument } from '../../src/editor/model/document.js';
import type { EditorDocument, ElementNode, NodeId } from '../../src/editor/model/types.js';
import { createContext } from '../../src/editor/controller/attach.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import {
  allowedTagsAt, canInsertTagAt, indexAmongChildren, resolveInsertTarget, containerTagAt,
} from '../../src/editor/insert/placement.js';
import {
  BUCKET_LABELS, BUCKET_ORDER, entriesForTarget, filterEntries, groupEntries, insertCatalog,
} from '../../src/editor/insert/catalog.js';
import {
  applyBooleanFields, compileSnippet, interpolateTemplate, previewSource,
} from '../../src/editor/insert/compile.js';
import { documentMovedSince, insertEntryAt } from '../../src/editor/insert/apply.js';
import type { InsertEntry, InsertTarget } from '../../src/editor/insert/types.js';

const SOURCE = '<sem-facts><sem-fact>One</sem-fact></sem-facts><sem-note><span class="sem-note-body">Hello</span></sem-note>';

function setup(): { doc: EditorDocument; ctx: EditorContext; factsId: NodeId; noteId: NodeId; rootId: NodeId } {
  const doc = createDocument(SOURCE);
  const ctx = createContext({ doc });
  const element = (tag: string): ElementNode =>
    doc.root.children.find((n) => n.kind === 'element' && n.name === tag) as ElementNode;
  return { doc, ctx, factsId: element('sem-facts').id, noteId: element('sem-note').id, rootId: doc.root.id };
}

function entry(tag: string): InsertEntry {
  const found = insertCatalog().find((e) => e.tag === tag);
  if (found === undefined) throw new Error(`no catalog entry for ${tag}`);
  return found;
}

// ── placement ───────────────────────────────────────────────────────────────

describe('allowedTagsAt (schema placement)', () => {
  it('the root allows every schema tag EXCEPT companion items, plus sem-chat', () => {
    const { doc, rootId } = setup();
    const allowed = allowedTagsAt(doc, rootId);
    expect(allowed.has('sem-note')).toBe(true);
    expect(allowed.has('sem-facts')).toBe(true);
    expect(allowed.has('sem-chat')).toBe(true); // seeded spec
    expect(allowed.has('sem-fact')).toBe(false); // optionsIn: sem-facts
    expect(allowed.has('sem-detail')).toBe(false);
    expect(allowed.has('highlight')).toBe(false);
    // npl-flag has NO optionsIn — it rides the root too (its container gate
    // is children data, not optionsIn), matching the pinned placement rule
    expect(allowed.has('npl-flag')).toBe(true);
  });

  it('a container allows its companions (sem-facts → sem-fact)', () => {
    const { doc, factsId } = setup();
    expect([...allowedTagsAt(doc, factsId)]).toEqual(['sem-fact']);
  });

  it('sem-details allows sem-detail and highlight', () => {
    const { doc } = setup();
    const details = createDocument('<sem-details></sem-details>');
    const id = (details.root.children[0] as ElementNode).id;
    const allowed = allowedTagsAt(details, id);
    expect(allowed.has('sem-detail')).toBe(true);
    expect(allowed.has('highlight')).toBe(true);
    expect(allowed.size).toBe(2);
    void doc;
  });

  it('children-as-tags arrive through children data (npl-flags → npl-flag)', () => {
    const { doc } = setup();
    const flags = createDocument('<npl-flags></npl-flags>');
    const id = (flags.root.children[0] as ElementNode).id;
    expect([...allowedTagsAt(flags, id)]).toEqual(['npl-flag']);
  });

  it('a leaf with no schema children allows nothing (sem-note)', () => {
    const { doc, noteId } = setup();
    expect(allowedTagsAt(doc, noteId).size).toBe(0);
  });

  it('canInsertTagAt mirrors the gate', () => {
    const { doc, factsId, noteId, rootId } = setup();
    expect(canInsertTagAt(doc, { parentId: rootId, index: 0 }, 'sem-note')).toBe(true);
    expect(canInsertTagAt(doc, { parentId: rootId, index: 0 }, 'sem-fact')).toBe(false);
    expect(canInsertTagAt(doc, { parentId: factsId, index: 1 }, 'sem-fact')).toBe(true);
    expect(canInsertTagAt(doc, { parentId: noteId, index: 0 }, 'sem-note')).toBe(false);
  });
});

describe('indexAmongChildren / containerTagAt', () => {
  it('is root-aware (the model answers -1 under the document root)', () => {
    const { doc, factsId, noteId } = setup();
    expect(indexAmongChildren(doc, factsId)).toBe(0);
    expect(indexAmongChildren(doc, noteId)).toBe(1);
    expect(doc.indexOf(factsId)).toBe(-1); // the raw model read, for contrast
  });

  it('containerTagAt: null at the root, the tag otherwise', () => {
    const { doc, factsId, rootId } = setup();
    expect(containerTagAt(doc, { parentId: rootId, index: 0 })).toBeNull();
    expect(containerTagAt(doc, { parentId: factsId, index: 0 })).toBe('sem-facts');
  });
});

describe('resolveInsertTarget (request normalization)', () => {
  it('null parent + null index + no selection = append at the root', () => {
    const { doc, rootId } = setup();
    expect(resolveInsertTarget(doc, { parent: null, index: null }, null)).toEqual({
      parentId: rootId, index: 2,
    });
  });

  it('clamps a wild index into 0..children.length', () => {
    const { doc, rootId } = setup();
    expect(resolveInsertTarget(doc, { parent: rootId, index: 99 }, null)?.index).toBe(2);
    expect(resolveInsertTarget(doc, { parent: rootId, index: -3 }, null)?.index).toBe(0);
  });

  it('a text-node parent normalizes to its parent element', () => {
    const { doc } = setup();
    const note = doc.root.children[1] as ElementNode;
    const body = note.children.find((c) => c.kind === 'element') as ElementNode;
    const text = body.children[0];
    expect(text?.kind).toBe('text');
    const target = resolveInsertTarget(doc, { parent: text.id, index: null }, null);
    expect(target?.parentId).toBe(body.id);
  });

  it('null index with a selected element selects INTO it (append)', () => {
    const { doc, factsId } = setup();
    const target = resolveInsertTarget(doc, { parent: null, index: null }, factsId);
    expect(target?.parentId).toBe(factsId);
    expect(target?.index).toBe(1);
  });

  it('null index with a selection outside the container appends', () => {
    const { doc, factsId, noteId } = setup();
    const target = resolveInsertTarget(doc, { parent: factsId, index: null }, noteId);
    // the note is not a child of sem-facts → append after its 1 item
    expect(target).toEqual({ parentId: factsId, index: 1 });
  });

  it('an unknown parent id returns null (caller announces)', () => {
    const { doc } = setup();
    expect(resolveInsertTarget(doc, { parent: 'n9999' as NodeId, index: 0 }, null)).toBeNull();
  });
});

// ── catalog ─────────────────────────────────────────────────────────────────

describe('insertCatalog', () => {
  it('has one entry per schema tag plus sem-chat, each with a template', () => {
    const catalog = insertCatalog();
    expect(catalog.length).toBe(50);
    for (const e of catalog) {
      expect(e.template.xml.length).toBeGreaterThan(0);
      expect(BUCKET_ORDER).toContain(e.bucket);
    }
    expect(catalog.some((e) => e.tag === 'sem-chat')).toBe(true);
    expect(catalog.some((e) => e.tag === 'sem-note')).toBe(true);
  });

  it('sem-chat rides the data bucket (lane override)', () => {
    expect(entry('sem-chat').bucket).toBe('data');
  });

  it('groups follow bucket order with labels; empty buckets are dropped', () => {
    const groups = groupEntries(insertCatalog());
    const seen = groups.map((g) => g.bucket);
    const order = seen.map((b) => BUCKET_ORDER.indexOf(b));
    expect([...order].sort((a, b) => a - b)).toEqual(order); // ascending
    for (const g of groups) expect(g.label).toBe(BUCKET_LABELS[g.bucket]);
    expect(groups.every((g) => g.entries.length > 0)).toBe(true);
  });

  it('entriesForTarget filters by placement', () => {
    const { doc, rootId, factsId } = setup();
    const atRoot = entriesForTarget(doc, { parentId: rootId, index: 0 });
    expect(atRoot.some((e) => e.tag === 'sem-note')).toBe(true);
    expect(atRoot.some((e) => e.tag === 'sem-fact')).toBe(false);
    expect(entriesForTarget(doc, { parentId: factsId, index: 0 }).map((e) => e.tag)).toEqual(['sem-fact']);
  });

  it('filterEntries matches title/tag/summary case-insensitively', () => {
    const catalog = insertCatalog();
    expect(filterEntries(catalog, 'SEM-NOTE').map((e) => e.tag)).toContain('sem-note');
    expect(filterEntries(catalog, 'zzz-no-match')).toEqual([]);
    expect(filterEntries(catalog, '  ')).toHaveLength(catalog.length);
  });
});

// ── compile / interpolation ────────────────────────────────────────────────

describe('interpolateTemplate (wizard field→stop binding)', () => {
  it('binds a field to the stop whose placeholder is the field name', () => {
    expect(interpolateTemplate('<sem-note>${1:caption}</sem-note>', { caption: 'Hi' })).toBe(
      '<sem-note>Hi</sem-note>',
    );
  });

  it('escapes attribute stops with the authored quote, text stops without', () => {
    const xml = '<x label="${1:caption}">${1:caption}</x>';
    const out = interpolateTemplate(xml, { caption: 'a "b" <c> &' });
    expect(out).toContain('label="a &quot;b&quot; &lt;c&gt; &amp;"');
    expect(out).toContain('>a "b" &lt;c&gt; &amp;<');
  });

  it('unbound stops keep their placeholder text', () => {
    expect(interpolateTemplate('<x>${1:caption}</x>', {})).toBe('<x>caption</x>');
  });

  it('choice stops fall back to the first option', () => {
    expect(interpolateTemplate('<x v="${2|b,c|}"/>', {})).toBe('<x v="b"/>');
  });

  it('is single-pass: a value containing stop grammar is never re-scanned', () => {
    expect(interpolateTemplate('<x>${1:caption}</x>', { caption: '${2|evil|}' })).toBe(
      '<x>${2|evil|}</x>',
    );
  });

  it('applyBooleanFields: checked → bare attribute, unchecked → removed', () => {
    const xml = '<x collapsed="" ranked="">body</x>';
    expect(applyBooleanFields(xml, { collapsed: 'true', ranked: '' }, ['collapsed', 'ranked'])).toBe(
      '<x collapsed>body</x>',
    );
    expect(applyBooleanFields(xml, { collapsed: '', ranked: 'true' }, ['collapsed', 'ranked'])).toBe(
      '<x ranked>body</x>',
    );
  });

  it('previewSource parses + serializes the result', () => {
    expect(previewSource('<sem-note>${1:caption}</sem-note>', { caption: 'Hey' })).toContain('Hey');
  });

  it('compileSnippet builds a detached node with a fresh id', () => {
    const { doc } = setup();
    const node = compileSnippet('<sem-note variant="info">x</sem-note>', doc);
    expect(node?.kind).toBe('element');
    expect(doc.node((node as ElementNode).id)).toBeUndefined(); // not attached yet
  });
});

// ── apply ───────────────────────────────────────────────────────────────────

describe('insertEntryAt (the one-op verb)', () => {
  it('inserts ONE node at the target index in ONE transaction', () => {
    const { doc, ctx, rootId } = setup();
    const before = doc.serialize();
    const version = doc.version;
    const announced: string[] = [];
    ctx.announce = (m) => announced.push(m);
    const tx = insertEntryAt(ctx, entry('sem-note'), { parentId: rootId, index: 0 });
    expect(tx).not.toBeNull();
    const children = doc.childrenOf(rootId);
    expect(children).toHaveLength(3);
    expect(children[0]?.name).toBe('sem-note');
    expect(doc.version).toBe(version + 1); // one transaction
    doc.undo();
    expect(doc.serialize()).toBe(before);
    expect(announced[0]).toContain('Inserted');
  });

  it('refuses schema-disallowed placement (announced, not thrown)', () => {
    const { ctx, rootId } = setup();
    const announced: string[] = [];
    ctx.announce = (m) => announced.push(m);
    const tx = insertEntryAt(ctx, entry('sem-fact'), { parentId: rootId, index: 0 });
    expect(tx).toBeNull();
    expect(announced[0]).toContain('cannot');
  });

  it('fires onInsert after a successful insert', () => {
    const { ctx, rootId } = setup();
    const calls: string[] = [];
    insertEntryAt(ctx, entry('sem-note'), { parentId: rootId, index: 0 }, {
      onInsert: (e) => calls.push(e.tag),
    });
    expect(calls).toEqual(['sem-note']);
  });

  it('documentMovedSince compares versions', () => {
    const { doc, ctx, rootId } = setup();
    const v = doc.version;
    expect(documentMovedSince(ctx, v)).toBe(false);
    insertEntryAt(ctx, entry('sem-note'), { parentId: rootId, index: 0 });
    expect(documentMovedSince(ctx, v)).toBe(true);
  });
});
