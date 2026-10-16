/**
 * controller/selection — DOM ⇄ model caret mapping (EDITOR.md §2.6).
 *
 * `caretFromDomPosition` maps a DOM caret inside the binding's light DOM to
 * a `DocPos`; `domPositionFor` is its inverse (caret restoration after a
 * re-render). Both walk AUTHORED children only — a caret inside unmodeled
 * chrome maps to null and callers fall back (never fabricate a position
 * inside chrome).
 *
 * Text offsets are DECODED units on both sides: DOM text nodes hold decoded
 * text and `TextNode.value` is decoded, so entity spelling never shifts a
 * caret.
 */

import type { EditorContext, ElementBinding } from './types.js';
import type { DocPos } from '../model/types.js';
import { authoredChildAt, authoredCount, authoredIndex, modelIdFor, siblingIndexOf } from './map.js';
import type { EditorContext as Ctx } from './types.js';

export function caretFromDomPosition(
  ctx: EditorContext,
  binding: ElementBinding,
  node: Node | null,
  offset: number,
): DocPos | null {
  if (node === null) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (parent === null) return null;
    const modelId = modelIdFor(ctx, binding, parent);
    if (modelId === null) return null;
    const text = ctx.doc.childrenOf(modelId)[authoredIndex(node)];
    if (text === undefined || text.kind !== 'text') return null;
    return { node: text.id, offset: Math.max(0, Math.min(offset, text.value.length)) };
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const modelId = modelIdFor(ctx, binding, el);
    if (modelId === null) return null;
    const child = el.childNodes[offset] ?? null;
    const boundary = child === null ? authoredCount(el) : authoredIndex(child);
    return { node: modelId, offset: boundary };
  }
  return null;
}

/** The DOM element hosting a model element's authored children — inverse of
 *  `modelIdFor`, region-aware (rendered wrappers re-anchor the walk). */
export function domElementForModel(
  ctx: EditorContext,
  binding: ElementBinding,
  modelId: string,
): Element | null {
  if (modelId === binding.rootId) return binding.el;
  const chain = [modelId, ...ctx.doc.ancestorsOf(modelId).map((a) => a.id)];
  chain.reverse(); // root-side ancestor first
  let cur: Element = binding.el;
  for (const ancestorId of chain.slice(0, -1)) {
    const regions = binding.descriptor?.regions?.(binding.el) ?? null;
    if (regions !== null) {
      for (const entry of regions) {
        for (const child of Array.from(cur.children)) {
          if (!child.matches(entry.selector)) continue;
          const id =
            typeof entry.nodeId === 'function'
              ? entry.nodeId(binding.el, authoredIndex(child))
              : entry.nodeId;
          if (id === ancestorId) cur = child;
        }
      }
    }
    const dom = authoredChildAt(cur, siblingIndexOf(ctx, ancestorId));
    if (dom === null || !(dom instanceof Element)) return null;
    cur = dom;
  }
  return cur;
}

/** Caret restoration: DOM text position for a model `DocPos`, or null when
 *  unreachable (model churn, chrome-only subtree). */
export function domPositionFor(
  ctx: EditorContext,
  binding: ElementBinding,
  pos: DocPos,
): { node: Node; offset: number } | null {
  const n = ctx.doc.node(pos.node);
  if (n === undefined) return null;
  if (n.kind === 'text') {
    const parent = ctx.doc.parentOf(n.id);
    if (parent === null) return null;
    const parentEl = domElementForModel(ctx, binding, parent.id);
    if (parentEl === null) return null;
    const dom = authoredChildAt(parentEl, ctx.doc.indexOf(n.id));
    if (!(dom instanceof Text)) return null;
    return { node: dom, offset: Math.max(0, Math.min(pos.offset, dom.data.length)) };
  }
  const el = domElementForModel(ctx, binding, pos.node);
  if (el === null) return null;
  return { node: el, offset: Math.max(0, Math.min(pos.offset, authoredCount(el))) };
}
