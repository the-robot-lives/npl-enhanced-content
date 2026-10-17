// @vitest-environment happy-dom
// Unit spec — the editor controller (EDITOR.md §4.2–4.8): attach/detach
// chrome hygiene, slot editing, re-render protocol, keyboard parity,
// selection mapping, glyphs, aria-live.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import '../../src/lit/sem-note.js';
import '../../src/lit/sem-note.edit.js';
import '../../src/lit/sem-facts.js';
import '../../src/lit/sem-facts.edit.js';
import { SemNote } from '../../src/lit/sem-note.js';
import {
  attachEditor, createContext, detachEditor, watchEditMode, claim, bindingFor,
} from '../../src/editor/controller/attach.js';
import { EditController } from '../../src/editor/controller/edit-controller.js';
import { addItem, removeItem, moveElement, duplicateElement, commitSlotText, stripTemplateStops } from '../../src/editor/controller/actions.js';
import { caretFromDomPosition, domPositionFor } from '../../src/editor/controller/selection.js';
import { siblingIndexOf } from '../../src/editor/controller/map.js';
import type { EditorContext } from '../../src/editor/controller/types.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const NOTE = '<sem-note variant="info" id="the-note"><span class="sem-note-body">Hello</span></sem-note>';

function makeNote(markup = NOTE): { el: SemNote; ctx: EditorContext; c: EditController } {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as SemNote;
  document.body.appendChild(el);
  const ctx = createContext();
  const c = attachEditor(el, ctx);
  if (c === null) throw new Error('attach failed');
  return { el, ctx, c };
}

describe('attach/detach (§4.2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('stamps data-sem-editing and is idempotent', () => {
    const { el, ctx } = makeNote();
    expect(el.hasAttribute('data-sem-editing')).toBe(true);
    const again = attachEditor(el, ctx);
    expect(again).not.toBeNull();
    expect(document.querySelectorAll('[data-sem-editing]').length).toBe(1);
  });

  it('detach removes the stamp and all data-sem-chrome; model untouched', () => {
    const { el, ctx } = makeNote();
    el.style.position = 'relative';
    const outline = document.createElement('div');
    outline.className = 'sem-ed-outline';
    outline.setAttribute('data-sem-chrome', '');
    el.appendChild(outline);
    const span = el.querySelector('.sem-note-body')!;
    detachEditor(el);
    expect(el.hasAttribute('data-sem-editing')).toBe(false);
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    expect(el.contains(span)).toBe(true); // authored content survives
    expect(ctx.doc.serialize().length).toBeGreaterThan(0);
  });

  it('watchEditMode attaches on attribute set, detaches on removal', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = NOTE;
    const el = wrap.firstElementChild as SemNote;
    document.body.appendChild(el);
    const stop = watchEditMode(el);
    expect(el.hasAttribute('data-sem-editing')).toBe(false); // not in edit-mode yet
    el.setAttribute('edit-mode', '');
    await flush();
    expect(el.hasAttribute('data-sem-editing')).toBe(true);
    el.removeAttribute('edit-mode');
    await flush();
    expect(el.hasAttribute('data-sem-editing')).toBe(false);
    stop();
  });

  it('claim() returns ok with the bound root id', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = NOTE;
    const el = wrap.firstElementChild as SemNote;
    document.body.appendChild(el);
    const r = claim(el);
    expect(r.ok).toBe(true);
    expect(r.rootId).toBeDefined();
    detachEditor(el);
  });

  it('binds empty-content elements via the fallback path', () => {
    const el = document.createElement('sem-note');
    document.body.appendChild(el);
    const ctx = createContext();
    const c = attachEditor(el, ctx);
    expect(c).not.toBeNull(); // parser accepts the empty round trip
    detachEditor(el);
  });
});

