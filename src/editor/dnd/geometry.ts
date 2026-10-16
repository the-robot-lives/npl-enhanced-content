/**
 * dnd/geometry — pure drop-position math. No DOM reads here: callers hand
 * in sibling rects (getBoundingClientRect results) and the pointer, so the
 * logic is unit-testable in happy-dom (which lays out nothing).
 */

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointLike {
  x: number;
  y: number;
}

/**
 * Insertion index among DOM-ordered sibling rects for a pointer position:
 * the count of siblings whose midpoint is at or before the pointer along
 * `axis`. Result range `0..rects.length` (0 = before the first, length =
 * after the last). Rects MUST be in document order.
 */
export function dropIndexFromRects(rects: readonly RectLike[], point: PointLike, axis: 'y' | 'x' = 'y'): number {
  let index = 0;
  for (const r of rects) {
    const mid = axis === 'y' ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
    const p = axis === 'y' ? point.y : point.x;
    if (p >= mid) index++;
  }
  return index;
}

/** The gap rectangle where an indicator renders for slot `index`:
 *  a thin horizontal (axis y) or vertical (axis x) band at the boundary
 *  before the `index`-th rect (or after the last). */
export function indicatorRectFor(rects: readonly RectLike[], index: number, axis: 'y' | 'x', thickness = 3): RectLike | null {
  if (rects.length === 0) return null;
  const edge =
    index >= rects.length
      ? rects[rects.length - 1]
      : rects[index];
  if (axis === 'y') {
    const y = index >= rects.length ? edge.bottom : edge.top;
    return { left: edge.left, right: edge.right, top: y - thickness / 2, bottom: y + thickness / 2 };
  }
  const x = index >= rects.length ? edge.right : edge.left;
  return { left: x - thickness / 2, right: x + thickness / 2, top: edge.top, bottom: edge.bottom };
}
