// @vitest-environment happy-dom
// Unit spec — the insert lane's pure core (EDITOR.md §5.5): placement
// gates, request→target normalization, the catalog, snippet interpolation
// (wizard field→stop binding), and the one-op insert verb.
import { describe, expect, it } from 'vitest';

import { createDocument } from '../../src/editor/model/document.js';
import type { EditorDocument, ElementNode, NodeId } from '../../src/editor/model/types.js';
import { createContext } from '../../src/editor/controller/attach.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
// side-effect imports: register the hand-only descriptors under test
import '../../src/lit/sem-question.edit.js';
import '../../src/lit/sem-option.edit.js';
import {
  allowedTagsAt, canInsertTagAt, indexAmongChildren, resolveInsertTarget, containerTagAt,
} from '../../src/editor/insert/placement.js';
import {
  BUCKET_LABELS, BUCKET_ORDER, entriesForTarget, filterEntries, groupEntries, insertCatalog,
} from '../../src/editor/insert/catalog.js';
import {
  applyBooleanFields, compileSnippet, interpolateTemplate, previewSource,
} from '../../src/editor/insert/compile.js';
import { scanStops, stripStops } from '../../src/editor/templates/stops.js';
import { documentMovedSince, insertEntryAt } from '../../src/editor/insert/apply.js';
import type { InsertEntry, InsertTarget } from '../../src/editor/insert/types.js';
import type { WizardField } from '../../src/editor/schema/types.js';

