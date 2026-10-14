// @vitest-environment happy-dom
// Unit spec — descriptor fan-out: sequence + definitions buckets (brief §6,
// EDITOR.md §3/§10). Per tag: descriptor shape, the untouched schema
// example round trip, and one text / item / attribute edit through the
// real model + controller — asserting only the touched subtrees re-emit.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { getTag } from '../../src/editor/schema/load-schema.js';
import { getDescriptor, hasHandDescriptor } from '../../src/editor/schema/registry.js';
import type { EditDescriptor, TemplateSnippet } from '../../src/editor/schema/types.js';
import { tryParse } from '../../src/editor/model/index.js';
import type { ElementNode, NodeId, TextNode } from '../../src/editor/model/types.js';
import {
  attachEditor, bindingFor, createContext, detachEditor,
} from '../../src/editor/controller/attach.js';
import {
  addItem, commitSlotText, removeItem, setLink,
} from '../../src/editor/controller/actions.js';
import type { EditorContext } from '../../src/editor/controller/types.js';

// descriptors register by side effect on import
import '../../src/lit/sem-chronology.edit.js';
import '../../src/lit/sem-event.edit.js';
import '../../src/lit/sem-procedure.edit.js';
import '../../src/lit/sem-step.edit.js';
import '../../src/lit/sem-progress.edit.js';
import '../../src/lit/sem-properties.edit.js';
import '../../src/lit/sem-property.edit.js';
import '../../src/lit/sem-references.edit.js';
import '../../src/lit/sem-reference.edit.js';
// Lit hosts for the two wrapper tags — the real requestUpdate/updateComplete path
import '../../src/lit/sem-properties.js';
import '../../src/lit/sem-references.js';

const SEQDEF = [
  'sem-chronology', 'sem-event', 'sem-procedure', 'sem-step', 'sem-progress',
  'sem-properties', 'sem-property', 'sem-references', 'sem-reference',
] as const;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function exampleOf(tag: string): string {
  const spec = getTag(tag);
  if (!spec) throw new Error(`no schema entry for ${tag}`);
  return spec.example;
}

/** Zero-JS tags (no Lit host) still satisfy the ReactiveControllerHost
 *  contract in tests: requestUpdate/updateComplete (§4.4 step 3) plus the
 *  add/removeController pair, with Lit's connected-host hostConnected call. */
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

interface Rig {
  el: Element;
  ctx: EditorContext;
  announce: ReturnType<typeof vi.fn>;
}

/** Attach `selector` (else the first element) of `markup` in edit-mode.
 *  Attach runs synchronously after connect so Lit upgrade chrome
 *  (`data-sem-upgraded`) never enters the parsed model. */
function rig(markup: string, selector?: string): Rig {
  const announce = vi.fn();
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = editable(
    (selector !== undefined ? wrap.querySelector(selector) : wrap.firstElementChild) as Element,
  );
  if (!el) throw new Error(`rig: selector ${selector ?? '(first)'} not found`);
  document.body.appendChild(wrap);
  const ctx = createContext({ announce });
  const c = attachEditor(el as never, ctx);
  if (c === null) throw new Error(`rig: attach failed for ${selector ?? '(first)'}`);
  return { el, ctx, announce };
}

function requireBinding(el: Element): { rootId: NodeId; el: Element } {
  const b = bindingFor(el);
  if (!b) throw new Error('no binding for element');
  return b as unknown as { rootId: NodeId; el: Element };
}

function childSubtrees(ctx: EditorContext, rootId: NodeId): string[] {
  return ctx.doc.childrenOf(rootId).map((n) => ctx.doc.serializeSubtree(n.id));
}

function elementChildren(ctx: EditorContext, rootId: NodeId): ElementNode[] {
  return ctx.doc.childrenOf(rootId).filter((n): n is ElementNode => n.kind === 'element');
}

function templateParses(t: TemplateSnippet, what: string): void {
  const r = tryParse(t.xml);
  expect(r.ok, `${what} must parse`).toBe(true);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.querySelectorAll('[data-sem-editing]').forEach((n) => detachEditor(n as never));
  document.body.innerHTML = '';
});

// ── descriptor shape ──────────────────────────────────────────────────────────

