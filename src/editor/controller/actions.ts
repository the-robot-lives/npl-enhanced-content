/**
 * controller/actions — the model-facing edit verbs (EDITOR.md §3.4).
 *
 * Every user gesture compiles to ONE of the nine ops (or a transaction of
 * them). All verbs check `canApply` first, announce the result (§7), and
 * never touch the DOM directly — the re-render protocol projects the model.
 */

import type { EditorContext, ElementBinding } from './types.js';
import type { EditorNode, NodeId } from '../model/types.js';
import { parse } from '../model/document.js';
import { isSafeUrl } from '../safety/url.js';
import { rebuildSubtree } from '../safety/sanitize.js';
import { itemListItems, modelIdFor, siblingIndexOf, slotTextTarget } from './map.js';

/** Structural parent id (element or the document root — `doc.parentOf`
 *  only answers for element parents, which would strand top-level
 *  elements). Returns null only for a detached node. */
function parentIdOf(ctx: EditorContext, id: NodeId): NodeId | null {
  return ctx.doc.node(id)?.parentId ?? null;
}

/** Strip snippet stop grammar (${n:default}, ${n|a,b}, ${n}) — the +/−
 *  glyphs insert READY items, not stop-marked ones (§4.6). Choice stops
 *  resolve to their FIRST option (`${2|1,2,3|}` → `1`), never the list. */
export function stripTemplateStops(xml: string): string {
  return xml
    .replace(/\$\{\d+\|([^|,}]*)[^}]*\}/g, '$1')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '');
}

/** Parse a template snippet XML and rebuild it with `doc`'s id counter. */
export function buildFromXml(doc: EditorContext['doc'], xml: string): EditorNode | null {
  const parsed = parse(stripTemplateStops(xml));
  const first = parsed.root.children.find((c) => c.kind === 'element');
  return first ? rebuildSubtree(doc, first) : null;
}

/** +/− item list verbs (§4.6). */
export function addItem(ctx: EditorContext, binding: ElementBinding): boolean {
  const list = binding.descriptor?.itemList;
  if (list === undefined) return false;
  const items = itemListItems(ctx, binding);
  const node = buildFromXml(ctx.doc, list.template.xml);
  if (node === null) return false;
  let parent: NodeId = binding.rootId;
  let index = ctx.doc.childrenOf(binding.rootId).length;
  if (items.length > 0) {
    const lastId = modelIdFor(ctx, binding, items[items.length - 1]);
    if (lastId === null) return false;
    const p = parentIdOf(ctx, lastId);
    if (p === null) return false;
    parent = p;
    index = siblingIndexOf(ctx, lastId) + 1;
  }
  const op = { type: 'insertNode', parent, index, node } as const;
  if (!ctx.doc.canApply(op).ok) return false;
  ctx.doc.apply(op);
  ctx.announce(`${list.label} added`);
  return true;
}

export function removeItem(ctx: EditorContext, binding: ElementBinding, itemEl: Element): boolean {
  const list = binding.descriptor?.itemList;
  const id = modelIdFor(ctx, binding, itemEl);
  if (list === undefined || id === null) return false;
  const op = { type: 'removeNode', node: id } as const;
  if (!ctx.doc.canApply(op).ok) return false;
  ctx.doc.apply(op);
  ctx.announce(`${list.label} removed — Cmd+Z to undo`);
  return true;
}

/** Context-menu verbs (§4.7). */
export function duplicateElement(ctx: EditorContext, binding: ElementBinding): boolean {
  const node = ctx.doc.node(binding.rootId);
  const parent = parentIdOf(ctx, binding.rootId);
  if (node === undefined || parent === null) return false;
  const copy = rebuildSubtree(ctx.doc, node);
  const index = siblingIndexOf(ctx, binding.rootId) + 1;
  const op = { type: 'insertNode', parent, index, node: copy } as const;
  if (!ctx.doc.canApply(op).ok) return false;
  ctx.doc.apply(op);
  ctx.announce(`${binding.descriptor?.title ?? (node.kind === 'element' ? node.name : 'element')} duplicated`);
  return true;
}

