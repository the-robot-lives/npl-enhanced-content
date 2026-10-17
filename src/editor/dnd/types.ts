/**
 * dnd — drag & drop + keyboard moves (EDITOR.md §5.6).
 *
 * This module owns the shared vocabulary of the lane: the drag payload MIME,
 * the DragState carried between dragstart and drop, and the tuning knobs
 * (edge-autoscroll thresholds, indicator class names). Every selector or
 * class the lane paints lives here or in dnd-css.ts.
 */

import type { NodeId } from '../model/types.js';

/** dataTransfer type carrying the model node id — NEVER HTML (§8: raw
 *  content drops go through the sanitizer path, not drag). */
export const DND_MIME = 'application/x-sem-node';

/** The drag handle is the label chip (§4.3/§5.6) — controller chrome. */
export const CHIP_SELECTOR = '.sem-ed-chip';

/** Hosts carry `data-sem-editing` (attach.ts stamps it). */
export const EDITING_HOST_SELECTOR = '[data-sem-editing]';

/** Drop indicator chrome (single instance per document while dragging). */
export const INDICATOR_CLASS = 'sem-ed-dropline';

/** Class stamped on the dragged source element for the drag's duration. */
export const DRAGGING_CLASS = 'sem-ed-dragging';

/** Live state for the drag in flight (null when not dragging). One drag at
 *  a time per document — the module-level state lives in drag.ts. */
export interface DragState {
  /** Model node id carried in the dataTransfer (the binding root). */
  nodeId: NodeId;
  /** Canonical dragged tag name (lowercase). */
  tag: string;
  /** The source DOM element (the bound host). */
  sourceEl: Element;
  /** The EditorContext the drag started in (bindings are per-context). */
  ctx: import('../controller/types.js').EditorContext;
  /** The last drop candidate resolved by dragover (recomputed at drop). */
  lastCandidate: DropCandidate | null;
  /** True once Escape cancelled the drag — drop is refused afterwards. */
  cancelled: boolean;
}

/** A validated drop position. `elementIndex` is ELEMENT-relative (the i-th
 *  element child); `modelIndex` is the pre-removal child index the
 *  `moveNode` op consumes (text children counted). */
export interface DropCandidate {
  containerId: NodeId;
  elementIndex: number;
  modelIndex: number;
  /** Geometry for the indicator (viewport coordinates, RectLike); null
   *  when unknown. */
  rect: import('./geometry.js').RectLike | null;
  axis: 'y' | 'x';
}