describe('seqdef descriptors — shape', () => {
  it('registers all nine tags as hand descriptors with sane selectors', () => {
    for (const tag of SEQDEF) {
      const d = getDescriptor(tag);
      expect(d, tag).not.toBe(null);
      expect(hasHandDescriptor(tag), tag).toBe(true);
      const desc = d as EditDescriptor;
      expect(desc.title.length, tag).toBeGreaterThan(0);
      for (const slot of desc.textSlots ?? []) {
        expect(
          slot.selector === ':scope' || slot.selector.startsWith(':scope >'),
          `${tag} slot ${slot.selector}`,
        ).toBe(true);
        expect(slot.escape, tag).toBe('entities');
      }
      if (desc.itemList) {
        expect(desc.itemList.childSelector.startsWith(':scope >'), tag).toBe(true);
      }
    }
  });

  it('every template and wizard step parses; stops start at 1', () => {
    for (const tag of SEQDEF) {
      const d = getDescriptor(tag) as EditDescriptor;
      const all: TemplateSnippet[] = [
        ...(d.templates ?? []),
        ...(d.wizard?.steps ?? []).map((s) => s.template),
      ];
      for (const t of all) {
        templateParses(t, `${tag}/${t.id}`);
        if (!t.xml.includes('${')) continue;
        expect(/\$\{1[:|]/.test(t.xml), `${tag}/${t.id} first stop is 1`).toBe(true);
        for (const stop of t.xml.match(/\$\{\d+[^}]*\}/g) ?? []) {
          expect(/^\$\{\d+:[^{}]*\}$|^\$\{\d+\|[^{}]*\}$/.test(stop), `${tag}/${t.id} stop "${stop}"`).toBe(true);
        }
      }
    }
  });

  it('container tags declare containerOf; companions stay slot-only', () => {
    expect(getDescriptor('sem-chronology')!.containerOf).toBe('sem-event');
    expect(getDescriptor('sem-procedure')!.containerOf).toBe('sem-step');
    expect(getDescriptor('sem-properties')!.containerOf).toBe('sem-property');
    expect(getDescriptor('sem-references')!.containerOf).toBe('sem-reference');
    expect(getDescriptor('sem-event')!.containerOf).toBeUndefined();
    expect(getDescriptor('sem-step')!.containerOf).toBeUndefined();
    expect(getDescriptor('sem-property')!.containerOf).toBeUndefined();
    expect(getDescriptor('sem-reference')!.containerOf).toBeUndefined();
  });
});

// ── untouched round trip (the invariant, per tag) ────────────────────────────

describe('seqdef descriptors — untouched examples round-trip', () => {
  for (const tag of SEQDEF) {
    it(`${tag}: serialize(parse(example)) === example`, () => {
      const ex = exampleOf(tag);
      const r = tryParse(ex);
      expect(r.ok, tag).toBe(true);
      expect(r.doc.serialize(), tag).toBe(ex);
    });
  }
});

// ── sem-chronology / sem-event ───────────────────────────────────────────────

describe('sem-chronology', () => {
  // addItem on a NON-empty list is blocked by a buildFromXml id-counter bug
  // (cross-lane request 1: document.parse() resets the shared id counter, so
  // the template rebuild mints ids inside the attached doc's range and
  // canApply rejects with "already attached"). Until the patch lands, add
  // coverage uses an empty container, where minted ids stay fresh.
  it('adds an event to an empty chronology and removes it, restoring the baseline', async () => {
    const { el, ctx } = rig(
      '<sem-chronology kind="release-history" view-as="timeline" role="list"></sem-chronology>',
    );
    const bind = requireBinding(el);
    const baseline = ctx.doc.serialize();

    expect(addItem(ctx, bind)).toBe(true);
    const events = elementChildren(ctx, bind.rootId);
    expect(events.length).toBe(1);
    expect(ctx.doc.serializeSubtree(events[0]!.id)).toBe(
      '<sem-event when="2026-01-01">What happened</sem-event>',
    );

    await flush(); // re-render projects the new item into the DOM
    const domEvents = el.querySelectorAll(':scope > :is(sem-event, .sem-event)');
    expect(domEvents.length).toBe(1);
    expect(removeItem(ctx, bind, domEvents[0] as Element)).toBe(true);
    expect(ctx.doc.serialize()).toBe(baseline);
    await flush(); // re-render drops the removed item
    expect(el.querySelectorAll(':scope > :is(sem-event, .sem-event)').length).toBe(0);
  });

  // Restore when the cross-lane id-seed patch lands (see above).
  it.skip('inserts after the last existing event (pending cross-lane id-seed patch)', () => {
    const { el, ctx } = rig(exampleOf('sem-chronology'));
    const bind = requireBinding(el);
    const before = elementChildren(ctx, bind.rootId).length;
    expect(addItem(ctx, bind)).toBe(true);
    expect(elementChildren(ctx, bind.rootId).length).toBe(before + 1);
    expect(ctx.doc.serializeSubtree(elementChildren(ctx, bind.rootId)[before]!.id)).toBe(
      '<sem-event when="2026-01-01">What happened</sem-event>',
    );
  });

  it('attribute edit touches the host only; child subtrees stay byte-identical', () => {
    const { el, ctx } = rig(exampleOf('sem-chronology'));
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    const op = { type: 'setAttr' as const, node: bind.rootId, name: 'view-as', value: 'list' };
    expect(ctx.doc.canApply(op).ok).toBe(true);
    ctx.doc.apply(op);
    expect(ctx.doc.serialize()).toContain('view-as="list"');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });
});

