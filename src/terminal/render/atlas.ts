/**
 * render/atlas — the glyph atlas (CORE-V2 §8.3).
 *
 * One offscreen canvas texture per style bucket; the cross product that
 * matters is bold × italic × fg-color-ref (dim composites as draw alpha and
 * underline/strike paint as strokes — see the lane report's design
 * deviations). Buckets materialize lazily; glyphs rasterize on first use via
 * `fillText` packed into 512px pages with a simple row allocator; pages evict
 * whole-page, LRU, 4 live at most.
 *
 * Canvas construction is injected (`createCanvas`) so unit tests drive the
 * atlas with fake 2D contexts that record draw calls.
 */

/** The atlas only needs this slice of a canvas element (fakes qualify). */
export interface AtlasCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): AtlasSourceContext | null;
}

/** The slice of CanvasRenderingContext2D rasterization uses. */
export interface AtlasSourceContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/** The slice of the target context drawing uses. */
export interface DrawContext {
  globalAlpha: number;
  drawImage(
    image: AtlasCanvas,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
}

/** What identifies one rasterized glyph. */
export interface GlyphKey {
  code: number;
  combining: readonly number[];
  /** True when the cell spans two columns (East-wide). */
  wide: boolean;
  bold: boolean;
  italic: boolean;
  /** Foreground palette ref — the bucket axis (§8.3). */
  fgRef: number;
}

/** A placed raster on a page: source rect for drawImage. */
export interface GlyphSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Internal: a slot that knows its page (draw needs it for drawImage). */
type PlacedGlyph = GlyphSlot & { page: Page };

interface Page {
  canvas: AtlasCanvas;
  ctx: AtlasSourceContext;
  /** Row allocator cursor. */
  x: number;
  y: number;
  rowHeight: number;
  lastUsed: number;
}

export interface AtlasOptions {
  /** Square page edge in px (default 512 per §8.3). */
  pagePixels?: number;
  /** Live-page cap (default 4 per §8.3); the coldest page evicts whole. */
  maxPages?: number;
  /** Canvas factory — document.createElement in prod, a fake in tests. */
  createCanvas(width: number, height: number): AtlasCanvas;
  /** Cell box the rasters are laid out for (update via `setFont`). */
  cellWidth: number;
  cellHeight: number;
  /** Base font CSS; bold/italic variants are derived. */
  fontCss: string;
  /** Padding around each glyph cell (default 2px, AA bleed headroom). */
  padding?: number;
}

const DEFAULT_PAGE = 512;
const DEFAULT_MAX_PAGES = 4;

export class GlyphAtlas {
  #pages: Page[] = [];
  #slots = new Map<string, PlacedGlyph>();
  #tick = 0;
  readonly #pagePixels: number;
  readonly #maxPages: number;
  readonly #createCanvas: AtlasOptions['createCanvas'];
  #cellWidth: number;
  #cellHeight: number;
  #fontCss: string;
  readonly #padding: number;

  constructor(options: AtlasOptions) {
    this.#pagePixels = options.pagePixels ?? DEFAULT_PAGE;
    this.#maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.#createCanvas = options.createCanvas;
    this.#cellWidth = options.cellWidth;
    this.#cellHeight = options.cellHeight;
    this.#fontCss = options.fontCss;
    this.#padding = options.padding ?? 2;
  }

  /** Current page count (test seam). */
  get pageCount(): number {
    return this.#pages.length;
  }

  /** Live raster count (test seam). */
  get size(): number {
    return this.#slots.size;
  }

  /**
   * Font or cell metrics changed: rasters are laid out for the old box —
   * drop everything (whole-page eviction at the coarsest level).
   */
  setFont(cellWidth: number, cellHeight: number, fontCss: string): void {
    if (cellWidth === this.#cellWidth && cellHeight === this.#cellHeight && fontCss === this.#fontCss) return;
    this.#cellWidth = cellWidth;
    this.#cellHeight = cellHeight;
    this.#fontCss = fontCss;
    this.clear();
  }

  clear(): void {
    this.#pages = [];
    this.#slots.clear();
  }

  #bucketSuffix(glyph: GlyphKey): string {
    return `${glyph.bold ? 'b' : '-'}${glyph.italic ? 'i' : '-'}\u0000${glyph.fgRef}`;
  }

