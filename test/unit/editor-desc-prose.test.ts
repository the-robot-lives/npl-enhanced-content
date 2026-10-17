// @vitest-environment happy-dom
// Unit spec — prose-bucket edit descriptors (Phase 2): sem-md, sem-code,
// sem-browser.
//
// Feature: descriptor shape (mirrors the schema lane's rules, per-file
//          registry isolation)
//   Scenario: each prose descriptor is hand-registered in the prose bucket
//   Scenario: slots anchor at :scope children and escape entities
//   Scenario: templates parse through the model parser; stops start at 1
//             and use the ${n:…} / ${n|a,b} grammar
// Feature: round trip (EDITOR.md §2.1)
//   Scenario: each tag's example round-trips byte-exact untouched
// Feature: sem-md (content is one Markdown text behind the raw fence)
//   Scenario: a text edit through the raw fence changes ONLY the text node
//   Scenario: an attribute edit changes ONLY that attribute; undo restores
//   Scenario: no item list — addItem is a graceful no-op
// Feature: sem-code (authored pre>code listing)
//   Scenario: a text edit changes ONLY the listing; attributes preserved
//   Scenario: a second edit after the re-render still maps (chrome stamp)
//   Scenario: attribute edit; no item list
// Feature: sem-browser (absent from elements.json — spec fixture)
//   Scenario: src accepts a relative path and rejects javascript: (§8)
//   Scenario: attribute edit; no item list
//   Scenario: no-src re-render re-homes fallback content exactly once
//
// Four flows are `it.fixme` (body kept, skipped): every controller op on a
// sem-md / sem-browser binding currently crashes the element's next Lit
// update — the element implementations eject lit's light-DOM part markers
// (md/element.ts `textContent = ''`; sem-browser #wire re-homing them into
// the frame the re-render cleanup removes) — so the re-render protocol's
// `await el.updateComplete` rejects and fails the file via unhandled
// rejection. Exact unblocking patches sit in each fixme comment; see the
// desc-prose report's cross-lane requests.
import { describe, expect, it, test, beforeEach, afterEach } from 'vitest';

import '../../src/lit/sem-md.js';
import '../../src/lit/sem-md.edit.js';
import '../../src/lit/sem-code.js';
import '../../src/lit/sem-code.edit.js';
import '../../src/lit/sem-browser.js';
import '../../src/lit/sem-browser.edit.js';

import { parse } from '../../src/editor/model/document.js';
import { loadSchema } from '../../src/editor/schema/load-schema.js';
import { handDescriptors } from '../../src/editor/schema/registry.js';
import type { EditDescriptor } from '../../src/editor/schema/types.js';
import {
  attachEditor,
  createContext,
  detachEditor,
} from '../../src/editor/controller/attach.js';
import type { EditController } from '../../src/editor/controller/edit-controller.js';
import { addItem, commitSlotText, setLink } from '../../src/editor/controller/actions.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import type { SemElement } from '../../src/lit/base.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function example(tag: string): string {
  const spec = loadSchema().byName.get(tag);
  if (spec === undefined) throw new Error(`no schema example for ${tag}`);
  return spec.example;
}

const MD_EXAMPLE = example('sem-md');
const CODE_EXAMPLE = example('sem-code');
// sem-browser is not in elements.json (cross-lane seed requested); the
// fixture is the spec's authoring form (spec/schema/sem-browser.md).
const BROWSER_EXAMPLE =
  '<sem-browser src="/demo/example-deck.sem.html" label="the deck">\n' +
  '  <figure class="code-window">\n' +
  '    <div aria-hidden="true">← → ⟳</div>\n' +
  '    <div>demo/example-deck.sem.html</div>\n' +
  '  </figure>\n' +
  '</sem-browser>';
const BROWSER_NO_SRC =
  '<sem-browser label="deck">\n' +
  '  <figure class="code-window"><p>Fallback</p></figure>\n' +
  '</sem-browser>';

function desc(tag: string): EditDescriptor {
  const d = handDescriptors().find((x) => x.tag === tag);
  if (d === undefined) throw new Error(`no hand descriptor registered for ${tag}`);
  return d;
}

const bound: SemElement[] = [];

