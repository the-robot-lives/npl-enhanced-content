/**
 * controller/rerender — the light-DOM re-render protocol (EDITOR.md §4.4).
 *
 * After a transaction touches a binding's subtree the controller re-projects
 * the model into the element's light DOM:
 *   1 capture caret → 2 replace authored children (kept node-for-node when
 *   untouched — media never reloads) via `renderAuthorInert` → 3 re-establish
 *   chrome (`requestUpdate` + `updateComplete` + `descriptor.rerender`) →
 *   4 restore caret. Every await is guarded on `doc.version` — a newer
 *   transaction invalidates an in-flight re-render; the newest wins.
 *
 * While a text slot of the binding is an active contenteditable the
 * re-render DEFERS (§4.5: never re-render under a caret).
 */

import type { EditorContext, ElementBinding } from './types.js';
import type { NodeId } from '../model/types.js';
import { renderAuthorInert } from '../safety/inert.js';
import { authoredChildAt, isChromeNode, isRuntimeChrome } from './map.js';
import { caretFromDomPosition, domPositionFor } from './selection.js';

interface Pending {
  touched: Set<NodeId>;
  running: boolean;
}

const pendingMap = new WeakMap<ElementBinding, Pending>();

/** Coalesced entry: one rerender per binding per microtask. */
export function scheduleRerender(ctx: EditorContext, binding: ElementBinding, touched: NodeId[]): void {
  let p = pendingMap.get(binding);
  if (p === undefined) {
    p = { touched: new Set(), running: false };
    pendingMap.set(binding, p);
  }
  touched.forEach((t) => p.touched.add(t));
  if (p.running) return;
  p.running = true;
  queueMicrotask(() => {
    const touchedIds = Array.from(p.touched);
    p.touched.clear();
    p.running = false;
    void rerenderElement(ctx, binding, touchedIds);
  });
}

/** Is this binding's subtree affected by the touched ids? A removed node
 *  is already unregistered (`node(t) === undefined`), so unknown ids count
 *  as affecting — removals must re-project. */
export function affectsBinding(ctx: EditorContext, binding: ElementBinding, touched: NodeId[]): boolean {
  return touched.some(
    (t) => t === binding.rootId || ctx.doc.contains(binding.rootId, t) || ctx.doc.node(t) === undefined,
  );
}

/** Optional post-rerender hook (installed by attach: re-stamps glyphs). */
let postRerenderHook: ((ctx: EditorContext, binding: ElementBinding) => Promise<void>) | null = null;
export function setPostRerenderHook(fn: (ctx: EditorContext, binding: ElementBinding) => Promise<void>): void {
  postRerenderHook = fn;
}

