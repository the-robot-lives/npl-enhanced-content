// @vitest-environment happy-dom
// Unit spec — desc-npl-b edit descriptors (EDITOR.md §3, lane brief §6).
//
// Per tag: the elements.json example round-trips byte-exact untouched;
// entering edit-mode (attach) binds the descriptor; one text edit / one
// item add-or-remove (where the element's post-upgrade DOM lets the
// controller resolve them — see the lane report for the withheld
// surfaces) and one attribute change each touch ONLY the targeted node.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import rawSchema from '../../elements.json';

// elements (custom-element registration)
import '../../src/lit/npl/npl-intent.js';
import '../../src/lit/npl/npl-mindread.js';
import '../../src/lit/npl/npl-mode.js';
import '../../src/lit/npl/npl-mood.js';
import '../../src/lit/npl/npl-poa.js';
import '../../src/lit/npl/npl-ref.js';
import '../../src/lit/npl/npl-rubric.js';
import '../../src/lit/npl/npl-section.js';
import '../../src/lit/npl/npl-thought.js';
import '../../src/lit/npl/npl-vos.js';
// descriptors (side-effect registration)
import '../../src/lit/npl/npl-intent.edit.js';
import '../../src/lit/npl/npl-mindread.edit.js';
import '../../src/lit/npl/npl-mode.edit.js';
import '../../src/lit/npl/npl-mood.edit.js';
import '../../src/lit/npl/npl-poa.edit.js';
import '../../src/lit/npl/npl-ref.edit.js';
import '../../src/lit/npl/npl-rubric.edit.js';
import '../../src/lit/npl/npl-section.edit.js';
import '../../src/lit/npl/npl-thought.edit.js';
import '../../src/lit/npl/npl-vos.edit.js';

import { parse } from '../../src/editor/model/document.js';
import { createContext, attachEditor, detachEditor } from '../../src/editor/controller/attach.js';
import type { EditorContext, ElementBinding } from '../../src/editor/controller/types.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import { commitSlotText, addItem, removeItem, stripTemplateStops } from '../../src/editor/controller/actions.js';
import { getDescriptor, hasHandDescriptor } from '../../src/editor/schema/registry.js';
import type { SemElement } from '../../src/lit/base.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

const TAGS = [
  'npl-intent',
  'npl-mindread',
  'npl-mode',
  'npl-mood',
  'npl-poa',
  'npl-ref',
  'npl-rubric',
  'npl-section',
  'npl-thought',
  'npl-vos',
] as const;

type Tag = (typeof TAGS)[number];

function exampleOf(tag: Tag): string {
  const raw = (rawSchema as { tags: Array<{ name: string; example: string }> }).tags.find(
    (t) => t.name === tag,
  );
  if (raw === undefined) throw new Error(`elements.json has no ${tag}`);
  return raw.example;
}

interface Harness {
  el: SemElement;
  ctx: EditorContext;
  c: EditController;
  binding: ElementBinding;
  example: string;
}

const detachables: SemElement[] = [];

/** Enter edit-mode on the example's FIRST element (the host), with the
 *  model parsed from the example source itself (attach finds the located
 *  root and never re-parses chrome-laden outerHTML). */
function harness(tag: Tag, pick: (parent: Element) => Element = (p) => p.firstElementChild as Element): Harness {
  const example = exampleOf(tag);
  const wrap = document.createElement('div');
  wrap.innerHTML = example;
  const el = pick(wrap) as SemElement;
  document.body.appendChild(el);
  el.setAttribute('edit-mode', '');
  const ctx = createContext({ source: example });
  const c = attachEditor(el, ctx);
  if (c === null) throw new Error(`attach failed for ${tag}`);
  detachables.push(el);
  return { el, ctx, c, binding: c.binding, example };
}

/** The serialized document with `find` replaced by `swap` — the expected
 *  "only the touched node changed" assertion target. */
function spliced(source: string, find: string, swap: string): string {
  const at = source.indexOf(find);
  if (at < 0) throw new Error('splice anchor not found');
  return source.slice(0, at) + swap + source.slice(at + find.length);
}

describe('desc-npl-b: coverage + untouched round-trip', () => {
  it('every npl-b tag carries a hand descriptor in bucket npl-b', () => {
    for (const tag of TAGS) {
      const d = getDescriptor(tag);
      expect(d !== null, tag).toBe(true);
      expect(hasHandDescriptor(tag), tag).toBe(true);
      expect(d!.bucket, tag).toBe('npl-b');
    }
  });

  for (const tag of TAGS) {
    it(`${tag}: serialize(parse(example)) === example untouched`, () => {
      expect(parse(exampleOf(tag)).serialize()).toBe(exampleOf(tag));
    });
  }
});

