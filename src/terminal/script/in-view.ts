/**
 * in-view — element visibility + document visibility watches.
 *
 * The autostart contract: a `start-script` demo does not run until the
 * shell first scrolls into view (IntersectionObserver, threshold ~0.5,
 * once), then pauses whenever it leaves view or the tab hides, and
 * resumes when both are true again. Observers are injectable so unit
 * tests drive the callbacks directly.
 *
 * No IntersectionObserver in this environment (old engine, test DOM):
 * the demo starts immediately — better started early than never —
 * with nothing to pause on.
 */

export interface InViewHandlers {
  /** The element crossed the start threshold (also fired on re-entry). */
  onShown(): void;
  /** The element fell below the hold fraction (demo should pause). */
  onHidden?(): void;
}

export interface InViewOptions extends InViewHandlers {
  /** Fraction visible that counts as shown (default 0.5). */
  start?: number;
  /** Below this fraction the demo pauses again (default 0.05). */
  hold?: number;
  /** Injectable observer constructor (tests); default the global one. */
  IntersectionObserver?: typeof IntersectionObserver;
}

export interface InViewWatch {
  dispose(): void;
}

export function watchInView(target: Element, options: InViewOptions): InViewWatch {
  const start = options.start ?? 0.5;
  const hold = Math.min(options.hold ?? 0.05, start);
  const Ctor = options.IntersectionObserver ?? globalThis.IntersectionObserver;
  let seen = false;
  let shown = false;

  if (typeof Ctor !== 'function') {
    const id = setTimeout(() => {
      seen = true;
      shown = true;
      options.onShown();
    }, 0);
    return { dispose: () => clearTimeout(id) };
  }

  const io = new Ctor((entries) => {
    for (const entry of entries) {
      const ratio = entry.intersectionRatio;
      if (!seen && ratio >= start) {
        seen = true;
        shown = true;
        options.onShown();
        continue;
      }
      if (seen && shown && ratio < hold) {
        shown = false;
        options.onHidden?.();
        continue;
      }
      if (seen && !shown && ratio >= start) {
        shown = true;
        options.onShown();
        continue;
      }
    }
  }, { threshold: [hold, start] });
  io.observe(target);
  return { dispose: () => io.disconnect() };
}

export interface VisibleHandlers {
  onShown(): void;
  onHidden(): void;
}

export interface VisibleWatch {
  dispose(): void;
}

/** A minimal document surface — the real Document satisfies it; tests fake it. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function watchVisible(source: VisibilitySource, handlers: VisibleHandlers): VisibleWatch {
  const onChange = (): void => (source.hidden ? handlers.onHidden() : handlers.onShown());
  source.addEventListener('visibilitychange', onChange);
  return {
    dispose: () => source.removeEventListener('visibilitychange', onChange),
  };
}
