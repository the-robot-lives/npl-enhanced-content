/**
 * render/types — the renderer contract (CORE-V2 §8).
 *
 * One contract, two implementations: the canvas driver (canvas.ts) paints
 * the pixels; the DOM mirror (mirror.ts) is the accessibility / find-in-page
 * / copy surface that is also promoted to the visible view on forced-colors,
 * a failed 2d context, `renderer="dom"`, or the context menu (§8.5).
 *
 * Both implementations are consumers: neither owns display state. They read
 * a `PaintScreen` (the core-screen ScreenModel seen through the adapter in
 * screen-shape.ts) and repaint from `DamageSet`s the screen batches (§4.5).
 *
 * Cell/attr/color/cursor/damage shapes come from the published screen-model
 * types (`src/terminal/screen/types.ts`, core-screen lane) — one source, no
 * drift. The ScreenRenderer lifecycle matches the lane brief's
 * `{attach, paint(damage), resize, destroy}` AND CORE-V2 §8's
 * `{attach, metrics(), drain(damage), detach()}`: `paint` aliases `drain`,
 * `destroy` aliases `detach`. Either integration spelling is one call.
 */

import type { Damage } from '../screen/types.js';
import type { PaintScreen } from './screen-shape.js';

/** Cell attribute bits — re-exported from the screen model (§4.1). */
export { ATTR, ATTR_MASK } from '../screen/types.js';

/**
 * The renderer's read-side view of the screen (the adapter in
 * screen-shape.ts builds one from a ScreenModel).
 */
export type { PaintScreen, PaintLine, PaintCell, PaintCursor, Rgb } from './screen-shape.js';
export type { CursorStyle, SelectionRange, ScreenPos } from '../screen/types.js';

/** xterm-style cell metrics in CSS pixels (§8.3 Fonts). */
export interface CellMetrics {
  /** Viewport columns the host box currently fits. */
  readonly cols: number;
  /** Viewport rows the host box currently fits. */
  readonly rows: number;
  /** Monospace advance width in CSS px. */
  readonly cellWidth: number;
  /** Line advance in CSS px. */
  readonly cellHeight: number;
  /** Backing-store scale actually in use (clamped 1–3). */
  readonly dpr: number;
}

/** The screen-batched damage set (§4.5), aliasing the screen-model type. */
export type DamageSet = Damage;

/**
 * The one renderer contract. `attach` binds a screen + host element and
 * mounts the paint surface; `drain` repaints the frame batch; `resize`
 * re-measures after the host box changed; `detach` tears everything down.
 */
export interface ScreenRenderer {
  attach(screen: PaintScreen, host: HTMLElement): void;
  metrics(): CellMetrics;
  /** CORE-V2 §8 name — called once per animation frame with the batch. */
  drain(damage: DamageSet): void;
  /** Host box / DPR changed: re-measure, resize the backing store, repaint all. */
  resize(): void;
  /** Unmount, drop listeners, release the canvas + atlas. */
  detach(): void;
}

/** Structural alias so either lane-side spelling type-checks. */
export interface ScreenRendererBrief extends ScreenRenderer {
  /** Alias of `drain` (lane-brief spelling). */
  paint(damage?: DamageSet): void;
  /** Alias of `detach` (lane-brief spelling). */
  destroy(): void;
}