/** Protocol steps 1–5 (§4.4). Idempotent; safe to call directly. */
export async function rerenderElement(
  ctx: EditorContext,
  binding: ElementBinding,
  touched: NodeId[] = [],
): Promise<void> {
  const el = binding.el;
  if (binding.editingSlot !== null) {
    // §4.5: never re-project under a caret. The retry is armed by
    // stopSlotEditing — re-arming here would busy-loop while editing.
    return;
  }
  if (ctx.doc.node(binding.rootId) === undefined) {
    // The bound element itself was deleted: the model is the source of
    // truth, so clear authored content and signal detach (§4.2).
    for (const n of Array.from(el.childNodes)) {
      if (isRuntimeChrome(n)) continue;
      el.removeChild(n);
    }
    el.dispatchEvent(new CustomEvent('semtext-editor-removed', { bubbles: true }));
    return;
  }
  const version = ctx.doc.version;

  // ── 1. capture caret if it sits inside the host ──
  const sel = el.ownerDocument.getSelection();
  const inside =
    sel !== null && sel.focusNode !== null && (el === sel.focusNode || el.contains(sel.focusNode));
  const caret = inside ? caretFromDomPosition(ctx, binding, sel.focusNode, sel.focusOffset) : null;

  // ── 2. replace authored children ──
  const source = ctx.doc.serializeSubtree(binding.rootId);
  const frag = renderAuthorInert(source, el.ownerDocument);
  // serializeSubtree emits the element itself — project its CHILDREN.
  const rootEl = frag.firstElementChild;
  const fresh = rootEl !== null ? Array.from(rootEl.childNodes) : [];
  const modelChildren = ctx.doc.childrenOf(binding.rootId);

  // Node-for-node keep keyed on IDENTITY, not DOM index (§4.4): children
  // whose model counterpart still exists AND whose subtree was NOT touched
  // are reused live (media/caret stability). A move reorders untouched
  // siblings, so an index-based keep would steal a neighbour's node and
  // duplicate the moved element. Identity = the data-sem-edit-node stamp
  // (model node id) or, on stamp-less docs, the authored `id` attribute.
  const byStamp = new Map<NodeId, Element>();
  const byAuthored = new Map<string, Element>();
  for (const child of Array.from(el.children)) {
    if (isRuntimeChrome(child)) continue;
    const stamp = child.getAttribute('data-sem-edit-node');
    if (stamp !== null) byStamp.set(stamp, child);
    const authoredId = child.getAttribute('id');
    if (authoredId !== null && authoredId !== '') byAuthored.set(authoredId, child);
  }
  const kept = new Map<number, Node>();
  for (let i = 0; i < modelChildren.length; i++) {
    const mc = modelChildren[i];
    if (mc.kind !== 'element') continue;
    if (touched.some((t) => t === mc.id || ctx.doc.contains(mc.id, t))) continue;
    const authoredId = mc.attrs.find((a) => a.name === 'id')?.value ?? undefined;
    let old: Element | undefined;
    if (authoredId !== undefined && byAuthored.has(authoredId)) {
      old = byAuthored.get(authoredId);
    } else {
      old = byStamp.get(mc.id);
    }
    if (old === undefined) {
      // Stamp-less AND id-less children (plain wrappers on headless docs)
      // fall back to the positional match — but only if the candidate is
      // unstamped, so a reordered sibling's node is never stolen.
      const byIndex = authoredChildAt(el, i);
      if (
        byIndex instanceof Element &&
        !byIndex.hasAttribute('data-sem-edit-node') &&
        byIndex.tagName.toLowerCase() === mc.name.toLowerCase()
      ) {
        old = byIndex;
      }
    }
    if (old !== undefined && old.tagName.toLowerCase() === mc.name.toLowerCase()) {
      kept.set(i, old);
    }
  }

  // Final DOM order = per model child: kept node or freshly rendered node.
  const order: Node[] = [];
  for (let i = 0; i < modelChildren.length; i++) {
    order.push(kept.get(i) ?? fresh[i] ?? document.createComment(''));
  }

  // Normalize el's child order towards `order` WITHOUT removing kept nodes
  // (removal+reinsert would reset media). Chrome nodes keep their position.
  let ref: Node | null = firstNonChrome(el);
  for (const node of order) {
    if (node === ref) {
      ref = nextNonChrome(ref);
      continue;
    }
    el.insertBefore(node, ref);
    // `ref` unchanged: it is still a child of el (insertBefore never removes ref)
  }
  // Drop authored leftovers not in `order` (removed nodes).
  const keepSet = new Set(order);
  for (const n of Array.from(el.childNodes)) {
    if (isRuntimeChrome(n) || keepSet.has(n)) continue;
    el.removeChild(n);
  }

  // Restamp model↔DOM pairs: fresh projections carry no data-sem-edit-node,
  // and the keep step + outline scroll + dnd resolution all key on it.
  stampEditNodes(ctx, binding);

  // ── 3. re-establish element chrome ──
  // Plain (non-Lit) elements have no lifecycle — skip cleanly.
  const litHost = el as { requestUpdate?: () => void; updateComplete?: Promise<unknown> };
  if (typeof litHost.requestUpdate === 'function') litHost.requestUpdate();
  await litHost.updateComplete?.catch(() => {}); // broken update ≠ broken edit session
  if (ctx.doc.version !== version) return; // stale — newest rerender wins
  await binding.descriptor?.rerender?.(el);
  if (ctx.doc.version !== version) return;
  await postRerenderHook?.(ctx, binding);
  if (ctx.doc.version !== version) return;

  // ── 4. restore caret ──
  if (caret !== null) {
    const pos = domPositionFor(ctx, binding, caret);
    if (pos !== null) el.ownerDocument.getSelection()?.collapse(pos.node, pos.offset);
  }
}

function firstNonChrome(el: Node): Node | null {
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (!isRuntimeChrome(n)) return n;
  }
  return null;
}

/**
 * Parallel model↔DOM walk stamping `data-sem-edit-node` on the binding host
 * and its DIRECT element children (chrome skipped). Depth-2+ descendants of
 * an upgraded host are re-homed by its build() and are deliberately not
 * stamped here — the canvas projector stamps full depth on open, and a
 * binding-scoped rerender restamps one level so the nearest stamped ancestor
 * always resolves. The stamp drives outline scroll, dnd element resolution
 * and the shell-aware claim fast path.
 */
export function stampEditNodes(ctx: EditorContext, binding: ElementBinding): void {
  const root = ctx.doc.node(binding.rootId);
  if (root === undefined || root.kind !== 'element') return;
  const host = binding.el;
  if (host.getAttribute('data-sem-edit-node') !== root.id) {
    host.setAttribute('data-sem-edit-node', root.id);
  }
  const modelChildren = ctx.doc.childrenOf(root.id);
  const domChildren = Array.from(host.children).filter((c) => !isChromeNode(c));
  let k = 0;
  for (const mc of modelChildren) {
    if (mc.kind !== 'element') continue;
    const dc = domChildren[k++];
    if (dc === undefined) break;
    if (dc.getAttribute('data-sem-edit-node') !== mc.id) dc.setAttribute('data-sem-edit-node', mc.id);
  }
}

function nextNonChrome(node: Node | null): Node | null {
  for (let n = node === null ? null : node.nextSibling; n !== null; n = n.nextSibling) {
    if (!isRuntimeChrome(n)) return n;
  }
  return null;
}
