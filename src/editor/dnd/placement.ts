/**
 * dnd/placement — schema-permitted moves and moveNode index arithmetic
 * (EDITOR.md §5.6: "drop indicators render only placements the schema
 * permits"; one `moveNode` per drop).
 *
 * Index conventions (pinned by the model, `document.ts applyAndInvert`):
 *  - `moveNode.index` is the anchor's position in the parent's children
 *    BEFORE the op applies; the model itself converts to post-removal
 *    (same-parent forward moves decrement on apply). Slots compile
 *    directly — see `moveOpIndex`.
 *  - Element-relative slots count ELEMENT children only (what geometry
 *    sees): slot k = "before the k-th element", slot count = append.
 *    Model indices count every child (text nodes included); the
 *    conversion anchors on the element child at the slot.
 */

import type { EditorContext } from '../controller/types.js';
import type { EditorNode, NodeId } from '../model/types.js';
import { allowedTagsAt, canonicalTagName } from '../insert/placement.js';

/** Structural parent id — element or the document root (`parentOf` masks
 *  the root; `node.parentId` answers for root children). */
export function structuralParentId(ctx: EditorContext, id: NodeId): NodeId | null {
  const n = ctx.doc.node(id);
  if (n === undefined) return null;
  return n.parentId ?? ctx.doc.root.id;
}

/** Element-kind children of `containerId` (works for the document root). */
export function elementChildrenOf(ctx: EditorContext, containerId: NodeId): EditorNode[] {
  return ctx.doc.childrenOf(containerId).filter((c): c is EditorNode & { kind: 'element' } => c.kind === 'element');
}

/** Current element-relative index of `id` among its element siblings, or -1. */
export function elementIndexOf(ctx: EditorContext, id: NodeId): number {
  const parent = structuralParentId(ctx, id);
  if (parent === null) return -1;
  return elementChildrenOf(ctx, parent).findIndex((c) => c.id === id);
}

/**
 * Convert an element-relative slot `elementIndex` in `containerId` to the
 * model child index the `moveNode` op consumes. `elementIndex === count`
 * (append) maps past the last element child, keeping any trailing text
 * after it in place.
 */
export function modelIndexForElementSlot(ctx: EditorContext, containerId: NodeId, elementIndex: number): number {
  const children = ctx.doc.childrenOf(containerId);
  const elements = elementChildrenOf(ctx, containerId);
  if (elementIndex >= elements.length) return children.length;
  const anchor = elements[elementIndex];
  const at = children.findIndex((c) => c.id === anchor.id);
  return at >= 0 ? at : children.length;
}

/** Same-parent reorder that lands where the node already is (or is a
 *  no-op flip of the two equivalent pre-removal slots). */
export function isReorderNoOp(current: number, target: number): boolean {
  return target === current || target === current + 1;
}

/**
 * The pre-removal `moveNode` index for an element-relative slot.
 * `modelIndexForElementSlot` already answers the anchor's PRE-removal child
 * position, which is exactly what `moveNode.index` consumes — the model
 * converts to post-removal itself (decrementing when the same-parent move
 * was forward). No caller-side adjustment is needed in either direction;
 * the append slot maps to `children.length`, the model's inclusive upper
 * bound.
 */
export function moveOpIndex(ctx: EditorContext, nodeId: NodeId, containerId: NodeId, elementIndex: number): number {
  void nodeId;
  void containerId;
  return modelIndexForElementSlot(ctx, containerId, elementIndex);
}

/**
 * May `nodeId` be moved into `containerId`? Same-parent reorders are always
 * permitted (the schema already admitted the node there); cross-container
 * moves require the schema to admit the dragged tag at the target — the
 * SAME gate the inserter renders `+` by, so drag and insert agree.
 */
export function isMoveAllowed(ctx: EditorContext, nodeId: NodeId, containerId: NodeId): boolean {
  const node = ctx.doc.node(nodeId);
  if (node === undefined) return false;
  const currentParent = structuralParentId(ctx, nodeId);
  if (currentParent === containerId) return true;
  if (node.kind !== 'element') return currentParent === containerId;
  const canonical = canonicalTagName(node.name) ?? node.name.toLowerCase();
  return allowedTagsAt(ctx.doc, containerId).has(canonical);
}

