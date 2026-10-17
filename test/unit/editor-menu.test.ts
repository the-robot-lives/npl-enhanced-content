// @vitest-environment happy-dom
// Unit spec — editor context menu (EDITOR.md §4.7): additive reuse of the
// terminal menu, editor verb ids/order, terminal seams inert, shift
// passthrough.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ContextMenuController } from '../../src/terminal/menu/context-menu.js';
import { buildEditorMenuItems, createEditorMenuHost, EDITOR_MENU_IDS } from '../../src/editor/controller/menu.js';
import { attachEditor, createContext, detachEditor } from '../../src/editor/controller/attach.js';
import '../../src/lit/sem-note.js';
import { SemNote } from '../../src/lit/sem-note.js';
import type { EditorContext } from '../../src/editor/controller/types.js';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

function makeNote(markup = '<sem-note variant="info"><span class="sem-note-body">Hello</span></sem-note>'): {
  el: SemNote; ctx: EditorContext;
} {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as SemNote;
  document.body.appendChild(el);
  const ctx = createContext();
  const controller = attachEditor(el, ctx);
  if (controller === null) throw new Error('attach failed');
  return { el, ctx };
}

let menu: ContextMenuController | null = null;

describe('editor context menu (§4.7)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    menu?.close();
    menu = null;
    document.querySelectorAll('sem-note').forEach((n) => detachEditor(n as SemNote));
  });

  it('exposes the ten editor verbs in contract order and labels', () => {
    const { el, ctx } = makeNote();
    const binding = { el, rootId: 'x', descriptor: null, editingSlot: null, controller: null } as never;
    void binding;
    const controller = attachEditor(el, ctx)!;
    const items = buildEditorMenuItems(ctx, controller.binding);
    expect(items.map((i) => i.id)).toEqual([...EDITOR_MENU_IDS]);
    expect(items.map((i) => i.label)).toEqual([
      'Properties…', 'Edit', 'Duplicate', 'Move up', 'Move down',
      'Wrap in…', 'Convert to…', 'Insert before…', 'Insert after…', 'Delete',
    ]);
  });

  it('renders through the terminal menu with editor data-menu-ids', () => {
    const { el, ctx } = makeNote();
    const controller = attachEditor(el, ctx)!;
    menu = new ContextMenuController(createEditorMenuHost(el), {
      items: (host) => buildEditorMenuItems(ctx, controller.binding),
    });
    menu.open({ x: 10, y: 10 });
    const el_menu = document.querySelector('.sem-term-menu');
    expect(el_menu).not.toBeNull();
    const ids = Array.from(document.querySelectorAll('[data-menu-id]')).map((b) => b.getAttribute('data-menu-id'));
    expect(ids).toEqual([...EDITOR_MENU_IDS]);
  });

  it('disable-with-hint rows for shell pickers; Delete/Duplicate always enabled', () => {
    const { el, ctx } = makeNote();
    const controller = attachEditor(el, ctx)!;
    const items = buildEditorMenuItems(ctx, controller.binding);
    for (const id of ['wrap-in', 'convert-to', 'insert-before', 'insert-after']) {
      const item = items.find((i) => i.id === id)!;
      expect(item.disabled).toBe(true);
      expect(item.hint).toBe('no shell');
    }
    for (const id of ['delete', 'duplicate', 'properties']) {
      expect(items.find((i) => i.id === id)!.disabled).toBe(false);
    }
  });

  it('activate duplicate inserts a sibling copy; activate delete removes the element', async () => {
    const { el, ctx } = makeNote();
    const controller = attachEditor(el, ctx)!;
    const items = buildEditorMenuItems(ctx, controller.binding);
    items.find((i) => i.id === 'duplicate')!.activate(createEditorMenuHost(el));
    await flush();
    expect(ctx.doc.root.children.length).toBe(2);
    items.find((i) => i.id === 'delete')!.activate(createEditorMenuHost(el));
    await flush();
    expect(ctx.doc.root.children.length).toBe(1);
  });

  it('terminal seams are no-op/false (Copy row disabled, host never throws)', () => {
    const host = createEditorMenuHost(document.createElement('div'));
    expect(host.copySelection()).toBe(false);
    expect(host.canvasAvailable()).toBe(false);
    expect(host.findAvailable()).toBe(false);
    expect(() => host.selectAll()).not.toThrow();
    expect(() => host.pasteFromClipboard()).not.toThrow();
    expect(() => host.armBrowserPassthrough()).not.toThrow();
  });

  it('Shift+right-click passthrough: the custom menu never opens', () => {
    const { el, ctx } = makeNote();
    attachEditor(el, ctx);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: 5, clientY: 5 }));
    expect(document.querySelector('.sem-term-menu')).toBeNull();
  });

  it('plain right-click opens the menu with editor verbs', () => {
    const { el, ctx } = makeNote();
    attachEditor(el, ctx);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(document.querySelector('.sem-term-menu')).not.toBeNull();
    const ids = Array.from(document.querySelectorAll('[data-menu-id]')).map((b) => b.getAttribute('data-menu-id'));
    expect(ids).toContain('properties');
    expect(ids).toContain('delete');
  });
});