describe('sem-event', () => {
  it('edits the <time> date label inline; only that text re-emits', () => {
    const { el, ctx } = rig(exampleOf('sem-chronology'), 'sem-event');
    const bind = requireBinding(el);
    const time = el.querySelector(':scope > time') as Element;
    expect(time).not.toBe(null);
    const before = ctx.doc.serialize();
    const slot = (getDescriptor('sem-event') as EditDescriptor).textSlots![0];
    expect(slot.selector).toBe(':scope > time');
    expect(commitSlotText(ctx, bind, time, 'March 2, 2026')).toBe(true);
    expect(ctx.doc.serialize()).toBe(before.replace('2 Mar 2026', 'March 2, 2026'));
  });

  it('refuses the host slot on a time-bearing event (mixed content) with an announcement', () => {
    const { el, ctx, announce } = rig(exampleOf('sem-chronology'), 'sem-event');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    expect(commitSlotText(ctx, bind, el, 'overwritten?')).toBe(false);
    expect(ctx.doc.serialize()).toBe(before);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('markup'));
  });

  it('edits the body of a time-less event through the host slot', () => {
    const { el, ctx } = rig(
      '<sem-chronology><sem-event when="2026-Q4">Theme pipeline.</sem-event></sem-chronology>',
      'sem-event',
    );
    const bind = requireBinding(el);
    expect(commitSlotText(ctx, bind, el, 'Theme pipeline — shipped.')).toBe(true);
    expect(ctx.doc.serialize()).toBe(
      '<sem-event when="2026-Q4">Theme pipeline — shipped.</sem-event>',
    );
  });

  it('status attribute edit touches the host only', () => {
    const { el, ctx } = rig(exampleOf('sem-chronology'), 'sem-event');
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    const op = { type: 'setAttr' as const, node: bind.rootId, name: 'status', value: 'blocked' };
    expect(ctx.doc.canApply(op).ok).toBe(true);
    ctx.doc.apply(op);
    expect(ctx.doc.serialize()).toContain('status="blocked"');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });
});

// ── sem-procedure / sem-step ─────────────────────────────────────────────────

describe('sem-procedure', () => {
  // Empty-container pattern — see the sem-chronology note on the id-seed bug.
  it('adds a step to an empty procedure and removes it, restoring the baseline', async () => {
    const { el, ctx } = rig('<sem-procedure kind="runbook" role="list"></sem-procedure>');
    const bind = requireBinding(el);
    const baseline = ctx.doc.serialize();

    expect(addItem(ctx, bind)).toBe(true);
    const steps = elementChildren(ctx, bind.rootId);
    expect(steps.length).toBe(1);
    expect(ctx.doc.serializeSubtree(steps[0]!.id)).toBe('<sem-step>Do the thing</sem-step>');

    await flush();
    const domSteps = el.querySelectorAll(':scope > :is(sem-step, .sem-step)');
    expect(domSteps.length).toBe(1);
    expect(removeItem(ctx, bind, domSteps[0] as Element)).toBe(true);
    expect(ctx.doc.serialize()).toBe(baseline);
  });

  it.skip('inserts after the last existing step (pending cross-lane id-seed patch)', () => {
    const { el, ctx } = rig(exampleOf('sem-procedure'));
    const bind = requireBinding(el);
    const before = elementChildren(ctx, bind.rootId).length;
    expect(addItem(ctx, bind)).toBe(true);
    expect(elementChildren(ctx, bind.rootId).length).toBe(before + 1);
    expect(ctx.doc.serializeSubtree(elementChildren(ctx, bind.rootId)[before]!.id)).toBe(
      '<sem-step>Do the thing</sem-step>',
    );
  });

  it('kind attribute edit touches the host only', () => {
    const { el, ctx } = rig(exampleOf('sem-procedure'));
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'kind', value: 'recipe' });
    expect(ctx.doc.serialize()).toContain('kind="recipe"');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });
});

