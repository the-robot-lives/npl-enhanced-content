/**
 * dnd/drag — HTML5 drag & drop over the edit-mode canvas (EDITOR.md §5.6).
 *
 * The drag handle is the label chip the controller already paints (§4.3);
 * the controller has no chrome hook yet, so the lane acquires it by
 * delegation: mousedown on a chip flips `draggable` on, dragend flips it
 * back (cross-lane request filed for a `markDragHandle` seam). All
 * listeners are document-level and delegated — the lane owns no controller
 * or shell code.
 *
 * Contract pins:
 *  - `dataTransfer` carries the NODE ID under `application/x-sem-node`,
 *    never HTML (§8).
 *  - Drop indicators render ONLY schema-permitted, non-noop placements;
 *    the drop itself is ONE `moveNode` op = ONE transaction.
 *  - Esc cancels: indicators clear, the pending drop is refused.
 *  - Auto-scroll arms near the viewport/frame edges (autoscroll.ts).
 */

import type { EditorContext } from '../controller/types.js';
import { isRuntimeChrome } from '../controller/map.js';
import type { NodeId } from '../model/types.js';
import {
  CHIP_SELECTOR,
  DND_MIME,
  DRAGGING_CLASS,
  type DragState,
  type DropCandidate,
} from './types.js';
import { bindingFromElement, draggedElementFor, hoveredModelId, labelFor } from './resolve.js';
import { structuralParentId, isMoveAllowed, isReorderNoOp, elementIndexOf, modelIndexForElementSlot, performMove, describeMove } from './placement.js';
import { dropIndexFromRects, indicatorRectFor, type RectLike } from './geometry.js';
import { hideDropIndicator, showDropIndicator } from './indicators.js';
import { createEdgeAutoScroll, type EdgeAutoScroll } from './autoscroll.js';

export interface AttachDnDOptions {
  /** Document to listen on (default `document`). */
  doc?: Document;
  /** Auto-scroll tuning override (tests). */
  autoscroll?: EdgeAutoScroll;
}

interface Resolved {
  containerId: NodeId;
  elementIndex: number;
  rects: RectLike[];
  axis: 'y' | 'x';
}

/**
 * Wire document-level DnD. Returns the detach fn (removes listeners,
 * indicator, autoscroll; clears in-flight state).
 */
