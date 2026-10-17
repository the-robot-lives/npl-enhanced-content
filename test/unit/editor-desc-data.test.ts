// @vitest-environment happy-dom
// Unit spec — data-bucket edit descriptors (Phase 2): sem-data-visualizer,
// sem-data-source, sem-data-join, sem-data-query + the hand-written
// sem-chat descriptor (absent from elements.json).
//
// Feature: descriptor shape (mirrors the schema lane's rules, per-file
//          registry isolation)
//   Scenario: each data descriptor is hand-registered in the data bucket
//   Scenario: slots anchor at :scope (children or the host-body form) and
//             escape entities
//   Scenario: the visualizer's item list targets source children
//   Scenario: sem-chat declares jsonItems the property-modal grammar supports
//   Scenario: templates parse through the model parser; stops start at 1
//             and use the ${n:…} / ${n|a,b} grammar
//   Scenario: every wizard field binds a stop named after the field
// Feature: round trip (EDITOR.md §2.1)
//   Scenario: each schema example round-trips byte-exact untouched
//   Scenario: the sem-chat seed example and an authored transcript
//             round-trip byte-exact untouched
// Feature: sem-data-visualizer (container of source buckets)
//   Scenario: entering edit-mode stamps the element
//   Scenario: + adds ONLY a source item; undo restores byte-exact
//   Scenario: − removes the added item; serialize returns byte-exact
//   Scenario: an attribute edit changes ONLY that attribute
// Feature: sem-data-source (payload behind the parked .sem-data-raw box)
//   Scenario: a payload edit through the parked box changes ONLY the payload
//   Scenario: the authored `:scope` slot edits the standalone payload
//   Scenario: an attribute edit changes ONLY that attribute; undo restores
//   Scenario: source link field accepts a relative path, rejects javascript:
// Feature: sem-data-join (declaration — attributes only)
//   Scenario: an attribute edit changes ONLY that attribute
//   Scenario: no slots and no item list — addItem is a graceful no-op
// Feature: sem-data-query (one SQL text body)
//   Scenario: a text edit changes ONLY the query
//   Scenario: no item list — addItem is a graceful no-op
// Feature: sem-chat (hand-written; JSON payload stays inert)
//   Scenario: jsonItems selector resolves the payload node + its raw text
//   Scenario: a payload edit changes ONLY the script body; undo restores
//   Scenario: the payload never executes — inert template holder (§8)
//   Scenario: a transcript message edit changes ONLY that message
//   Scenario: endpoint link field accepts https, rejects javascript:
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import '../../src/lit/sem-data-visualizer.js';
import '../../src/lit/sem-chat.js';
import '../../src/lit/sem-data-visualizer.edit.js';
import '../../src/lit/sem-data-source.edit.js';
import '../../src/lit/sem-data-join.edit.js';
import '../../src/lit/sem-data-query.edit.js';
import '../../src/lit/sem-chat.edit.js';

import { parse } from '../../src/editor/model/document.js';
import { loadSchema } from '../../src/editor/schema/load-schema.js';
import {
  getDescriptor,
  hasHandDescriptor,
  handDescriptors,
} from '../../src/editor/schema/registry.js';
import type { EditDescriptor } from '../../src/editor/schema/types.js';
import { selectorSupports, matchChildren } from '../../src/editor/shell/selector.js';
import {
  attachEditor,
  createContext,
  detachEditor,
} from '../../src/editor/controller/attach.js';
import { addItem, removeItem, commitSlotText, setLink } from '../../src/editor/controller/actions.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import { renderAuthorInert } from '../../src/editor/safety/inert.js';
import type { SemElement } from '../../src/lit/base.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function example(tag: string): string {
  const spec = loadSchema().byName.get(tag);
  if (spec === undefined) throw new Error(`no schema example for ${tag}`);
  // The v0.7 schema examples demonstrate the data family nested inside a
  // sem-data-visualizer; these specs exercise each element STANDALONE, so
  // lift the named element out of its demonstrative container. (The
  // byte-exact assertions all derive from the same string, so the lift
  // stays internally consistent.)
  const host = document.createElement('div');
  host.innerHTML = spec.example;
  const el = host.querySelector(tag);
  return el !== null ? el.outerHTML : spec.example;
}