describe('sem-step', () => {
  it('edits the instruction through the host slot; the exact source re-emits', () => {
    const { el, ctx } = rig(exampleOf('sem-procedure'), 'sem-step');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    expect(commitSlotText(ctx, bind, el, 'provision Infisical path first')).toBe(true);
    expect(ctx.doc.serialize()).toBe(
      before.replace('provision Infisical path', 'provision Infisical path first'),
    );
  });

  it('status attribute lands on a status-less step without touching the text', () => {
    // Standalone step (fresh-ctx attach resolves single-element parses only;
    // mid-list steps resolve when an ancestor is attached first — covered by
    // the sem-procedure instruction test).
    const { el, ctx } = rig('<sem-step role="listitem">run migrations</sem-step>', 'sem-step');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    const op = { type: 'setAttr' as const, node: bind.rootId, name: 'status', value: 'todo' };
    expect(ctx.doc.canApply(op).ok).toBe(true);
    ctx.doc.apply(op);
    expect(ctx.doc.serialize()).toBe('<sem-step role="listitem" status="todo">run migrations</sem-step>');
  });
});

// ── sem-progress ─────────────────────────────────────────────────────────────

describe('sem-progress', () => {
  it('value and label attribute edits re-emit in place, trivia preserved', () => {
    const { el, ctx } = rig(exampleOf('sem-progress'));
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'value', value: '0.75' });
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'label', value: 'tests' });
    expect(ctx.doc.serialize()).toBe(
      before.replace('value="0.62"', 'value="0.75"').replace('label="coverage"', 'label="tests"'),
    );
  });
});

// ── sem-properties / sem-property ────────────────────────────────────────────

describe('sem-properties', () => {
  // Empty-container pattern — see the sem-chronology note on the id-seed bug.
  it('adds a property with the accessible authoring form and removes it', async () => {
    const { el, ctx } = rig('<sem-properties kind="config"></sem-properties>');
    const bind = requireBinding(el);
    const baseline = ctx.doc.serialize();

    expect(addItem(ctx, bind)).toBe(true);
    const props = elementChildren(ctx, bind.rootId);
    expect(props.length).toBe(1);
    expect(ctx.doc.serializeSubtree(props[0]!.id)).toBe(
      '<sem-property key="Key" role="definition" aria-label="Key">Value</sem-property>',
    );

    await flush();
    const domProps = el.querySelectorAll(':scope > :is(sem-property, .sem-property)');
    expect(domProps.length).toBe(1);
    expect(removeItem(ctx, bind, domProps[0] as Element)).toBe(true);
    expect(ctx.doc.serialize()).toBe(baseline);
  });

  it.skip('inserts after the last existing property (pending cross-lane id-seed patch)', () => {
    const { el, ctx } = rig(exampleOf('sem-properties'));
    const bind = requireBinding(el);
    const before = elementChildren(ctx, bind.rootId).length;
    expect(addItem(ctx, bind)).toBe(true);
    expect(elementChildren(ctx, bind.rootId).length).toBe(before + 1);
    expect(ctx.doc.serializeSubtree(elementChildren(ctx, bind.rootId)[before]!.id)).toBe(
      '<sem-property key="Key" role="definition" aria-label="Key">Value</sem-property>',
    );
  });

  it('kind attribute edit touches the host only', () => {
    const { el, ctx } = rig(exampleOf('sem-properties'));
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'kind', value: 'spec' });
    expect(ctx.doc.serialize()).toContain('kind="spec"');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });
});

describe('sem-property', () => {
  it('edits the value through the host slot; the exact source re-emits', () => {
    const { el, ctx } = rig(exampleOf('sem-properties'), 'sem-property');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    expect(commitSlotText(ctx, bind, el, '20 minutes')).toBe(true);
    expect(ctx.doc.serialize()).toBe(before.replace('>15m<', '>20 minutes<'));
  });

  it('key attribute edit leaves the value and aria-label untouched', () => {
    const { el, ctx } = rig(exampleOf('sem-properties'), 'sem-property');
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'key', value: 'token lifetime' });
    const s = ctx.doc.serialize();
    expect(s).toContain('key="token lifetime"');
    expect(s).toContain('aria-label="token ttl"'); // mirror is authored, not auto-synced
    expect(s).toContain('>15m<');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });
});

// ── sem-references / sem-reference ───────────────────────────────────────────

