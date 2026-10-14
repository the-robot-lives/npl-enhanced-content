// @vitest-environment happy-dom
// Unit spec — LANE=desc-disclosure: the seven disclosure-bucket edit
// descriptors (sem-details, sem-detail, highlight, sem-reveal, sem-source,
// sem-views, sem-view) against the real model + controller.
//
// Feature: descriptor data (EDITOR.md §3.3)
//   Scenario: every bucket tag registers a hand descriptor with title + bucket
//   Scenario: slots are the host-is-slot or :scope > form; escape stays entities
//   Scenario: item-list selectors are :scope > anchored and match real DOM
//   Scenario: every template parses; stops start at 1 in the ${n:…}/${n|a,b} grammar
//   Scenario: wizards are coherent — field order matches stop order, required ids
// Feature: round-trip
//   Scenario: serialize(parse(example)) === example for every bucket tag
// Feature: edit isolation (lane brief)
//   Scenario: one attribute change / text edit / item add+remove per tag
//             changes the serialized source ONLY inside the touched node
//   Scenario: undo restores the untouched document byte-exact
// Feature: DOM protocol (Lit hosts of the bucket)
//   Scenario: sem-details item glyphs add/remove real detail children
//   Scenario: sem-source rerender re-snapshots the fence after an edit;
//             the fence never serializes into the model
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// descriptors register by side-effect import (EDITOR.md §3.2)
import '../../src/lit/sem-details.edit.js';
import '../../src/lit/sem-detail.edit.js';
import '../../src/lit/highlight.edit.js';
import '../../src/lit/sem-reveal.edit.js';
import '../../src/lit/sem-source.edit.js';
import '../../src/lit/sem-views.edit.js';
import '../../src/lit/sem-view.edit.js';

// the two Lit hosts of the bucket — DOM-protocol tests attach these
import '../../src/lit/sem-details.js';
import '../../src/lit/sem-source.js';

import { getDescriptor, hasHandDescriptor } from '../../src/editor/schema/registry.js';
import { loadSchema } from '../../src/editor/schema/load-schema.js';
import { tryParse } from '../../src/editor/model/document.js';
import type { EditorDocument, EditorNode, SourceRange } from '../../src/editor/model/types.js';
import {
  attachEditor,
  createContext,
  detachEditor,
} from '../../src/editor/controller/attach.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import type { SemElement } from '../../src/lit/base.js';
import {
  commitSlotText,
  removeItem,
} from '../../src/editor/controller/actions.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const MINE = [
  'sem-details',
  'sem-detail',
  'highlight',
  'sem-reveal',
  'sem-source',
  'sem-views',
  'sem-view',
] as const;

type ElNode = Extract<EditorNode, { kind: 'element' }>;
type TextNodeT = Extract<EditorNode, { kind: 'text' }>;

// ── model-tree helpers ───────────────────────────────────────────────────────

