/**
 * render/screen-shape — the renderer's read-side view of the screen.
 *
 * core-screen publishes the model (`src/terminal/screen/types.ts`): SoA
 * lines, absolute-line-space cursor/selection, a scrollback ring, and the
 * viewport window (`Buffer.lines`). Renderers want a small structural view:
 * row-indexed lines with materialized cells, viewport-space cursor, and a
 * color-ref → RGB resolver (§4.2). This module is that seam —
 * `screenView(screen)` adapts a `ScreenModel`; `buildPaintScreen(grid)`
 * builds an equivalent fixture straight from strings (tests, golden grids,
 * integration smoke). The canvas driver and mirror consume `PaintScreen`
 * and never touch the model directly, so either source satisfies them.
 *
 * Color refs (§4.2): 0–255 palette (0–15 themed, 16–255 xterm cube),
 * 0x8000–0xFFFE truecolor table, 0xFFFF theme default — constants alias the
 * screen model's own (one source, no drift).
 */

import { ansiIndexedRgb } from '../ansi/index.js';
import {
  ATTR_MASK,
  COLOR_DEFAULT,
  COLOR_TRUECOLOR_BASE,
  COLOR_TRUECOLOR_MAX,
  type Color,
  type CursorStyle,
  type Line,
  type ScreenModel,
  type SelectionRange,
} from '../screen/types.js';

export { ATTR, ATTR_MASK, COLOR_DEFAULT, COLOR_TRUECOLOR_BASE, COLOR_TRUECOLOR_MAX } from '../screen/types.js';
export type { CursorStyle, Line, ScreenModel, SelectionRange, ScreenPos } from '../screen/types.js';

/** Alias kept for the doc spelling (CORE-V2 §4.2 `0xFFFF`). */
export const REF_DEFAULT = COLOR_DEFAULT;
/** Alias kept for the doc spelling (CORE-V2 §4.2 `0x8000`). */
export const REF_TRUECOLOR_BASE = COLOR_TRUECOLOR_BASE;

/** True when `ref` indexes the screen's truecolor table (§4.2). */
export function isTruecolorRef(ref: number): boolean {
  return ref >= COLOR_TRUECOLOR_BASE && ref <= COLOR_TRUECOLOR_MAX;
}

/** An 8-bit RGB triple (what the truecolor table stores). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One materialized cell position (the logical `Cell` shape, §4.1). */
export interface PaintCell {
  code: number;
  combining: number[];
  width: 0 | 1 | 2;
  fg: Color;
  bg: Color;
  attrs: number;
}

/** One viewport line: cell materializer + wrap flag (§4.3). */
export interface PaintLine {
  cell(col: number): PaintCell;
  readonly wrapped: boolean;
  /** Column count — cell() answers every index, so scanners need this bound. */
  readonly cols: number;
  /** Underlying model line when adapted from one (tests use fixtures). */
  readonly source?: Line;
}

/** The drawn cursor in viewport space (§8.3 style vocabulary). */
export interface PaintCursor {
  row: number;
  col: number;
  visible: boolean;
  style: CursorStyle;
}

/** The renderer's read-side screen view (§4, viewport window only). */
export interface PaintScreen {
  readonly cols: number;
  readonly rows: number;
  /** Viewport row `row` (0 = top), or null past the end. */
  lineAt(row: number): PaintLine | null;
  /** Row currently displaying this exact line ref, or null (scrolled off). */
  rowOfLine(line: object): number | null;
  /** Absolute index (ring + viewport) of viewport row `row`, or null. */
  absoluteLineAt(row: number): number | null;
  /** The cursor clamped into the viewport, or null when scrolled off. */
  cursor(): PaintCursor | null;
  /** Live selections in absolute-line space (§7.3 — a single range today). */
  selection(): readonly SelectionRange[];
  /** Resolve a color ref to RGB, or null for unknown/unavailable. */
  rgbOf(ref: number, layer: 'fg' | 'bg'): Rgb | null;
}

/* ------------------------------------------------------------------ *
 * Default colors (dark-theme fallbacks; the integrator overrides via
 * `screenView` options when the theme tokens are resolvable)
 * ------------------------------------------------------------------ */

