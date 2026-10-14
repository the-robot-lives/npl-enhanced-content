// @vitest-environment happy-dom
// Unit spec — document-bucket edit descriptors (Phase 2, LANE=desc-document).
//
// Feature: registration (EDITOR.md §3.2–3.3)
//   Scenario: all five document-bucket tags resolve hand-written descriptors
//   Scenario: the out-of-schema tags (root wrapper, agent) resolve through
//             the loader seed their cross-lane patch requests
//   Scenario: slot and item-list selectors start with ":scope >"
//   Scenario: every template parses; stops start at ${1:
// Feature: round-trip (§1 invariant)
//   Scenario: serialize(parse(x)) === x for every untouched example
// Feature: edits change ONLY the touched nodes (§6 brief)
//   Scenario: sem-reader attribute change rewrites exactly that attribute
//   Scenario: sem-audiences +/− rewrites only the profile list
//   Scenario: sem-profile attribute edits, agent name slot edit,
//             root-wrapper attribute edit — byte-exact neighbours
// Feature: rerender seam (§3.3)
//   Scenario: sem-reader's reading chrome is re-established after a
//             model-driven re-render and never enters the model
//
// sem-reader is the bucket's only Lit-backed element, so it is the only
// tag exercised through full attachEditor (the controller registers via
// host.addController). The other four have no component class — their
// tests drive the REAL model and the REAL controller verbs through a
// hand-built binding (attach is a cross-lane patch away, see report);
// source assertions are model-level either way (§2.5: the model is the
// source of truth, the DOM a projection).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { GLOBAL_ATTR_NAMES, loadSchema } from '../../src/editor/schema/load-schema.js';
import { getDescriptor, hasHandDescriptor } from '../../src/editor/schema/registry.js';
import type { SchemaTagSpec } from '../../src/editor/schema/types.js';
import { tryParse } from '../../src/editor/model/document.js';
import { seedIdCounter } from '../../src/editor/model/parse.js';
import { rebuildSubtree } from '../../src/editor/safety/sanitize.js';
import type { EditorNode, NodeId } from '../../src/editor/model/types.js';
import {
  attachEditor,
  createContext,
  detachEditor,
  locateModelRoot,
} from '../../src/editor/controller/attach.js';
import { addItem, commitSlotText, removeItem } from '../../src/editor/controller/actions.js';
import type { EditorContext, ElementBinding } from '../../src/editor/controller/types.js';
import type { SemElement } from '../../src/lit/base.js';

// descriptors under test — side-effect registration (§3.2)
import '../../src/lit/sem-enhanced-document.edit.js';
import '../../src/lit/sem-reader.edit.js';
import '../../src/lit/sem-audiences.edit.js';
import '../../src/lit/sem-profile.edit.js';
import '../../src/lit/agent.edit.js';
// the real sem-reader element: its rerender seam runs enhanceReaderElement
import '../../src/lit/sem-reader.js';

// ── Out-of-schema seeds ──────────────────────────────────────────────────────
// sem-enhanced-document and agent are not in elements.json (sem-chat
// precedent, EDITOR.md §3.1): getDescriptor() resolves them only once
// load-schema.ts seeds a SchemaTagSpec. This mirrors the exact patch
// requested from the schema lane (reports/desc-document.md); when the
// patch lands, the shipped spec wins and this is a no-op.

const DOC_EXAMPLE =
  '<sem-enhanced-document>\n' +
  '  <h1 data-kind="title">Guide</h1>\n' +
  '  <sem-note variant="info">Hello</sem-note>\n' +
  '</sem-enhanced-document>';

const AGENT_EXAMPLE =
  '<agent id="guide">\n' +
  '  <name>Infra Guide</name>\n' +
  '  <bio>Deployment runbook assistant</bio>\n' +
  '  <instructions>Answer from sem-fact ids only.</instructions>\n' +
  '</agent>';

function seedOutOfSchemaTag(name: string, summary: string, example: string): void {
  const byName = loadSchema().byName as Map<string, SchemaTagSpec>;
  if (byName.has(name.toLowerCase())) return; // loader patch landed — keep shipped spec
  byName.set(name.toLowerCase(), {
    name,
    family: 'sem',
    summary,
    description: summary,
    attributes: GLOBAL_ATTR_NAMES.map((attr) => ({
      name: attr,
      required: false,
      type: '',
      allowedValues: [],
      default: null,
      description: 'global attribute catalog (conventions.md §2)',
      global: true,
    })),
    children: [],
    example,
    optionsIn: null,
  });
}

