// Unit spec — renderer lane: cell metrics (src/terminal/render/metrics.ts).
//
// Feature: measureCellMetrics
//   Scenario: the advance is the measured width of 'W'
//   Scenario: the cell height rounds fontSize × lineHeight
//   Scenario: wideRatio reports wide advance ÷ advance (monospace check)
//   Scenario: a zero advance falls back to 0.6 × fontSize and ratio 2
//   Scenario: the font CSS uses the §8.3 stack unless overridden
// Feature: clampDpr
//   Scenario: clamps into [1, 3] per §8.3
//   Scenario: non-finite DPR clamps to 1
// Feature: fitCounts
//   Scenario: floors the box into whole cells, at least one
// Feature: remeasureOnFontLoad
//   Scenario: resolves to a noop without document fonts
//   Scenario: calls onChange only when the measured box moved

import { describe, it, expect, vi } from 'vitest';
import {
  clampDpr,
  fitCounts,
  measureCellMetrics,
  remeasureOnFontLoad,
  SHELL_FONT_STACK,
  type MeasuringContext,
  type RawMetrics,
} from '../../src/terminal/render/metrics.js';

class FakeMeasure implements MeasuringContext {
  font = '';
  constructor(readonly advance = 8.4, readonly wide = 16.8) {}
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } {
    const per = text.charCodeAt(0) >= 0xff00 ? this.wide : this.advance;
    return { width: per * text.length, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
  }
}

describe('measureCellMetrics', () => {
  it("the advance is the measured width of 'W'", () => {
    const ctx = new FakeMeasure(8.4);
    const m = measureCellMetrics(ctx);
    expect(m.cellWidth).toBe(8.4);
  });

  it('the cell height rounds fontSize × lineHeight', () => {
    const m = measureCellMetrics(new FakeMeasure(), { fontSize: 14, lineHeight: 1.27 });
    expect(m.cellHeight).toBe(Math.round(14 * 1.27));
    expect(m.fontSize).toBe(14);
  });

  it('wideRatio reports wide advance ÷ advance', () => {
    const m = measureCellMetrics(new FakeMeasure(8, 16));
    expect(m.wideRatio).toBeCloseTo(2);
  });

  it('a zero advance falls back to 0.6 × fontSize and ratio 2', () => {
    const m = measureCellMetrics(new FakeMeasure(0, 0), { fontSize: 10 });
    expect(m.cellWidth).toBeCloseTo(6);
    expect(m.wideRatio).toBe(2);
  });

  it('the font CSS uses the §8.3 stack unless overridden', () => {
    const m = measureCellMetrics(new FakeMeasure(), { fontSize: 14 });
    expect(m.fontCss).toBe(`14px ${SHELL_FONT_STACK}`);
    const m2 = measureCellMetrics(new FakeMeasure(), { fontSize: 14, fontFamily: '"X"' });
    expect(m2.fontCss).toBe('14px "X"');
  });
});

describe('clampDpr', () => {
  it('clamps into [1, 3] per §8.3', () => {
    expect(clampDpr(0.5)).toBe(1);
    expect(clampDpr(2)).toBe(2);
    expect(clampDpr(9)).toBe(3);
  });

  it('non-finite DPR clamps to 1', () => {
    expect(clampDpr(Number.NaN)).toBe(1);
    expect(clampDpr(Number.POSITIVE_INFINITY)).toBe(3);
  });
});

describe('fitCounts', () => {
  it('floors the box into whole cells, at least one', () => {
    expect(fitCounts(80, 40, 8, 18)).toEqual({ cols: 10, rows: 2 });
    expect(fitCounts(1, 1, 8, 18)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('remeasureOnFontLoad', () => {
  it('resolves to a noop without document fonts', () => {
    const onChange = vi.fn();
    const cancel = remeasureOnFontLoad(null, () => ({ cellWidth: 8, cellHeight: 18, fontSize: 14, wideRatio: 2, fontCss: 'x' }), onChange);
    expect(typeof cancel).toBe('function');
    cancel();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange only when the measured box moved', async () => {
    let metrics: RawMetrics = { cellWidth: 8, cellHeight: 18, fontSize: 14, wideRatio: 2, fontCss: 'x' };
    const fonts = { ready: Promise.resolve() } as unknown as FontFaceSet;
    const doc = { fonts } as unknown as Document;
    const onChange = vi.fn();
    remeasureOnFontLoad(doc, () => metrics, onChange);
    metrics = { cellWidth: 9, cellHeight: 18, fontSize: 14, wideRatio: 2, fontCss: 'x' };
    await new Promise((r) => setTimeout(r, 0)); // let fonts.ready settle
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].cellWidth).toBe(9);
  });
});