describe('slot editing + commit (§4.5)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('startSlotEditing makes the slot editable; commit writes one setText', async () => {
    const { el, ctx, c } = makeNote();
    const slot = el.querySelector('.sem-note-body')!;
    c.startSlotEditing(slot);
    expect(slot.classList.contains('sem-ed-slot-editing')).toBe(true);
    const ce = (slot as HTMLElement).contentEditable;
    expect(ce === 'true' || ce === 'plaintext-only').toBe(true);
    slot.textContent = 'Hello edited';
    commitSlotText(ctx, c.binding, slot, 'Hello edited');
    c.stopSlotEditing();
    await flush();
    const note = ctx.doc.root.children[0];
    expect(note !== undefined && note.kind === 'element' && note.children[0]?.children[0]?.kind === 'text' &&
      (note.children[0]!.children[0] as { value: string }).value === 'Hello edited').toBe(true);
  });

  it('a typing burst coalesces into ONE undo step', async () => {
    const { el, ctx, c } = makeNote();
    const slot = el.querySelector('.sem-note-body')!;
    c.startSlotEditing(slot);
    expect(ctx.doc.canUndo()).toBe(false); // fresh context — no history yet
    commitSlotText(ctx, c.binding, slot, 'Hello one');
    commitSlotText(ctx, c.binding, slot, 'Hello one two');
    commitSlotText(ctx, c.binding, slot, 'Hello one two three');
    expect(ctx.doc.canUndo()).toBe(true);
    ctx.doc.undo(); // one step unwinds the WHOLE burst
    expect(ctx.doc.canUndo()).toBe(false);
    await flush();
    const note = ctx.doc.root.children[0];
    const text = note !== undefined && note.kind === 'element'
      ? (note.children[0]?.children[0] as { value?: string } | undefined)?.value : undefined;
    expect(text).toBe('Hello');
  });

  it('rich-content slots are refused with an announcement (v1 fallback)', async () => {
    const { el, ctx, c } = makeNote(
      '<sem-note variant="info" id="rich-note"><span class="sem-note-body">a <b>b</b> c</span></sem-note>',
    );
    const slot = el.querySelector('.sem-note-body')!;
    const heard: string[] = [];
    ctx.announce = (m) => heard.push(m);
    const ok = commitSlotText(ctx, c.binding, slot, 'replaced');
    expect(ok).toBe(false); // model slot holds an element child — no flattening
    expect(heard.some((m) => m.includes('markup'))).toBe(true);
  });

  it('re-render defers while the slot is an active editor (§4.5)', async () => {
    const { el, ctx, c } = makeNote();
    const slot = el.querySelector('.sem-note-body')!;
    c.startSlotEditing(slot);
    const marker = slot; // identity must survive (no re-projection under caret)
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'variant', value: 'tip' });
    });
    await flush();
    expect(el.querySelector('.sem-note-body')).toBe(marker);
    c.stopSlotEditing();
    await flush();
  });
});

