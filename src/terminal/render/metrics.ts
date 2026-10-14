/**
 * render/metrics — cell metrics measurement (CORE-V2 §8.3 Fonts).
 *
 * A monospace stack; the advance width is measured once per font-load state
 * (`document.fonts.ready`) and re-measured when it changes — the canvas
 * driver calls `measureCellMetrics` through `remeasureOnFontLoad`. Width-2
 * glyphs are painted from the screen's own `width` flags; the measurer only
 * verifies the monospace assumption (wide glyph ≈ 2 × advance) so grid math
 * and paint agree.
 */

export const SHELL_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** What a measuring context must provide (real 2d contexts qualify). */
export interface MeasuringContext {
  font: string;
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number };
}

export interface MeasureOptions {
  /** CSS px font size (from the host's computed style; default 14). */
  fontSize?: number;
  /** Line height multiple (default 1.27 — comfortable terminal leading). */
  lineHeight?: number;
  /** Font family override; defaults to SHELL_FONT_STACK. */
  fontFamily?: string;
}

export interface RawMetrics {
  cellWidth: number;
  cellHeight: number;
  fontSize: number;
  /** Measured wide-glyph width ÷ advance (1.0 means the width table and paint agree). */
  wideRatio: number;
  fontCss: string;
}

/** Measure the monospace cell box. Pure given a measuring context. */
export function measureCellMetrics(ctx: MeasuringContext, options: MeasureOptions = {}): RawMetrics {
  const fontSize = options.fontSize ?? 14;
  const lineHeight = options.lineHeight ?? 1.27;
  const fontCss = `${fontSize}px ${options.fontFamily ?? SHELL_FONT_STACK}`;
  ctx.font = fontCss;
  const advance = ctx.measureText('W').width;
  const wide = ctx.measureText('Ｗ').width; // Ｗ FULLWIDTH LATIN CAPITAL LETTER W
  const cellWidth = advance > 0 ? advance : fontSize * 0.6;
  return {
    cellWidth,
    cellHeight: Math.round(fontSize * lineHeight),
    fontSize,
    wideRatio: advance > 0 ? wide / advance : 2,
    fontCss,
  };
}

/** Clamp CORE-V2 §8.3 backs with: devicePixelRatio ∈ [1, 3]. */
export function clampDpr(dpr: number): number {
  if (Number.isNaN(dpr)) return 1;
  return Math.min(3, Math.max(1, dpr));
}

/**
 * Fit counts for a host box: how many cols/rows the box fits at the given
 * cell size (at least one). Clamping to §4.6's [20,500]×[4,200] is the
 * screen's call on resize; this only reports geometry.
 */
export function fitCounts(width: number, height: number, cellWidth: number, cellHeight: number): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor(width / cellWidth)),
    rows: Math.max(1, Math.floor(height / cellHeight)),
  };
}

/**
 * Re-measure once web fonts settle. Calls `onChange` when the measured
 * advance moved (theme font swap); resolves immediately when fonts are not
 * a thing (tests, old engines).
 */
export function remeasureOnFontLoad(
  doc: Document | null,
  measure: () => RawMetrics,
  onChange: (m: RawMetrics) => void,
): () => void {
  const fonts = (doc as Document | null)?.fonts;
  if (!fonts?.ready) return () => {};
  let cancelled = false;
  let baseline = measure();
  void fonts.ready.then(() => {
    if (cancelled) return;
    const next = measure();
    if (next.cellWidth !== baseline.cellWidth || next.cellHeight !== baseline.cellHeight) {
      baseline = next;
      onChange(next);
    }
  });
  return () => {
    cancelled = true;
  };
}