seedOutOfSchemaTag(
  'sem-enhanced-document',
  'The required root wrapper — every SemText document wraps its vocabulary in one.',
  DOC_EXAMPLE,
);
seedOutOfSchemaTag(
  'agent',
  'Document-level agent metadata (machine-facing, unstyled): name, bio, instructions.',
  AGENT_EXAMPLE,
);

// ── Harness ──────────────────────────────────────────────────────────────────

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function mount(markup: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  return el;
}

/** Full edit session — Lit-backed elements only (the controller registers
 *  with the host). The context is built from the CLEAN authored source
 *  (§4.2 — sem-editor owns the model), so runtime chrome the reading
 *  bundle inserted can never leak into the model. */
function editSession(markup: string): {
  el: HTMLElement;
  ctx: EditorContext;
  c: NonNullable<ReturnType<typeof attachEditor>>;
} {
  const el = mount(markup);
  const ctx = createContext({ source: markup });
  const c = attachEditor(el as unknown as SemElement, ctx);
  if (c === null) throw new Error('attach failed');
  return { el, ctx, c };
}

/** Model session — tags with no component class: real model + real verbs
 *  through a hand-built binding; no Lit host to register with. */
function modelSession(markup: string): { el: HTMLElement; ctx: EditorContext; rootId: NodeId } {
  const el = mount(markup);
  const ctx = createContext({ source: markup });
  const located = locateModelRoot(ctx.doc, el);
  if (located === null) throw new Error('model root not found');
  return { el, ctx, rootId: located.id };
}

/** The live binding over an element mounted in `ctx` (no attach). */
function looseBinding(ctx: EditorContext, el: HTMLElement): ElementBinding {
  const located = locateModelRoot(ctx.doc, el);
  if (located === null) throw new Error('model root not found');
  return {
    el: el as unknown as SemElement,
    rootId: located.id,
    descriptor: ctx.descriptors(el.tagName.toLowerCase()),
    editingSlot: null,
    controller: null,
  };
}

/** Strip snippet stop grammar — same rules as actions.stripTemplateStops. */
function stripStops(xml: string): string {
  return xml
    .replace(/\$\{\d+\|([^|}]*)\|[^}]*\}/g, '$1')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '');
}

/** Largest numeric id in the subtree — the buildFromXml seed point. */
function maxIdIn(n: EditorNode): number {
  let max = Number(n.id.slice(1));
  if (n.kind === 'element' || n.kind === 'document') {
    for (const c of n.children) max = Math.max(max, maxIdIn(c));
  }
  return max;
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  document.querySelectorAll('[data-sem-editing]').forEach((n) => detachEditor(n as SemElement));
});

const DOC_TAGS = [
  'sem-enhanced-document',
  'sem-reader',
  'sem-audiences',
  'sem-profile',
  'agent',
] as const;

// ── Registration + shape (§3.2–3.3) ─────────────────────────────────────────