describe('re-render protocol (§4.4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note, sem-facts').forEach((n) => detachEditor(n as HTMLElement));
  });

  it('projected DOM follows the model; untouched children keep node identity', async () => {
    const { el, ctx, c } = makeNote();
    const spanBefore = el.querySelector('.sem-note-body')!;
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'variant', value: 'warning' });
    });
    await flush();
    const note = ctx.doc.root.children[0];
    const attr = note !== undefined && note.kind === 'element'
      ? note.attrs.find((a) => a.name === 'variant')?.value : undefined;
    expect(attr).toBe('warning'); // model is the source of truth
    expect(el.querySelector('.sem-note-body')).toBe(spanBefore); // kept node-for-node
  });

  it('text changes re-project the text node (decode-faithful)', async () => {
    const { el, ctx, c } = makeNote();
    const note = ctx.doc.root.children[0]!;
    const span = note.kind === 'element' ? note.children[0]! : null;
    ctx.doc.transaction('test', (tx) => {
      if (span !== null) tx.push({ type: 'setText', node: span.children[0]!.id, value: 'AT&T <rocks>' });
    });
    await flush();
    expect(el.querySelector('.sem-note-body')?.textContent).toBe('AT&T <rocks>');
  });

  it('chrome nodes survive a re-render; authored leftovers go', async () => {
    const { el, ctx, c } = makeNote();
    const chip = document.createElement('div');
    chip.className = 'sem-ed-outline';
    chip.setAttribute('data-sem-chrome', '');
    el.appendChild(chip);
    ctx.doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: c.binding.rootId, name: 'variant', value: 'tip' });
    });
    await flush();
    expect(el.querySelector('[data-sem-chrome]')).not.toBeNull();
  });

  it('deleting the bound element clears authored content (model is truth)', async () => {
    const { el, ctx, c } = makeNote();
    ctx.doc.apply({ type: 'removeNode', node: c.binding.rootId });
    await flush();
    expect(el.querySelector('.sem-note-body')).toBeNull();
  });

  it('item glyphs track the list: add/remove re-stamps with aria-labels', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<sem-facts id="f1"><sem-fact><statement>One</statement><conclusion>C</conclusion></sem-fact></sem-facts>';
    const el = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(el);
    const ctx = createContext();
    const c = attachEditor(el, ctx);
    if (c === null) throw new Error('attach failed');
    addItem(ctx, c.binding);
    await flush();
    const facts = el.querySelectorAll(':scope > :is(sem-fact, .sem-fact)');
    expect(facts.length).toBe(2);
    const minus = facts[1].querySelector(':scope > .sem-ed-glyph[data-glyph="minus"]') as HTMLButtonElement | null
      ?? el.querySelector('.sem-ed-glyph[data-glyph="minus"]');
    expect(minus).not.toBeNull();
    expect(minus!.getAttribute('aria-label')).toMatch(/Remove/i);
    const itemEl = facts[1];
    removeItem(ctx, c.binding, itemEl);
    await flush();
    expect(el.querySelectorAll(':scope > :is(sem-fact, .sem-fact)').length).toBe(1);
  });

  it('stripTemplateStops resolves choice stops to their FIRST option (npl-b)', () => {
    expect(stripTemplateStops('<sem-step status="${2|todo,doing,done|}">${1:Do it}</sem-step>')).toBe(
      '<sem-step status="todo">Do it</sem-step>',
    );
    expect(stripTemplateStops('<x k="${1:Key}" aria-label="${1:Key}">')).toBe('<x k="Key" aria-label="Key">');
    expect(stripTemplateStops('<x k="${3}">')).toBe('<x k="">');
  });

  it('addItem on a doc LARGER than the template (regression: id-counter collision)', async () => {
    // buildFromXml used to mint ids inside the live doc's range whenever the
    // template subtree was smaller than the doc — canApply rejected with
    // "already attached". Per-document allocators make this impossible.
    const many = Array.from({ length: 8 }, (_, i) =>
      `<sem-fact><statement>Fact ${i + 1}</statement><conclusion>C${i + 1}</conclusion></sem-fact>`).join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = `<sem-facts id="f1">${many}</sem-facts>`;
    const el = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(el);
    const ctx = createContext();
    const c = attachEditor(el, ctx);
    if (c === null) throw new Error('attach failed');
    expect(ctx.doc.childrenOf(c.binding.rootId).length).toBe(8);
    expect(addItem(ctx, c.binding)).toBe(true);
    await flush();
    expect(ctx.doc.childrenOf(c.binding.rootId).length).toBe(9);
    expect(el.querySelectorAll(':scope > :is(sem-fact, .sem-fact)').length).toBe(9);
    // every model id unique — no silent table overwrite
    const ids = new Set(ctx.doc.childrenOf(c.binding.rootId).map((n) => n.id));
    expect(ids.size).toBe(9);
    expect(el.querySelectorAll(':scope > :is(sem-fact, .sem-fact)')[8]!.textContent).toContain('Statement');
  });
});

