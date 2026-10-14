/**
 * insert/placement — schema-allowed placement (EDITOR.md §5.5).
 *
 * "Insert targets are validated against the schema (`children`/`optionsIn`
 * data); disallowed insert points never render a `+`." This module is that
 * gate, pure model+schema reads — no DOM.
 *
 * Rules:
 *  - document root: every schema tag EXCEPT companion items (a tag with
 *    `optionsIn` belongs inside its container).
 *  - an element: its spec's declared children that are themselves schema
 *    tags (plain-HTML parts like `table`/`statement` are item-list chrome,
 *    not inserter blocks), PLUS the companion tags whose `optionsIn` names
 *    the container, PLUS the container's own item-list child when that is a
 *    schema tag (`npl-flags` → `npl-flag` arrives through children data).
 *  - a container with neither: nothing is insertable (no `+` rendered,
 *    panel shows an empty state).
 */

import type { DocumentNode, EditorDocument, EditorNode, NodeId } from '../model/types.js';
import type { EditDescriptor } from '../schema/types.js';
import { canonicalTagName, companionsOf, getTag, handDescriptors, loadSchema } from '../schema/index.js';
import type { InsertRequestDetail, InsertTarget } from './types.js';

// pass-through for lane consumers (dnd placement imports it from here)
export { canonicalTagName };

/** Hand-written descriptors for tags with NO schema entry (sem-question,
 *  sem-option — Tier-1 quiz pair; desc-recall). They have no placement
 *  data, so this lane defines their rule: `containerOf: T` → inside T only;
 *  otherwise top-level (validator warns `unknown-tag`, never blocks). */
function handOnlyDescriptors(): EditDescriptor[] {
  return handDescriptors().filter((d) => getTag(d.tag) === undefined);
}

/**
 * Canonical tag names insertable as children of `parentId` (an element node
 * id or the document root id). Order-free; callers group for display.
 */
export function allowedTagsAt(doc: EditorDocument, parentId: NodeId): Set<string> {
  const allowed = new Set<string>();
  const node: EditorNode | DocumentNode | undefined =
    parentId === doc.root.id ? doc.root : doc.node(parentId);
  if (node === undefined) return allowed;

  if (node.kind === 'document') {
    for (const spec of loadSchema().tags) {
      if (spec.optionsIn === null) allowed.add(spec.name.toLowerCase());
    }
    allowed.add('sem-chat'); // seeded spec, optionsIn-less by construction
    for (const d of handOnlyDescriptors()) {
      if (d.containerOf === undefined) allowed.add(d.tag.toLowerCase());
    }
    return allowed;
  }
  if (node.kind !== 'element') return allowed;

  const tag = node.name.toLowerCase();
  for (const child of getTag(tag)?.children ?? []) {
    const canonical = canonicalTagName(child.name);
    if (canonical !== null) allowed.add(canonical);
  }
  for (const companion of companionsOf(tag)) allowed.add(companion.name.toLowerCase());
  for (const d of handOnlyDescriptors()) {
    if (d.containerOf?.toLowerCase() === tag) allowed.add(d.tag.toLowerCase());
  }
  return allowed;
}

/** Does placement permit `tag` at `target`? (The model's `canApply` runs
 *  again at insert time with the built node in hand — this is the cheap
 *  gate that decides whether an entry renders at all.) */
export function canInsertTagAt(doc: EditorDocument, target: InsertTarget, tag: string): boolean {
  return allowedTagsAt(doc, target.parentId).has(canonicalTagName(tag) ?? tag.toLowerCase());
}

/** Index of `id` among its siblings — element OR document parent (the model
 *  answers -1 under the root; this is the same root-aware correction the
 *  controller's siblingIndexOf applies, kept local so the insert lane does
 *  not depend on controller internals for a read). */
export function indexAmongChildren(doc: EditorDocument, id: NodeId): number {
  const node = doc.node(id);
  if (node === undefined) return -1;
  // parentOf masks the document root (returns null); root children need the
  // manual index — the same correction the controller's siblingIndexOf makes
  if (doc.parentOf(id) === null) return doc.root.children.findIndex((c) => c.id === id);
  return doc.indexOf(id);
}

/**
 * Normalize an insert request (shell event, `+` zone, slash, menu) into a
 * concrete target:
 *  - `parent` null → the current selection's container, else the root.
 *  - a text/comment parent → its parent element (blocks never nest in text).
 *  - `index` null → after the selection when it is a child of the container,
 *    else append.
 *  - the index clamps to `0..children.length`.
 * Returns null only when `parent` names a node that does not exist.
 */
export function resolveInsertTarget(
  doc: EditorDocument,
  request: InsertRequestDetail,
  selectedId: NodeId | null,
): InsertTarget | null {
  const rootId = doc.root.id;

  // container
  let parentId: NodeId = rootId;
  if (request.parent !== null && request.parent !== rootId) {
    const node = doc.node(request.parent);
    if (node === undefined) return null;
    parentId = node.kind === 'element' ? node.id : node.parentId ?? rootId;
  } else if (selectedId !== null) {
    const sel = doc.node(selectedId);
    if (sel !== undefined && sel.kind === 'element') parentId = sel.id;
  }

  // index
  const count = doc.childrenOf(parentId).length;
  let index: number;
  if (request.index !== null && Number.isInteger(request.index)) {
    index = request.index;
  } else if (selectedId !== null && doc.node(selectedId) !== undefined) {
    const sel = doc.node(selectedId)!;
    // node() never returns the document itself; null parentId = under root
    const selParent = sel.parentId !== null ? sel.parentId : rootId;
    const selIndex = childrenIndexOf(doc, selParent, selectedId);
    index = selParent === parentId && selIndex >= 0 ? selIndex + 1 : count;
  } else {
    index = count;
  }
  return { parentId, index: Math.max(0, Math.min(index, count)) };
}

function childrenIndexOf(doc: EditorDocument, parentId: NodeId, id: NodeId): number {
  const children = parentId === doc.root.id ? doc.root.children : doc.childrenOf(parentId);
  return children.findIndex((c) => c.id === id);
}

/** The parent element's canonical tag, or null at the document root. */
export function containerTagAt(doc: EditorDocument, target: InsertTarget): string | null {
  if (target.parentId === doc.root.id) return null;
  const node = doc.node(target.parentId);
  return node !== undefined && node.kind === 'element' ? node.name.toLowerCase() : null;
}