function make(markup: string): {
  el: HTMLElement;
  ctx: EditorContext;
  c: EditController;
} {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as HTMLElement;
  if (el === null) throw new Error('fixture produced no element');
  // Attach BEFORE the element connects: the controller parses outerHTML for
  // the model, and a connected element has already claimed its runtime
  // attributes (base.ts claims `data-sem-upgraded` in connectedCallback).
  // Attaching first keeps the model byte-identical to the authored source.
  const ctx = createContext();
  const c = attachEditor(el as unknown as SemElement, ctx);
  if (c === null) throw new Error('attach failed');
  document.body.appendChild(el);
  if (c === null) throw new Error('attach failed');
  bound.push(el as unknown as SemElement);
  return { el, ctx, c };
}

function reset(): void {
  for (const el of bound) detachEditor(el);
  bound.length = 0;
  document.body.innerHTML = '';
}

// stop grammar (mirror of the schema lane's rules — registry is per-file)
const textStop = /^\$\{\d+:[^{}]*\}$/;
const choiceStop = /^\$\{\d+\|[^{}]*\}$/;

describe('prose descriptors — shape', () => {
  it('registers sem-md, sem-code and sem-browser hand descriptors in the prose bucket', () => {
    for (const tag of ['sem-md', 'sem-code', 'sem-browser']) {
      const d = desc(tag);
      expect(d.bucket, tag).toBe('prose');
      expect(d.title.length, tag).toBeGreaterThan(0);
      expect(d.tag.toLowerCase(), tag).toBe(tag);
    }
  });

  it('slots anchor at :scope children and escape entities', () => {
    for (const tag of ['sem-md', 'sem-code']) {
      const d = desc(tag);
      expect(d.textSlots?.length, tag).toBeGreaterThan(0);
      for (const slot of d.textSlots ?? []) {
        expect(slot.selector.startsWith(':scope >'), `${tag} slot ${slot.selector}`).toBe(true);
        expect(slot.escape, tag).toBe('entities');
      }
    }
    expect(desc('sem-browser').textSlots).toBeUndefined(); // fallback children are structural
  });

  it('templates parse through the model parser; stops use the pinned grammar', () => {
    for (const tag of ['sem-md', 'sem-code', 'sem-browser']) {
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
});

describe('prose descriptors — round trip (§2.1)', () => {
  it('sem-md example round-trips byte-exact untouched', () => {
    expect(parse(MD_EXAMPLE).serialize()).toBe(MD_EXAMPLE);
  });
  it('sem-code example round-trips byte-exact untouched', () => {
    expect(parse(CODE_EXAMPLE).serialize()).toBe(CODE_EXAMPLE);
  });
  it('sem-browser spec fixture round-trips byte-exact untouched', () => {
    expect(parse(BROWSER_EXAMPLE).serialize()).toBe(BROWSER_EXAMPLE);
    expect(parse(BROWSER_NO_SRC).serialize()).toBe(BROWSER_NO_SRC);
  });
});

describe('sem-md — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('enters edit-mode on attach', () => {
    const { el } = make(MD_EXAMPLE);
    expect(el.hasAttribute('data-sem-editing')).toBe(true);
  });

  it('text edit through the raw fence changes ONLY the markdown text node', async () => {
    const { el, ctx, c } = make(MD_EXAMPLE);
    await flush(); // the element's own enhancement builds the raw fence
    const code = el.querySelector(':scope > .sem-md-raw code');
    expect(code).not.toBeNull();
    expect(commitSlotText(ctx, c.binding, code!, 'edited')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(
      '<sem-md id="m-lifetimes" label="Token lifetimes" controls="toggle,copy">edited</sem-md>',
    );
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(MD_EXAMPLE);
  });

  it('attribute edit changes ONLY that attribute; undo restores byte-exact', async () => {
    const { ctx, c } = make(MD_EXAMPLE);
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'label', value: 'Renamed caption' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(
      MD_EXAMPLE.replace('label="Token lifetimes"', 'label="Renamed caption"'),
    );
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(MD_EXAMPLE);
  });

  it('no item list — addItem is a graceful no-op', () => {
    const { ctx, c } = make(MD_EXAMPLE);
    expect(addItem(ctx, c.binding)).toBe(false);
    expect(ctx.doc.serialize()).toBe(MD_EXAMPLE);
  });
});

describe('sem-code — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  const ORIGINAL =
    'export function rotate(pair: Pair): Pair {\n  const next = mint();\n  retire(pair.refresh);\n  return next;\n}';

// The edit-slot machinery targets the NESTED authoring form (`pre > code`
// stays supported; slots bind the authored DOM, and the flat form's minted
// nodes are outside the attach-time model). The schema example is the flat
// form, so these edit tests pin their own nested fixture.
const CODE_NESTED = [
  '<sem-code id="c-rotate" lang="ts" filename="src/rotate.ts" mark="2,4-5" controls="copy,wrap">',
  '<pre><code>' + ORIGINAL + '</code></pre>',
  '</sem-code>',
].join('\n');

  it('text edit changes ONLY the listing; attributes preserved', async () => {
    const { el, ctx, c } = make(CODE_NESTED);
    const code = el.querySelector(':scope > pre > code');
    expect(code).not.toBeNull();
    expect(commitSlotText(ctx, c.binding, code!, 'ROTATED')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(CODE_NESTED.replace(ORIGINAL, 'ROTATED'));
    ctx.doc.undo();
    expect(ctx.doc.serialize()).toBe(CODE_NESTED);
  });

  it('a second edit after the re-render still maps (chrome stamped, not indexed)', async () => {
    const { el, ctx, c } = make(CODE_NESTED);
    const code = el.querySelector(':scope > pre > code')!;
    commitSlotText(ctx, c.binding, code, 'FIRST');
    await flush(); // re-render re-establishes + stamps the chrome
    const chrome = el.querySelector(':scope > .sem-code-chrome');
    expect(chrome?.hasAttribute('data-sem-chrome')).toBe(true);
    const code2 = el.querySelector(':scope > pre > code');
    expect(code2).not.toBeNull();
    expect(commitSlotText(ctx, c.binding, code2!, 'SECOND')).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(CODE_NESTED.replace(ORIGINAL, 'SECOND'));
  });

  it('attribute edit changes ONLY that attribute', async () => {
    const { ctx, c } = make(CODE_EXAMPLE);
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'lang', value: 'js' });
    });
    await flush();
    expect(ctx.doc.serialize()).toBe(CODE_EXAMPLE.replace('lang="ts"', 'lang="js"'));
  });

  it('no item list — addItem is a graceful no-op', () => {
    const { ctx, c } = make(CODE_EXAMPLE);
    expect(addItem(ctx, c.binding)).toBe(false);
    expect(ctx.doc.serialize()).toBe(CODE_EXAMPLE);
  });
});