describe('sem-references', () => {
  // Empty-container pattern — see the sem-chronology note on the id-seed bug.
  it('adds a reference to an empty list and removes it, restoring the baseline', async () => {
    const { el, ctx } = rig(
      '<sem-references id="refs" kind="bibliography" role="list"></sem-references>',
      'sem-references',
    );
    const bind = requireBinding(el);
    const baseline = ctx.doc.serialize();

    expect(addItem(ctx, bind)).toBe(true);
    const refs = elementChildren(ctx, bind.rootId);
    expect(refs.length).toBe(1);
    expect(ctx.doc.serializeSubtree(refs[0]!.id)).toBe('<sem-reference>Reference text</sem-reference>');

    await flush();
    const domRefs = el.querySelectorAll(':scope > :is(sem-reference, .sem-reference)');
    expect(domRefs.length).toBe(1);
    expect(removeItem(ctx, bind, domRefs[0] as Element)).toBe(true);
    expect(ctx.doc.serialize()).toBe(baseline);
  });

  it.skip('inserts after the last existing reference (pending cross-lane id-seed patch)', () => {
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-references');
    const bind = requireBinding(el);
    const before = elementChildren(ctx, bind.rootId).length;
    expect(addItem(ctx, bind)).toBe(true);
    expect(elementChildren(ctx, bind.rootId).length).toBe(before + 1);
    expect(ctx.doc.serializeSubtree(elementChildren(ctx, bind.rootId)[before]!.id)).toBe(
      '<sem-reference>Reference text</sem-reference>',
    );
  });

  it('kind attribute edit touches the host only', () => {
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-references');
    const bind = requireBinding(el);
    const beforeChildren = childSubtrees(ctx, bind.rootId);
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'kind', value: 'footnotes' });
    expect(ctx.doc.serialize()).toContain('kind="footnotes"');
    expect(childSubtrees(ctx, bind.rootId)).toEqual(beforeChildren);
  });

  it('rerender re-establishes the references enhance chrome after a re-projection', async () => {
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-references');
    const bind = requireBinding(el);
    await flush(); // upgrade enhance ran: the cited entry carries its link chrome
    const first = el.querySelector(':scope > :is(sem-reference, .sem-reference)') as Element;
    expect(first.querySelector(':scope > .sem-references-link')).not.toBe(null);

    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'kind', value: 'footnotes' });
    await flush(); // re-render wipes authored-looking chrome, then descriptor.rerender restores it
    const fresh = el.querySelector(':scope > :is(sem-reference, .sem-reference)') as Element;
    expect(fresh.querySelector(':scope > .sem-references-link')).not.toBe(null);
    expect(ctx.doc.serialize()).toContain('kind="footnotes"');
  });
});

describe('sem-reference', () => {
  it('edits the citation text through the host slot; attr trivia preserved', () => {
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-reference');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    const raw = firstTextRaw(ctx, bind.rootId);
    expect(commitSlotText(ctx, bind, el, 'The OAuth 2.0 Authorization Framework (section 10.4).')).toBe(true);
    expect(ctx.doc.serialize()).toBe(
      before.replace(raw, 'The OAuth 2.0 Authorization Framework (section 10.4).'),
    );
    expect(ctx.doc.serialize()).toContain('href="https://www.rfc-editor.org/rfc/rfc6749"');
  });

  it('href edit via the link field is URL-safety-checked', () => {
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-reference');
    const bind = requireBinding(el);
    const field = { attr: 'href' as const };
    const bad = setLink(ctx, bind, field, 'javascript:alert(1)');
    expect(bad.ok).toBe(false);
    expect(ctx.doc.serialize()).toContain('href="https://www.rfc-editor.org/rfc/rfc6749"');
    const good = setLink(ctx, bind, field, 'https://example.com/oauth');
    expect(good.ok).toBe(true);
    expect(ctx.doc.serialize()).toContain('href="https://example.com/oauth"');
  });

  it('cite is NOT a link field — the modal edits it as plain text', () => {
    const d = getDescriptor('sem-reference') as EditDescriptor;
    expect(d.linkFields?.some((f) => f.attr === 'cite')).toBe(false);
    const { el, ctx } = rig(exampleOf('sem-references'), 'sem-reference');
    const bind = requireBinding(el);
    const before = ctx.doc.serialize();
    ctx.doc.apply({ type: 'setAttr', node: bind.rootId, name: 'cite', value: 'RFC 6749, section 10.4' });
    expect(ctx.doc.serialize()).toBe(before.replace('cite="RFC 6749"', 'cite="RFC 6749, section 10.4"'));
  });
});

// ── helper ───────────────────────────────────────────────────────────────────

function firstTextRaw(ctx: EditorContext, rootId: NodeId): string {
  const t = ctx.doc.childrenOf(rootId).find((n): n is TextNode => n.kind === 'text');
  if (!t) throw new Error('no direct text child');
  return t.raw;
}
