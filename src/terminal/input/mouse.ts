/**
 * mouse — pointer → cell coordinates, SGR-1006-style reporting, and the
 * selection state machine (CORE-V2 §7.3, §4.3, §9).
 *
 * Everything here is pure data: the DOM events are converted by the input
 * model, which hands us a pixel offset relative to the terminal surface
 * plus the active renderer's cell metrics — this module never touches a
 * MouseEvent. Selection addresses (absoluteLine, col) so scrollback
 * eviction clips a live selection instead of invalidating it, and copy
 * goes through extractText — the one text extractor the canvas selection
 * and the DOM mirror both use.
 */

import { type CellMetrics, type Mods, type MouseEventInfo, type SelectionPoint, type SelectionRange } from './types.js';

/**
 * Map a pixel offset from the terminal surface's top-left to a clamped cell.
 * Fractional pixels floor (the glyph's left half is the cell).
 */
export function cellFromPoint(px: number, py: number, metrics: CellMetrics): { col: number; row: number } {
  const col = Math.min(metrics.cols - 1, Math.max(0, Math.floor(px / metrics.cellWidth)));
  const row = Math.min(metrics.rows - 1, Math.max(0, Math.floor(py / metrics.cellHeight)));
  return { col, row };
}

function modBits(mods: Mods): number {
  return (mods.shift ? 4 : 0) + (mods.meta ? 8 : 0) + (mods.ctrl ? 16 : 0);
}

/**
 * The SGR-1006 button number for a click/drag report: button 0/1/2 =
 * left/middle/right, drag (any-motion) adds 32, mods add 4/8/16
 * (shift/meta/ctrl). The screen contract's MouseEvent carries the mods
 * flat (no meta — browser-owned), so callers fold them through modsOfEvent.
 */
export function sgrButtonNumber(kind: 'press' | 'release' | 'drag', button: 0 | 1 | 2, mods: Mods): number {
  const base = kind === 'drag' ? 32 : button & 3;
  return base + modBits(mods);
}

/** Wheel reports encode as 64 + (1 when the wheel scrolls down). */
export function sgrWheelButton(dy: number, mods: Mods): number {
  return 64 + (dy > 0 ? 1 : 0) + modBits(mods);
}

/** The screen contract's flat mouse mods → our Mods (meta is not in the contract). */
export function modsOfEvent(ev: MouseEventInfo): Mods {
  return { ctrl: ev.ctrl, alt: ev.alt, shift: ev.shift, meta: false };
}

/**
 * The SGR-style report string, 1006 semantics throughout (we never
 * synthesize legacy X10 encodings): `<btn;col;row` with 1-based
 * coordinates, `M` to end a press/drag report, `m` a release. Wheel
 * reports its cell too — the deltas are what the app acts on.
 */
export function sgrSequence(ev: MouseEventInfo): string {
  const mods = modsOfEvent(ev);
  if (ev.kind === 'wheel') {
    const btn = sgrWheelButton(ev.dy, mods);
    return `<${btn};${ev.col + 1};${ev.row + 1}M`;
  }
  const btn = sgrButtonNumber(ev.kind, ev.button, mods);
  const final = ev.kind === 'release' ? 'm' : 'M';
  return `<${btn};${ev.col + 1};${ev.row + 1}${final}`;
}

/**
 * Selection state in (absoluteLine, col) space. `begin` anchors,
 * `extend` drags, `end` freezes (the range survives for copy until
 * `clear`). Alt-drag is rectangular; ordinary drag is a stream over
 * logical lines.
 */
export class SelectionState {
  #anchor: SelectionPoint | null = null;
  #focus: SelectionPoint | null = null;
  #rectangular = false;
  #dragging = false;

  begin(line: number, col: number, rectangular = false): void {
    this.#anchor = { line, col };
    this.#focus = { line, col };
    this.#rectangular = rectangular;
    this.#dragging = true;
  }

