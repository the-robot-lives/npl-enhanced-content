// @vitest-environment happy-dom
// Unit spec — dnd lane wiring: the HTML5 drag & drop listeners in drag.ts
// exercised end-to-end with synthetic events (EDITOR.md §5.6: chip handle,
// sem-MIME payload, schema-permitted indicators, one-moveNode drops, Esc).
//
// Feature: handle acquisition by delegation
//   Scenario: mousedown on a chip flips draggable on; no controller seam
// Feature: drag payload
//   Scenario: dragstart carries the NODE id under application/x-sem-node,
//             never HTML, effectAllowed move, source dimmed
// Feature: indicators + drops
//   Scenario: dragover a permitted slot shows the dropline; drop performs
//             ONE moveNode and announces the new position
//   Scenario: dragover a refused container shows NO dropline; drop no-ops
//   Scenario: drop onto a second container's host appends (companion admit)
//   Scenario: Escape cancels — subsequent drop writes nothing
//   Scenario: dragend cleans up dimming + indicator
// Feature: keyboard/drag share the resolver (deep target, not host root)
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { SemElement } from '../../src/lit/base.js';
import { createDocument } from '../../src/editor/model/index.js';
import {
  attachEditor,
  createContext,
  detachEditor,
} from '../../src/editor/controller/attach.js';
import type { EditorContext } from '../../src/editor/controller/types.js';
import { attachDnD } from '../../src/editor/dnd/index.js';
import { DND_MIME, DRAGGING_CLASS } from '../../src/editor/dnd/index.js';
import { dropIndicatorVisible, hideDropIndicator } from '../../src/editor/dnd/index.js';

// ── hosts ────────────────────────────────────────────────────────────────────
class FactsHost extends SemElement {}
class FactHost extends SemElement {}
class NoteHost extends SemElement {}
SemElement.register('sem-facts', FactsHost);
SemElement.register('sem-fact', FactHost);
SemElement.register('sem-note', NoteHost);

const FLUSH = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

const SRC = [
  '<sem-facts id="fx">',
  '<sem-fact id="a"><statement>one</statement></sem-fact>',
  '<sem-fact id="b"><statement>two</statement></sem-fact>',
  '<sem-fact id="c"><statement>three</statement></sem-fact>',
  '</sem-facts>',
  '<sem-note id="nt">body</sem-note>',
  '<sem-facts id="fy"><sem-fact id="d"><statement>four</statement></sem-fact></sem-facts>',
].join('');

// ── synthetic-event helpers ──────────────────────────────────────────────────
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const dt = {
    setData(type: string, value: string): void {
      store.set(type, value);
    },
    getData(type: string): string {
      return store.get(type) ?? '';
    },
    dropEffect: 'none',
    effectAllowed: 'all',
  };
  return dt as unknown as DataTransfer;
}

/** Dispatch a drag-phase event; DragEvent when the env has one, else a
 *  bubbling Event carrying the transfer + coordinates. */
function fireDrag(target: Element, type: string, dt: DataTransfer, x = 0, y = 0): DragEvent {
  let e: DragEvent;
  try {
    e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'dataTransfer', { value: dt });
  } catch {
    e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y }) as unknown as DragEvent;
  }
  target.dispatchEvent(e);
  return e;
}