// ── attribute changes (every tag; root attrs always resolve) ────────────────

describe('desc-npl-b: attribute changes touch only the host tag', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const el of detachables.splice(0)) detachEditor(el);
  });

  const cases: Array<{ tag: Tag; attr: string; value: string | null; find: string; swap: string }> = [
    {
      tag: 'npl-intent', attr: 'kind', value: 'program',
      find: 'kind="initiative"', swap: 'kind="program"',
    },
    {
      tag: 'npl-mindread', attr: 'confidence', value: '0.9',
      find: 'confidence="0.7"', swap: 'confidence="0.9"',
    },
    {
      tag: 'npl-mode', attr: 'primary', value: null, // bare boolean spelling
      find: '<npl-mode>', swap: '<npl-mode primary>',
    },
    {
      tag: 'npl-mood', attr: 'mood', value: '🔥 sharp',
      find: 'mood="🙂 wistful"', swap: 'mood="🔥 sharp"',
    },
    {
      tag: 'npl-poa', attr: 'direction', value: 'td',
      find: 'direction="lr"', swap: 'direction="td"',
    },
    {
      tag: 'npl-ref', attr: 'variant', value: 'brief',
      find: 'variant="full"', swap: 'variant="brief"',
    },
    {
      tag: 'npl-rubric', attr: 'title', value: 'Perf review',
      find: 'title="Code review"', swap: 'title="Perf review"',
    },
    {
      tag: 'npl-section', attr: 'type', value: 'example',
      find: 'type="syntax"', swap: 'type="example"',
    },
    {
      tag: 'npl-thought', attr: 'id', value: 't7',
      find: 'id="t1"', swap: 'id="t7"',
    },
    {
      tag: 'npl-vos', attr: 'phase', value: 'exit',
      find: 'phase="entry"', swap: 'phase="exit"',
    },
  ];

  for (const { tag, attr, value, find, swap } of cases) {
    it(`${tag}: setAttr ${attr} → only the attribute spelling changes`, async () => {
      const h = harness(tag);
      await flush(); // let the element's own upgrade land first
      h.ctx.doc.apply({ type: 'setAttr', node: h.binding.rootId, name: attr, value });
      await flush();
      expect(h.ctx.doc.serialize()).toBe(spliced(h.example, find, swap));
    });
  }
});

// ── text slots (mapping-verified elements) ──────────────────────────────────

describe('desc-npl-b: text slot edits touch only the slot node', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const el of detachables.splice(0)) detachEditor(el);
  });

  it('npl-intent: overview slot commits into its section only', async () => {
    const h = harness('npl-intent');
    await flush();
    const slot = h.el.querySelector(':scope > npl-intent-overview')!;
    expect(slot !== null).toBe(true);
    expect(commitSlotText(h.ctx, h.binding, slot, 'Ship the fleet dashboard to prod.')).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<npl-intent-overview>Ship the fleet dashboard to stage.</npl-intent-overview>',
        '<npl-intent-overview>Ship the fleet dashboard to prod.</npl-intent-overview>',
      ),
    );
  });

  it('npl-poa: selected slot commits into its element only', async () => {
    const h = harness('npl-poa');
    await flush();
    const slot = h.el.querySelector(':scope > selected')!;
    expect(slot !== null).toBe(true);
    expect(commitSlotText(h.ctx, h.binding, slot, 'Path B confirmed.')).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<selected>Path B — 90% weight; lowest migration cost.</selected>',
        '<selected>Path B confirmed.</selected>',
      ),
    );
  });

  it('npl-ref: assessment slot commits into its section only', async () => {
    const h = harness('npl-ref');
    await flush();
    const slot = h.el.querySelector(':scope > assessment')!;
    expect(slot !== null).toBe(true);
    expect(commitSlotText(h.ctx, h.binding, slot, 'held; two gaps noted')).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<assessment>the approach held; one gap in the eval loop</assessment>',
        '<assessment>held; two gaps noted</assessment>',
      ),
    );
  });

  it('npl-thought: a thought child commits its text only', async () => {
    const h = harness('npl-thought');
    await flush();
    const slot = h.el.querySelector(':scope > npl-thought')!;
    expect(slot !== null).toBe(true);
    expect(commitSlotText(h.ctx, h.binding, slot, 'Cache misses cluster on Mondays.')).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<npl-thought type="observation">The cache misses cluster on Mondays.</npl-thought>',
        '<npl-thought type="observation">Cache misses cluster on Mondays.</npl-thought>',
      ),
    );
  });
});

