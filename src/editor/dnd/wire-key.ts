/**
 * dnd/wire-key — the capture-phase listener behind attachKeyboardMoves.
 * Split from keyboard.ts so the default resolver's controller imports stay
 * out of test graphs that inject their own resolver (import-shape parity
 * with how the controller lazily imports actions).
 */

import type { EditorContext } from '../controller/types.js';
import type { NodeId } from '../model/types.js';
import { bindingFromElement, hoveredModelId, labelFor } from './resolve.js';
import { demoteNode, promoteNode } from './placement.js';

type Resolver = (target: EventTarget | null) => { ctx: EditorContext; rootId: NodeId; label: string } | null;

export const defaultResolver: Resolver = (target) => {
  const el = target instanceof Element ? target : null;
  const handle = bindingFromElement(el);
  if (handle === null) return null;
  // The chord targets the DEEPEST authored element under the key event, not
  // the binding root — a keydown on a nested sem-fact moves that sem-fact.
  // Fall back to the binding root when the target sits over unmodeled
  // chrome (the host itself is still a movable model element).
  const id = hoveredModelId(handle.ctx, handle.binding, el) ?? handle.rootId;
  return { ctx: handle.ctx, rootId: id, label: labelFor(handle.ctx, id) };
};

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function attachKeyboardMovesListener(doc: Document, resolve?: Resolver): () => void {
  const resolver = resolve ?? defaultResolver;
  const onKey = (e: KeyboardEvent): void => {
    // Claim exactly the promote/demote chord: Alt+Shift+Arrow, no other
    // modifiers. Plain Alt+arrows stay the controller's (§4.7).
    if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (!MOVE_KEYS.has(e.key)) return;
    const handle = resolver(e.target);
    if (handle === null) return;
    e.preventDefault();
    e.stopPropagation();
    const promote = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const result = promote ? promoteNode(handle.ctx, handle.rootId, handle.label) : demoteNode(handle.ctx, handle.rootId, handle.label);
    if (!result.ok) return; // refusal/noop announcements already emitted
    if (promote) {
      handle.ctx.announce(`${handle.label} moved out one level`);
    } else {
      handle.ctx.announce(`${handle.label} nested into previous sibling`);
    }
  };
  doc.addEventListener('keydown', onKey, true);
  return () => doc.removeEventListener('keydown', onKey, true);
}