function allEl(root: EditorNode, name: string): ElNode[] {
  const out: ElNode[] = [];
  const walk = (n: EditorNode): void => {
    if (n.kind === 'element' && n.name.toLowerCase() === name.toLowerCase()) out.push(n);
    if (n.kind === 'element' || n.kind === 'document') {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return out;
}

function firstTextOf(n: EditorNode): TextNodeT | null {
  if (n.kind === 'text') return n;
  if (n.kind !== 'element') return null;
  for (const c of n.children) {
    const t = firstTextOf(c);
    if (t !== null) return t;
  }
  return null;
}

function docFromExample(tag: string): EditorDocument {
  const src = loadSchema().byName.get(tag)!.example;
  const parsed = tryParse(src);
  if (!parsed.ok) throw new Error(`${tag}: elements.json example does not parse`);
  return parsed.doc;
}

/** The byte span where `before` and `after` differ (common prefix/suffix
 *  trim; the suffix is computed FIRST so trailing context — e.g. the
 *  closing tag after an end insertion — is never swallowed by a
 *  coincidental 1-char prefix match). `removed` is the before-side bytes,
 *  `next` the after-side bytes; start/end are in AFTER coordinates. */
function deltaSpan(before: string, after: string): { start: number; end: number; removed: string; next: string } {
  const min = Math.min(before.length, after.length);
  let s = 0;
  while (s < min && before[before.length - 1 - s] === after[after.length - 1 - s]) s += 1;
  let p = 0;
  const maxP = min - s;
  while (p < maxP && before[p] === after[p]) p += 1;
  return {
    start: p,
    end: p + (after.length - s - p),
    removed: before.slice(p, before.length - s),
    next: after.slice(p, after.length - s),
  };
}

/** The lane's core assertion: the edit changed source ONLY inside the
 *  touched node's pre-edit range, and undo restores the document
 *  byte-exact (serialize(parse(x)) === x for the untouched doc). */
function assertConfinedEdit(
  tag: string,
  edit: (doc: EditorDocument) => { id: NodeId | null; expectChange: boolean },
): void {
  const doc = docFromExample(tag);
  const before = doc.serialize();
  const { id, expectChange } = edit(doc);
  const after = doc.serialize();
  const span = deltaSpan(before, after);
  const changed = span.removed.length + span.next.length;
  if (expectChange) {
    expect(changed, `${tag}: source changed`).toBeGreaterThan(0);
  } else {
    expect(changed, `${tag}: source untouched`).toBe(0);
  }
  if (id !== null) {
    const range: SourceRange | undefined = doc.rangeOf(id);
    expect(range, `${tag}: touched node has a range`).toBeDefined();
    expect(span.start, `${tag}: delta starts inside the touched node`).toBeGreaterThanOrEqual(range!.start);
    expect(span.end, `${tag}: delta ends inside the touched node`).toBeLessThanOrEqual(range!.end);
  }
  doc.undo();
  expect(doc.serialize(), `${tag}: undo restores the document byte-exact`).toBe(before);
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function makeEl(markup: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  return el;
}

function itemsOf(el: Element, selector: string): Element[] {
  return Array.from(el.querySelectorAll(selector));
}

// ── descriptor data ──────────────────────────────────────────────────────────

describe('disclosure descriptors — data (§3.3)', () => {
  it('registers every bucket tag as a hand descriptor with title + bucket', () => {
    for (const tag of MINE) {
      expect(hasHandDescriptor(tag), tag).toBe(true);
      const d = getDescriptor(tag)!;
      expect(d.tag.toLowerCase(), tag).toBe(tag);
      expect(d.title.length, tag).toBeGreaterThan(0);
      expect(['disclosure', 'views'], `${tag} bucket`).toContain(d.bucket);
      expect(d.summary?.length, tag).toBeGreaterThan(0);
    }
  });

  it('slots use the host-is-slot or :scope > form; escape stays entities', () => {
    for (const tag of MINE) {
      const d = getDescriptor(tag)!;
      for (const slot of d.textSlots ?? []) {
        expect(
          slot.selector === ':scope' || slot.selector.startsWith(':scope >'),
          `${tag} slot ${slot.selector}`,
        ).toBe(true);
        expect(slot.escape, tag).toBe('entities');
        expect(slot.label.length, tag).toBeGreaterThan(0);
      }
    }
    // bodies that are plain text use the host-is-slot form (map.ts: the
    // unwrapped-content contract); containers declare none
    expect(getDescriptor('sem-detail')!.textSlots?.[0]?.selector).toBe(':scope');
    expect(getDescriptor('highlight')!.textSlots?.[0]?.selector).toBe(':scope');
    expect(getDescriptor('sem-reveal')!.textSlots?.[0]?.selector).toBe(':scope');
    expect(getDescriptor('sem-view')!.textSlots?.[0]?.selector).toBe(':scope');
    expect(getDescriptor('sem-details')!.textSlots).toBeUndefined();
    expect(getDescriptor('sem-source')!.textSlots).toBeUndefined();
  });

  it('item-list selectors are :scope > anchored and match real DOM', () => {
    for (const tag of ['sem-details', 'sem-views']) {
      const d = getDescriptor(tag)!;
      expect(d.itemList, tag).toBeDefined();
      expect(d.itemList!.childSelector.startsWith(':scope >'), tag).toBe(true);
      const host = makeEl(loadSchema().byName.get(tag)!.example);
      const matched = itemsOf(host, d.itemList!.childSelector);
      expect(matched.length, `${tag} childSelector`).toBeGreaterThan(0);
      host.remove();
    }
    expect(getDescriptor('sem-details')!.containerOf).toBe('sem-detail');
    expect(getDescriptor('sem-views')!.containerOf).toBe('sem-view');
  });

  it('every template parses and stops start at 1 in the stop grammar', () => {
    const textStop = /^\$\{\d+:[^{}]*\}$/;
    const choiceStop = /^\$\{\d+\|[^{}]*\}$/;
    for (const tag of MINE) {
      const d = getDescriptor(tag)!;
      expect(d.templates?.length, `${tag} has templates`).toBeGreaterThan(0);
      for (const t of d.templates ?? []) {
        const parsed = tryParse(t.xml);
        expect(parsed.ok, `${tag}/${t.id} parses`).toBe(true);
        const first = /\$\{(\d+)/.exec(t.xml)?.[1] ?? null;
        if (first !== null) expect(first, `${tag}/${t.id} first stop`).toBe('1');
        for (const stop of t.xml.match(/\$\{\d+[^}]*\}/g) ?? []) {
          expect(textStop.test(stop) || choiceStop.test(stop), `${tag}/${t.id} stop "${stop}"`).toBe(true);
        }
      }
    }
  });

  it('wizards are coherent: field order matches stop order, ids required', () => {
    const stopCount = (xml: string): number => (xml.match(/\$\{\d+[^}]*\}/g) ?? []).length;
    for (const tag of ['sem-details', 'sem-views', 'sem-view']) {
      const d = getDescriptor(tag)!;
      expect(d.wizard?.steps.length, `${tag} wizard`).toBeGreaterThan(0);
      for (const step of d.wizard!.steps) {
        expect(step.fields.length, `${tag} wizard fields`).toBeGreaterThan(0);
        expect(stopCount(step.template.xml), `${tag} field⇔stop order`).toBe(step.fields.length);
        const parsed = tryParse(step.template.xml);
        expect(parsed.ok, `${tag} wizard template parses`).toBe(true);
        for (const f of step.fields) {
          expect(['text', 'url', 'select', 'textarea', 'number', 'boolean'], `${tag} field type`).toContain(f.type);
        }
      }
    }
    // the tab-family ids the deep links need are collected as required
    const viewFields = getDescriptor('sem-view')!.wizard!.steps[0]!.fields;
    expect(viewFields.filter((f) => f.required).map((f) => f.name)).toEqual(['name', 'id', 'content']);
  });
});

// ── round-trip ───────────────────────────────────────────────────────────────

describe('disclosure descriptors — round-trip', () => {
  for (const tag of MINE) {
    it(`serialize(parse(example)) === example for ${tag}`, () => {
      const src = loadSchema().byName.get(tag)!.example;
      const parsed = tryParse(src);
      expect(parsed.ok, tag).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.doc.serialize()).toBe(src);
    });
  }
});

// ── edit isolation (one attr change + one text edit + items where applicable)

describe('disclosure descriptors — edits stay inside the touched node', () => {
  it('sem-details: view-as attribute change', () => {
    assertConfinedEdit('sem-details', (doc) => {
      const container = allEl(doc.root, 'sem-details')[0]!;
      doc.apply({ type: 'setAttr', node: container.id, name: 'view-as', value: 'plain' });
      return { id: container.id, expectChange: true };
    });
  });

  it('sem-details: text edit inside a detail', () => {
    assertConfinedEdit('sem-details', (doc) => {
      const detail = allEl(doc.root, 'sem-detail')[0]!;
      const text = firstTextOf(detail)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Edited prose.' });
      return { id: detail.id, expectChange: true };
    });
  });

  it('sem-details: item add appends a detail; undo restores byte-exact', () => {
    assertConfinedEdit('sem-details', (doc) => {
      const container = allEl(doc.root, 'sem-details')[0]!;
      // items rebuild through the document factories (§2.3 adoption rule;
      // actions.buildFromXml currently re-ids colliding — controller ask)
      const node = doc.createElement({
        tag: 'sem-detail',
        children: [doc.createText('Added detail')],
      });
      const op = { type: 'insertNode', parent: container.id, index: container.children.length, node } as const;
      expect(doc.canApply(op).ok).toBe(true);
      doc.apply(op);
      return { id: node.id, expectChange: true };
    });
  });

  it('sem-details: item remove deletes a detail; undo restores byte-exact', () => {
    assertConfinedEdit('sem-details', (doc) => {
      const details = allEl(doc.root, 'sem-detail');
      expect(details.length).toBe(1);
      const op = { type: 'removeNode', node: details[0]!.id } as const;
      doc.apply(op);
      return { id: null, expectChange: true }; // removed id is unregistered
    });
  });

  it('sem-detail: id attribute + body text edit', () => {
    assertConfinedEdit('sem-detail', (doc) => {
      const detail = allEl(doc.root, 'sem-detail')[0]!;
      doc.apply({ type: 'setAttr', node: detail.id, name: 'id', value: 'oidc-detail' });
      return { id: detail.id, expectChange: true };
    });
    assertConfinedEdit('sem-detail', (doc) => {
      const detail = allEl(doc.root, 'sem-detail')[0]!;
      const text = firstTextOf(detail)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Rewritten detail prose.' });
      return { id: detail.id, expectChange: true };
    });
  });

  it('highlight: inline text edit + global attribute', () => {
    assertConfinedEdit('highlight', (doc) => {
      const h = allEl(doc.root, 'highlight')[0]!;
      const text = firstTextOf(h)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Bearer token' });
      return { id: h.id, expectChange: true };
    });
    assertConfinedEdit('highlight', (doc) => {
      const h = allEl(doc.root, 'highlight')[0]!;
      doc.apply({ type: 'setAttr', node: h.id, name: 'kind', value: 'recall' });
      return { id: h.id, expectChange: true };
    });
  });

  it('sem-reveal: summary attribute + body text edit', () => {
    assertConfinedEdit('sem-reveal', (doc) => {
      const r = allEl(doc.root, 'sem-reveal')[0]!;
      doc.apply({ type: 'setAttr', node: r.id, name: 'summary', value: 'Why not cookies?' });
      return { id: r.id, expectChange: true };
    });
    assertConfinedEdit('sem-reveal', (doc) => {
      const r = allEl(doc.root, 'sem-reveal')[0]!;
      const text = firstTextOf(r)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Rewritten answer body.' });
      return { id: r.id, expectChange: true };
    });
  });

  it('sem-source: label attribute + heading text edit', () => {
    assertConfinedEdit('sem-source', (doc) => {
      const s = allEl(doc.root, 'sem-source')[0]!;
      doc.apply({ type: 'setAttr', node: s.id, name: 'label', value: 'Renamed caption' });
      return { id: s.id, expectChange: true };
    });
    assertConfinedEdit('sem-source', (doc) => {
      const h2 = allEl(doc.root, 'h2')[0]!;
      const text = firstTextOf(h2)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Renamed heading' });
      return { id: h2.id, expectChange: true };
    });
  });

  it('sem-views: container id + view item add/remove', () => {
    assertConfinedEdit('sem-views', (doc) => {
      const container = allEl(doc.root, 'sem-views')[0]!;
      doc.apply({ type: 'setAttr', node: container.id, name: 'id', value: 'deploy-x' });
      return { id: container.id, expectChange: true };
    });
    assertConfinedEdit('sem-views', (doc) => {
      const container = allEl(doc.root, 'sem-views')[0]!;
      const node = doc.createElement({
        tag: 'sem-view',
        attrs: [
          { name: 'name', value: 'CLI' },
          { name: 'id', value: 'cli' },
          { name: 'role', value: 'tabpanel' },
        ],
        children: [doc.createText('CLI content')],
      });
      const op = { type: 'insertNode', parent: container.id, index: container.children.length, node } as const;
      expect(doc.canApply(op).ok).toBe(true);
      doc.apply(op);
      return { id: node.id, expectChange: true };
    });
    assertConfinedEdit('sem-views', (doc) => {
      const views = allEl(doc.root, 'sem-view');
      const op = { type: 'removeNode', node: views[views.length - 1]!.id } as const;
      doc.apply(op);
      return { id: null, expectChange: true };
    });
  });

  it('sem-view: name attribute + content text edit', () => {
    assertConfinedEdit('sem-view', (doc) => {
      const v = allEl(doc.root, 'sem-view')[0]!;
      doc.apply({ type: 'setAttr', node: v.id, name: 'name', value: 'Compose' });
      return { id: v.id, expectChange: true };
    });
    assertConfinedEdit('sem-view', (doc) => {
      const v = allEl(doc.root, 'sem-view')[0]!;
      const text = firstTextOf(v)!;
      doc.apply({ type: 'setText', node: text.id, value: 'Rewritten view content.' });
      return { id: v.id, expectChange: true };
    });
  });

  it('an untouched sibling example round-trips while a neighbor edits', () => {
    // sem-details example: editing the container attr must not perturb the
    // detail subtree bytes outside the touched range (implied by
    // containment, asserted here explicitly on the detail prefix).
    const doc = docFromExample('sem-details');
    const before = doc.serialize();
    const container = allEl(doc.root, 'sem-details')[0]!;
    const detail = allEl(doc.root, 'sem-detail')[0]!;
    const detailRange = doc.rangeOf(detail.id)!;
    const beforeBytes = before.slice(detailRange.start, detailRange.end);
    doc.apply({ type: 'setAttr', node: container.id, name: 'view-as', value: 'plain' });
    const after = doc.serialize();
    // 'quiz'→'plain' shifts every later byte by +1; the untouched detail's
    // CONTENT is identical once the shift is accounted for
    const shift = after.length - before.length;
    expect(after.slice(detailRange.start + shift, detailRange.end + shift)).toBe(beforeBytes);
  });
});

// ── DOM protocol on the bucket's Lit hosts ───────────────────────────────────

describe('disclosure descriptors — DOM protocol (Lit hosts)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-details, sem-source').forEach((n) => detachEditor(n as unknown as SemElement));
  });

  it('sem-details: item glyphs add/remove real detail children; slot commit edits one', async () => {
    const el = makeEl(
      '<sem-details id="d1"><sem-detail>\n  First detail\n</sem-detail><sem-detail>\n  Second detail\n</sem-detail></sem-details>',
    );
    const ctx: EditorContext = createContext();
    const c = attachEditor(el, ctx);
    expect(c).not.toBeNull();
    const selector = getDescriptor('sem-details')!.itemList!.childSelector;
    const items = (): Element[] => itemsOf(el, selector);
    expect(items().length).toBe(2);

    // item add through the model factories (§2.3): the re-render projects
    // the new detail child (actions.buildFromXml id-collision ask noted in
    // the lane report — the glyph's + path uses it and is data-dependent)
    const containerId = c!.binding.rootId;
    const node = ctx.doc.createElement({
      tag: 'sem-detail',
      children: [ctx.doc.createText('Added detail')],
    });
    ctx.doc.apply({ type: 'insertNode', parent: containerId, index: ctx.doc.childrenOf(containerId).length, node });
    await flush();
    expect(items().length).toBe(3);
    expect(items()[2]!.textContent).toContain('Added detail');

    removeItem(ctx, c!.binding, items()[0]!);
    await flush();
    expect(items().length).toBe(2);

    // text edit through the container binding: the touched detail only
    const before = ctx.doc.serialize();
    const detail = items()[0]!;
    expect(commitSlotText(ctx, c!.binding, detail, 'Edited detail prose')).toBe(true);
    await flush();
    expect(items()[0]!.textContent).toContain('Edited detail prose');
    expect(items()[1]!.textContent).not.toContain('Edited detail prose');
    const after = ctx.doc.serialize();
    expect(after).not.toBe(before);
    ctx.doc.undo();
    await flush();
    expect(ctx.doc.serialize()).toBe(before);

    // attribute change re-projects the host; children keep node identity
    const secondBefore = items()[0];
    const root = ctx.doc.root.children[0]!;
    ctx.doc.apply({ type: 'setAttr', node: root.id, name: 'view-as', value: 'quiz' });
    await flush();
    const modelAttr = (ctx.doc.root.children[0] as ElNode).attrs.find((a) => a.name === 'view-as');
    expect(modelAttr?.value).toBe('quiz');
    expect(items()[0]).toBe(secondBefore); // untouched child kept node-for-node (§4.4)
  });

  it('sem-source: rerender re-snapshots the fence after an edit; fence never serializes', async () => {
    // Attach BEFORE connect (the shell path: the model is built from the
    // authored form, never from the element's own upgrade snapshot).
    const wrap = document.createElement('div');
    wrap.innerHTML = '<sem-source id="s1" label="Facts">\n  <h2>Facts — flashcards</h2>\n</sem-source>';
    const el = wrap.firstElementChild as HTMLElement;
    const ctx: EditorContext = createContext();
    const c = attachEditor(el, ctx);
    expect(c).not.toBeNull();
    expect(el.querySelector(':scope > template.sem-source-raw')).toBeNull(); // authored form pre-upgrade
    document.body.appendChild(el);
    await flush();
    // the element's own upgrade fences the markup — element behavior, and
    // the fence stays runtime chrome: it never enters the model
    expect(el.querySelector(':scope > template.sem-source-raw')).not.toBeNull();
    expect(ctx.doc.serialize()).not.toContain('template');

    const before = ctx.doc.serialize();
    const root = ctx.doc.root.children[0]!;
    ctx.doc.apply({ type: 'setAttr', node: root.id, name: 'label', value: 'Renamed' });
    await flush();

    // re-render dropped the stale fence; descriptor.rerender re-took it fresh
    const tpl = el.querySelector<HTMLTemplateElement>(':scope > template.sem-source-raw');
    expect(tpl).not.toBeNull();
    expect(tpl!.content.querySelectorAll('h2').length).toBe(1);

    // text edit inside → re-render → fence reflects the NEW content.
    // sem-source declares NO textSlots by design (children are arbitrary
    // SemText — they edit through their own bindings or the code view),
    // so this leg drives the model's setText directly.
    const h2 = el.querySelector('h2')!;
    const h2Node = allEl(ctx.doc.root, 'h2')[0]!;
    const h2Text = firstTextOf(h2Node)!;
    ctx.doc.apply({ type: 'setText', node: h2Text.id, value: 'Renamed heading' });
    await flush();
    expect(el.querySelector('h2')!.textContent).toBe('Renamed heading');
    const tpl2 = el.querySelector<HTMLTemplateElement>(':scope > template.sem-source-raw');
    expect(tpl2!.content.querySelector('h2')!.textContent).toBe('Renamed heading');

    // the fence is runtime chrome: never model content, never serialized
    expect(ctx.doc.serialize()).not.toContain('template');
    expect(ctx.doc.serialize()).not.toBe(before);
    ctx.doc.undo(); // undoes the setText
    ctx.doc.undo(); // undoes the setAttr
    await flush();
    expect(ctx.doc.serialize()).toBe(before);
  });
});