export interface MoveResult {
  ok: boolean;
  /** "noop" = permitted but the position is unchanged; "refused" = schema
   *  or model guard rejected. */
  kind?: 'noop' | 'refused';
}

/**
 * ONE moveNode op = ONE transaction (doc.apply), canApply-checked first
 * (UI paths never rely on ModelError, §2.3). Announces the result.
 * `label` names the moved element for the announcement.
 */
export function performMove(
  ctx: EditorContext,
  nodeId: NodeId,
  containerId: NodeId,
  elementIndex: number,
  label: string,
): MoveResult {
  if (!isMoveAllowed(ctx, nodeId, containerId)) {
    ctx.announce(`Cannot nest ${label} there — placement not allowed`);
    return { ok: false, kind: 'refused' };
  }
  const currentParent = structuralParentId(ctx, nodeId);
  if (currentParent === containerId) {
    const current = elementIndexOf(ctx, nodeId);
    if (isReorderNoOp(current, elementIndex)) return { ok: false, kind: 'noop' };
  }
  const op = {
    type: 'moveNode',
    node: nodeId,
    parent: containerId,
    index: moveOpIndex(ctx, nodeId, containerId, elementIndex),
  } as const;
  if (!ctx.doc.canApply(op).ok) {
    ctx.announce(`Cannot move ${label} there`);
    return { ok: false, kind: 'refused' };
  }
  ctx.doc.apply(op);
  return { ok: true };
}

/** Where was `nodeId` (pre-move) — for undo-style announcements. */
export function describeMove(ctx: EditorContext, nodeId: NodeId, containerId: NodeId, label: string): string {
  const target = ctx.doc.node(containerId);
  const targetName =
    containerId === ctx.doc.root.id ? 'top level' : target !== undefined && target.kind === 'element' ? target.name.toLowerCase() : 'element';
  return `Moved ${label} into ${targetName}`;
}

/**
 * Promote (§5.6): splice the node out to the grandparent, right after its
 * current parent. Top-level nodes cannot promote.
 */
export function promoteNode(ctx: EditorContext, nodeId: NodeId, label: string): MoveResult {
  const parentId = structuralParentId(ctx, nodeId);
  if (parentId === null) return { ok: false, kind: 'refused' };
  const parent = ctx.doc.node(parentId);
  if (parentId === ctx.doc.root.id || parent === undefined || parent.parentId === null) {
    ctx.announce(`${label} is already at top level`);
    return { ok: false, kind: 'noop' };
  }
  const grandparentId = parent.parentId;
  // Final element slot in the grandparent = right after the current
  // parent: the parent's element index + 1.
  const parentElementAt = elementChildrenOf(ctx, grandparentId).findIndex((c) => c.id === parentId);
  if (parentElementAt < 0) return { ok: false, kind: 'refused' };
  return performMove(ctx, nodeId, grandparentId, parentElementAt + 1, label);
}

/** Demote (§5.6): move the node into its previous ELEMENT sibling, appended
 *  after that sibling's children. Refuses when there is no previous sibling
 *  or the schema does not admit the tag inside it. */
export function demoteNode(ctx: EditorContext, nodeId: NodeId, label: string): MoveResult {
  const parentId = structuralParentId(ctx, nodeId);
  if (parentId === null) return { ok: false, kind: 'refused' };
  const siblings = elementChildrenOf(ctx, parentId);
  const at = siblings.findIndex((c) => c.id === nodeId);
  if (at <= 0) {
    ctx.announce(`Nothing to nest ${label} into`);
    return { ok: false, kind: 'noop' };
  }
  const prev = siblings[at - 1];
  const tag = ctx.doc.node(nodeId);
  const canonical = tag !== undefined && tag.kind === 'element' ? canonicalTagName(tag.name) ?? tag.name.toLowerCase() : '';
  const admitted = allowedTagsAt(ctx.doc, prev.id).has(canonical);
  if (!admitted) {
    const prevName = prev.kind === 'element' ? prev.name.toLowerCase() : prev.kind;
    ctx.announce(`Cannot nest ${canonical} in ${prevName}`);
    return { ok: false, kind: 'refused' };
  }
  return performMove(ctx, nodeId, prev.id, elementChildrenOf(ctx, prev.id).length, label);
}