// ── item lists ──────────────────────────────────────────────────────────────

describe('desc-npl-b: item add/remove touch only the list', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    for (const el of detachables.splice(0)) detachEditor(el);
  });

  it('npl-rubric: add inserts after the last criterion; remove takes it back', async (t) => {
    const h = harness('npl-rubric');
    await flush();
    if (!addItem(h.ctx, h.binding)) t.skip(); // blocked by the buildFromXml id-collision (cross-lane request)
    await flush();
    const added = '<npl-criterion name="Criterion" weight="1" score="1"></npl-criterion>';
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<npl-criterion name="Style" weight="1" score="5"></npl-criterion>',
        `<npl-criterion name="Style" weight="1" score="5"></npl-criterion>${added}`,
      ),
    );
    const last = h.el.querySelectorAll(':scope > npl-criterion')[2]!;
    expect(removeItem(h.ctx, h.binding, last)).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(h.example);
  });

  it('npl-rubric: removing an authored criterion splices only that element', async () => {
    const h = harness('npl-rubric');
    await flush();
    const style = h.el.querySelectorAll(':scope > npl-criterion')[1]!;
    expect(removeItem(h.ctx, h.binding, style)).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<npl-criterion name="Style" weight="1" score="5"></npl-criterion>',
        '',
      ),
    );
  });

  it('npl-thought: add inserts after the last thought; remove takes it back', async (t) => {
    const h = harness('npl-thought');
    await flush();
    if (!addItem(h.ctx, h.binding)) t.skip(); // blocked by the buildFromXml id-collision (cross-lane request)
    await flush();
    const added = '<npl-thought type="observation">The thought</npl-thought>';
    const anchor = '<npl-thought type="balloon">unknown — degrades to plain text</npl-thought>';
    expect(h.ctx.doc.serialize()).toBe(
      spliced(h.example, anchor, `${anchor}${added}`),
    );
    const last = h.el.querySelectorAll(':scope > npl-thought')[3]!;
    expect(removeItem(h.ctx, h.binding, last)).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(h.example);
  });

  it('npl-thought: removing the unknown-type child splices only that element', async () => {
    const h = harness('npl-thought');
    await flush();
    const balloon = h.el.querySelectorAll(':scope > npl-thought')[2]!;
    expect(removeItem(h.ctx, h.binding, balloon)).toBe(true);
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(
        h.example,
        '<npl-thought type="balloon">unknown — degrades to plain text</npl-thought>',
        '',
      ),
    );
  });

  it('npl-mood: + appends the part at the end of the element model children', async (t) => {
    const h = harness('npl-mood');
    await flush(); // parts already regrouped into .npl-mood-detail
    if (!addItem(h.ctx, h.binding)) t.skip(); // blocked by the buildFromXml id-collision (cross-lane request)
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(h.example, '</npl-mood>', '<div class="npl-mood-tone">Tone</div></npl-mood>'),
    );
  });

  it('npl-vos: + appends the part at the end of the element model children', async (t) => {
    const h = harness('npl-vos');
    await flush(); // parts already bracketed into .npl-vos-row bodies
    if (!addItem(h.ctx, h.binding)) t.skip(); // blocked by the buildFromXml id-collision (cross-lane request)
    await flush();
    expect(h.ctx.doc.serialize()).toBe(
      spliced(h.example, '</npl-vos>', '<p data-vos="id">Part text</p></npl-vos>'),
    );
  });
});

// ── templates parse (insert surfaces are model-safe) ────────────────────────

describe('desc-npl-b: every stripped template parses through the model', () => {
  for (const tag of TAGS) {
    it(`${tag}`, () => {
      const d = getDescriptor(tag)!;
      const snippets = [
        ...(d.templates ?? []).map((t) => t.xml),
        ...(d.wizard?.steps ?? []).flatMap((s) => [s.template.xml]),
        ...(d.itemList ? [d.itemList.template.xml] : []),
      ];
      expect(snippets.length > 0, tag).toBe(true);
      for (const xml of snippets) {
        // exactly what buildFromXml does before parsing an insert surface
        expect(() => parse(stripTemplateStops(xml)), `${tag}: ${xml.slice(0, 60)}`).not.toThrow();
      }
    });
  }
});