  extend(line: number, col: number): void {
    if (this.#anchor === null) {
      this.begin(line, col, this.#rectangular);
      return;
    }
    this.#focus = { line, col };
  }

  end(): void {
    this.#dragging = false;
  }

  clear(): void {
    this.#anchor = null;
    this.#focus = null;
    this.#rectangular = false;
    this.#dragging = false;
  }

  /** True while the button is down. */
  get dragging(): boolean {
    return this.#dragging;
  }

  /** True while this is an Alt-drag rectangle — SelectionRange itself carries no flag. */
  get rectangular(): boolean {
    return this.#rectangular;
  }

  /**
   * The ordered bounds, in the screen contract's SelectionRange shape.
   * Stream mode orders the two points lexicographically; rectangular mode
   * returns the bounding corners (firstLine, firstCol) → (lastLine, lastCol).
   */
  ordered(): SelectionRange | null {
    if (this.#anchor === null || this.#focus === null) return null;
    if (!this.#rectangular) {
      const [start, end] =
        this.#anchor.line < this.#focus.line ||
        (this.#anchor.line === this.#focus.line && this.#anchor.col <= this.#focus.col)
          ? [this.#anchor, this.#focus]
          : [this.#focus, this.#anchor];
      return { start, end };
    }
    return {
      start: {
        line: Math.min(this.#anchor.line, this.#focus.line),
        col: Math.min(this.#anchor.col, this.#focus.col),
      },
      end: {
        line: Math.max(this.#anchor.line, this.#focus.line),
        col: Math.max(this.#anchor.col, this.#focus.col),
      },
    };
  }

  /** True when a selection exists and contains at least one cell. */
  isEmpty(): boolean {
    const r = this.ordered();
    return r === null || (r.start.line === r.end.line && r.start.col === r.end.col && !this.#rectangular);
  }

  /**
   * Clip to the lines still retained (scrollback eviction). A selection
   * fully outside the window clears; a partially retained one clamps its
   * evicted endpoint to the nearest retained edge. A live selection
   * degrades, it never dangles.
   */
  clip(minLine: number, maxLine: number): void {
    if (this.#anchor === null) return;
    const inside = (p: SelectionPoint): boolean => p.line >= minLine && p.line <= maxLine;
    const both = this.#anchor !== null && this.#focus !== null;
    if (both && !inside(this.#anchor!) && !inside(this.#focus!)) {
      this.clear();
      return;
    }
    const clamp = (p: SelectionPoint): SelectionPoint => ({
      line: Math.min(maxLine, Math.max(minLine, p.line)),
      col: p.line < minLine ? 0 : p.line > maxLine ? Number.MAX_SAFE_INTEGER : p.col,
    });
    this.#anchor = clamp(this.#anchor!);
    this.#focus = clamp(this.#focus!);
    if (this.isEmpty()) this.clear();
  }

  /**
   * The selected text. `getLine(line)` returns a logical line's text (the
   * caller folds wrapped segments — selection addresses logical lines, so
   * reflow cannot orphan a copy). Rectangular mode slices every spanned
   * line between the corner columns and joins with '\n'; stream mode
   * joins the line span, trimming to the selection inside the end lines.
   */
  extractText(getLine: (line: number) => string): string {
    const r = this.ordered();
    if (r === null) return '';
    const { start, end } = r;
    const slice = (line: number, from: number, to: number): string => getLine(line).slice(from, to + 1);
    if (this.#rectangular) {
      const parts: string[] = [];
      for (let line = start.line; line <= end.line; line += 1) parts.push(slice(line, start.col, end.col));
      return parts.join('\n');
    }
    if (start.line === end.line && start.col === end.col) return ''; // a click, not a selection
    if (start.line === end.line) return slice(start.line, start.col, end.col);
    const parts: string[] = [slice(start.line, start.col, Number.MAX_SAFE_INTEGER)];
    for (let line = start.line + 1; line < end.line; line += 1) parts.push(getLine(line));
    parts.push(slice(end.line, 0, end.col));
    return parts.join('\n');
  }
}
