/**
 * render — public barrel for the renderer lane.
 *
 * The canvas driver is the one visible paint path (CORE-V2 §8.3); the DOM
 * mirror is the accessibility / find-in-page / selection surface that
 * doubles as the promoted text view (§8.5). core-screen integrates by
 * building `screenView(screen)`, calling `createCanvasRenderer()`,
 * `renderer.attach(view, host)`, then `renderer.drain(damage)` per
 * animation frame and `renderer.resize()` on host box changes — or the
 * lane-brief spellings `paint(damage?)`/`destroy()`.
 *
 * Types come from the screen model (`src/terminal/screen/types.ts`) so
 * renderer and screen cannot drift; this barrel re-exports the ones
 * integrators touch.
 */

export { GlyphAtlas, type AtlasCanvas, type AtlasSourceContext, type DrawContext, type GlyphKey, type GlyphSlot, type AtlasOptions } from './atlas.js';
export { createCanvasRenderer, CanvasRenderer, type CanvasRendererOptions, type CreateRendererResult, type PaintContext, type ViewEnvironment } from './canvas.js';
export { CANVAS_DOM_CSS } from './css.js';
export { clampDpr, fitCounts, measureCellMetrics, remeasureOnFontLoad, SHELL_FONT_STACK, type MeasuringContext, type MeasureOptions, type RawMetrics } from './metrics.js';
export { cellToSgr, DOMMirror, spansForLine, type MirrorOptions } from './mirror.js';
export {
  ATTR,
  ATTR_MASK,
  buildPaintScreen,
  COLOR_DEFAULT,
  COLOR_TRUECOLOR_BASE,
  COLOR_TRUECOLOR_MAX,
  colsOnLine,
  cssRgb,
  DEFAULT_ANSI16,
  DEFAULT_BG,
  DEFAULT_FG,
  defaultRgb,
  isTruecolorRef,
  normalizeRange,
  rangeOverlapsLine,
  REF_DEFAULT,
  REF_TRUECOLOR_BASE,
  screenView,
  type PaintCell,
  type PaintCursor,
  type PaintLine,
  type PaintScreen,
  type Rgb,
  type ScreenData,
  type ScreenDataRow,
  type ScreenModel,
  type ScreenViewOptions,
  type SelectionRange,
  type ScreenPos,
  type SelRange,
  type Line,
  type CursorStyle,
} from './screen-shape.js';
export { lineText, selectionRowRuns, viewportText, type RowRun } from './selection.js';
export type { CellMetrics, DamageSet, ScreenRenderer, ScreenRendererBrief } from './types.js';
