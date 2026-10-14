// Unit spec — renderer lane: the glyph atlas (src/terminal/render/atlas.ts).
//
// Feature: lazy rasterization
//   Scenario: a glyph rasterizes once and every later get is a cache hit
//   Scenario: blank glyphs never rasterize
// Feature: buckets
//   Scenario: bold and italic variants rasterize separately
//   Scenario: each foreground ref gets its own bucket
// Feature: page allocator
//   Scenario: rasters pack rows until the page fills, then wrap to a new page
//   Scenario: whole pages evict LRU with slots dropped, staying under maxPages
// Feature: draw
//   Scenario: drawImage blits the slot rect at the target with composed alpha
// Feature: setFont
//   Scenario: new cell metrics or font drop every raster

import { describe, it, expect } from 'vitest';
import { GlyphAtlas, type AtlasCanvas, type AtlasSourceContext } from '../../src/terminal/render/atlas.js';
import type { DrawContext } from '../../src/terminal/render/atlas.js';

/* ---------------------------------------------------------------- *
 * fakes — a recording 2D context and a canvas factory
 * ---------------------------------------------------------------- */

interface Op { op: string; args: unknown[] }

class FakeCtx implements AtlasSourceContext {
  readonly ops: Op[] = [];
  font = '';
  fillStyle: string = '';
  textBaseline = '';
  fillText(text: string, x: number, y: number): void {
    this.ops.push({ op: 'fillText', args: [text, x, y] });
  }
  measureText(text: string): { width: number } {
    return { width: 8 * text.length };
  }
}

class FakeCanvas implements AtlasCanvas {
  width = 0;
  height = 0;
  constructor(readonly ctx: FakeCtx) {}
  getContext(kind: '2d'): AtlasSourceContext | null {
    return kind === '2d' ? this.ctx : null;
  }
}

const glyph = (code: number, over: Partial<Parameters<GlyphAtlas['get']>[0]> = {}) => ({
  code, combining: [], wide: false, bold: false, italic: false, fgRef: 3, ...over,
});

/** Recording draw target. */
function makeDrawTarget(): { ctx: DrawContext; ops: Op[] } {
  const ops: Op[] = [];
  const ctx = {
    globalAlpha: 1,
    drawImage(...args: unknown[]) { ops.push({ op: 'drawImage', args }); },
  };
  return { ctx: ctx as unknown as DrawContext, ops };
}

/* ---------------------------------------------------------------- *
 * lazy rasterization
 * ---------------------------------------------------------------- */

describe('lazy rasterization', () => {
  it('a glyph rasterizes once and every later get is a cache hit', () => {
    const pages: FakeCtx[] = [];
    const atlas = new GlyphAtlas({
      createCanvas: (w, h) => {
        const ctx = new FakeCtx();
        pages.push(ctx);
        return new FakeCanvas(ctx);
      },
      cellWidth: 8, cellHeight: 16, fontCss: '14px x',
    });
    const g = glyph(65);
    expect(atlas.get(g, '#fff')).not.toBeNull();
    expect(atlas.get(g, '#fff')).not.toBeNull();
    expect(atlas.size).toBe(1);
    expect(atlas.pageCount).toBe(1);
    expect(pages[0].ops.filter((o) => o.op === 'fillText')).toHaveLength(1);
  });

  it('blank glyphs never rasterize', () => {
    const atlas = new GlyphAtlas({ createCanvas: () => new FakeCanvas(new FakeCtx()), cellWidth: 8, cellHeight: 16, fontCss: 'x' });
    expect(atlas.get(glyph(0), '#fff')).toBeNull();
    expect(atlas.pageCount).toBe(0);
  });
});

describe('buckets', () => {
  it('bold and italic variants rasterize separately', () => {
    const atlas = new GlyphAtlas({ createCanvas: () => new FakeCanvas(new FakeCtx()), cellWidth: 8, cellHeight: 16, fontCss: 'x' });
    atlas.get(glyph(65), '#fff');
    atlas.get(glyph(65, { bold: true }), '#fff');
    atlas.get(glyph(65, { italic: true }), '#fff');
    expect(atlas.size).toBe(3);
  });

  it('each foreground ref gets its own bucket', () => {
    const atlas = new GlyphAtlas({ createCanvas: () => new FakeCanvas(new FakeCtx()), cellWidth: 8, cellHeight: 16, fontCss: 'x' });
    atlas.get(glyph(65, { fgRef: 1 }), '#111');
    atlas.get(glyph(65, { fgRef: 2 }), '#222');
    expect(atlas.size).toBe(2);
  });
});

describe('page allocator', () => {
  // 32px page, 12px raster box → 2 per row, 2 rows → exactly 4 glyphs per page.
  const TINY = { pagePixels: 32, maxPages: 16, cellWidth: 8, cellHeight: 8, fontCss: 'x', createCanvas: () => new FakeCanvas(new FakeCtx()) };

  it('rasters pack rows until the page fills, then wrap to a new page', () => {
    const atlas = new GlyphAtlas(TINY);
    for (const code of [65, 66, 67, 68]) atlas.get(glyph(code), '#fff');
    expect(atlas.pageCount).toBe(1); // 4 × 12px exactly fills one 32px page
    atlas.get(glyph(69), '#fff');
    expect(atlas.pageCount).toBe(2);
  });

  it('whole pages evict LRU with slots dropped, staying under maxPages', () => {
    const atlas = new GlyphAtlas({ ...TINY, maxPages: 2 });
    for (const code of [65, 66, 67, 68]) atlas.get(glyph(code), '#fff'); // fills page 1
    for (const code of [69, 70, 71, 72]) atlas.get(glyph(code), '#fff'); // fills page 2
    expect(atlas.pageCount).toBe(2);
    expect(atlas.size).toBe(8);
    atlas.get(glyph(73), '#fff'); // page 3 needed → evict page 1 (coldest)
    expect(atlas.pageCount).toBe(2);
    expect(atlas.size).toBe(5); // page 2's four + the new raster
    expect(atlas.get(glyph(65), '#fff')).not.toBeNull(); // re-rasterizes on a live page
    expect(atlas.pageCount).toBe(2);
  });
});

describe('draw', () => {
  it('drawImage blits the slot rect at the target with composed alpha', () => {
    const atlas = new GlyphAtlas({ createCanvas: () => new FakeCanvas(new FakeCtx()), cellWidth: 8, cellHeight: 16, fontCss: 'x' });
    const { ctx, ops } = makeDrawTarget();
    expect(atlas.draw(ctx, glyph(65), '#fff', 40, 80, 0.5)).toBe(true);
    expect(ops).toHaveLength(1);
    const [img, sx, sy, sw, sh, dx, dy] = ops[0].args as unknown[];
    expect(dx).toBe(40);
    expect(dy).toBe(80);
    expect(sx).toBe(0); // padding-less slot origin
    expect(ctx.globalAlpha).toBe(1); // restored
    expect(atlas.draw(ctx, glyph(0), '#fff', 0, 0)).toBe(false); // blank never draws
  });
});

describe('setFont', () => {
  it('new cell metrics or font drop every raster', () => {
    const atlas = new GlyphAtlas({ createCanvas: () => new FakeCanvas(new FakeCtx()), cellWidth: 8, cellHeight: 16, fontCss: 'x' });
    atlas.get(glyph(65), '#fff');
    expect(atlas.size).toBe(1);
    atlas.setFont(8, 16, 'x'); // no-op when nothing changed
    expect(atlas.size).toBe(1);
    atlas.setFont(10, 16, 'x');
    expect(atlas.size).toBe(0);
  });
});