const VIS_EXAMPLE = example('sem-data-visualizer');
const SOURCE_EXAMPLE = example('sem-data-source');
const JOIN_EXAMPLE = example('sem-data-join');
const QUERY_EXAMPLE = example('sem-data-query');
// sem-chat's schema seed (schema-complete, not in elements.json)
const CHAT_EXAMPLE = example('sem-chat');
// the authored zero-JS transcript form (no fixture payload)
const CHAT_AUTHORED =
  '<sem-chat id="chat-authored" endpoint="/chat/api">\n' +
  '  <div class="sem-chat-msg" data-role="user" data-id="m1">\n' +
  '    <span class="sem-chat-content">Hello there</span>\n' +
  '  </div>\n' +
  '</sem-chat>';

const DATA_TAGS = ['sem-data-visualizer', 'sem-data-source', 'sem-data-join', 'sem-data-query', 'sem-chat'];

function desc(tag: string): EditDescriptor {
  const d = handDescriptors().find((x) => x.tag === tag);
  if (d === undefined) throw new Error(`no hand descriptor registered for ${tag}`);
  return d;
}

const bound: SemElement[] = [];

/** Zero-JS tags (sem-data-source/join/query have no Lit host) still satisfy
 *  the ReactiveControllerHost contract in tests: requestUpdate/updateComplete
 *  plus the add/removeController pair, with Lit's connected-host call — the
 *  same shim the sequence/definitions lane's spec uses (§4.4 step 3). */
function editable(el: Element): Element {
  const h = el as Element & Record<string, unknown>;
  if (typeof h.requestUpdate !== 'function') {
    h.requestUpdate = () => {};
    h.updateComplete = Promise.resolve(true);
    const controllers: Array<{ hostConnected?: () => void }> = [];
    h.addController = (c: { hostConnected?: () => void }) => {
      controllers.push(c);
      if (el.isConnected) c.hostConnected?.();
    };
    h.removeController = (c: { hostConnected?: () => void }) => {
      const i = controllers.indexOf(c);
      if (i >= 0) controllers.splice(i, 1);
    };
  }
  return el;
}

function make(markup: string): { el: HTMLElement; ctx: EditorContext; c: EditController } {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = editable(wrap.firstElementChild as HTMLElement) as HTMLElement;
  if (el === null) throw new Error('fixture produced no element');
  // Attach BEFORE the element connects: the controller parses outerHTML for
  // the model, and a connected SemElement has already claimed its runtime
  // attributes (base.ts claims `data-sem-upgraded` in connectedCallback;
  // sem-chat adds `role="group"` the same way). Attaching first keeps the
  // model byte-identical to the authored source.
  const ctx = createContext();
  const c = attachEditor(el as unknown as SemElement, ctx);
  if (c === null) throw new Error('attach failed');
  document.body.appendChild(el);
  bound.push(el as unknown as SemElement);
  return { el, ctx, c };
}

function reset(): void {
  for (const el of bound) detachEditor(el);
  bound.length = 0;
  document.body.innerHTML = '';
}

// stop grammar (mirror of the earlier desc lanes' rules — per-file registry)
const textStop = /^\$\{\d+:[^{}]*\}$/;
const choiceStop = /^\$\{\d+\|[^{}]*\}$/;