/** Wizard field fixture: name carries the value key; type drives validation. */
const f = (name: string, type: WizardField['type'] = 'text', options?: string[]): WizardField => ({
  name,
  label: name,
  type,
  ...(options !== undefined ? { options } : {}),
});

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
    // hand-only descriptors (no schema entry): sem-question is top-level
    // (no containerOf); sem-option is companion-gated, never at the root
    expect(allowed.has('sem-question')).toBe(true);
    expect(allowed.has('sem-option')).toBe(false);
  });

  it('a hand-only containerOf descriptor gates on its container (sem-question → sem-option)', () => {
    const q = createDocument('<sem-question type="mc"></sem-question>');
    const id = (q.root.children[0] as ElementNode).id;
    expect([...allowedTagsAt(q, id)]).toEqual(['sem-option']);
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
  it('has one entry per schema tag plus sem-chat plus the hand-only descriptors', () => {
    const catalog = insertCatalog();
    expect(catalog.length).toBe(57); // 54 schema + sem-chat + sem-question + sem-option
    for (const e of catalog) {
      expect(e.template.xml.length).toBeGreaterThan(0);
      expect(BUCKET_ORDER).toContain(e.bucket);
    }
    expect(catalog.some((e) => e.tag === 'sem-chat')).toBe(true);
    expect(catalog.some((e) => e.tag === 'sem-note')).toBe(true);
  });

  it('hand-only descriptors surface with their real templates (sem-question)', () => {
    const q = entry('sem-question');
    expect(q.title).toBe('Quiz question');
    expect(q.bucket).toBe('recall'); // EditBucket widened by the schema lane
    expect(q.wizard).not.toBeNull();
    expect(q.template.xml).toContain('${1|'); // their positional choice stop rides along
    expect(entry('sem-option').tag).toBe('sem-option');
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

  it('entriesForTarget filters by placement (schema AND hand-only)', () => {
    const { doc, rootId, factsId } = setup();
    const atRoot = entriesForTarget(doc, { parentId: rootId, index: 0 });
    expect(atRoot.some((e) => e.tag === 'sem-note')).toBe(true);
    expect(atRoot.some((e) => e.tag === 'sem-fact')).toBe(false);
    expect(atRoot.some((e) => e.tag === 'sem-question')).toBe(true);
    expect(entriesForTarget(doc, { parentId: factsId, index: 0 }).map((e) => e.tag)).toEqual(['sem-fact']);
    const q = createDocument('<sem-question type="mc"></sem-question>');
    const qId = (q.root.children[0] as ElementNode).id;
    expect(entriesForTarget(q, { parentId: qId, index: 0 }).map((e) => e.tag)).toEqual(['sem-option']);
  });

  it('filterEntries matches title/tag/summary case-insensitively', () => {
    const catalog = insertCatalog();
    expect(filterEntries(catalog, 'SEM-NOTE').map((e) => e.tag)).toContain('sem-note');
    expect(filterEntries(catalog, 'zzz-no-match')).toEqual([]);
    expect(filterEntries(catalog, '  ')).toHaveLength(catalog.length);
  });
});

// ── compile / interpolation ────────────────────────────────────────────────

describe('interpolateTemplate (POSITIONAL wizard binding — the desc-lane convention)', () => {
  it('binds field i to stop i (placeholder text is a label, not a key)', () => {
    // sem-question's real shape: field 'prompt' ↔ stop `${2:Prompt}`
    const fields = [f('type', 'select', ['mc', 'cloze']), f('prompt')];
    const xml = '<sem-question><p data-kind="prompt">${2:Prompt}</p></sem-question>';
    expect(interpolateTemplate(xml, fields, { type: 'mc', prompt: 'Why?' })).toBe(
      '<sem-question><p data-kind="prompt">Why?</p></sem-question>',
    );
  });

  it('escapes attribute stops with the authored quote, text stops without', () => {
    const xml = '<x label="${1:Label}">${2:Body}</x>';
    const values = { label: 'a "b" <c> &', body: 'a "b" <c> &' };
    const out = interpolateTemplate(xml, [f('label'), f('body')], values);
    expect(out).toContain('label="a &quot;b&quot; &lt;c&gt; &amp;"');
    expect(out).toContain('>a "b" &lt;c&gt; &amp;<');
  });

  it('more stops than fields: extra named stops keep their placeholder text', () => {
    expect(interpolateTemplate('<x>${1:A} ${2:B}</x>', [f('a')], { a: 'v' })).toBe('<x>v B</x>');
  });

  it('a bound choice stop takes the field value (validated at the step)', () => {
    const fields = [f('kind'), f('level', 'select', ['b', 'c'])];
    expect(interpolateTemplate('<x v="${2|b,c|}"/>', fields, { kind: 'k', level: 'c' })).toBe('<x v="c"/>');
  });

  it('an UNBOUND choice stop falls to the first option', () => {
    expect(interpolateTemplate('<x v="${2|b,c|}"/>', [], {})).toBe('<x v="b"/>');
  });

  it('an empty non-required named field substitutes an empty string (attr stays, validator warns)', () => {
    expect(interpolateTemplate('<x note="${1:Note}">t</x>', [f('note')], { note: '' })).toBe(
      '<x note="">t</x>',
    );
  });

  it('a bare stop substitutes its field value, or nothing when unbound', () => {
    expect(interpolateTemplate('<x>${1}</x>', [f('v')], { v: 'x' })).toBe('<x>x</x>');
    expect(interpolateTemplate('<x>${1}</x>', [], {})).toBe('<x></x>');
  });

  it('is single-pass: a value containing stop grammar is never re-scanned', () => {
    expect(interpolateTemplate('<x>${1:Caption}</x>', [f('cap')], { cap: '${2|evil|}' })).toBe(
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
    expect(previewSource('<sem-note>${1:Caption}</sem-note>', [f('cap')], { cap: 'Hey' })).toContain('Hey');
  });

  it('compileSnippet builds a detached node with a fresh id (stops stripped)', () => {
    const { doc } = setup();
    const node = compileSnippet('<sem-note variant="${2|info,warn|}">${1:Caption}</sem-note>', doc);
    expect(node?.kind).toBe('element');
    expect((node as ElementNode).attrs.find((a) => a.name === 'variant')?.value).toBe('info');
    expect((node as ElementNode).children[0]?.kind).toBe('text');
    expect(doc.node((node as ElementNode).id)).toBeUndefined(); // not attached yet
  });
});

describe('templates/stops (the ONE shared stop grammar)', () => {
  it('scanStops classifies named, choice, and bare stops in order', () => {
    const stops = scanStops('<x a="${1:hey}" v="${2|b,c|}">${3}</x>');
    expect(stops.map((s) => s.kind)).toEqual(['named', 'choice', 'bare']);
    expect(stops[0]?.text).toBe('hey');
    expect(stops[1]?.options).toEqual(['b', 'c']);
    expect(stops[2]?.index).toBe(3);
  });

  it('choice options are verbatim (split on comma, never trimmed)', () => {
    expect(scanStops('<x v="${2|a, b|}"/>')[0]?.options).toEqual(['a', ' b']);
  });

  it('stripStops: named → placeholder, choice → first option, bare → removed', () => {
    expect(stripStops('<x a="${1:hey}" v="${2|b,c|}">${3}</x>')).toBe('<x a="hey" v="b"></x>');
  });

  it('stripStops keeps the comma form intact (the desc-data conflict case)', () => {
    // the legacy controller regex mangled option lists; the shared parser does not
    expect(stripStops('<sem-chronology v="${2|timeline,list|}"/>')).toBe('<sem-chronology v="timeline"/>');
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
