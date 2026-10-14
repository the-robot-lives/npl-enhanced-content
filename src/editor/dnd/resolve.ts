/**
 * dnd/resolve — locate the EditorContext / binding behind a DOM element.
 *
 * The controller keeps per-host registries (attach.ts); the DnD lane reads
 * them through the public `bindingFor` seam instead of asking the
 * controller for a chrome hook. When the controller later grows one
 * (`markDragHandle`), this module is the single place to re-point.
 */

import type { EditorContext, ElementBinding } from '../controller/types.js';
import { bindingFor } from '../controller/attach.js';
import { isRuntimeChrome, modelIdFor } from '../controller/map.js';
import { EDITING_HOST_SELECTOR } from './types.js';
import type { NodeId } from '../model/types.js';

export interface BindingHandle {
  ctx: EditorContext;
  binding: ElementBinding;
  /** The binding root's model id. */
  rootId: NodeId;
}

/** The bound host above `el` (or null): closest `[data-sem-editing]`. */
export function bindingFromElement(el: Element | null): BindingHandle | null {
  let node: Element | null = el;
  while (node !== null) {
    if (node.hasAttribute('data-sem-editing')) {
      const binding = bindingFor(node);
      const controller = binding?.controller ?? null;
      if (binding !== undefined && controller !== null) {
        return { ctx: controller.ctx, binding, rootId: binding.rootId };
      }
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The model ELEMENT under the pointer inside a binding: `modelIdFor`
 * answers element ids only (text/marked chrome → null), so walk up until
 * one resolves. Null when the pointer sits over unmodeled chrome.
 * NOTE: chrome nodes are SKIPPED, never resolved — `modelIdFor` answers
 * positionally, so a chip (authored index 0) would otherwise map to the
 * first model child instead of being ignored.
 */
export function hoveredModelId(ctx: EditorContext, binding: ElementBinding, start: Element | null): NodeId | null {
  let el = start;
  while (el !== null && el !== binding.el.parentElement) {
    if (!isRuntimeChrome(el)) {
      const id = modelIdFor(ctx, binding, el);
      if (id !== null) {
        const node = ctx.doc.node(id);
        if (node !== undefined && node.kind === 'element') return id;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/** The deepest authored element under `start` that maps to a model node —
 *  the element a drag actually moves (the chip lives INSIDE it). Falls back
 *  to the binding root. */
export function draggedElementFor(ctx: EditorContext, binding: ElementBinding, start: Element | null): { id: NodeId; el: Element } {
  let el = start;
  while (el !== null && el !== binding.el.parentElement) {
    if (!isRuntimeChrome(el)) {
      const id = modelIdFor(ctx, binding, el);
      if (id !== null) {
        const node = ctx.doc.node(id);
        if (node !== undefined && node.kind === 'element') return { id, el };
      }
    }
    el = el.parentElement;
  }
  return { id: binding.rootId, el: binding.el };
}

/** A short human label for a model element (descriptor title, else tag). */
export function labelFor(ctx: EditorContext, id: NodeId): string {
  const node = ctx.doc.node(id);
  if (node === undefined || node.kind !== 'element') return 'element';
  const d = ctx.descriptors(node.name.toLowerCase());
  return d?.title ?? node.name.toLowerCase();
}