export function moveElement(ctx: EditorContext, binding: ElementBinding, delta: -1 | 1): boolean {
  const parent = parentIdOf(ctx, binding.rootId);
  if (parent === null) return false;
  const siblings = ctx.doc.childrenOf(parent);
  const index = siblingIndexOf(ctx, binding.rootId);
  if (index < 0) return false;
  if (delta < 0 && index === 0) return false;
  if (delta > 0 && index >= siblings.length - 1) return false;
  // The model's moveNode index is PRE-removal (it decrements when moving
  // forward within the same parent): down = index + 2, up = index - 1.
  const target = delta < 0 ? index - 1 : index + 2;
  const op = { type: 'moveNode', node: binding.rootId, parent, index: target } as const;
  if (!ctx.doc.canApply(op).ok) return false;
  ctx.doc.apply(op);
  ctx.announce(`Moved ${delta < 0 ? 'up' : 'down'}`);
  return true;
}

export function deleteElement(ctx: EditorContext, binding: ElementBinding): boolean {
  const node = ctx.doc.node(binding.rootId);
  if (node === undefined) return false;
  const op = { type: 'removeNode', node: binding.rootId } as const;
  if (!ctx.doc.canApply(op).ok) return false;
  ctx.doc.apply(op);
  const count = node.kind === 'element' ? node.children.length : 0;
  ctx.announce(
    `Deleted ${binding.descriptor?.title ?? (node.kind === 'element' ? node.name : 'element')}` +
      (count > 1 ? ` (${count} items). Cmd+Z to undo.` : '. Cmd+Z to undo.'),
  );
  return true;
}

/** Inline text slot commit (§4.5). One setText transaction, coalesced per
 *  node so a typing burst is one undo step. */
export function commitSlotText(
  ctx: EditorContext,
  binding: ElementBinding,
  slotEl: Element,
  value: string,
): boolean {
  const slotId = modelIdFor(ctx, binding, slotEl);
  if (slotId === null) return false;
  const { textId, mergeIds, blocked } = slotTextTarget(ctx, slotId);
  if (blocked) {
    ctx.announce('该片段包含标记结构，请使用属性面板或代码视图 / Slot contains markup — use properties or code view');
    return false;
  }
  if (textId === null) {
    if (value === '') return true; // nothing to write
    const node = ctx.doc.createText(value);
    const op = { type: 'insertNode', parent: slotId, index: 0, node } as const;
    if (!ctx.doc.canApply(op).ok) return false;
    ctx.doc.apply(op);
    ctx.announce('Text added');
    return true;
  }
  if (ctx.doc.node(textId)?.kind === 'text' && (ctx.doc.node(textId) as { value: string }).value === value) {
    return true; // no-op
  }
  ctx.doc.transaction(
    `text:${textId}`,
    (tx) => {
      tx.push({ type: 'setText', node: textId, value });
      for (const id of mergeIds) tx.push({ type: 'removeNode', node: id });
    },
    { coalesce: `text:${textId}` },
  );
  ctx.announce('Text updated');
  return true;
}

/** Link popover commit (§3.4 linkFields) — URL-safety-checked (§8). */
export function setLink(
  ctx: EditorContext,
  binding: ElementBinding,
  field: { attr?: string; slotSelector?: string },
  value: string,
): { ok: boolean; reason?: string } {
  if (field.attr !== undefined) {
    const check = isSafeUrl(value, { attr: field.attr });
    if (!check.ok) return { ok: false, reason: check.reason };
    const op = { type: 'setAttr', node: binding.rootId, name: field.attr, value: value === '' ? null : value } as const;
    if (!ctx.doc.canApply(op).ok) return { ok: false, reason: 'cannot apply' };
    ctx.doc.apply(op);
    ctx.announce(`Updated ${field.attr}`);
    return { ok: true };
  }
  if (field.slotSelector !== undefined) {
    const slotEl = binding.el.querySelector(field.slotSelector);
    if (slotEl === null) return { ok: false, reason: 'slot not found' };
    const check = isSafeUrl(value);
    if (!check.ok) return { ok: false, reason: check.reason };
    return { ok: commitSlotText(ctx, binding, slotEl, value) };
  }
  return { ok: false, reason: 'empty link field' };
}
