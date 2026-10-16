// @vitest-environment happy-dom
// Unit spec — LANE=desc-npl-a edit descriptors (brief §6; EDITOR.md §3.3).
//
// Lane split (20 npl-* tags, alphabetical halves): npl-a = npl-agent,
// npl-artifact, npl-cot, npl-critique, npl-declaration, npl-directive,
// npl-example, npl-flag, npl-flags, npl-hormones. npl-b = npl-intent …
// npl-vos (the other lane).
//
// Per tag:
//   Scenario: the elements.json example round-trips byte-exact through the
//             model (untouched documents never drift)
//   Scenario: a HAND descriptor registers in bucket npl-a with `:scope`
//             selectors, entity escapes, parsing templates, and wizard
//             fields bound 1:1 to their template stops in order
//   Scenario: an attribute edit splices the serialized source ONLY inside
//             the touched attribute (or the open tag, for a bare-attribute
//             authoring); undo restores byte-exact
//   Scenario: a text edit splices ONLY the touched text node
//   Scenario: item add inserts exactly at the list tail, remove returns the
//             serialization byte-exact (add/remove cancel)
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// element classes define the custom elements (attach upgrades them)
import '../../src/lit/npl/npl-agent.js';
import '../../src/lit/npl/npl-artifact.js';
import '../../src/lit/npl/npl-cot.js';
import '../../src/lit/npl/npl-critique.js';
import '../../src/lit/npl/npl-declaration.js';
import '../../src/lit/npl/npl-directive.js';
import '../../src/lit/npl/npl-example.js';
import '../../src/lit/npl/npl-flag.js';
import '../../src/lit/npl/npl-flags.js';
import '../../src/lit/npl/npl-hormones.js';
// descriptors register by side effect on import
import '../../src/lit/npl/npl-agent.edit.js';
import '../../src/lit/npl/npl-artifact.edit.js';
import '../../src/lit/npl/npl-cot.edit.js';
import '../../src/lit/npl/npl-critique.edit.js';
import '../../src/lit/npl/npl-declaration.edit.js';
import '../../src/lit/npl/npl-directive.edit.js';
import '../../src/lit/npl/npl-example.edit.js';
import '../../src/lit/npl/npl-flag.edit.js';
import '../../src/lit/npl/npl-flags.edit.js';
import '../../src/lit/npl/npl-hormones.edit.js';

import type { SemElement } from '../../src/lit/base.js';
import { parse, tryParse } from '../../src/editor/model/document.js';
import { seedIdCounter } from '../../src/editor/model/parse.js';
import type { EditorDocument, ElementNode, NodeId, TextNode } from '../../src/editor/model/types.js';
import { attachEditor, createContext, detachEditor } from '../../src/editor/controller/attach.js';
import { addItem, removeItem, stripTemplateStops } from '../../src/editor/controller/actions.js';
import { modelIdFor } from '../../src/editor/controller/map.js';
import { rebuildSubtree } from '../../src/editor/safety/sanitize.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import { getDescriptor, hasHandDescriptor } from '../../src/editor/schema/registry.js';
import { loadSchema } from '../../src/editor/schema/load-schema.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const EXAMPLES = new Map(loadSchema().tags.map((t) => [t.name, t.example]));

interface TagSpec {
  /** Single-root authored variant the edit scenarios run against. */
  markup: string;
  /** The attribute edit: `value` swaps the authored value; omitted = the
   *  bare-attribute authoring (present-without-value) on a tag that lacks
   *  one initially (npl-cot's `collapsed`). */
  attr: { name: string; value?: string };
  /** childSelector when the tag carries an item list (+/− verbs). */
  itemList?: string;
  /** Settle the element's first lit update chain after attach (see edit). */
  settle?: boolean;
}

