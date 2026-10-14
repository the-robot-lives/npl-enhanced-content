/**
 * render/selection — viewport selection geometry + text serialization
 * (CORE-V2 §7.3, §9).
 *
 * Selection and copy run through the screen: drag-select paints canvas
 * overlays; assistive/platform selection on the mirror addresses the same
 * (absoluteLine, col) ranges. NOTE on copy: core-screen owns THE one
 * `extractText` (`ScreenTextSource` over ring + viewport, `screen.ts`) —
 * the clipboard path integrates with that. `viewportText` here is the same
 * algorithm scoped to the viewport window, feeding the canvas overlay
 * paths, the mirror and the test golden strings.
 *
 * Wrapped lines (the `wrapped` flag is set on the continuation line, §4.3)
 * join without a newline; trailing spaces trim per row; width-0 continuation
 * cells are skipped (their wide base cell already rendered).
 */

import { colsOnLine, normalizeRange, type PaintScreen, type SelRange } from './screen-shape.js';

/** Text for a column slice of one line: chars only, no padding. */
export function lineText(
  line: NonNullable<ReturnType<PaintScreen['lineAt']>>,
  from = 0,
  to = Number.MAX_SAFE_INTEGER,
): string {
  let text = '';
  const end = Math.min(to, line.cols);
  for (let col = Math.max(0, from); col < end; col++) {
    const cell = line.cell(col);
    if (cell.width === 0) continue; // continuation cell — the base cell rendered
    if (cell.code === 0) text += ' ';
    else {
      text += String.fromCodePoint(cell.code);
      for (const mark of cell.combining) text += String.fromCodePoint(mark);
    }
  }
  return text;
}

/** Trailing-space trim for a rendered row (copy semantics, v1-compatible). */
function trimEnd(text: string): string {
  return text.replace(/[ ]+$/, '');
}

/**
 * The viewport (or a selection slice of it) as plain text. Same algorithm as
 * core-screen's `extractText`, scoped to the viewport window — the overlay,
 * mirror and test golden strings serialize through this.
 */
export function viewportText(screen: PaintScreen, range?: SelRange): string {
  const rows: string[] = [];
  const bounds = range ? normalizeRange(range) : null;
  for (let row = 0; row < screen.rows; row++) {
    const abs = screen.absoluteLineAt(row);
    const line = screen.lineAt(row);
    if (abs === null || line === null) continue;
    const cols = bounds === null
      ? { from: 0, to: screen.cols }
      : colsOnLine(bounds, abs, screen.cols);
    rows.push(trimEnd(lineText(line, cols.from, cols.to)));
  }
  // A row whose successor is a wrapped continuation joins without a newline.
  let out = '';
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1];
    if (next === undefined) {
      out += rows[i];
      break;
    }
    const nextRow = nextRowOf(screen, i);
    const nextLine = nextRow === null ? null : screen.lineAt(nextRow);
    out += rows[i] + (nextLine !== null && nextLine.wrapped ? '' : '\n');
  }
  return out;
}

function nextRowOf(screen: PaintScreen, row: number): number | null {
  // Find the next *rendered* row (extractText skips absent lines).
  for (let r = row + 1; r < screen.rows; r++) {
    if (screen.lineAt(r) !== null && screen.absoluteLineAt(r) !== null) return r;
  }
  return null;
}

/** Per-row selection run for overlay painting / mirror highlighting. */
export interface RowRun {
  readonly row: number;
  readonly from: number;
  /** Exclusive end column. */
  readonly to: number;
}

/**
 * Map absolute-space selection ranges onto viewport rows. The canvas paints
 * one translucent rect per run; the mirror expresses the same runs natively.
 */
export function selectionRowRuns(screen: PaintScreen, ranges: readonly SelRange[]): RowRun[] {
  const runs: RowRun[] = [];
  for (const raw of ranges) {
    const range = normalizeRange(raw);
    for (let row = 0; row < screen.rows; row++) {
      const abs = screen.absoluteLineAt(row);
      if (abs === null) continue;
      const cols = colsOnLine(range, abs, screen.cols);
      if (cols !== null && cols.to > cols.from) runs.push({ row, from: cols.from, to: cols.to });
    }
  }
  return runs;
}