/** The 16 ANSI slots, dark-theme fallbacks (palette.ts keeps the themed ones). */
export const DEFAULT_ANSI16: readonly Rgb[] = Object.freeze([
  { r: 0x1c, g: 0x20, b: 0x26 }, { r: 0xe5, g: 0x53, b: 0x4e }, { r: 0x7d, g: 0xc4, b: 0x75 },
  { r: 0xdd, g: 0xb2, b: 0x67 }, { r: 0x61, g: 0xaf, b: 0xef }, { r: 0xc6, g: 0x78, b: 0xdd },
  { r: 0x56, g: 0xb6, b: 0xc2 }, { r: 0xab, g: 0xb2, b: 0xbf }, { r: 0x5c, g: 0x63, b: 0x70 },
  { r: 0xf0, g: 0x6c, b: 0x74 }, { r: 0x98, g: 0xc3, b: 0x79 }, { r: 0xe5, g: 0xc0, b: 0x7b },
  { r: 0x61, g: 0xaf, b: 0xef }, { r: 0xc6, g: 0x78, b: 0xdd }, { r: 0x56, g: 0xb6, b: 0xc2 },
  { r: 0xd7, g: 0xde, b: 0xe7 },
]) as readonly Rgb[];

export const DEFAULT_FG: Rgb = { r: 0xd7, g: 0xde, b: 0xe7 };
export const DEFAULT_BG: Rgb = { r: 0x0f, g: 0x12, b: 0x16 };

/** Palette index 16–255 → RGB (the xterm cube; the ansi lane's table). */
export function defaultRgb(ref: number): Rgb | null {
  if (ref >= 0 && ref <= 255) {
    const rgb = ansiIndexedRgb(ref);
    return { r: rgb.r, g: rgb.g, b: rgb.b };
  }
  return null;
}

/** `rgb()` CSS string (canvas fillStyle and inline styles both take it). */
export function cssRgb(rgb: Rgb): string {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
}

/* ------------------------------------------------------------------ *
 * screenView — adapt the real ScreenModel (the integration path)
 * ------------------------------------------------------------------ */

export interface ScreenViewOptions {
  /** RGB for palette indices 0–15 (theme tokens); default the fallback set. */
  ansiRgb?(index: number): Rgb | null;
  /** Truecolor-table slot lookup; default null (refs resolve to the default). */
  truecolorAt?(slot: number): readonly [number, number, number] | null;
}

/**
 * Adapt a `ScreenModel` to the renderer's read-side view. Cheap to call per
 * frame (no copying — cells materialize lazily in `PaintLine.cell`).
 */
export function screenView(screen: ScreenModel, options: ScreenViewOptions = {}): PaintScreen {
  const ansiOf = (index: number): Rgb | null =>
    options.ansiRgb ? options.ansiRgb(index) : (DEFAULT_ANSI16[index] ?? null);

  const rgbOf = (ref: number, _layer: 'fg' | 'bg'): Rgb | null => {
    if (ref === COLOR_DEFAULT) return null; // renderer composes its own defaults
    if (isTruecolorRef(ref)) {
      const rgb = options.truecolorAt ? options.truecolorAt(ref - COLOR_TRUECOLOR_BASE) : null;
      return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null;
    }
    if (ref >= 0 && ref <= 15) return ansiOf(ref);
    return defaultRgb(ref);
  };

  const lineView = (line: Line): PaintLine => ({
    wrapped: line.wrapped,
    cols: line.cols,
    source: line,
    cell(col: number): PaintCell {
      return {
        code: line.codes[col] ?? 0,
        combining: line.combining?.get(col) ?? [],
        width: (line.widths[col] ?? 1) as 0 | 1 | 2,
        fg: line.fg[col] ?? COLOR_DEFAULT,
        bg: line.bg[col] ?? COLOR_DEFAULT,
        attrs: (line.attrs[col] ?? 0) & ATTR_MASK,
      };
    },
  });

  const top = (): number => {
    try {
      return screen.viewportTop();
    } catch {
      return Math.max(0, screen.totalLines() - screen.rows);
    }
  };

  return {
    cols: screen.cols,
    rows: screen.rows,
    lineAt(row: number): PaintLine | null {
      const line = screen.active.lines[row];
      return line === undefined ? null : lineView(line);
    },
    rowOfLine(line: object): number | null {
      const idx = (screen.active.lines as unknown as object[]).indexOf(line);
      return idx === -1 ? null : idx;
    },
    absoluteLineAt(row: number): number | null {
      if (row < 0 || row >= screen.rows) return null;
      return top() + row;
    },
    cursor(): PaintCursor | null {
      const cur = screen.cursor;
      const row = cur.line - top();
      if (row < 0 || row >= screen.rows) return null; // scrolled off — not drawn
      return { row, col: cur.col, visible: cur.visible, style: cur.style };
    },
    selection(): readonly SelectionRange[] {
      return screen.selection === null ? [] : [screen.selection];
    },
    rgbOf,
  };
}

/* ------------------------------------------------------------------ *
 * Range helpers (shared by canvas overlay, mirror and selection text)
 * ------------------------------------------------------------------ */

/** Alias kept for the doc spelling (CORE-V2 §7.3 selection range). */
export type SelRange = SelectionRange;

