/**
 * dnd/autoscroll — edge auto-scroll while dragging (§5.6). A rAF-driven
 * loop nudges the nearest scrollable ancestor when the pointer parks
 * within `threshold` px of its top/bottom edge. Reduced motion keeps the
 * functional scroll but skips easing (fixed steps, no acceleration).
 * The tick is exposed for tests; the rAF loop is a thin driver.
 */

const DEFAULT_THRESHOLD = 48;
const DEFAULT_STEP = 14;

export interface EdgeAutoScrollOptions {
  /** Current pointer (null = not over the document — stops the loop). */
  getPoint: () => { x: number; y: number } | null;
  /** The scrollable ancestor for an element (default: `.sem-window-viewport`
   *  ancestor, else the document scrolling element). */
  scrollerOf?: (anchor: Element | null) => ScrollerLike | null;
  threshold?: number;
  step?: number;
  reducedMotion?: boolean;
  /** Loop driver override (tests). Defaults to requestAnimationFrame. */
  schedule?: (fn: () => void) => void;
}

export interface ScrollerLike {
  scrollTop: number;
  scrollLeft?: number;
  scrollHeight: number;
  clientHeight: number;
  scrollBy(options: { top: number; behavior?: string }): void;
  getBoundingClientRect(): { top: number; bottom: number };
}

export interface EdgeAutoScroll {
  /** Re-evaluate after a dragover: start/steer/stop the loop. */
  update(anchor: Element | null): void;
  /** One scroll decision (unit-testable): scrolls when the point is inside
   *  an edge zone. Returns the applied delta (0 = no scroll). */
  tick(): number;
  stop(): void;
}

export function createEdgeAutoScroll(opts: EdgeAutoScrollOptions): EdgeAutoScroll {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const step = opts.step ?? DEFAULT_STEP;
  const schedule = opts.schedule ?? ((fn: () => void) => requestAnimationFrame(fn));
  const scrollerOf =
    opts.scrollerOf ??
    ((anchor: Element | null): ScrollerLike | null => {
      if (anchor !== null) {
        const frame = anchor.closest('.sem-window-viewport');
        if (frame !== null) return frame as unknown as ScrollerLike;
      }
      const docEl = anchor?.ownerDocument.scrollingElement ?? null;
      return docEl !== null ? (docEl as unknown as ScrollerLike) : null;
    });

  let scroller: ScrollerLike | null = null;
  let running = false;

  const loop = (): void => {
    if (!running) return;
    tick();
    if (!running) return;
    schedule(loop);
  };

  const tick = (): number => {
    const point = opts.getPoint();
    if (point === null || scroller === null) return 0;
    const rect = scroller.getBoundingClientRect();
    const fromTop = point.y - rect.top;
    const fromBottom = rect.bottom - point.y;
    let delta = 0;
    if (fromTop >= 0 && fromTop < threshold) {
      const falloff = opts.reducedMotion ? 1 : Math.max(0.25, 1 - fromTop / threshold);
      delta = -Math.round(step * falloff);
    } else if (fromBottom >= 0 && fromBottom < threshold) {
      const falloff = opts.reducedMotion ? 1 : Math.max(0.25, 1 - fromBottom / threshold);
      delta = Math.round(step * falloff);
    }
    if (delta !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollBy({ top: delta });
      if (scroller.scrollTop === before) return 0; // hit the scroll extent
    }
    return delta;
  };

  return {
    update(anchor: Element | null): void {
      const next = scrollerOf(anchor);
      if (next === null) {
        this.stop();
        return;
      }
      const changed = next !== scroller;
      scroller = next;
      if (!running) {
        running = true;
        schedule(loop);
      } else if (changed) {
        // loop keeps running; it picks up the new scroller next tick
      }
    },
    tick,
    stop(): void {
      running = false;
      scroller = null;
    },
  };
}