/** Pin a viewport rect on an element (happy-dom answers zeros). */
function pinRect(el: Element, top: number, bottom: number): void {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({
      left: 0,
      top,
      right: 200,
      bottom,
      width: 200,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

interface Rig {
  ctx: EditorContext;
  detach: () => void;
  announcements: string[];
  setPointer(el: Element | null): void;
  chip(id: string): Element;
  modelOrder(containerId: string): string[];
  id(tag: string, withId: string): string;
}

function rig(): Rig {
  const wrap = document.createElement('div');
  wrap.innerHTML = SRC;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  const announcements: string[] = [];
  const ctx = createContext({ doc: createDocument(SRC), announce: (m: string) => announcements.push(m) });
  for (const id of ['fx', 'nt', 'fy']) {
    const host = document.getElementById(id) as SemElement;
    if (attachEditor(host, ctx) === null) throw new Error('attach failed: ' + id);
  }
  const detachDnD = attachDnD();

  // Pointer stub — the DnD lane resolves drops through elementFromPoint.
  let pointer: Element | null = null;
  const docAny = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  const original = docAny.elementFromPoint;
  docAny.elementFromPoint = () => pointer;

  // Geometry: fx at 0..300 (facts a/b/c 0..100/100..200/200..300), note at
  // 300..400, fy at 400..500.
  for (const [id, top, bottom] of [
    ['fx', 0, 300],
    ['a', 0, 100],
    ['b', 100, 200],
    ['c', 200, 300],
    ['nt', 300, 400],
    ['fy', 400, 500],
    ['d', 400, 500],
  ] as [string, number, number][]) {
    const el = document.getElementById(id);
    if (el !== null) pinRect(el, top, bottom);
  }

  function findInModel(tag: string, withId: string): string {
    const walk = (n: import('../../src/editor/model/index.js').EditorNode): string | null => {
      if (n.kind === 'element' && n.name === tag && n.attrs.some((at) => at.name === 'id' && at.value === withId)) return n.id;
      if ('children' in n) {
        for (const c of n.children) {
          const hit = walk(c);
          if (hit !== null) return hit;
        }
      }
      return null;
    };
    const hit = walk(ctx.doc.root);
    if (hit === null) throw new Error(`no <${tag} id="${withId}"> in the model`);
    return hit;
  }

  return {
    ctx,
    announcements,
    detach: () => {
      detachDnD();
      docAny.elementFromPoint = original;
    },
    setPointer(el: Element | null) {
      pointer = el;
    },
    /** The chip handle for an element (chrome paints them in edit mode; the
     *  rig guarantees one marked chip as a direct child either way). */
    chip(id: string): Element {
      const host = document.getElementById(id);
      if (host === null) throw new Error('no element ' + id);
      let chip = host.querySelector(':scope .sem-ed-chip');
      if (chip === null) {
        chip = document.createElement('span');
        chip.className = 'sem-ed-chip';
        chip.setAttribute('data-sem-chrome', '');
        host.insertBefore(chip, host.firstChild);
      }
      return chip;
    },
    modelOrder(containerId: string): string[] {
      return ctx.doc
        .childrenOf(containerId)
        .filter((n) => n.kind === 'element')
        .map((n) => (n.kind === 'element' ? n.attrs.find((at) => at.name === 'id')?.value ?? n.name : ''))
        .filter((v) => v !== '' && /^[a-z]$/.test(v));
    },
    id: findInModel,
  };
}

function modelOrderOf(rigb: Rig, containerId: string): string[] {
  return rigb.modelOrder(containerId);
}

let rigb: Rig;

beforeEach(() => {
  document.body.innerHTML = '';
  hideDropIndicator();
  rigb = rig();
});

afterEach(async () => {
  rigb.detach();
  await FLUSH();
  document.querySelectorAll('sem-facts, sem-fact, sem-note').forEach((n) => detachEditor(n as SemElement));
  document.body.innerHTML = '';
  hideDropIndicator();
});

const FX = () => rigb.id('sem-facts', 'fx');
const FY = () => rigb.id('sem-facts', 'fy');
const NT = () => rigb.id('sem-note', 'nt');

describe('handle acquisition by delegation', () => {
  it('mousedown on a chip flips draggable on (no controller seam)', () => {
    const chip = rigb.chip('b');
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect((chip as HTMLElement).draggable).toBe(true);
  });

  it('dragstart carries the node id under the sem MIME, never HTML', () => {
    const chip = rigb.chip('b');
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const dt = fakeDataTransfer();
    const host = document.getElementById('b')!;
    rigb.setPointer(host);
    fireDrag(chip, 'dragstart', dt);
    expect(dt.getData(DND_MIME)).toBe(rigb.id('sem-fact', 'b'));
    expect(dt.getData(DND_MIME)).not.toContain('<');
    expect(dt.effectAllowed).toBe('move');
    expect(host.classList.contains(DRAGGING_CLASS)).toBe(true);
  });

  it('the drag targets the chip OWN element, not the binding host', () => {
    // b's chip lives inside the fx host — the payload must be b's id.
    const chip = rigb.chip('b');
    const dt = fakeDataTransfer();
    rigb.setPointer(document.getElementById('b')!);
    fireDrag(chip, 'dragstart', dt);
    expect(dt.getData(DND_MIME)).toBe(rigb.id('sem-fact', 'b'));
    expect(dt.getData(DND_MIME)).not.toBe(rigb.id('sem-facts', 'fx'));
  });
});

describe('indicators + drops', () => {
  it('permitted dragover shows the dropline; drop performs ONE move and announces', async () => {
    const chip = rigb.chip('b');
    const dt = fakeDataTransfer();
    const hostB = document.getElementById('b')!;
    rigb.setPointer(hostB);
    fireDrag(chip, 'dragstart', dt);

    // Pointer at y=20: above a's midpoint → slot 0 → b before a.
    const hostA = document.getElementById('a')!;
    rigb.setPointer(hostA);
    fireDrag(chip, 'dragover', dt, 20, 20);
    expect(dropIndicatorVisible()).toBe(true);
    expect(dt.dropEffect).toBe('move');

    fireDrag(chip, 'drop', dt, 20, 20);
    await FLUSH();
    expect(modelOrderOf(rigb, FX())).toEqual(['b', 'a', 'c']);
    expect(rigb.ctx.doc.history().length).toBe(1); // ONE transaction
    expect(rigb.announcements.some((m) => /Moved .+ to position 1/.test(m))).toBe(true);
    expect(dropIndicatorVisible()).toBe(false);
    expect(hostB.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('refused container: no dropline, dropEffect none, drop no-ops', () => {
    const chip = rigb.chip('b');
    const dt = fakeDataTransfer();
    rigb.setPointer(document.getElementById('b')!);
    fireDrag(chip, 'dragstart', dt);

    const note = document.getElementById('nt')!;
    rigb.setPointer(note);
    fireDrag(chip, 'dragover', dt, 20, 350);
    expect(dropIndicatorVisible()).toBe(false);
    expect(dt.dropEffect).toBe('none');

    fireDrag(chip, 'drop', dt, 20, 350);
    expect(rigb.ctx.doc.history().length).toBe(0);
    expect(modelOrderOf(rigb, FX())).toEqual(['a', 'b', 'c']); // untouched
    expect(rigb.ctx.doc.node(rigb.id('sem-fact', 'b'))?.parentId).not.toBe(NT());
  });

  it('drop onto a second container host appends (companion admit)', async () => {
    const chip = rigb.chip('a');
    const dt = fakeDataTransfer();
    rigb.setPointer(document.getElementById('a')!);
    fireDrag(chip, 'dragstart', dt);

    const fyHost = document.getElementById('fy')!;
    rigb.setPointer(fyHost);
    fireDrag(chip, 'dragover', dt, 20, 450);
    expect(dropIndicatorVisible()).toBe(true);
    fireDrag(chip, 'drop', dt, 20, 450);
    await FLUSH();
    expect(modelOrderOf(rigb, FY())).toEqual(['d', 'a']); // appended after d
    expect(modelOrderOf(rigb, FX())).toEqual(['b', 'c']);
    expect(rigb.announcements.some((m) => /Moved .+ into sem-facts/.test(m))).toBe(true);
  });

  it('Escape cancels the pending drop', () => {
    const chip = rigb.chip('b');
    const dt = fakeDataTransfer();
    rigb.setPointer(document.getElementById('a')!);
    fireDrag(chip, 'dragstart', dt);
    fireDrag(chip, 'dragover', dt, 20, 20);
    expect(dropIndicatorVisible()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(dropIndicatorVisible()).toBe(false);

    fireDrag(chip, 'drop', dt, 20, 20);
    expect(rigb.ctx.doc.history().length).toBe(0);
    expect(modelOrderOf(rigb, FX())).toEqual(['a', 'b', 'c']);
  });

  it('dragend cleans up dimming and the indicator', () => {
    const chip = rigb.chip('b');
    const dt = fakeDataTransfer();
    const hostB = document.getElementById('b')!;
    rigb.setPointer(hostB);
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); // handle acquisition
    expect((chip as HTMLElement).draggable).toBe(true);
    fireDrag(chip, 'dragstart', dt);
    fireDrag(chip, 'dragover', dt, 20, 20);
    expect(dropIndicatorVisible()).toBe(true);

    fireDrag(chip, 'dragend', dt);
    expect(hostB.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(dropIndicatorVisible()).toBe(false);
    expect((chip as HTMLElement).draggable).toBe(false); // handle released
    expect(rigb.ctx.doc.history().length).toBe(0);
  });
});