  #key(glyph: GlyphKey): string {
    return `${glyph.code}\u0001${glyph.combining.join(',')}\u0001${glyph.wide ? 2 : 1}\u0001${this.#bucketSuffix(glyph)}`;
  }

  /** Look up (and lazily rasterize) a glyph. Returns null when unrasterizable. */
  get(glyph: GlyphKey, fgCss: string): GlyphSlot | null {
    return this.#lookup(glyph, fgCss);
  }

  #lookup(glyph: GlyphKey, fgCss: string): PlacedGlyph | null {
    if (glyph.code === 0) return null; // blank cells paint as background only
    const key = this.#key(glyph);
    const hit = this.#slots.get(key);
    if (hit) {
      hit.page.lastUsed = ++this.#tick;
      return hit;
    }
    return this.#rasterize(glyph, fgCss, key);
  }

  /**
   * Draw one glyph at (dx, dy) — top-left of its cell — at `alpha`
   * (dim composites here). False when the glyph is not in the atlas.
   */
  draw(ctx: DrawContext, glyph: GlyphKey, fgCss: string, dx: number, dy: number, alpha = 1): boolean {
    const slot = this.#lookup(glyph, fgCss);
    if (slot === null) return false;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(slot.page.canvas, slot.x, slot.y, slot.w, slot.h, dx, dy, slot.w, slot.h);
    ctx.globalAlpha = prev;
    return true;
  }

  #rasterize(glyph: GlyphKey, fgCss: string, key: string): PlacedGlyph | null {
    const page = this.#pageFor(glyph);
    if (page === null) return null;
    const w = Math.ceil(this.#cellWidth * (glyph.wide ? 2 : 1)) + this.#padding * 2;
    const h = Math.ceil(this.#cellHeight) + this.#padding * 2;
    const x = page.x + this.#padding;
    const y = page.y + this.#padding;
    page.ctx.font = this.#font(glyph);
    page.ctx.fillStyle = fgCss;
    page.ctx.textBaseline = 'top';
    page.ctx.fillText(this.#text(glyph), x, y + this.#padding);
    const slot = { page, x: x - this.#padding, y: y - this.#padding, w, h };
    this.#slots.set(key, slot);
    page.x += w;
    page.rowHeight = Math.max(page.rowHeight, h);
    if (page.x + w > this.#pagePixels) { // wrap to the next row (simple allocator)
      page.x = 0;
      page.y += page.rowHeight;
      page.rowHeight = 0;
    }
    page.lastUsed = ++this.#tick;
    return slot;
  }

  /** The page a new raster lands on, allocating (and LRU-evicting) as needed. */
  #pageFor(glyph: GlyphKey): Page | null {
    const w = Math.ceil(this.#cellWidth * (glyph.wide ? 2 : 1)) + this.#padding * 2;
    const h = Math.ceil(this.#cellHeight) + this.#padding * 2;
    const open = this.#pages.find((p) => p.y + h <= this.#pagePixels);
    if (open) return open;
    if (this.#pages.length >= this.#maxPages) {
      let coldest = this.#pages[0];
      for (const p of this.#pages) if (p.lastUsed < coldest.lastUsed) coldest = p;
      this.#pages = this.#pages.filter((p) => p !== coldest);
      for (const [key, slot] of [...this.#slots]) if (slot.page === coldest) this.#slots.delete(key);
    }
    const canvas = this.#createCanvas(this.#pagePixels, this.#pagePixels);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    const page: Page = { canvas, ctx, x: 0, y: 0, rowHeight: 0, lastUsed: ++this.#tick };
    this.#pages.push(page);
    return page;
  }

  #font(glyph: GlyphKey): string {
    let font = this.#fontCss;
    if (glyph.italic) font = `italic ${font}`;
    if (glyph.bold) font = `bold ${font}`;
    return font;
  }

  #text(glyph: GlyphKey): string {
    let text = String.fromCodePoint(glyph.code);
    for (const mark of glyph.combining) text += String.fromCodePoint(mark);
    return text;
  }
}