describe('sem-browser — edits', () => {
  beforeEach(reset);
  afterEach(reset);

  it('src link field accepts a relative path and writes ONLY that attribute', async () => {
    const { ctx, c } = make(BROWSER_EXAMPLE);
    const r = setLink(ctx, c.binding, { attr: 'src' }, 'demo/other.sem.html');
    expect(r.ok).toBe(true);
    await flush();
    expect(ctx.doc.serialize()).toBe(
      BROWSER_EXAMPLE.replace('src="/demo/example-deck.sem.html"', 'src="demo/other.sem.html"'),
    );
  });

  it('src link field rejects javascript: and writes nothing (§8)', async () => {
    const { ctx, c } = make(BROWSER_EXAMPLE);
    const r = setLink(ctx, c.binding, { attr: 'src' }, 'javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(ctx.doc.serialize()).toBe(BROWSER_EXAMPLE);
  });

  it('no item list — addItem is a graceful no-op', () => {
    const { ctx, c } = make(BROWSER_EXAMPLE);
    expect(addItem(ctx, c.binding)).toBe(false);
    expect(ctx.doc.serialize()).toBe(BROWSER_EXAMPLE);
  });

  it('no-src re-render keeps one copy of the fallback inside the viewport', async () => {
    const { el, ctx, c } = make(BROWSER_NO_SRC);
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'label', value: 'renamed' });
    });
    await flush(); // wire + re-render settle
    const frame = el.querySelector(':scope > .sem-window');
    expect(frame).not.toBeNull();
    expect(frame?.hasAttribute('data-sem-chrome')).toBe(true);
    const figures = el.querySelectorAll('figure');
    expect(figures.length).toBe(1);
    expect(figures[0]!.closest('.sem-window-viewport')).not.toBeNull();
    expect(ctx.doc.serialize()).toBe(BROWSER_NO_SRC.replace('label="deck"', 'label="renamed"'));
  });
});