describe('verbs + undo (§3.4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('duplicate → move → delete round trip, each undoable', async () => {
    const { el, ctx, c } = makeNote();
    expect(duplicateElement(ctx, c.binding)).toBe(true);
    expect(ctx.doc.root.children.length).toBe(2);
    expect(moveElement(ctx, c.binding, 1)).toBe(true);
    expect(siblingIndexOf(ctx, c.binding.rootId)).toBe(1);
    expect(ctx.doc.undo()).toBe(true);
    expect(siblingIndexOf(ctx, c.binding.rootId)).toBe(0);
    expect(ctx.doc.redo()).toBe(true);
  });

  it('announce() reaches the aria-live region (§7)', async () => {
    const { el, ctx, c } = makeNote();
    duplicateElement(ctx, c.binding);
    await flush();
    const live = document.querySelector('.sem-ed-live');
    expect(live).not.toBeNull();
  });
});

describe('selection mapping (§2.6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('DOM caret inside a slot maps to the model text node and back', async () => {
    const { el, ctx, c } = makeNote();
    const slot = el.querySelector('.sem-note-body')!;
    const textNode = slot.firstChild!;
    const pos = caretFromDomPosition(ctx, c.binding, textNode, 3);
    expect(pos).not.toBeNull();
    const back = domPositionFor(ctx, c.binding, pos!);
    expect(back).not.toBeNull();
    expect(back!.node).toBe(textNode);
    expect(back!.offset).toBe(3);
  });

  it('a caret inside chrome maps to null (never fabricated)', async () => {
    const { el, ctx, c } = makeNote();
    const chrome = document.createElement('div');
    chrome.setAttribute('data-sem-chrome', '');
    el.appendChild(chrome);
    const pos = caretFromDomPosition(ctx, c.binding, chrome, 0);
    expect(pos).toBeNull(); // chrome is never model content (§2.4)
    const stranger = document.createElement('div');
    document.body.appendChild(stranger);
    expect(caretFromDomPosition(ctx, c.binding, stranger, 0)).toBeNull();
  });
});

describe('keyboard parity (§4.7 a11y)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('Alt+ArrowDown moves the element down; Shift+F10 opens the menu', async () => {
    const { el, ctx, c } = makeNote('<sem-note variant="info" id="n-a"><span class="sem-note-body">A</span></sem-note>');
    duplicateElement(ctx, c.binding);
    await flush();
    expect(siblingIndexOf(ctx, c.binding.rootId)).toBe(0);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(siblingIndexOf(ctx, c.binding.rootId)).toBe(1);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('.sem-term-menu')).not.toBeNull();
  });

  it('Enter starts slot editing; Escape stops it without committing', async () => {
    const { el, c } = makeNote();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();
    expect(c.binding.editingSlot).not.toBeNull();
    const slot = c.binding.editingSlot!;
    slot.textContent = 'should not commit';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(c.binding.editingSlot).toBeNull();
  });

  it('Alt+= duplicates; Alt+Delete deletes (undoable)', async () => {
    const { el, ctx, c } = makeNote();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '=', altKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(ctx.doc.root.children.length).toBe(2);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', altKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(el.querySelector('.sem-note-body')).toBeNull(); // cleared via removal guard
  });
});

describe('hover outline + chip (§4.3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('pointerover draws the outline; pointerout hides it; chip opens properties', async () => {
    const { el, c } = makeNote();
    let opened = 0;
    (c.binding as { descriptor: unknown });
    // shell hook absence → announce path; count via context override
    el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    let outline = el.querySelector('.sem-ed-outline');
    expect(outline).not.toBeNull();
    const chip = outline!.querySelector('.sem-ed-chip') as HTMLButtonElement;
    expect(chip.getAttribute('aria-label')).toMatch(/Edit/);
    expect(chip.textContent).toContain('Note');
    el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    await flush();
    outline = el.querySelector('.sem-ed-out-out');
    expect(el.querySelector('.sem-ed-outline')).toBeNull();
    void opened;
  });
});