describe('registration + shape', () => {
  it('all five document-bucket tags resolve hand-written descriptors', () => {
    for (const tag of DOC_TAGS) {
      expect(hasHandDescriptor(tag), tag).toBe(true);
      const d = getDescriptor(tag);
      expect(d, tag).not.toBeNull();
      expect(d!.bucket).toBe('document');
      expect(d!.title.length).toBeGreaterThan(0);
    }
  });

  it('out-of-schema tags resolve through the loader seed (cross-lane patch)', () => {
    // Without the load-schema seed these return null — the descriptor
    // files are unreachable for tags outside byName (§3.2 retrieval).
    expect(getDescriptor('sem-enhanced-document')?.tag).toBe('sem-enhanced-document');
    expect(getDescriptor('agent')?.tag).toBe('agent');
    // the class alias resolves to the wrapper, and the bare agent spelling
    // stays the metadata tag — NOT the npl-agent definition card
    expect(getDescriptor('.sem-enhanced-document')?.title).toBe('Document');
    expect(getDescriptor('agent')?.tag).not.toBe('npl-agent');
  });

  it('slot and item-list selectors start with ":scope >"', () => {
    for (const tag of DOC_TAGS) {
      const d = getDescriptor(tag)!;
      for (const slot of d.textSlots ?? []) {
        expect(slot.selector.startsWith(':scope >'), `${tag} slot ${slot.selector}`).toBe(true);
      }
      if (d.itemList !== undefined) {
        expect(d.itemList.childSelector.startsWith(':scope >'), tag).toBe(true);
      }
    }
  });

  it('every template parses; stops start at ${1:', () => {
    for (const tag of DOC_TAGS) {
      const d = getDescriptor(tag)!;
      for (const t of d.templates ?? []) {
        const parsed = tryParse(t.xml);
        const detail = parsed.ok ? '' : ` — ${parsed.error.message}`;
        expect(parsed.ok, `${tag} template ${t.id}${detail}`).toBe(true);
        const first = t.xml.match(/\$\{(\d+)[:|]/);
        if (first !== null) expect(first[1]).toBe('1');
      }
      for (const step of d.wizard?.steps ?? []) {
        expect(tryParse(step.template.xml).ok, `${tag} wizard step`).toBe(true);
      }
    }
  });

  it('sem-audiences item list matches BOTH authoring forms via sel()', () => {
    const d = getDescriptor('sem-audiences')!;
    expect(d.itemList?.childSelector).toBe(':scope > :is(sem-profile, .sem-profile)');
    expect(d.containerOf).toBe('sem-profile');
  });

  it('agent slots match both the bare-tag and class-alias spellings', () => {
    const slots = getDescriptor('agent')!.textSlots ?? [];
    expect(slots.map((s) => s.selector)).toEqual([
      ':scope > :is(name, .sem-agent-name)',
      ':scope > :is(bio, .sem-agent-bio)',
      ':scope > :is(instructions, .sem-agent-instructions)',
    ]);
  });

  it('the declaration-unit tags declare no text slots (metadata, not prose)', () => {
    expect(getDescriptor('sem-audiences')?.textSlots).toBeUndefined();
    expect(getDescriptor('sem-profile')?.textSlots).toBeUndefined();
    expect(getDescriptor('sem-reader')?.textSlots).toBeUndefined();
    expect(getDescriptor('sem-enhanced-document')?.textSlots).toBeUndefined();
  });

  it('only the one-shot wrapper (sem-reader) carries the rerender seam', () => {
    expect(typeof getDescriptor('sem-reader')!.rerender).toBe('function');
    for (const tag of ['sem-enhanced-document', 'sem-audiences', 'sem-profile', 'agent'] as const) {
      expect(getDescriptor(tag)!.rerender, tag).toBeUndefined();
    }
  });
});

// ── Round-trip (§1 invariant, untouched examples) ────────────────────────────

describe('round-trip on untouched sources', () => {
  const sources: string[] = [
    loadSchema().byName.get('sem-reader')!.example,
    loadSchema().byName.get('sem-audiences')!.example,
    loadSchema().byName.get('sem-profile')!.example,
    DOC_EXAMPLE,
    AGENT_EXAMPLE,
  ];

  it('serialize(parse(x)) === x for every example', () => {
    for (const src of sources) {
      const parsed = tryParse(src);
      if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.message}`);
      expect(parsed.doc.serialize()).toBe(src);
    }
  });
});

// ── sem-reader (Lit-backed — full attach) ────────────────────────────────────

const READER = '<sem-reader controls="outline,progress" outline-depth="2"></sem-reader>';

describe('sem-reader', () => {
  it('attribute edit rewrites exactly that attribute; undo restores bytes', async () => {
    const { ctx } = editSession(READER);
    const id = ctx.doc.root.children[0]!.id;
    ctx.doc.apply({ type: 'setAttr', node: id, name: 'outline-depth', value: '4' });
    await flush();
    expect(ctx.doc.serialize()).toBe(
      '<sem-reader controls="outline,progress" outline-depth="4"></sem-reader>',
    );
    expect(ctx.doc.undo()).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(READER);
  });

  it('rerender seam re-establishes the reading chrome; the model never sees it', async () => {
    const { el, ctx } = editSession(READER);
    const id = ctx.doc.root.children[0]!.id;
    ctx.doc.apply({ type: 'setAttr', node: id, name: 'controls', value: 'outline' });
    await flush();
    // the re-render drops the enhance chrome as an authored leftover, then
    // descriptor.rerender re-runs the idempotent enhance (§3.3, §4.4 step 3)
    expect(el.querySelector(':scope > .sem-reader-chrome')).not.toBeNull();
    // chrome is runtime, never model content (§0) — source stays clean
    expect(ctx.doc.serialize()).toBe('<sem-reader controls="outline" outline-depth="2"></sem-reader>');
  });
});

// ── sem-audiences ────────────────────────────────────────────────────────────

const AUDIENCES_EXAMPLE = loadSchema().byName.get('sem-audiences')!.example;
const P1 = '<sem-profile id="reader" label="Reader"></sem-profile>';
const P2 = '<sem-profile id="operator" label="Operator" implies="reader"></sem-profile>';

describe('sem-audiences', () => {
  it('+ inserts the profile template as one op; neighbours byte-exact; undoable', () => {
    // drive the §3.4 `+` op directly: the template rebuilt through the
    // factories, inserted after the last item. addItem() itself is
    // blocked by the buildFromXml id-collision bug (cross-lane report:
    // parse() resets the shared counter, so the rebuild mints ids the
    // live doc already owns whenever the template is smaller than the
    // document — the controller lane owns the fix).
    const { ctx } = modelSession(AUDIENCES_EXAMPLE);
    const aud = ctx.doc.root.children[0]!;
    const tpl = getDescriptor('sem-audiences')!.itemList!.template.xml;
    const parsed = tryParse(stripStops(tpl));
    if (!parsed.ok) throw new Error(`template parse failed: ${parsed.error.message}`);
    const first = parsed.doc.root.children.find((c) => c.kind === 'element');
    if (first === undefined || first.kind !== 'element') throw new Error('template has no element');
    seedIdCounter(maxIdIn(ctx.doc.root) + 1); // the documented buildFromXml fix
    const node = rebuildSubtree(ctx.doc, first);
    ctx.doc.apply({ type: 'insertNode', parent: aud.id, index: 4, node });
    const src = ctx.doc.serialize();
    expect(src.split('<sem-profile').length - 1).toBe(3);
    expect(src).toContain(P1);
    expect(src).toContain(P2);
    expect(src).toContain('<sem-profile id="profile-id" label="Label"></sem-profile>');
    expect(src.startsWith('<sem-audiences>\n  ' + P1)).toBe(true); // prefix intact
    expect(src.endsWith('\n</sem-audiences>')).toBe(true); // suffix intact
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(AUDIENCES_EXAMPLE);
  });

  it('− removes exactly the targeted profile (neighbouring whitespace trivia is preserved, not tidied)', () => {
    const { el, ctx } = modelSession(AUDIENCES_EXAMPLE);
    const first = el.querySelector('sem-profile')!;
    expect(removeItem(ctx, looseBinding(ctx, el), first)).toBe(true);
    expect(ctx.doc.serialize()).toBe('<sem-audiences>\n  \n  ' + P2 + '\n</sem-audiences>');
  });

  it('container attribute change rewrites only the open tag', () => {
    const { ctx, rootId } = modelSession(AUDIENCES_EXAMPLE);
    ctx.doc.apply({ type: 'setAttr', node: rootId, name: 'id', value: 'aud' });
    expect(ctx.doc.serialize()).toBe(
      '<sem-audiences id="aud">\n  ' + P1 + '\n  ' + P2 + '\n</sem-audiences>',
    );
  });
});

// ── sem-profile ──────────────────────────────────────────────────────────────

describe('sem-profile', () => {
  it('label edit + implies add keep every other byte', () => {
    const { ctx, rootId } = modelSession(P1);
    ctx.doc.apply({ type: 'setAttr', node: rootId, name: 'label', value: 'Operator' });
    ctx.doc.apply({ type: 'setAttr', node: rootId, name: 'implies', value: 'reader' });
    expect(ctx.doc.serialize()).toBe(
      '<sem-profile id="reader" label="Operator" implies="reader"></sem-profile>',
    );
    expect(ctx.doc.undo()).toBe(true); // implies
    expect(ctx.doc.undo()).toBe(true); // label
    expect(ctx.doc.serialize()).toBe(P1);
  });
});

// ── agent ────────────────────────────────────────────────────────────────────

describe('agent', () => {
  it('name slot edit via the controller verb rewrites exactly that text node', () => {
    const { el, ctx } = modelSession(AGENT_EXAMPLE);
    const name = el.querySelector(':scope > :is(name, .sem-agent-name)')!;
    const binding = looseBinding(ctx, el);
    expect(commitSlotText(ctx, binding, name, 'Infra Guide v2')).toBe(true);
    expect(ctx.doc.serialize()).toBe(
      '<agent id="guide">\n' +
        '  <name>Infra Guide v2</name>\n' +
        '  <bio>Deployment runbook assistant</bio>\n' +
        '  <instructions>Answer from sem-fact ids only.</instructions>\n' +
        '</agent>',
    );
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(AGENT_EXAMPLE);
  });

  it('the child set is fixed fields, not an item list', () => {
    const { el, ctx } = modelSession(AGENT_EXAMPLE);
    expect(addItem(ctx, looseBinding(ctx, el))).toBe(false);
  });
});

// ── sem-enhanced-document ────────────────────────────────────────────────────

describe('sem-enhanced-document', () => {
  it('landmark attribute change leaves the document body byte-exact', () => {
    const { ctx, rootId } = modelSession(DOC_EXAMPLE);
    ctx.doc.apply({ type: 'setAttr', node: rootId, name: 'role', value: 'main' });
    expect(ctx.doc.serialize()).toBe(
      '<sem-enhanced-document role="main">\n' +
        '  <h1 data-kind="title">Guide</h1>\n' +
        '  <sem-note variant="info">Hello</sem-note>\n' +
        '</sem-enhanced-document>',
    );
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(DOC_EXAMPLE);
  });
});
