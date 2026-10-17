// @vitest-environment happy-dom
// Unit spec — recall-bucket descriptors (Phase 2): sem-fact, sem-question,
// sem-option.
//
// Feature: registry shapes
//   Scenario: the three descriptors register by side effect
//   Scenario: statement/conclusion/incorrect-statement are sem-fact's slots,
//             never standalone descriptors (EDITOR.md §3.3)
//   Scenario: slot selectors start with ":scope", escape pin is 'entities'
//   Scenario: every template parses (model parser, stops stripped)
// Feature: untouched documents round-trip
//   Scenario: elements.json examples (sem-fact, sem-facts) serialize
//             byte-identical
//   Scenario: recall fixtures serialize byte-identical
// Feature: sem-fact controller flows (element + alias child forms)
//   Scenario: edit-mode attach; statement commit rewrites only the statement
//   Scenario: class-alias children (.sem-statement, .incorrect-statement)
//             edit through the same slots
//   Scenario: attribute change is the only delta
// Feature: sem-question controller flows
//   Scenario: prompt commit rewrites only the prompt
//   Scenario: option add/remove — removal restores byte-exact source
//   Scenario: attribute change is the only delta
//   Scenario: out-of-schema status surfaces as a warning, never a block
// Feature: sem-option controller flows
//   Scenario: :scope slot commit; bare `correct` attr toggles; undo restores
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { SemElement } from '../../src/lit/base.js';
import {
  createDocument,
  parse,
  seedIdCounter,
  tryParse,
} from '../../src/editor/model/index.js';
import type { EditorNode } from '../../src/editor/model/index.js';
import { getTag, loadSchema } from '../../src/editor/schema/load-schema.js';
import {
  getDescriptor,
  handDescriptors,
} from '../../src/editor/schema/registry.js';
import { validateTree } from '../../src/editor/schema/validator.js';
import type { EditDescriptor, TextSlot } from '../../src/editor/schema/types.js';
import {
  attachEditor,
  createContext,
  detachEditor,
  watchEditMode,
} from '../../src/editor/controller/attach.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import {
  commitSlotText,
  stripTemplateStops,
} from '../../src/editor/controller/actions.js';
import { resolveSlotEl } from '../../src/editor/controller/map.js';

// descriptors register by side effect on import
import '../../src/lit/sem-fact.edit.js';
import '../../src/lit/sem-question.edit.js';
import '../../src/lit/sem-option.edit.js';

// sem-fact / sem-question / sem-option have no Lit classes yet (companion
// markup + Tier-1): register bare hosts so the controller can attach. The
// registry is per test-file module graph, so this cannot leak.
class FactHost extends SemElement {}
class QuestionHost extends SemElement {}
class OptionHost extends SemElement {}
SemElement.register('sem-fact', FactHost);
SemElement.register('sem-question', QuestionHost);
SemElement.register('sem-option', OptionHost);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const FACT_SRC = [
  '<sem-fact id="f-jwt">',
  '  <statement>JWTs rotate per session</statement>',
  '  <conclusion>Short-lived access tokens</conclusion>',
  '  <incorrect-statement>Store tokens in localStorage.</incorrect-statement>',
  '</sem-fact>',
].join('\n');

const ALIAS_SRC = [
  '<sem-fact id="f-alias">',
  '  <div class="sem-statement">Claim one</div>',
  '  <div class="sem-conclusion">Resolution one</div>',
  '  <div class="incorrect-statement">Wrong one</div>',
  '</sem-fact>',
].join('\n');

const QUESTION_SRC = [
  '<sem-question type="mc">',
  '  <p data-kind="prompt">Which header carries the OIDC token?</p>',
  '  <sem-option correct>Authorization</sem-option>',
  '  <sem-option>Cookie</sem-option>',
  '</sem-question>',
].join('\n');

const OPTION_SRC = '<sem-option>Cookie</sem-option>';

interface Bound {
  el: SemElement;
  ctx: EditController['ctx'];
  c: EditController;
}

function bind(
  markup: string,
  descriptors?: (tag: string) => EditDescriptor | null,
): Bound {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as SemElement;
  document.body.appendChild(el);
  const ctx = createContext(descriptors ? { descriptors } : {});
  const c = attachEditor(el, ctx);
  if (c === null) throw new Error('attach failed: ' + markup);
  return { el, ctx, c };
}

/** Out-of-schema bridge: the context's descriptor lookup gates on the
 *  schema, so sem-question/sem-option bindings only see their descriptors
 *  through the hand map — the seam an editor entry must install. */