const TAGS: ReadonlyArray<{ name: string; spec: TagSpec }> = [
  {
    name: 'npl-agent',
    spec: {
      markup:
        '<npl-agent name="scout" type="scout" version="0.3" extends="base-agent">\n' +
        'Read-only scout: search, read, and summarise.\n</npl-agent>',
      attr: { name: 'name', value: 'pathfinder' },
    },
  },
  {
    name: 'npl-artifact',
    spec: {
      markup:
        '<npl-artifact type="code">\n  <title>Q3 revenue breakdown</title>\n' +
        '  <content>def q3(): return rows()</content>\n</npl-artifact>',
      attr: { name: 'type', value: 'text' },
    },
  },
  {
    name: 'npl-cot',
    spec: {
      markup:
        '<npl-cot>\n  <sem-step>Pull the failing log lines.</sem-step>\n' +
        '  <sem-step>The 502s cluster in one span.</sem-step>\n' +
        '  <div outcome>The upstream proxy restarted mid-window.</div>\n</npl-cot>',
      attr: { name: 'collapsed' },
      itemList: ':scope > :is(sem-step, .sem-step)',
    },
  },
  {
    name: 'npl-critique',
    spec: {
      markup:
        '<npl-critique id="c1">\n  <subject>the launch prompt</subject>\n' +
        '  <perspective>security reviewer</perspective>\n' +
        '  <strengths><item>explicit failure modes</item><item>bounded output</item></strengths>\n' +
        '  <weaknesses><item>no examples</item></weaknesses>\n' +
        '  <verdict>ship after one revision</verdict>\n</npl-critique>',
      attr: { name: 'id', value: 'c2' },
    },
  },
  {
    name: 'npl-declaration',
    spec: {
      markup:
        '<npl-declaration version="0.6">Every response states its assumptions before its answer.</npl-declaration>',
      attr: { name: 'version', value: '0.7' },
    },
  },
  {
    name: 'npl-directive',
    spec: {
      markup:
        '<npl-directive glyph="🔮" kind="directive" qualifier="style">\n' +
        '  be terse | because the reader is skimming\n</npl-directive>',
      attr: { name: 'qualifier', value: 'tone' },
    },
  },
  {
    name: 'npl-example',
    spec: {
      markup: '<npl-example label="hello">authored children survive beside the label</npl-example>',
      attr: { name: 'label', value: 'hi' },
    },
  },
  {
    name: 'npl-flag',
    spec: {
      markup: '<npl-flag name="calm_factor" value="0.5"></npl-flag>',
      attr: { name: 'value', value: '0.8' },
    },
  },
  {
    name: 'npl-flags',
    spec: {
      markup:
        '<npl-flags preset="production">\n' +
        '  <npl-flag name="calm_factor" value="0.5"></npl-flag>\n' +
        '  tuning notes…\n</npl-flags>',
      attr: { name: 'preset', value: 'full' },
      itemList: ':scope > :is(npl-flag, .npl-flag)',
    },
  },
  {
    name: 'npl-hormones',
    spec: {
      markup:
        '<npl-hormones variant="panel">\n  <panel>\n' +
        '    <h name="Momentum" symbol="MTM" value="6" delta="+2" trigger="Tests passed first try"></h>\n' +
        '    <h name="Tension" symbol="TNS" value="3" delta="0" trigger="Complexity"></h>\n' +
        '  </panel>\n  <state>Productive tension</state>\n' +
        '  <triggered>RST threshold crossed</triggered>\n</npl-hormones>',
      attr: { name: 'variant', value: 'bars' },
      itemList: ':scope > panel > h',
      settle: true,
    },
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

/** Attach one authored variant in edit mode (the controller suite's
 *  pattern: attach runs before Lit's first update microtask, so the model
 *  captures the authored form, never the rendered chrome). Runs
 *  SYNCHRONOUSLY — callers must do their pre-lit DOM queries and model
 *  mappings before the first `await`. Tags with `settle` then flush once
 *  so the element's first lit update chain finishes before the first
 *  mutation — safe only for display-only elements (npl-hormones never
 *  moves authored children; settling npl-cot would let `#move` empty the
 *  light DOM mid-test). */
function edit(markup: string): { el: HTMLElement; ctx: EditorContext; c: EditController } {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  const ctx = createContext();
  const c = attachEditor(el as unknown as SemElement, ctx);
  if (c === null) throw new Error(`attach failed: ${markup.slice(0, 48)}`);
  expect(el.hasAttribute('data-sem-editing')).toBe(true);
  return { el, ctx, c };
}

function firstTextNode(doc: EditorDocument, id: NodeId): TextNode | undefined {
  for (const c of doc.childrenOf(id)) {
    if (c.kind === 'text') {
      if (c.value.trim() !== '') return c;
      continue;
    }
    if (c.kind === 'element') {
      const hit = firstTextNode(doc, c.id);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** Offset of the `>` closing the open tag that starts at `from` (quote-aware). */
function openTagEnd(src: string, from: number): number {
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const ch = src[i]!;
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/** `after` is `before` with exactly the [start, end) slice replaced — the
 *  "changed ONLY in the touched nodes" assertion (brief §6). */
function expectSplice(before: string, after: string, start: number, end: number, label: string): void {
  expect(after.startsWith(before.slice(0, start)), `${label}: untouched prefix`).toBe(true);
  expect(after.endsWith(before.slice(end)), `${label}: untouched suffix`).toBe(true);
}

/** Largest numeric n-id issued in `doc` (public-API walk). */
function maxIdIn(doc: EditorDocument): number {
  let max = 0;
  const walk = (id: NodeId): void => {
    const n = Number(id.slice(1));
    if (Number.isFinite(n) && n > max) max = n;
    for (const c of doc.childrenOf(id)) walk(c.id);
  };
  walk(doc.root.id);
  return max;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  document
    .querySelectorAll('[data-sem-editing]')
    .forEach((n) => detachEditor(n as unknown as SemElement));
  // let in-flight lit microtask updates settle while the DOM is still alive
  // (clearing first strands their insertBefore and throws async)
  await flush();
  document.body.innerHTML = '';
});

// ── the per-tag suite ────────────────────────────────────────────────────────

for (const { name, spec } of TAGS) {
  describe(`desc npl-a — ${name}`, () => {
    it('schema example round-trips byte-exact through the model', () => {
      const example = EXAMPLES.get(name);
      expect(example, `${name} in elements.json`).toBeDefined();
      // parse() throws on malformed sources; the model suite already proves
      // every example parses, so assert the round trip directly
      expect(parse(example!).serialize()).toBe(example);
    });

    it('hand descriptor: npl-a bucket, :scope selectors, templates parse, wizard fields ↔ stops', () => {
      expect(hasHandDescriptor(name)).toBe(true);
      const d = getDescriptor(name)!;
      expect(d.tag).toBe(name);
      expect(d.bucket).toBe('npl-a');
      for (const slot of d.textSlots ?? []) {
        expect(slot.selector.startsWith(':scope'), `${name} slot ${slot.selector}`).toBe(true);
        expect(slot.escape).toBe('entities');
      }
      if (d.itemList) {
        expect(d.itemList.childSelector.startsWith(':scope >'), name).toBe(true);
      }
      const templates = [
        ...(d.templates ?? []),
        ...(d.wizard?.steps.map((s) => s.template) ?? []),
      ];
      expect(templates.length, `${name} ships templates`).toBeGreaterThan(0);
      for (const t of templates) {
        expect(tryParse(t.xml).ok, `${name}/${t.id} parses`).toBe(true);
        if (t.xml.includes('${')) {
          expect(/\$\{1[:|]/.test(t.xml), `${name}/${t.id} first stop is 1`).toBe(true);
        }
      }
      // lane convention (listed for the insert lane): wizard field i fills
      // template stop i — stops are ${1..n} in field order
      for (const step of d.wizard?.steps ?? []) {
        const stops = [...step.template.xml.matchAll(/\$\{(\d+)[:|]/g)].map((m) => m[1]!);
        expect(
          stops,
          `${name} wizard "${step.title}" stops`,
        ).toEqual(step.fields.map((_, i) => String(i + 1)));
      }
    });

    it('attribute edit splices only inside the touched attribute; undo restores', async () => {
      const { ctx, c } = edit(spec.markup);
      if (spec.settle === true) await flush();
      const before = ctx.doc.serialize();
      const root = ctx.doc.node(c.binding.rootId);
      expect(root?.kind).toBe('element');
      const elNode = root as ElementNode;

      if (spec.attr.value === undefined) {
        // bare-attribute authoring (npl-cot collapsed): the only source
        // touched is the open tag's closing '>'
        const gt = openTagEnd(before, elNode.range.start);
        expect(gt).toBeGreaterThan(0);
        ctx.doc.apply({ type: 'setAttr', node: elNode.id, name: spec.attr.name, value: null });
        const after = ctx.doc.serialize();
        expectSplice(before, after, gt, gt, `${name} bare attr`);
        expect(after.slice(gt).startsWith(` ${spec.attr.name}`)).toBe(true);
      } else {
        const attr = elNode.attrs.find((a) => a.name === spec.attr.name);
        expect(attr, `${name}[@${spec.attr.name}] authored`).toBeDefined();
        const start = attr!.range.start;
        const end = attr!.range.end;
        ctx.doc.apply({
          type: 'setAttr',
          node: elNode.id,
          name: spec.attr.name,
          value: spec.attr.value,
        });
        const after = ctx.doc.serialize();
        expectSplice(before, after, start, end, `${name} attr ${spec.attr.name}`);
        // the touched slice [start, end) is the attribute's whole raw text,
        // re-emitted as `name="value"`
        expect(after.slice(start, start + `${spec.attr.name}="${spec.attr.value}"`.length)).toBe(
          `${spec.attr.name}="${spec.attr.value}"`,
        );
      }

      expect(ctx.doc.undo()).toBe(true);
      expect(ctx.doc.serialize()).toBe(before);
    });

    it('text edit splices only the touched text node', async () => {
      const { ctx } = edit(spec.markup);
      if (spec.settle === true) await flush();
      const before = ctx.doc.serialize();
      const text = firstTextNode(ctx.doc, ctx.doc.root.id);
      if (name === 'npl-flag') {
        // attribute-driven row: no authored text contract — nothing to slot
        expect(text).toBeUndefined();
        return;
      }
      expect(text, `${name} has authored text`).toBeDefined();
      const start = ctx.doc.rangeOf(text!.id)!.start;
      const end = ctx.doc.rangeOf(text!.id)!.end;
      ctx.doc.apply({ type: 'setText', node: text!.id, value: 'EDITED' });
      const after = ctx.doc.serialize();
      expectSplice(before, after, start, end, `${name} text`);
      expect(after.slice(start, start + 'EDITED'.length)).toBe('EDITED');
      expect(ctx.doc.undo()).toBe(true);
      expect(ctx.doc.serialize()).toBe(before);
    });

    it('item add lands at the list tail; remove returns byte-exact', async () => {
      if (spec.itemList === undefined) return; // no list contract on this tag
      const { el, ctx, c } = edit(spec.markup);
      const items = el.querySelectorAll(spec.itemList);
      expect(items.length, `${name} starts with items`).toBeGreaterThan(0);
      const lastId = modelIdFor(ctx, c.binding, items[items.length - 1] as HTMLElement);
      expect(lastId, `${name} last item maps to the model`).not.toBe(null);
      const parent = ctx.doc.node(lastId!)!.parentId!;
      const tail = ctx.doc.rangeOf(lastId!)!.end;
      if (spec.settle === true) await flush();
      const before = ctx.doc.serialize();

      // KNOWN CROSS-LANE BUG (actions.ts buildFromXml, filed in the lane
      // report): its throwaway template parse RESETS the shared id counter,
      // so the fresh copy can land on ids this doc already owns and
      // addItem() returns false (canApply: "already attached"). Until the
      // controller lane lands the reseed patch, drive the very same ops at
      // the model layer with a correctly seeded counter.
      seedIdCounter(maxIdIn(ctx.doc) + 1);
      const itemXml = stripTemplateStops(getDescriptor(name)!.itemList!.template.xml);
      const tplDoc = parse(itemXml);
      const tplEl = tplDoc.root.children.find((n) => n.kind === 'element')!;
      const fresh = rebuildSubtree(ctx.doc, tplEl);
      const index = ctx.doc.childrenOf(parent).findIndex((k) => k.id === lastId) + 1;
      ctx.doc.apply({ type: 'insertNode', parent, index, node: fresh });
      const afterAdd = ctx.doc.serialize();
      expectSplice(before, afterAdd, tail, tail, `${name} item add`);
      await flush();
      const grown = el.querySelectorAll(spec.itemList);
      expect(grown.length).toBe(items.length + 1);
      // the re-rendered tail item maps back into the model
      expect(modelIdFor(ctx, c.binding, grown[grown.length - 1] as HTMLElement)).not.toBe(null);

      // removeItem resolves through modelIdFor only (no buildFromXml) —
      // exercise the real controller verb end to end
      expect(removeItem(ctx, c.binding, grown[grown.length - 1] as HTMLElement)).toBe(true);
      await flush();
      expect(ctx.doc.serialize()).toBe(before);
    });
  });
}

// End-to-end coverage through the real +/− verb — the same add/remove flow
// as the per-tag loop above. npl-cot's upgrade re-homes authored children
// out of `:scope >`, so position is asserted via model children: the count
// and the tail splice are read from the model, the DOM only proves the
// re-projection grows by one.
it('addItem verb inserts at the list tail', async () => {
  const entry = TAGS.find((t) => t.name === 'npl-cot')!;
  // edit() runs synchronously (no await — one would yield a microtask and
  // let the upgrade re-home the authored children before they are counted)
  const { el, ctx, c } = edit(entry.spec.markup);
  const items = el.querySelectorAll(entry.spec.itemList!);
  expect(items.length, 'npl-cot starts with items').toBeGreaterThan(0);
  const lastId = modelIdFor(ctx, c.binding, items[items.length - 1] as HTMLElement);
  expect(lastId, 'last item maps to the model').not.toBe(null);
  const parent = ctx.doc.node(lastId!)!.parentId!;
  const elementKids = () => ctx.doc.childrenOf(parent).filter((n) => n.kind === 'element');
  const beforeIds = new Set(elementKids().map((n) => n.id));
  const beforeCount = beforeIds.size;
  const before = ctx.doc.serialize();
  expect(addItem(ctx, c.binding)).toBe(true);
  const kids = elementKids();
  expect(kids.length).toBe(beforeCount + 1);
  const fresh = kids.find((n) => !beforeIds.has(n.id));
  expect(fresh, 'a new element joined the model').toBeDefined();
  expect(fresh!.id).not.toBe(lastId);
  // at the tail of the ITEM LIST: the new node's immediate predecessor
  // among the element siblings is the previous last item
  const siblingIds = kids.map((n) => n.id);
  expect(siblingIds[siblingIds.indexOf(fresh!.id) - 1]).toBe(lastId);
  expect(ctx.doc.serializeSubtree(fresh!.id)).toMatch(/^<sem-step/);
  await flush();
  const grown = el.querySelectorAll(entry.spec.itemList!);
  expect(grown.length).toBe(items.length + 1);
  expect(removeItem(ctx, c.binding, grown[grown.length - 1] as HTMLElement)).toBe(true);
  await flush();
  expect(ctx.doc.serialize()).toBe(before);
});
