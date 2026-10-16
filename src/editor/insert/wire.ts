/**
 * insert/wire — assembles the insert roads (EDITOR.md §5.5).
 *
 * Three things wire here, all lane-owned:
 * 1. `createInsertShellHooks` — the `ShellHooks.openInserter` implementation
 *    the context menu's insert-before/after items call (they render
 *    disabled-with-hint until a shell installs hooks). Mapping: "before" /
 *    "after" the bound element = its PARENT's child list at the element's
 *    sibling index (pre-insertion; moving down is index+1 in a list where
 *    the anchor stays — not the moveNode+2 rule, nothing is removed).
 * 2. The `sem-edit-insert-request` custom event (toolbar Insert…). Payload
 *    shape, pinned in types.ts: `{parent: NodeId | null, index: number |
 *    null}` — null index means "after the selection, else append"; a
 *    text-node parent normalizes to its parent element. The insert lane
 *    resolves descriptors/schema itself, so the shell carries no schema.
 * 3. The pointer roads on the projected canvas: `+` zones (plus.ts) and
 *    the `/` command (slash.ts).
 *
 * `wireInsert` returns one detach that unwinds everything.
 */

import type { EditorContext, ElementBinding, ShellHooks } from '../controller/types.js';
import { modelIdFor } from '../controller/map.js';
import type { NodeId } from '../model/types.js';
import { attachPlusZones } from './plus.js';
import { attachSlashCommand } from './slash.js';
import { indexAmongChildren, resolveInsertTarget } from './placement.js';
import { openInsertPanel } from './panel.js';
import type { InsertOpenOptions, InsertRequestDetail } from './types.js';

export interface InsertShellHooksOptions extends InsertOpenOptions {
  ctx: EditorContext;
}

/** `ShellHooks` fragment for the insert lane. */
export function createInsertShellHooks(opts: InsertShellHooksOptions): ShellHooks {
  const { ctx, ...panel } = opts;
  return {
    openInserter(binding: ElementBinding, where: 'before' | 'after'): void {
      const id = modelIdFor(ctx, binding, binding.el);
      if (id === null) return;
      if (id === ctx.doc.root.id) {
        // the bound host IS the document projection — before/after = start/end
        const count = ctx.doc.root.children.length;
        openInsertPanel(ctx, { parentId: id, index: where === 'before' ? 0 : count }, panel);
        return;
      }
      const node = ctx.doc.node(id);
      if (node === undefined) return;
      const parentId = node.parentId ?? ctx.doc.root.id;
      const among = indexAmongChildren(ctx.doc, id);
      openInsertPanel(ctx, { parentId, index: where === 'before' ? among : among + 1 }, panel);
    },
  };
}

export interface WireInsertOptions extends InsertOpenOptions {
  ctx: EditorContext;
  /** The projected canvas: hosts `+` zones and the slash listener. */
  canvas?: HTMLElement | null;
  /** Where `sem-edit-insert-request` is heard (default: document). */
  surface?: HTMLElement | Document | null;
  /** Current selection for null-index requests (default: none → append). */
  getSelectedId?: () => NodeId | null;
  /** Turn roads off selectively (all default on). */
  plusZones?: boolean;
  slash?: boolean;
  requestEvent?: boolean;
}

/** Wire every insert road; returns one detach. */
export function wireInsert(opts: WireInsertOptions): () => void {
  const { ctx, canvas = null, surface = null, getSelectedId = () => null } = opts;
  const panel: InsertOpenOptions = { onInsert: opts.onInsert, onCancel: opts.onCancel };
  const detach: Array<() => void> = [];

  if (opts.requestEvent !== false) {
    const listener = (e: Event): void => {
      const detail = (e as CustomEvent<InsertRequestDetail>).detail;
      if (detail === null || typeof detail !== 'object') return;
      const selectedId = getSelectedId();
      const target = resolveInsertTarget(ctx.doc, detail, selectedId);
      if (target === null) {
        ctx.announce('That insert position is no longer valid.');
        return;
      }
      openInsertPanel(ctx, target, panel);
    };
    const target: HTMLElement | Document = surface ?? document;
    target.addEventListener('sem-edit-insert-request', listener);
    detach.push(() => target.removeEventListener('sem-edit-insert-request', listener));
  }

  if (canvas !== null) {
    if (opts.plusZones !== false) {
      detach.push(
        attachPlusZones({ container: canvas, ctx, openPanel: (target) => openInsertPanel(ctx, target, panel) }),
      );
    }
    if (opts.slash !== false) {
      detach.push(attachSlashCommand({ root: canvas, ctx }));
    }
  }

  return () => {
    for (const fn of detach) fn();
  };
}
