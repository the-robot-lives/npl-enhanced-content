/**
 * dnd — public surface (EDITOR.md §5.6 drag & drop + keyboard moves).
 *
 * Shipped wiring:
 *   wireDnD()  — inject the lane CSS, attach HTML5 DnD (chip-as-handle,
 *                schema-permitted drop indicators, one-moveNode drops,
 *                edge auto-scroll, Esc cancel) AND the Alt+Shift+Arrow
 *                promote/demote keyboard parity.
 *
 * Pieces are exported individually for tests and for integrate to compose
 * (e.g. shell may own the CSS injection block ordering).
 */

import { attachDnD } from './drag.js';
import { attachKeyboardMoves } from './keyboard.js';
import type { EdgeAutoScroll } from './autoscroll.js';
import { DND_CSS } from './dnd-css.js';

export { attachDnD } from './drag.js';
export { attachKeyboardMoves } from './keyboard.js';
export type { KeyboardMovesOptions } from './keyboard.js';
export {
  createEdgeAutoScroll,
  type EdgeAutoScroll,
  type EdgeAutoScrollOptions,
  type ScrollerLike,
} from './autoscroll.js';
export { dropIndexFromRects, indicatorRectFor, type PointLike, type RectLike } from './geometry.js';
export { hideDropIndicator, showDropIndicator, dropIndicatorVisible } from './indicators.js';
export {
  demoteNode,
  promoteNode,
  performMove,
  isMoveAllowed,
  isReorderNoOp,
  moveOpIndex,
  modelIndexForElementSlot,
  elementChildrenOf,
  elementIndexOf,
  structuralParentId,
  type MoveResult,
} from './placement.js';
export { bindingFromElement, hoveredModelId, draggedElementFor, labelFor, type BindingHandle } from './resolve.js';
export { DND_MIME, CHIP_SELECTOR, EDITING_HOST_SELECTOR, INDICATOR_CLASS, DRAGGING_CLASS, type DragState, type DropCandidate } from './types.js';
export { DND_CSS } from './dnd-css.js';

export interface WireDnDOptions {
  doc?: Document;
  autoscroll?: EdgeAutoScroll;
}

/**
 * Full wiring for one document: CSS block + drag + keyboard. Returns one
 * detach fn covering all three.
 */
export function wireDnD(options: WireDnDOptions = {}): () => void {
  const doc = options.doc ?? document;
  if (!doc.querySelector('style[data-sem-editor-css][data-sem-ed-block="dnd"]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-sem-editor-css', '');
    style.setAttribute('data-sem-ed-block', 'dnd');
    style.textContent = DND_CSS;
    doc.head.appendChild(style);
  }
  const offDnD = attachDnD({ doc, autoscroll: options.autoscroll });
  const offKeys = attachKeyboardMoves({ doc });
  return () => {
    offDnD();
    offKeys();
  };
}
