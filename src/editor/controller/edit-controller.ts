/**
 * controller/edit-controller — the per-element ReactiveController (§4).
 *
 * Wires one bound element: hover/focus outline + chip, context menu
 * (right-click + Shift+F10, Shift+right-click = browser passthrough),
 * keyboard verbs (§4.7 a11y parity: Alt+arrows move, Alt+= duplicate,
 * Alt+Delete delete, Enter/F2 edit slot, Esc cancel), inline slot editing
 * (§4.5 plaintext-only), Mod+K link popover, item glyphs, and the doc
 * `change` subscription driving the §4.4 re-render protocol.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { EditorContext, ElementBinding } from './types.js';
import { ContextMenuController } from '../../terminal/menu/context-menu.js';
import { affectsBinding, scheduleRerender, setPostRerenderHook } from './rerender.js';
import { modelIdFor, resolveSlotEl, slotForElement } from './map.js';
import { buildEditorMenuItems, createEditorMenuHost } from './menu.js';
import {
  clearChrome, closeLinkPopover, hideOutline, showOutline, stampGlyphs, stampHost,
} from './chrome.js';

export class EditController implements ReactiveController {
  readonly ctx: EditorContext;
  readonly binding: ElementBinding;
  private host: ReactiveControllerHost;
  private menu: ContextMenuController | null = null;
  private unsubs: Array<() => void> = [];
  private origSlotEditable: string | null = null;

  constructor(host: ReactiveControllerHost, ctx: EditorContext, binding: ElementBinding) {
    this.host = host;
    this.ctx = ctx;
    this.binding = binding;
    host.addController(this);
  }

  // ── ReactiveController lifecycle ──────────────────────────────────────────

  hostConnected(): void {
    stampHost(this.binding);
    this.wireDom();
    this.wireDoc();
  }

  hostDisconnected(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.stopSlotEditing();
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
    clearChrome(this.binding);
  }

  // ── DOM wiring ─────────────────────────────────────────────────────────────

  private wireDom(): void {
    const el = this.binding.el;
    // Context menu: right-click and Shift+F10; Shift+right-click passes through.
    const onContext = (e: MouseEvent): void => {
      if (e.shiftKey) return; // browser passthrough (§4.7)
      e.preventDefault();
      this.openMenu(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!this.onKeydown(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onOver = (e: Event): void => {
      const t = e.target as Element;
      if (t === el || el.contains(t)) showOutline(this.binding, t instanceof Element ? t : el);
    };
    const onOut = (e: Event): void => {
      const to = (e as MouseEvent).relatedTarget;
      if (!(to instanceof Element) || !el.contains(to)) hideOutline(this.binding);
    };
    const onFocusIn = (e: Event): void => {
      const t = e.target as Element;
      if (t instanceof Element) showOutline(this.binding, t);
    };
    const onRemoved = (): void => {
      void import('./attach.js').then((m) => m.detachEditor(el));
    };
    const onDblClick = (e: MouseEvent): void => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const slot = slotForElement(this.binding, t);
      if (slot === null) return;
      const slotEl = resolveSlotEl(this.binding, slot);
      if (slotEl !== null) this.startSlotEditing(slotEl);
    };
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerover', onOver);
    el.addEventListener('pointerout', onOut);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('semtext-editor-removed', onRemoved);
    this.unsubs.push(() => {
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerover', onOver);
      el.removeEventListener('pointerout', onOut);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('semtext-editor-removed', onRemoved);
    });
  }

  private wireDoc(): void {
    const off = this.ctx.doc.on('change', (e) => {
      if (!affectsBinding(this.ctx, this.binding, [...e.transaction.touched])) return;
      scheduleRerender(this.ctx, this.binding, [...e.transaction.touched]);
    });
    this.unsubs.push(off);
  }

  private openMenu(x: number, y: number): void {
    if (this.menu === null) {
      this.menu = new ContextMenuController(createEditorMenuHost(this.binding.el), {
        items: (host) => buildEditorMenuItems(this.ctx, this.binding),
      });
      this.menu.attach();
    }
    this.menu.open({ x, y });
  }

  // ── keyboard verbs (§4.7 parity with the context menu) ────────────────────

  private onKeydown(e: KeyboardEvent): boolean {
    const el = this.binding.el;
    const mod = e.altKey && !e.metaKey && !e.ctrlKey;
    if (e.key === 'F10' && e.shiftKey) {
      const r = el.getBoundingClientRect();
      this.openMenu(r.left + 4, r.top + 4);
      return true;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      this.openLinkPopoverForField();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.binding.editingSlot !== null) {
        this.stopSlotEditing();
        return true;
      }
      closeLinkPopover(this.binding);
      return false;
    }
    if ((e.key === 'Enter' || e.key === 'F2') && !mod) {
      const slot = this.binding.descriptor?.textSlots?.[0];
      const slotEl = slot !== undefined ? resolveSlotEl(this.binding, slot) : null;
      if (slotEl !== null) {
        this.startSlotEditing(slotEl);
        return true;
      }
      if (this.ctx.shell?.openProperties) this.ctx.shell.openProperties(this.binding);
      return false;
    }
    if (!mod) return false;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        void import('./actions.js').then((m) => m.moveElement(this.ctx, this.binding, -1));
        return true;
      case 'ArrowDown':
      case 'ArrowRight':
        void import('./actions.js').then((m) => m.moveElement(this.ctx, this.binding, 1));
        return true;
      case '=':
      case '+':
        void import('./actions.js').then((m) => m.duplicateElement(this.ctx, this.binding));
        return true;
      case 'Delete':
        void import('./actions.js').then((m) => m.deleteElement(this.ctx, this.binding));
        return true;
      default:
        return false;
    }
  }

  private openLinkPopoverForField(): void {
    void import('./chrome.js').then((c) => {
      const field = this.binding.descriptor?.linkFields?.[0];
      if (field === undefined) {
        this.ctx.announce('No link field on this element');
        return;
      }
      c.openLinkPopover(this.ctx, this.binding, field);
    });
  }

  // ── inline slot editing (§4.5) ─────────────────────────────────────────────

  startSlotEditing(slotEl: Element): void {
    const b = this.binding;
    if (b.editingSlot === slotEl) return;
    this.stopSlotEditing();
    const supported = 'contentEditable' in slotEl;
    this.origSlotEditable = (slotEl as HTMLElement).contentEditable;
    try {
      (slotEl as HTMLElement).contentEditable = 'plaintext-only';
    } catch {
      /* older engines */
    }
    if ((slotEl as HTMLElement).contentEditable !== 'plaintext-only' && supported) {
      (slotEl as HTMLElement).contentEditable = 'true';
      const onPaste = (ev: Event): void => {
        const ce = ev as ClipboardEvent;
        ce.preventDefault();
        const text = ce.clipboardData?.getData('text/plain') ?? '';
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertText', false, text); // §8 sanitized paste
        }
      };
      (slotEl as HTMLElement).addEventListener('paste', onPaste);
      this.unsubs.push(() => (slotEl as HTMLElement).removeEventListener('paste', onPaste));
    }
    slotEl.classList.add('sem-ed-slot-editing');
    b.editingSlot = slotEl;
    const commit = (): void => {
      if (b.editingSlot !== slotEl) return;
      const id = modelIdFor(this.ctx, b, slotEl);
      void import('./actions.js').then((m) => {
        if (id !== null) m.commitSlotText(this.ctx, b, slotEl, slotEl.textContent ?? '');
      });
      this.stopSlotEditing();
    };
    slotEl.addEventListener('blur', commit, { once: true });
    const onSlotKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.stopSlotEditing();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    };
    (slotEl as HTMLElement).addEventListener('keydown', onSlotKey);
    (slotEl as HTMLElement).focus();
    this.unsubs.push(() => (slotEl as HTMLElement).removeEventListener('keydown', onSlotKey));
  }

  stopSlotEditing(): void {
    const b = this.binding;
    if (b.editingSlot === null) return;
    const slotEl = b.editingSlot;
    (slotEl as HTMLElement).contentEditable = this.origSlotEditable ?? 'inherit';
    slotEl.classList.remove('sem-ed-slot-editing');
    b.editingSlot = null;
    (slotEl as HTMLElement).blur();
    // Re-project whatever queued up while the caret held the slot (§4.5).
    scheduleRerender(this.ctx, b, [b.rootId]);
  }
}

/** Install the shared post-rerender glyph re-stamp once per context. */
export function installPostRerenderStamp(ctx: EditorContext): void {
  setPostRerenderHook(async (c, binding) => stampGlyphs(c, binding));
}