export function attachDnD(options: AttachDnDOptions = {}): () => void {
  const doc = options.doc ?? document;
  const autoscroll =
    options.autoscroll ??
    createEdgeAutoScroll({
      getPoint: () => (state !== null && !state.cancelled ? lastPoint : null),
      scrollerOf: (anchor) => {
        const frame = (anchor ?? state?.sourceEl ?? null)?.closest?.('.sem-window-viewport') ?? null;
        const target = frame !== null ? frame : doc.scrollingElement;
        return target !== null ? (target as unknown as import('./autoscroll.js').ScrollerLike) : null;
      },
    });

  let state: DragState | null = null;
  let lastPoint: { x: number; y: number } | null = null;

  // ── handle acquisition (delegated — no controller seam yet) ───────────────
  const onMouseDown = (e: MouseEvent): void => {
    const chip = e.target instanceof Element ? e.target.closest(CHIP_SELECTOR) : null;
    if (chip !== null && chip.closest('[data-sem-editing]') !== null) {
      (chip as HTMLElement).draggable = true;
    }
  };

  const onDragStart = (e: DragEvent): void => {
    const chip = e.target instanceof Element ? e.target.closest(CHIP_SELECTOR) : null;
    if (chip === null) return;
    const handle = bindingFromElement(chip);
    if (handle === null) return;
    // The chip lives INSIDE the element it moves — the drag targets the
    // deepest authored element under the chip, not the binding root.
    const dragged = draggedElementFor(handle.ctx, handle.binding, chip);
    const node = handle.ctx.doc.node(dragged.id);
    const tag = node !== undefined && node.kind === 'element' ? node.name.toLowerCase() : '';
    state = {
      nodeId: dragged.id,
      tag,
      sourceEl: dragged.el,
      ctx: handle.ctx,
      lastCandidate: null,
      cancelled: false,
    };
    dragged.el.classList.add(DRAGGING_CLASS);
    const dt = e.dataTransfer;
    if (dt !== undefined && dt !== null) {
      trySet(dt, DND_MIME, dragged.id);
      trySet(dt, 'text/plain', tag);
      dt.effectAllowed = 'move';
    }
    // No preventDefault here: cancelling the dragstart default cancels the
    // drag itself. The browser's native drag image suffices; the source is
    // dimmed via DRAGGING_CLASS (no ghost animation, §7 reduced motion).
  };

  /** Geometry + permission resolution shared by dragover and drop. The
   *  in-flight state is a PARAMETER: drop resolves AFTER capturing `s` but
   *  the shared cleanup nulls the closure state first. */
  const resolve = (x: number, y: number, s: DragState | null): { ok: true; resolved: Resolved } | { ok: false; why: 'outside' | 'refused' | 'noop' | 'self' } => {
    if (s === null) return { ok: false, why: 'outside' };
    const hovered = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
    const handle = bindingFromElement(hovered);
    if (handle === null || handle.ctx !== s.ctx) return { ok: false, why: 'outside' };
    const hoveredId = hoveredModelId(handle.ctx, handle.binding, hovered);
    if (hoveredId === null) return { ok: false, why: 'outside' };

    // Pointer over the bound HOST itself (its own padding/empty area) means
    // "append into the host"; over any authored descendant means
    // "before/after that element, among its parent's children".
    const onHost = hovered !== null && hovered === handle.binding.el;
    const containerId = onHost ? hoveredId : structuralParentId(handle.ctx, hoveredId);
    if (containerId === null) return { ok: false, why: 'outside' };
    // never drop into the dragged node's own subtree
    if (handle.ctx.doc.contains(s.nodeId, containerId)) return { ok: false, why: 'self' };

    // Sibling rects come from the DOM container's authored element children
    // (chrome + Lit markers skipped).
    const domContainer = onHost ? (hovered as Element) : hovered !== null ? hovered.parentElement : null;
    if (domContainer === null) return { ok: false, why: 'outside' };
    const siblings: Element[] = [];
    for (const n of Array.from(domContainer.children)) {
      if (!isRuntimeChrome(n)) siblings.push(n);
    }
    // v1: block layout → vertical axis (lane report notes the limitation).
    const axis: 'y' | 'x' = 'y';
    const rects: RectLike[] = siblings.map((s) => s.getBoundingClientRect());
    const point = { x, y };
    const elementIndex = onHost ? rects.length : dropIndexFromRects(rects, point, axis);
    return { ok: true, resolved: { containerId, elementIndex, rects, axis } };
  };

  const applyDropEffect = (e: DragEvent, allowed: boolean, noop: boolean): void => {
    const dt = e.dataTransfer;
    if (dt !== undefined && dt !== null) dt.dropEffect = allowed && !noop ? 'move' : 'none';
    if (allowed && !noop) e.preventDefault();
  };

  const onDragOver = (e: DragEvent): void => {
    if (state === null || state.cancelled) return;
    lastPoint = { x: e.clientX, y: e.clientY };
    const r = resolve(e.clientX, e.clientY, state);
    if (!r.ok) {
      hideDropIndicator();
      state.lastCandidate = null;
      applyDropEffect(e, false, false);
      autoscroll.stop();
      return;
    }
    const { containerId, elementIndex, rects, axis } = r.resolved;
    const allowed = isMoveAllowed(state.ctx, state.nodeId, containerId);
    const noop =
      allowed &&
      structuralParentId(state.ctx, state.nodeId) === containerId &&
      isReorderNoOp(elementIndexOf(state.ctx, state.nodeId), elementIndex);
    if (!allowed || noop) {
      hideDropIndicator();
      state.lastCandidate = null;
      applyDropEffect(e, allowed, noop);
      return;
    }
    const rect = indicatorRectFor(rects, elementIndex, axis);
    if (rect !== null) showDropIndicator(doc, rect);
    state.lastCandidate = {
      containerId,
      elementIndex,
      modelIndex: modelIndexForElementSlot(state.ctx, containerId, elementIndex),
      rect,
      axis,
    };
    applyDropEffect(e, true, false);
    autoscroll.update(state.sourceEl);
  };

  const onDrop = (e: DragEvent): void => {
    if (state === null) return;
    e.preventDefault();
    const s = state;
    if (s.cancelled) {
      cleanup();
      return;
    }
    // Resolve against the CAPTURED state — cleanup nulls the closure.
    const r = resolve(e.clientX, e.clientY, s);
    cleanup();
    if (!r.ok) return;
    const { containerId, elementIndex } = r.resolved;
    const label = labelFor(s.ctx, s.nodeId);
    const wasSameParent = structuralParentId(s.ctx, s.nodeId) === containerId;
    const result = performMove(s.ctx, s.nodeId, containerId, elementIndex, label);
    if (result.ok) {
      s.ctx.announce(
        wasSameParent ? `Moved ${label} to position ${elementIndex + 1}` : describeMove(s.ctx, s.nodeId, containerId, label),
      );
    }
  };

  const onDragEnd = (): void => {
    cleanup();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (state === null) return;
    if (e.key === 'Escape') {
      state.cancelled = true;
      hideDropIndicator();
      autoscroll.stop();
    }
  };

  const onDragLeave = (e: DragEvent): void => {
    if (state === null) return;
    if (e.relatedTarget === null) hideDropIndicator(); // left the window
  };

  function cleanup(): void {
    if (state !== null) {
      state.sourceEl.classList.remove(DRAGGING_CLASS);
      // Release every acquired handle (some engines don't reflect the
      // draggable property to the attribute — query by class, reset by prop).
      doc.querySelectorAll(CHIP_SELECTOR).forEach((c) => {
        (c as HTMLElement).draggable = false;
      });
    }
    state = null;
    lastPoint = null;
    hideDropIndicator();
    autoscroll.stop();
  }

  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('dragstart', onDragStart, true);
  doc.addEventListener('dragover', onDragOver, true);
  doc.addEventListener('drop', onDrop, true);
  doc.addEventListener('dragend', onDragEnd, true);
  doc.addEventListener('dragleave', onDragLeave, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('dragstart', onDragStart, true);
    doc.removeEventListener('dragover', onDragOver, true);
    doc.removeEventListener('drop', onDrop, true);
    doc.removeEventListener('dragend', onDragEnd, true);
    doc.removeEventListener('dragleave', onDragLeave, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    cleanup();
  };
}

function trySet(dt: DataTransfer, type: string, value: string): void {
  try {
    dt.setData(type, value);
  } catch {
    // exotic engines reject unknown types — the in-memory state still works
  }
}