const handBridge = (tag: string): EditDescriptor | null =>
  handDescriptors().find((x) => x.tag === tag) ?? null;

/** Hosts are Lit elements: SemElement stamps `data-sem-upgraded=""` at
 *  connect, attach parses outerHTML with the marker present, and serialize
 *  re-emits it — on the host AND on any registered sem-* descendant. Every
 *  other byte of the expected source must still match exactly. */
function upgraded(src: string): string {
  return src.replace(
    /(<sem-(?:fact|question|option)\b((?:\s+[a-z-]+(?:="[^"]*")?)*))/g,
    '$1 data-sem-upgraded=""',
  );
}

function descriptors(): { fact: EditDescriptor; question: EditDescriptor; option: EditDescriptor } {
  const hand = handDescriptors();
  const pick = (tag: string): EditDescriptor => {
    const d = hand.find((x) => x.tag === tag);
    if (d === undefined) throw new Error('recall descriptor not registered: ' + tag);
    return d;
  };
  return { fact: pick('sem-fact'), question: pick('sem-question'), option: pick('sem-option') };
}

function slotsOf(d: EditDescriptor): TextSlot[] {
  return d.textSlots ?? [];
}

function allTemplates(): string[] {
  const { fact, question, option } = descriptors();
  const xmls: string[] = [];
  for (const d of [fact, question, option]) {
    for (const t of d.templates ?? []) xmls.push(t.xml);
    if (d.itemList) xmls.push(d.itemList.template.xml);
    for (const step of d.wizard?.steps ?? []) xmls.push(step.template.xml);
  }
  return xmls;
}

/** Attached flows parse the LIVE DOM's outerHTML, and the DOM impl
 *  normalizes bare attributes to `=""` before the model ever sees them —
 *  expected sources for those flows carry the DOM spelling. */
function domForm(src: string): string {
  return upgraded(src).replace(' correct data-sem-upgraded=""', ' correct="" data-sem-upgraded=""');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document
    .querySelectorAll('sem-fact, sem-question, sem-option')
    .forEach((n) => detachEditor(n as SemElement));
});

describe('registry shapes', () => {
  it('registers the three recall descriptors by side effect', () => {
    for (const d of Object.values(descriptors())) {
      expect(handDescriptors().some((x) => x.tag === d.tag), d.tag).toBe(true);
    }
    // sem-fact is an elements.json tag: the canonical lookup resolves it.
    expect(getDescriptor('sem-fact')?.tag).toBe('sem-fact');
    expect(getDescriptor('sem-fact')?.containerOf).toBe('sem-facts');
    // sem-question / sem-option are out-of-schema: getDescriptor gates on
    // the schema and answers null — handDescriptors() is the only path
    // (the inserter's enumeration). Pinned so a lookup change is deliberate.
    expect(getDescriptor('sem-question')).toBeNull();
    expect(getDescriptor('sem-option')).toBeNull();
    expect(descriptors().option.containerOf).toBe('sem-question');
  });

  it('statement/conclusion/incorrect-statement are slots of sem-fact, not descriptors', () => {
    // The parts are not elements.json tags — getDescriptor answers null and
    // the contract (§3.3) names them as sem-fact's slots.
    for (const part of ['statement', 'conclusion', 'incorrect-statement']) {
      expect(getDescriptor(part), part).toBeNull();
    }
    const selectors = slotsOf(descriptors().fact).map((s) => s.selector);
    expect(selectors.some((s) => s.startsWith(':scope > :is(statement, .sem-statement)'))).toBe(true);
    expect(selectors.some((s) => s.startsWith(':scope > :is(conclusion, .sem-conclusion)'))).toBe(true);
    // the alias spellings are uneven: `.incorrect-statement` has no sem- prefix
    expect(
      selectors.some((s) => s.includes(':is(incorrect-statement, .incorrect-statement, .sem-incorrect-statement)')),
    ).toBe(true);
  });

  it('slot selectors start with ":scope" and every slot pins entity escaping', () => {
    for (const d of [descriptors().fact, descriptors().question, descriptors().option]) {
      for (const slot of slotsOf(d)) {
        expect(slot.selector === ':scope' || slot.selector.startsWith(':scope >'), slot.selector).toBe(true);
        expect(slot.escape).toBe('entities');
      }
      if (d.itemList) expect(d.itemList.childSelector.startsWith(':scope >')).toBe(true);
    }
  });

  it('sem-fact declares no itemList — the collection belongs to sem-facts', () => {
    expect(descriptors().fact.itemList).toBeUndefined();
    expect(descriptors().question.itemList).toBeDefined();
  });

  it('every template parses once stops are stripped', () => {
    for (const xml of allTemplates()) {
      const r = tryParse(stripTemplateStops(xml));
      expect(r.ok, xml).toBe(true);
    }
  });

  it('choice stops stay within the spec enum mc|multi|blank|match|order|tf|short', () => {
    const stop = descriptors().question.templates?.[0]?.xml ?? '';
    const m = stop.match(/\$\{1\|([^|}]*)\|/);
    expect(m).not.toBeNull();
    expect(m![1].split(',')).toEqual(['mc', 'multi', 'blank', 'match', 'order', 'tf', 'short']);
  });
});

describe('untouched documents round-trip', () => {
  it('elements.json examples (sem-fact, sem-facts) serialize byte-identical', () => {
    const schema = loadSchema();
    for (const name of ['sem-fact', 'sem-facts']) {
      const example = getTag(name)?.example ?? schema.byName.get(name)?.example;
      expect(example, name).toBeDefined();
      expect(createDocument(example!).serialize(), name).toBe(example);
    }
  });

  it('recall fixtures round-trip', () => {
    for (const src of [FACT_SRC, ALIAS_SRC, QUESTION_SRC, OPTION_SRC]) {
      expect(createDocument(src).serialize(), src).toBe(src);
    }
  });
});

describe('sem-fact — controller flows', () => {
  it('entering edit-mode attaches; a statement commit rewrites only the statement', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = FACT_SRC;
    const el = wrap.firstElementChild as SemElement;
    document.body.appendChild(el);
    const stop = watchEditMode(el);
    expect(el.hasAttribute('data-sem-editing')).toBe(false);
    el.setAttribute('edit-mode', '');
    await flush();
    expect(el.hasAttribute('data-sem-editing')).toBe(true);

    // attachEditor is idempotent — returns the controller watchEditMode made
    const c = attachEditor(el, createContext());
    if (c === null) throw new Error('watch attach failed');
    const ctx = c.ctx;
    const slot = slotsOf(descriptors().fact)[0];
    const slotEl = resolveSlotEl(c.binding, slot);
    expect(slotEl).not.toBeNull();
    c.startSlotEditing(slotEl!);
    commitSlotText(ctx, c.binding, slotEl!, 'JWTs rotate per deployment');

    const out = ctx.doc.serialize();
    // edit-mode was set BEFORE attach parsed the host, so the attribute is
    // in the model too; the edit delta is still confined to the statement.
    expect(out).toBe(
      upgraded(FACT_SRC)
        .replace(' data-sem-upgraded=""', ' data-sem-upgraded="" edit-mode=""')
        .replace('JWTs rotate per session', 'JWTs rotate per deployment'),
    );
    expect(ctx.doc.undo()).toBe(true);
    expect(ctx.doc.serialize()).toBe(
      upgraded(FACT_SRC).replace(' data-sem-upgraded=""', ' data-sem-upgraded="" edit-mode=""'),
    );
    stop();
  });

  it('class-alias children edit through the same slots', () => {
    const { ctx, c } = bind(ALIAS_SRC);
    const conclusion = slotsOf(descriptors().fact)[1];
    const slotEl = resolveSlotEl(c.binding, conclusion);
    expect(slotEl).not.toBeNull();
    c.startSlotEditing(slotEl!);
    commitSlotText(ctx, c.binding, slotEl!, 'Resolution edited');
    expect(ctx.doc.serialize()).toBe(upgraded(ALIAS_SRC).replace('Resolution one', 'Resolution edited'));
  });

  it('an attribute change is the only delta', () => {
    const { ctx, c } = bind(FACT_SRC);
    ctx.doc.apply({ type: 'setAttr', node: c.binding.rootId, name: 'kind', value: 'concept' });
    expect(ctx.doc.serialize()).toBe(
      upgraded(FACT_SRC).replace(
        ' data-sem-upgraded=""',
        ' data-sem-upgraded="" kind="concept"',
      ),
    );
  });
});

describe('sem-question — controller flows', () => {
  it('a prompt commit rewrites only the prompt', () => {
    const { ctx, c } = bind(QUESTION_SRC, handBridge);
    const slotEl = resolveSlotEl(c.binding, slotsOf(descriptors().question)[0]);
    expect(slotEl).not.toBeNull();
    c.startSlotEditing(slotEl!);
    commitSlotText(ctx, c.binding, slotEl!, 'Edited prompt');
    expect(ctx.doc.serialize()).toBe(
      domForm(QUESTION_SRC).replace('Which header carries the OIDC token?', 'Edited prompt'),
    );
  });

  it('the itemList template inserts through the factories; removal restores bytes', async () => {
    const { el, ctx, c } = bind(QUESTION_SRC, handBridge);
    const list = descriptors().question.itemList!;
    // The controller's addItem/buildFromXml path currently mis-allocates on
    // documents larger than the template (parse() resets the shared module
    // id counter; rebuilt ids land inside the live doc's range — cross-lane
    // patch filed). Here the SAME template goes through the sanctioned
    // adoption path: parse → rebuild via the doc factories (fresh ids,
    // counter seeded past the doc) → one insertNode.
    seedIdCounter(1000);
    const parsed = tryParse(stripTemplateStops(list.template.xml));
    expect(parsed.ok, list.template.xml).toBe(true);
    const src = parsed.doc.root.children.find((n): n is Extract<EditorNode, { kind: 'element' }> => n.kind === 'element');
    expect(src).toBeDefined();
    // parse() reset the module counter again — seed AFTER the parse, BEFORE
    // the rebuild, so factory allocations land outside the doc's id range
    // (the addItem bug in a nutshell).
    seedIdCounter(2000);
    const rebuild = (n: EditorNode): EditorNode => {
      if (n.kind === 'text') return ctx.doc.createText(n.value, n.mode);
      return ctx.doc.createElement({
        tag: n.name,
        attrs: n.attrs.map((a) => ({ name: a.name, value: a.value })),
        children: n.children.map(rebuild),
      });
    };
    const item = rebuild(src!);
    ctx.doc.apply({
      type: 'insertNode', parent: c.binding.rootId, index: ctx.doc.childrenOf(c.binding.rootId).length, node: item,
    });
    await flush(); // the §4.4 re-render projects the model child into the DOM

    const out = ctx.doc.serialize();
    expect(el.querySelectorAll(':scope > :is(sem-option, .sem-option)').length).toBe(3);
    expect(out).toContain('<sem-option correct="" data-sem-upgraded="">Authorization</sem-option>');
    expect(out).toContain('<sem-option data-sem-upgraded="">Cookie</sem-option>');
    expect(out).toContain('<sem-option>Option</sem-option>');
    expect(out.startsWith(domForm(QUESTION_SRC).split('\n').slice(0, 2).join('\n'))).toBe(true);

    ctx.doc.apply({ type: 'removeNode', node: item.id });
    expect(ctx.doc.serialize()).toBe(domForm(QUESTION_SRC));
  });

  it('an attribute change is the only delta', () => {
    const { ctx, c } = bind(QUESTION_SRC, handBridge);
    ctx.doc.apply({ type: 'setAttr', node: c.binding.rootId, name: 'type', value: 'tf' });
    expect(ctx.doc.serialize()).toBe(domForm(QUESTION_SRC).replace('type="mc"', 'type="tf"'));
  });

  it('out-of-schema status surfaces as a warning, never a block', () => {
    const parsed = parse(QUESTION_SRC);
    const issues = validateTree(parsed.root);
    const q = issues.find((i) => i.code === 'unknown-tag' && i.tag === 'sem-question');
    expect(q).toBeDefined();
    expect(q!.severity).toBe('warning');
  });
});

describe('sem-option — controller flows', () => {
  it(':scope slot commit and bare correct attr toggle; undo restores', () => {
    const { ctx, c } = bind(OPTION_SRC, handBridge);
    const slotEl = resolveSlotEl(c.binding, slotsOf(descriptors().option)[0]);
    expect(slotEl).not.toBeNull();
    c.startSlotEditing(slotEl!);
    commitSlotText(ctx, c.binding, slotEl!, 'Session cookie');
    expect(ctx.doc.serialize()).toBe(upgraded('<sem-option>Cookie</sem-option>').replace('Cookie', 'Session cookie'));

    ctx.doc.apply({ type: 'setAttr', node: c.binding.rootId, name: 'correct', value: null });
    expect(ctx.doc.serialize()).toBe('<sem-option data-sem-upgraded="" correct>Session cookie</sem-option>');

    expect(ctx.doc.undo()).toBe(true); // the setAttr
    expect(ctx.doc.undo()).toBe(true); // the slot commit
    expect(ctx.doc.serialize()).toBe(upgraded(OPTION_SRC));
  });
});