describe('data descriptors — shape', () => {
  it('registers the four data tags + sem-chat as hand descriptors in the data bucket', () => {
    for (const tag of DATA_TAGS) {
      const d = desc(tag);
      expect(d.bucket, tag).toBe('data');
      expect(d.title.length, tag).toBeGreaterThan(0);
      expect(d.tag.toLowerCase(), tag).toBe(tag);
      expect(hasHandDescriptor(tag), tag).toBe(true);
      expect(getDescriptor(tag)?.tag, tag).toBe(tag);
    }
  });

  it('slots anchor at :scope (child selectors or the host-body form) and escape entities', () => {
    for (const tag of DATA_TAGS) {
      const d = desc(tag);
      for (const slot of d.textSlots ?? []) {
        const ok = slot.selector === ':scope' || slot.selector.startsWith(':scope >');
        expect(ok, `${tag} slot ${slot.selector}`).toBe(true);
        expect(slot.escape, tag).toBe('entities');
      }
    }
    expect(desc('sem-data-visualizer').textSlots).toBeUndefined();
    expect(desc('sem-data-join').textSlots).toBeUndefined();
  });

  it('the visualizer item list targets source children', () => {
    const list = desc('sem-data-visualizer').itemList;
    expect(list?.childSelector.startsWith(':scope >')).toBe(true);
    expect(list?.childSelector).toContain('sem-data-source');
    // the modal-side grammar must resolve the same children (no `:is()`)
    expect(selectorSupports(list!.childSelector)).toBe(true);
    expect(desc('sem-data-join').itemList).toBeUndefined();
    expect(desc('sem-data-query').itemList).toBeUndefined();
  });

  it('sem-chat declares jsonItems the property-modal grammar supports', () => {
    const json = desc('sem-chat').jsonItems;
    expect(json).toBeDefined();
    expect(json!.selector.startsWith(':scope >')).toBe(true);
    expect(selectorSupports(json!.selector)).toBe(true);
    expect(json!.schemaHint.length).toBeGreaterThan(0);
    expect(desc('sem-data-source').jsonItems).toBeUndefined();
  });

  it('templates parse through the model parser; stops use the pinned grammar', () => {
    for (const tag of DATA_TAGS) {
      const d = desc(tag);
      expect(d.templates?.length, tag).toBeGreaterThan(0);
      for (const t of d.templates ?? []) {
        const parsed = parse(t.xml);
        expect(parsed.issues.some((i) => i.severity === 'error'), `${tag}/${t.id}`).toBe(false);
        if (!t.xml.includes('${')) continue;
        const first = /\$\{(\d+)/.exec(t.xml)?.[1] ?? null;
        expect(first, `${tag}/${t.id} first stop`).toBe('1');
        for (const stop of t.xml.match(/\$\{\d+[^}]*\}/g) ?? []) {
          expect(textStop.test(stop) || choiceStop.test(stop), `${tag}/${t.id} stop "${stop}"`).toBe(true);
        }
      }
    }
  });

  it('every wizard field binds a stop named after the field', () => {
    for (const tag of ['sem-data-visualizer', 'sem-data-source', 'sem-data-join']) {
      const d = desc(tag);
      expect(d.wizard?.steps.length, tag).toBeGreaterThan(0);
      for (const step of d.wizard?.steps ?? []) {
        const parsed = parse(step.template.xml);
        expect(parsed.issues.some((i) => i.severity === 'error'), `${tag} wizard`).toBe(false);
        const named = [...step.template.xml.matchAll(/\$\{\d+:([^{}]*)\}/g)].map((m) => m[1]);
        for (const field of step.fields) {
          expect(named, `${tag} field ${field.name}`).toContain(field.name);
        }
      }
    }
    expect(desc('sem-data-query').wizard).toBeUndefined();
    expect(desc('sem-chat').wizard).toBeUndefined();
  });
});

describe('data descriptors — round trip (§2.1)', () => {
  it('each schema example round-trips byte-exact untouched', () => {
    for (const src of [VIS_EXAMPLE, SOURCE_EXAMPLE, JOIN_EXAMPLE, QUERY_EXAMPLE, CHAT_EXAMPLE]) {
      expect(parse(src).serialize()).toBe(src);
    }
  });

  it('the authored chat transcript round-trips byte-exact untouched', () => {
    expect(parse(CHAT_AUTHORED).serialize()).toBe(CHAT_AUTHORED);
  });
});

describe('sem-data-visualizer — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('enters edit-mode on attach', () => {
    const { el } = make(VIS_EXAMPLE);
    expect(el.hasAttribute('data-sem-editing')).toBe(true);
  });