/** Order two range endpoints (start ≤ end in absolute-line space). */
export function normalizeRange(range: SelectionRange): SelectionRange {
  const a = range.start;
  const b = range.end;
  if (a.line < b.line || (a.line === b.line && a.col <= b.col)) {
    return { start: { line: a.line, col: a.col }, end: { line: b.line, col: b.col } };
  }
  return { start: { line: b.line, col: b.col }, end: { line: a.line, col: a.col } };
}

/** Does a normalized range touch the absolute line `abs`? */
export function rangeOverlapsLine(range: SelectionRange, abs: number): boolean {
  const { start, end } = normalizeRange(range);
  return abs >= start.line && abs <= end.line;
}

/** Cells a selection covers on one line (clamped to `cols`). */
export function colsOnLine(range: SelectionRange, abs: number, cols: number): { from: number; to: number } {
  const { start, end } = normalizeRange(range);
  if (abs < start.line || abs > end.line) return { from: 0, to: 0 };
  const from = abs === start.line ? Math.min(start.col, cols) : 0;
  const to = abs === end.line ? Math.min(end.col, cols) : cols;
  return { from, to };
}

/* ------------------------------------------------------------------ *
 * buildPaintScreen — string-grid fixture (tests, golden grids)
 * ------------------------------------------------------------------ */

/** One fixture line: text plus optional wrap flag. */
export interface ScreenDataRow {
  text: string;
  wrapped?: boolean;
}

/** Input grid for `buildPaintScreen` — plain strings, one per viewport row. */
export type ScreenData = readonly (string | ScreenDataRow)[];

interface FixtureLine extends PaintLine {
  readonly cells: PaintCell[];
}

/**
 * Build a PaintScreen fixture from a string grid. Wide characters are
 * detected with a small East-Asian-width subset (enough for tests: CJK,
 * kana, fullwidth forms — the same ranges `width.ts` classifies); the cell
 * after a wide char is the width-0 continuation. No styling — every cell is
 * default fg/bg, attrs 0.
 */
export function buildPaintScreen(data: ScreenData, options: { cols?: number; cursor?: PaintCursor | null; selection?: readonly SelectionRange[] | null } = {}): PaintScreen {
  const rows = data.length;
  const cols = options.cols ?? data.reduce((max, row) => Math.max(max, typeof row === 'string' ? row.length : row.text.length), 0);
  const lines: FixtureLine[] = data.map((row) => {
    const text = typeof row === 'string' ? row : row.text;
    const wrapped = typeof row === 'string' ? false : (row.wrapped ?? false);
    const cells: PaintCell[] = [];
    for (let i = 0; i < cols; i++) {
      cells.push({ code: 0, combining: [], width: 1, fg: COLOR_DEFAULT, bg: COLOR_DEFAULT, attrs: 0 });
    }
    let col = 0;
    for (const ch of text) {
      if (col >= cols) break;
      const code = ch.codePointAt(0) ?? 0;
      const wide = isWideCodepoint(code);
      cells[col] = { code, combining: [], width: wide ? 2 : 1, fg: COLOR_DEFAULT, bg: COLOR_DEFAULT, attrs: 0 };
      if (wide) {
        if (col + 1 < cols) cells[col + 1] = { code: 0, combining: [], width: 0, fg: COLOR_DEFAULT, bg: COLOR_DEFAULT, attrs: 0 };
        col += 2;
      } else {
        col += 1;
      }
    }
    return {
      wrapped,
      cols: cells.length,
      cells,
      cell(col: number): PaintCell {
        return cells[col] ?? { code: 0, combining: [], width: 1, fg: COLOR_DEFAULT, bg: COLOR_DEFAULT, attrs: 0 };
      },
    };
  });
  const cursor = options.cursor === undefined ? null : options.cursor;
  return {
    cols,
    rows,
    lineAt(row: number): PaintLine | null {
      return lines[row] ?? null;
    },
    rowOfLine(line: object): number | null {
      const idx = lines.indexOf(line as FixtureLine);
      return idx === -1 ? null : idx;
    },
    absoluteLineAt(row: number): number | null {
      return row >= 0 && row < rows ? row : null;
    },
    cursor(): PaintCursor | null {
      return cursor;
    },
    selection(): readonly SelectionRange[] {
      return options.selection ?? [];
    },
    rgbOf(): Rgb | null {
      return null;
    },
  };
}

/** East-Asian-wide subset used by the fixture (U+ ranges, §width.ts). */
function isWideCodepoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, CJK symbols
    (code >= 0x3041 && code <= 0x33ff) || // Kana + CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compat ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compat forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) || // emoji (pictographic subset)
    (code >= 0x20000 && code <= 0x3fffd) // CJK ext B+
  );
}
