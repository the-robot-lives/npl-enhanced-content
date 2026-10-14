/**
 * controller/map — DOM ⇄ model mapping for light-DOM elements.
 *
 * Authored children map to model children BY POSITION: the i-th authored
 * child node of the host (elements + text + real comments, in document
 * order) is `doc.childrenOf(rootId)[i]`. Skipped on the DOM side, by
 * contract (§0/§4.4): editor chrome (`[data-sem-chrome]`) and EMPTY
 * comments (Lit's `<!---->` update markers — stripped from the model on
 * parse). Descriptors that regroup content (`regions()`) re-anchor the
 * mapping: a rendered wrapper (`.sem-note-body`) maps to an ANCESTOR's
 * model id and its children continue inside that id.
 *
 * This module is the load-bearing seam of the re-render protocol (§4.4):
 * it must agree with how the element renders and with how
 * `renderAuthorInert` re-projects — authored order is the one invariant
 * both sides keep.
 */

import type { EditorContext, ElementBinding } from './types.js';
import type { EditorNode, NodeId } from '../model/types.js';
import type { RegionMap, TextSlot } from '../schema/types.js';

/** Editor chrome: never authored content, never indexed, never serialized. */
/** Index of `id` among its siblings (element OR document parent —
 *  `doc.indexOf` answers -1 under the document node). */
export function siblingIndexOf(ctx: EditorContext, id: NodeId): number {
  const parentId = ctx.doc.node(id)?.parentId ?? null;
  if (parentId === null) return -1;
  const p = ctx.doc.node(parentId);
  const children: readonly EditorNode[] =
    parentId === ctx.doc.root.id ? ctx.doc.root.children : p !== undefined && p.kind === 'element' ? p.children : [];
  return children.findIndex((c) => c.id === id);
}

export function isChromeNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-sem-chrome');
}

/** Lit update markers: empty comments (`<!---->`) and lit-html part
 *  markers (`<!--?lit$…-->`). Real comments have bodies without `?lit$`
 *  and stay in the model (§4.4). */
function isLitMarker(node: Node): boolean {
  return node.nodeType === Node.COMMENT_NODE &&
    ((node as Comment).data === '' || (node as Comment).data.includes('?lit$'));
}

/** Lit-owned nodes the controller must never remove or reorder. */
export function isRuntimeChrome(node: Node): boolean {
  return isChromeNode(node) || isLitMarker(node);
}

function isAuthored(node: Node): boolean {
  return !isChromeNode(node) && !isLitMarker(node);
}

/** Index of `node` among its parent's AUTHORED child nodes. */
export function authoredIndex(node: Node): number {
  let i = 0;
  for (let n = node.previousSibling; n !== null; n = n.previousSibling) {
    if (isAuthored(n)) i += 1;
  }
  return i;
}

/** The authored child at model-position `index` (the exact inverse of
 *  `authoredIndex`), or null. */
export function authoredChildAt(parent: Node, index: number): Node | null {
  if (index < 0) return null;
  let i = -1;
  for (let n = parent.firstChild; n !== null; n = n.nextSibling) {
    if (!isAuthored(n)) continue;
    i += 1;
    if (i === index) return n;
  }
  return null;
}

/** How many authored children `parent` has. */
export function authoredCount(parent: Node): number {
  let i = 0;
  for (let n = parent.firstChild; n !== null; n = n.nextSibling) {
    if (isAuthored(n)) i += 1;
  }
  return i;
}

/** The region entry hit for a rendered element, or null (first wins §3.3). */
function regionHit(regions: RegionMap | null, binding: ElementBinding, el: Element): NodeId | null {
  if (regions === null) return null;
  for (const entry of regions) {
    if (!el.matches(entry.selector)) continue;
    return typeof entry.nodeId === 'function'
      ? entry.nodeId(binding.el, authoredIndex(el))
      : entry.nodeId;
  }
  return null;
}

/**
 * Model node id for a DOM element under the binding — region anchors first
 * (rendered wrappers), then authored-child indexing (the contract's
 * fallback, §3.3). Null when `el` sits outside the host.
 */
export function modelIdFor(ctx: EditorContext, binding: ElementBinding, el: Element): NodeId | null {
  if (el === binding.el) return binding.rootId;
  if (!binding.el.contains(el)) return null;
  // The chain INCLUDES `el` itself (a direct child must resolve through
  // childrenOf(rootId) — anchoring at the parent would return rootId).
  const chain: Element[] = [el];
  for (let e = el.parentElement; e !== null && e !== binding.el; e = e.parentElement) {
    chain.unshift(e);
  }
  const regions = binding.descriptor?.regions?.(binding.el) ?? null;
  let anchorId = binding.rootId;
  for (const step of chain) {
    const hit = regionHit(regions, binding, step);
    if (hit !== null) {
      anchorId = hit;
      continue;
    }
    const child = ctx.doc.childrenOf(anchorId)[authoredIndex(step)];
    if (child === undefined || child.kind !== 'element') return null;
    anchorId = child.id;
  }
  return anchorId;
}

/**
 * The one text node a slot commit targets, plus the ids to merge: a clean
 * slot holds exactly one text child; a split slot (whitespace runs) merges
 * by keeping the first and removing the rest. Any ELEMENT child blocks the
 * inline edit — markup goes through the property modal / code view; the
 * controller announces the refusal instead of flattening authored markup.
 */
export function slotTextTarget(
  ctx: EditorContext,
  slotId: NodeId,
): { textId: NodeId | null; mergeIds: NodeId[]; blocked: boolean } {
  const children = ctx.doc.childrenOf(slotId);
  const texts = children.filter((c): c is Extract<EditorNode, { kind: 'text' }> => c.kind === 'text');
  if (texts.length !== children.length) return { textId: null, mergeIds: [], blocked: true };
  if (texts.length === 0) return { textId: null, mergeIds: [], blocked: false };
  const [first, ...rest] = texts;
  return { textId: first.id, mergeIds: rest.map((t) => t.id), blocked: false };
}

/** The element a descriptor slot selector matches first. `:scope` is the
 *  contract's unwrapped-content form — the host itself is the slot. */
export function resolveSlotEl(binding: ElementBinding, slot: TextSlot): Element | null {
  if (slot.selector === ':scope') return binding.el;
  return binding.el.querySelector(slot.selector);
}

/** The slot definition whose region contains `el` (first declared wins). */
export function slotForElement(binding: ElementBinding, el: Element): TextSlot | null {
  const slots = binding.descriptor?.textSlots;
  if (slots === undefined) return null;
  for (const slot of slots) {
    if (slot.selector === ':scope') {
      if (el === binding.el || binding.el.contains(el)) return slot;
      continue;
    }
    for (const candidate of binding.el.querySelectorAll(slot.selector)) {
      if (candidate === el || candidate.contains(el)) return slot;
    }
  }
  return null;
}

/** Items of the binding's item list, in order (empty when none declared). */
export function itemListItems(binding: ElementBinding): Element[] {
  const list = binding.descriptor?.itemList;
  if (list === undefined) return [];
  return Array.from(binding.el.querySelectorAll(list.childSelector));
}

/** First text content of a subtree (item preview labels). */
export function previewTextOf(node: EditorNode | undefined): string {
  if (node === undefined) return '';
  const t = textOf(node);
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function textOf(node: EditorNode): string {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'element') return node.children.map(textOf).join('');
  return '';
}