// The ATTACHED doc serializes canonically (a wrapped open tag re-emits with
// its attributes on one line — a model/attach fidelity note for the lane
// report; the pure parse() round trip below stays byte-exact). Every
// expected string in the edit specs is therefore derived from BASE, the
// attached doc's own serialization captured before the first transaction.
  // The inserted item serializes with its stop-stripped template body
  // verbatim (text is never re-indented — the serializer keeps node text
  // byte-exact).
  const NEWSRC_D2 =
    '<sem-data-source data-name="Bucket name" data-format="table">\n  | Column | Column |\n</sem-data-source>';

  it('+ adds ONLY a source item; undo restores byte-exact', async () => {
    const { el, ctx, c } = make(VIS_EXAMPLE);
    const BASE = ctx.doc.serialize();
    // Commit BEFORE the element's own enhancement runs: the reading chrome
    // (`.sem-data-tools` bar et al) carries no `data-sem-chrome` mark, so
    // once it is in the DOM the position mapping loses the authored anchors
    // (chrome-marking cross-lane request in the lane report). Synchronous
    // after connect, the authored form is still what both sides see.
    expect(addItem(ctx, c.binding)).toBe(true);
    await flush();
    expect(el.querySelectorAll(':scope > :is(sem-data-source, .sem-data-source)').length).toBe(2);
    // the + inserts next to the last existing item (before the trailing text)
    const close = BASE.indexOf('</sem-data-source>') + '</sem-data-source>'.length;
    expect(ctx.doc.serialize()).toBe(BASE.slice(0, close) + NEWSRC_D2 + BASE.slice(close));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('− removes an item; serialize returns byte-exact', async () => {
    const { el, ctx, c } = make(VIS_EXAMPLE);
    const BASE = ctx.doc.serialize();
    expect(addItem(ctx, c.binding)).toBe(true);
    // The added node is not in the DOM until re-projection, so remove the
    // AUTHORED item synchronously (enhancement chrome lands only after the
    // flush below — see the chrome-marking note above).
    const items = el.querySelectorAll(':scope > :is(sem-data-source, .sem-data-source)');
    expect(items.length).toBe(1);
    expect(removeItem(ctx, c.binding, items[0]!)).toBe(true);
    await flush();
    const open = BASE.indexOf('<sem-data-source');
    const close = BASE.indexOf('</sem-data-source>') + '</sem-data-source>'.length;
    expect(ctx.doc.serialize()).toBe(BASE.slice(0, open) + NEWSRC_D2 + BASE.slice(close));
    ctx.doc.undo(); // back to the after-add state
    const close2 = BASE.indexOf('</sem-data-source>') + '</sem-data-source>'.length;
    expect(ctx.doc.serialize()).toBe(BASE.slice(0, close2) + NEWSRC_D2 + BASE.slice(close2));
    ctx.doc.undo(); // back to the authored form
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('an attribute edit changes ONLY that attribute; undo restores byte-exact', async () => {
    const { ctx, c } = make(VIS_EXAMPLE);
    const BASE = ctx.doc.serialize();
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'id', value: 'dv-renamed' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(BASE.replace('id="dv-tokens"', 'id="dv-renamed"'));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('a payload edit through the parked box changes ONLY the payload', async () => {
    const { el, ctx } = make(VIS_EXAMPLE);
    const BASE = ctx.doc.serialize();
    await flush(); // enhancement builds the parked raw box
    const source = el.querySelector(':scope > :is(sem-data-source, .sem-data-source)')!;
    expect(source.querySelector(':scope > .sem-data-raw')).not.toBeNull();
    const sc = attachEditor(editable(source) as unknown as SemElement, ctx);
    if (sc === null) throw new Error('source attach failed');
    bound.push(source as unknown as SemElement);
    const raw = source.querySelector(':scope > .sem-data-raw')!;
    expect(commitSlotText(ctx, sc.binding, raw, '| A | B |')).toBe(true);
    await flush();
    // the edit replaces the payload text node wholesale — surrounding
    // whitespace goes with it, so the element re-emits inline
    const sOpen = BASE.indexOf('<sem-data-source');
    const bodyStart = BASE.indexOf('>', sOpen) + 1;
    const bodyEnd = BASE.indexOf('</sem-data-source>');
    expect(ctx.doc.serialize()).toBe(BASE.slice(0, bodyStart) + '| A | B |' + BASE.slice(bodyEnd));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });
});

describe('sem-data-source — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('the authored :scope slot edits the standalone payload; only the payload changes', async () => {
    const { el, ctx, c } = make(SOURCE_EXAMPLE);
    const BASE = ctx.doc.serialize();
    const bodyStart = BASE.indexOf('>', BASE.indexOf('<sem-data-source')) + 1;
    const bodyEnd = BASE.indexOf('</sem-data-source>');
    expect(commitSlotText(ctx, c.binding, el, '| A | B |')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(BASE.slice(0, bodyStart) + '| A | B |' + BASE.slice(bodyEnd));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('an attribute edit changes ONLY that attribute; undo restores byte-exact', async () => {
    const { ctx, c } = make(SOURCE_EXAMPLE);
    const BASE = ctx.doc.serialize();
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'data-name', value: 'Renamed bucket' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(BASE.replace('data-name="Token lifetimes"', 'data-name="Renamed bucket"'));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('source link field accepts a relative path and writes ONLY that attribute (§8)', async () => {
    const { ctx, c } = make(SOURCE_EXAMPLE);
    const BASE = ctx.doc.serialize();
    const r = setLink(ctx, c.binding, { attr: 'source' }, 'data/bucket.csv');
    expect(r.ok).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toContain('source="data/bucket.csv"');
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(BASE);
  });

  it('source link field rejects javascript: and writes nothing (§8)', async () => {
    const { ctx, c } = make(SOURCE_EXAMPLE);
    const BASE = ctx.doc.serialize();
    const r = setLink(ctx, c.binding, { attr: 'source' }, 'javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(ctx.doc.serialize()).toBe(BASE);
  });
});

describe('sem-data-join — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('an attribute edit changes ONLY that attribute (authored alias spelling kept)', async () => {
    const { ctx, c } = make(JOIN_EXAMPLE);
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'on', value: 'order-id' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(JOIN_EXAMPLE.replace('on="user-id"', 'on="order-id"'));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(JOIN_EXAMPLE);
  });

  it('no item list — addItem is a graceful no-op', () => {
    const { ctx, c } = make(JOIN_EXAMPLE);
    expect(addItem(ctx, c.binding)).toBe(false);
    expect(ctx.doc.serialize()).toBe(JOIN_EXAMPLE);
  });
});

describe('sem-data-query — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('a text edit changes ONLY the query', async () => {
    const { el, ctx, c } = make(QUERY_EXAMPLE);
    expect(commitSlotText(ctx, c.binding, el, 'SELECT name FROM services')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(
      QUERY_EXAMPLE.replace(
        'SELECT name, port FROM services WHERE ready = true ORDER BY port LIMIT 5',
        'SELECT name FROM services',
      ),
    );
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(QUERY_EXAMPLE);
  });

  it('no item list — addItem is a graceful no-op', () => {
    const { ctx, c } = make(QUERY_EXAMPLE);
    expect(addItem(ctx, c.binding)).toBe(false);
    expect(ctx.doc.serialize()).toBe(QUERY_EXAMPLE);
  });
});

describe('sem-chat — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('jsonItems selector resolves the payload node + its single raw text child', () => {
    const { ctx, c } = make(CHAT_EXAMPLE);
    const d = desc('sem-chat');
    const found = matchChildren(ctx.doc.childrenOf(c.binding.rootId), d.jsonItems!.selector);
    expect(found.length).toBe(1);
    const texts = ctx.doc.childrenOf(found[0]!.id).filter((n) => n.kind === 'text');
    expect(texts.length).toBe(1); // script bodies parse as ONE raw text node
  });

  it('a payload edit changes ONLY the script body; undo restores byte-exact', async () => {
    const { ctx, c } = make(CHAT_EXAMPLE);
    const found = matchChildren(ctx.doc.childrenOf(c.binding.rootId), desc('sem-chat').jsonItems!.selector);
    const text = ctx.doc.childrenOf(found[0]!.id).find((n) => n.kind === 'text');
    if (text === undefined) throw new Error('payload text missing');
    ctx.doc.transaction('json', (tx) => {
      tx.push({ type: 'setText', node: text.id, value: '[{"role":"user","text":"hello"}]' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(
      CHAT_EXAMPLE.replace('[{"role":"user","text":"hi"}]', '[{"role":"user","text":"hello"}]'),
    );
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(CHAT_EXAMPLE);
  });

  it('the payload never executes — inert template holder (§8)', () => {
    const frag = renderAuthorInert(CHAT_EXAMPLE);
    const holder = frag.querySelector('template[data-sem-inert]') as HTMLTemplateElement | null;
    expect(holder).not.toBeNull();
    expect(holder?.getAttribute('data-sem-script-type')).toBe('application/json');
    // template bodies live in .content (browser + happy-dom alike)
    const body = holder?.textContent || holder?.content?.textContent || '';
    expect(body).toBe('[{"role":"user","text":"hi"}]');
    expect(frag.querySelector('script')).toBeNull();
  });

  it('a transcript message edit changes ONLY that message', async () => {
    const { el, ctx, c } = make(CHAT_AUTHORED);
    // Commit while the authored transcript is still the DOM (the element's
    // wire has not run yet): once wired, authored msg nodes re-parent into
    // the unmarked `.sem-chat-log` chrome and the `:scope >` slot loses its
    // anchor — the chrome-marking cross-lane request in the lane report.
    const content = el.querySelector('.sem-chat-content');
    expect(content).not.toBeNull();
    expect(commitSlotText(ctx, c.binding, content!, 'edited')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(CHAT_AUTHORED.replace('Hello there', 'edited'));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(CHAT_AUTHORED);
  });

  it('endpoint link field accepts https and writes ONLY that attribute (§8)', async () => {
    const { ctx, c } = make(CHAT_AUTHORED);
    const r = setLink(ctx, c.binding, { attr: 'endpoint' }, 'https://chat.example.com/api');
    expect(r.ok).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(
      CHAT_AUTHORED.replace('endpoint="/chat/api"', 'endpoint="https://chat.example.com/api"'),
    );
  });

  it('endpoint link field rejects javascript: and writes nothing (§8)', async () => {
    const { ctx, c } = make(CHAT_AUTHORED);
    const r = setLink(ctx, c.binding, { attr: 'endpoint' }, 'javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(ctx.doc.serialize()).toBe(CHAT_AUTHORED);
  });
});
