/**
 * render/canvas — the canvas driver, the one visible paint path
 * (CORE-V2 §8.3; 2026-10-14 "canvas everywhere" decision).
 *
 * Glyph atlas painting from damage sets, DPR-aware backing store
 * (clamped 1–3), monospace cell metrics, block/bar/underline cursor with
 * 530 ms blink (steady under `prefers-reduced-motion`), selection overlay
 * rects, and the automatic promotion signals (§8.1/§8.5a): forced-colors or
 * a failed 2d context fire `onUnavailable` so the host promotes the DOM
 * mirror. The renderer owns no display state — it reads the PaintScreen.
 *
 * All host surfaces are injectable (document canvas factory, timers,
 * matchMedia, DPR) so unit tests drive painting with a fake 2D context that
 * records draw calls.
 */

import { GlyphAtlas, type AtlasCanvas, type DrawContext, type GlyphKey } from './atlas.js';
import { clampDpr, fitCounts, measureCellMetrics, remeasureOnFontLoad, SHELL_FONT_STACK, type RawMetrics } from './metrics.js';
import { ATTR, cssRgb, type PaintScreen } from './screen-shape.js';
import { selectionRowRuns } from './selection.js';
import { DOMMirror, type MirrorOptions } from './mirror.js';
import type { CellMetrics, CursorStyle, DamageSet, ScreenRenderer } from './types.js';

/**
 * Host environment the driver reads (all injectable for tests).
 */
export interface ViewEnvironment {
  /** Live device pixel ratio — a getter, so zoom changes are visible per frame. */
  readonly devicePixelRatio: number;
  matchMedia(query: string): { matches: boolean; addEventListener(t: string, fn: () => void): void; removeEventListener(t: string, fn: () => void): void };
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface CanvasRendererOptions {
  /** Font size in CSS px (default 14). */
  fontSize?: number;
  /** Font family override (default the §8.3 monospace stack). */
  fontFamily?: string;
  /** Cursor blink half-period, ms (§8.3: 530). */
  cursorBlinkMs?: number;
  /** Selection overlay paint (a CSS color string). */
  selectionColor?: string;
  /** Cursor paint. */
  cursorColor?: string;
  /** Forced-colors / 2d-failure callback — the host promotes the mirror. */
  onUnavailable?(reason: 'forced-colors' | 'no-2d-context'): void;
  /** Called whenever cell metrics change (the host resizes the screen). */
  onMetricsChange?(metrics: CellMetrics): void;
  /** Defaults: the host document (tests inject stubs). */
  doc?: Document | null;
  view?: ViewEnvironment | null;
  /** Canvas factory injection (tests) — default host.createElement('canvas'). */
  createCanvas?(width: number, height: number): AtlasCanvas;
  /** Mirror options passthrough (throttle/timers — tests). */
  mirror?: Partial<MirrorOptions>;
}

export type CreateRendererResult =
  | { ok: true; renderer: CanvasRenderer & ScreenRenderer }
  | { ok: false; reason: 'forced-colors' | 'no-2d-context' };

const CURSOR_BLINK_MS = 530;

export function createCanvasRenderer(options: CanvasRendererOptions = {}): CreateRendererResult {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null);
  const view = options.view ?? defaultView();
  if (view !== null && view.matchMedia('(forced-colors: active)').matches) {
    return { ok: false, reason: 'forced-colors' };
  }
  return { ok: true, renderer: new CanvasRenderer(options, doc, view) };
}

function defaultView(): ViewEnvironment | null {
  const w = typeof window !== 'undefined' ? window : null;
  if (w === null || typeof w.matchMedia !== 'function') return null;
  return {
    get devicePixelRatio() { return w.devicePixelRatio; },
    matchMedia: (q) => w.matchMedia(q),
    setTimeout: (fn, ms) => w.setTimeout(fn, ms),
    clearTimeout: (id) => w.clearTimeout(id as number),
  };
}

/** The full-screen probe a real 2d context must satisfy (fakes qualify). */
export type PaintContext = CanvasRenderingContext2D & DrawContext;

export class CanvasRenderer implements ScreenRenderer {
  readonly #options: CanvasRendererOptions;
  readonly #doc: Document | null;
  readonly #view: ViewEnvironment | null;
  #screen: PaintScreen | null = null;
  #host: HTMLElement | null = null;
  #canvas: AtlasCanvas | null = null;
  #ctx: PaintContext | null = null;
  #atlas: GlyphAtlas | null = null;
  #mirror: DOMMirror | null = null;
  #metrics: CellMetrics | null = null;
  #raw: RawMetrics | null = null;
  #cursorPhase = true;
  #blinkCancel: (() => void) | null = null;
  #reducedMotion = false;
  #lastCursor: { row: number; col: number } | null = null;
  #resizeObserver: { disconnect(): void } | null = null;
  #cancelFontWatch: (() => void) | null = null;
  #motionMq: { matches: boolean; addEventListener(t: string, fn: () => void): void; removeEventListener(t: string, fn: () => void): void } | null = null;
  readonly #onMotionChange: () => void;

  constructor(options: CanvasRendererOptions, doc: Document | null, view: ViewEnvironment | null) {
    this.#options = options;
    this.#doc = doc;
    this.#view = view;
    this.#onMotionChange = () => {
      this.#applyReducedMotion();
    };
  }

  get mirror(): DOMMirror | null {
    return this.#mirror;
  }

  attach(screen: PaintScreen, host: HTMLElement): void {
    this.#screen = screen;
    this.#host = host;
    const create = this.#options.createCanvas ?? ((w: number, h: number) => {
      const el = (this.#doc ?? host.ownerDocument).createElement('canvas');
      el.width = w;
      el.height = h;
      return el as unknown as AtlasCanvas;
    });
    // A failed context is the §8.5(a) automatic promotion signal.
    const canvas = create(1, 1);
    const probe = canvas.getContext('2d') as PaintContext | null;
    if (probe === null) {
      this.#options.onUnavailable?.('no-2d-context');
      // The mirror still mounts — it is the a11y tree regardless (§9).
      this.#attachMirror(screen, host);
      return;
    }
    this.#canvas = canvas;
    this.#ctx = probe;
    if ('className' in canvas) (canvas as unknown as HTMLElement).className = 'sem-term-canvas';
    host.prepend(canvas as unknown as HTMLCanvasElement);

    this.#raw = this.#measure();
    this.#applyMetrics();
    this.#atlas = new GlyphAtlas({
      createCanvas: create,
      cellWidth: this.#raw.cellWidth,
      cellHeight: this.#raw.cellHeight,
      fontCss: this.#raw.fontCss,
    });
    this.#attachMirror(screen, host);
    this.#watchEnvironment();
    this.repaintAll();
    if (!this.#reducedMotion) this.#startBlink();
  }

  #attachMirror(screen: PaintScreen, host: HTMLElement): void {
    const base: MirrorOptions = {
      schedule: (fn, ms) => this.#scheduleTimer(fn, ms),
      now: () => nowMs(),
      ...this.#options.mirror,
    };
    this.#mirror = new DOMMirror(base);
    this.#mirror.attach(screen, host);
  }

  metrics(): CellMetrics {
    return this.#metrics ?? { cols: 0, rows: 0, cellWidth: 0, cellHeight: 0, dpr: 1 };
  }

  /** Host box / DPR changed: re-measure, re-fit the backing store, repaint all. */
  resize(): void {
    if (this.#screen === null || this.#ctx === null) return;
    const raw = this.#measure();
    const fontChanged = this.#raw === null || raw.cellWidth !== this.#raw.cellWidth
      || raw.cellHeight !== this.#raw.cellHeight || raw.fontCss !== this.#raw.fontCss;
    this.#raw = raw;
    this.#applyMetrics();
    if (fontChanged && this.#atlas !== null) {
      this.#atlas.setFont(raw.cellWidth, raw.cellHeight, raw.fontCss);
    }
    this.repaintAll();
  }

  drain(damage: DamageSet): void {
    const ctx = this.#ctx;
    const screen = this.#screen;
    if (ctx === null || screen === null || this.#raw === null) return;
    // Zoom changes DPR without a box resize; catch it each frame (§8.3).
    if (this.#view !== null && clampDpr(this.#view.devicePixelRatio) !== this.#metrics?.dpr) {
      this.resize();
      return; // resize() already repainted everything
    }
    if (damage.full || damage.scroll) {
      this.repaintAll();
      return;
    }
    for (const line of damage.lines) {
      const row = screen.rowOfLine(line);
      if (row !== null) this.paintRow(row);
    }
    if (damage.cursor) {
      if (this.#lastCursor !== null) this.paintRow(this.#lastCursor.row);
      const cursor = screen.cursor();
      if (cursor !== null) this.paintRow(cursor.row);
    }
    this.#mirror?.drain(damage);
  }

  /** Brief spelling of `drain` (lane contract). */
  paint(damage?: DamageSet): void {
    if (damage !== undefined) this.drain(damage);
    else this.repaintAll();
  }

  /** Promote the DOM mirror to the visible view (§8.5b/c). */
  useDomView(): void {
    if (this.#canvas !== null && 'className' in this.#canvas) (this.#canvas as unknown as HTMLElement).className = 'sem-term-canvas sem-term-canvas-hidden';
    this.#mirror?.setVisible(true);
  }

  /** Back to the canvas paint. */
  useCanvasView(): void {
    if (this.#canvas !== null && 'className' in this.#canvas) (this.#canvas as unknown as HTMLElement).className = 'sem-term-canvas';
    this.#mirror?.setVisible(false);
  }

  detach(): void {
    this.#stopBlink();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#cancelFontWatch?.();
    this.#cancelFontWatch = null;
    if (this.#motionMq !== null) {
      this.#motionMq.removeEventListener('change', this.#onMotionChange);
      this.#motionMq = null;
    }
    this.#atlas?.clear();
    this.#mirror?.detach();
    this.#mirror = null;
    (this.#canvas as unknown as { remove?(): void } | null)?.remove?.();
    this.#canvas = null;
    this.#ctx = null;
    this.#screen = null;
    this.#host = null;
    this.#metrics = null;
    this.#lastCursor = null;
  }

  /** Brief spelling of `detach` (lane contract). */
  destroy(): void {
    this.detach();
  }

  /* ------------------------------------------------------------ *
   * environment (DPR, resize, fonts, motion)
   * ------------------------------------------------------------ */

  #measure(): RawMetrics {
    const ctx = this.#ctx as PaintContext | null;
    if (ctx === null) {
      return { cellWidth: 8.4, cellHeight: 18, fontSize: this.#options.fontSize ?? 14, wideRatio: 2, fontCss: `${this.#options.fontSize ?? 14}px ${this.#options.fontFamily ?? SHELL_FONT_STACK}` };
    }
    return measureCellMetrics(ctx, {
      fontSize: this.#options.fontSize,
      fontFamily: this.#options.fontFamily,
    });
  }

  #applyMetrics(): void {
    const raw = this.#raw;
    const host = this.#host;
    const canvas = this.#canvas;
    if (raw === null || host === null || canvas === null) return;
    const dpr = clampDpr(this.#view?.devicePixelRatio ?? 1);
    const width = Math.max(0, host.clientWidth);
    const height = Math.max(0, host.clientHeight);
    const { cols, rows } = fitCounts(width, height, raw.cellWidth, raw.cellHeight);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = this.#ctx as PaintContext;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#metrics = { cols, rows, cellWidth: raw.cellWidth, cellHeight: raw.cellHeight, dpr };
    this.#options.onMetricsChange?.(this.#metrics);
  }

  #watchEnvironment(): void {
    const host = this.#host;
    const view = this.#view;
    const ViewResize = host?.ownerDocument?.defaultView?.ResizeObserver;
    if (host !== null && typeof ViewResize === 'function') {
      const observer = new ViewResize(() => this.resize());
      observer.observe(host);
      this.#resizeObserver = observer;
    }
    if (view !== null && typeof view.matchMedia === 'function') {
      const mq = view.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', this.#onMotionChange);
      this.#motionMq = mq;
      this.#reducedMotion = mq.matches;
    }
    this.#cancelFontWatch = remeasureOnFontLoad(this.#doc, () => this.#measure(), () => this.resize());
  }

  /** Timer indirection: host env when injected, globals otherwise. */
  #scheduleTimer(fn: () => void, ms: number): () => void {
    if (this.#view === null) {
      const id = setTimeout(fn, ms) as unknown as number;
      return () => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    }
    const view = this.#view;
    const id = view.setTimeout(fn, ms);
    return () => view.clearTimeout(id);
  }

  #applyReducedMotion(): void {
    const was = this.#reducedMotion;
    this.#reducedMotion = this.#motionMq?.matches ?? false;
    if (was === this.#reducedMotion) return;
    if (this.#reducedMotion) this.#stopBlink();
    else this.#startBlink();
    this.#cursorPhase = true;
    const cursor = this.#screen?.cursor();
    if (cursor !== null && cursor !== undefined) this.paintRow(cursor.row);
  }

  /* ------------------------------------------------------------ *
   * painting
   * ------------------------------------------------------------ */

  repaintAll(): void {
    const screen = this.#screen;
    if (screen === null) return;
    for (let row = 0; row < screen.rows; row++) this.paintRow(row);
    this.#mirror?.flushNow(true);
  }

  #bgColor(): string {
    return this.#resolveCss({ kind: 'bg', ref: 0xffff });
  }

  #fgColor(ref: number): string {
    return this.#resolveCss({ kind: 'fg', ref });
  }

  #resolveCss(c: { kind: 'fg' | 'bg'; ref: number }): string {
    const screen = this.#screen;
    if (screen === null) return c.kind === 'fg' ? '#d7dee7' : '#0f1216';
    const rgb = screen.rgbOf(c.ref, c.kind);
    if (rgb !== null) return cssRgb(rgb);
    // Default refs — read the theme tokens when the host declares them.
    const fallback = this.#optionsTheme(c.kind);
    return fallback;
  }

  #optionsTheme(kind: 'fg' | 'bg'): string {
    return kind === 'fg' ? '#d7dee7' : '#0f1216';
  }

  paintRow(row: number): void {
    const ctx = this.#ctx;
    const screen = this.#screen;
    const raw = this.#raw;
    const atlas = this.#atlas;
    if (ctx === null || screen === null || raw === null || atlas === null) return;
    const line = screen.lineAt(row);
    const abs = screen.absoluteLineAt(row);
    const cw = raw.cellWidth;
    const ch = raw.cellHeight;
    // 1. background pass: theme bg, then per-cell bg runs (REVERSE composes here)
    ctx.fillStyle = this.#bgColor();
    ctx.fillRect(0, row * ch, screen.cols * cw, ch);
    // 2. glyph + decoration pass
    if (line !== null) {
      for (let col = 0; col < screen.cols; col++) {
        const cell = line.cell(col);
        if (cell.width === 0) continue;
        const reversed = (cell.attrs & ATTR.REVERSE) !== 0;
        const bg = reversed ? this.#fgColor(cell.fg) : this.#resolveCss({ kind: 'bg', ref: cell.bg });
        if (cell.code === 0 || cell.code === 32) {
          if (reversed || (cell.bg !== 0xffff && this.#resolvedDiffers(cell.bg, this.#bgColor()))) {
            ctx.fillStyle = bg;
            ctx.fillRect(col * cw, row * ch, cw, ch);
          }
          continue;
        }
        const hidden = (cell.attrs & ATTR.HIDDEN) !== 0;
        if (reversed) {
          ctx.fillStyle = bg;
          ctx.fillRect(col * cw, row * ch, cell.width * cw, ch);
        }
        if (hidden) continue;
        const fg = reversed ? this.#resolveCss({ kind: 'bg', ref: cell.bg }) : this.#fgColor(cell.fg);
        const dim = (cell.attrs & ATTR.DIM) !== 0;
        const glyph: GlyphKey = {
          code: cell.code,
          combining: cell.combining,
          wide: cell.width === 2,
          bold: (cell.attrs & ATTR.BOLD) !== 0,
          italic: (cell.attrs & ATTR.ITALIC) !== 0,
          fgRef: cell.fg,
        };
        atlas.draw(ctx, glyph, fg, col * cw, row * ch, dim ? 0.66 : 1);
        // Decorations: underline + strike paint as strokes (crisper than
        // baking them into the atlas — report deviation).
        const underline = (cell.attrs & ATTR.UNDERLINE) !== 0;
        const strike = (cell.attrs & ATTR.STRIKE) !== 0;
        if (underline || strike) {
          ctx.fillStyle = fg;
          const y = underline ? row * ch + ch - 1 : row * ch + Math.floor(ch / 2);
          ctx.fillRect(col * cw, y, cell.width * cw, 1);
        }
      }
    }
    // 3. selection overlay runs (§8.3)
    this.#paintSelectionRow(row, abs);
    // 4. cursor (last, so it sits over everything)
    const cursor = screen.cursor();
    if (cursor !== null && cursor.visible && cursor.row === row) {
      this.#paintCursor(cursor);
      this.#lastCursor = { row: cursor.row, col: cursor.col };
    } else if (cursor !== null && this.#lastCursor?.row === row) {
      this.#lastCursor = null;
    }
  }

  #resolvedDiffers(ref: number, base: string): boolean {
    return this.#resolveCss({ kind: 'bg', ref }) !== base;
  }

  #paintSelectionRow(row: number, abs: number | null): void {
    const ctx = this.#ctx;
    const screen = this.#screen;
    const raw = this.#raw;
    if (ctx === null || screen === null || raw === null || abs === null) return;
    const selection = screen.selection();
    if (selection.length === 0) return;
    const runs = selectionRowRuns(screen, selection).filter((run) => run.row === row);
    ctx.fillStyle = this.#options.selectionColor ?? 'rgba(96,165,250,0.35)';
    for (const run of runs) {
      ctx.fillRect(run.from * raw.cellWidth, row * raw.cellHeight, (run.to - run.from) * raw.cellWidth, raw.cellHeight);
    }
  }

  #paintCursor(cursor: { row: number; col: number; style: CursorStyle }): void {
    const ctx = this.#ctx;
    const raw = this.#raw;
    if (ctx === null || raw === null || this.#screen === null) return;
    if (!this.#cursorPhase && !this.#reducedMotion) return;
    const cw = raw.cellWidth;
    const ch = raw.cellHeight;
    const x = cursor.col * cw;
    const y = cursor.row * ch;
    ctx.fillStyle = this.#options.cursorColor ?? 'rgba(220,228,240,0.85)';
    if (cursor.style === 'block') {
      ctx.fillRect(x, y, cw, ch);
      // Redraw the glyph in the background colour so the block stays readable.
      const line = this.#screen.lineAt(cursor.row);
      const cell = line?.cell(cursor.col);
      const atlas = this.#atlas;
      if (line !== undefined && line !== null && cell !== undefined && cell !== null && cell.code !== 0 && atlas !== null) {
        const glyph: GlyphKey = {
          code: cell.code,
          combining: cell.combining,
          wide: cell.width === 2,
          bold: (cell.attrs & ATTR.BOLD) !== 0,
          italic: (cell.attrs & ATTR.ITALIC) !== 0,
          fgRef: cell.fg,
        };
        atlas.draw(ctx, glyph, this.#bgColor(), x, y, 1);
      }
    } else if (cursor.style === 'beam') {
      ctx.fillRect(x, y, Math.max(2, Math.floor(cw / 8)), ch);
    } else {
      ctx.fillRect(x, y + ch - 2, cw, 2);
    }
  }

  /* ------------------------------------------------------------ *
   * cursor blink (530 ms; steady under reduced motion)
   * ------------------------------------------------------------ */

  /** Start (or restart) the blink cycle — the host calls this on focus. */
  startBlink(): void {
    if (this.#reducedMotion) return; // §8.3: steady, not blinking
    this.#startBlink();
  }

  #startBlink(): void {
    this.#stopBlink();
    if (this.#reducedMotion) return;
    const step = (): void => {
      this.#cursorPhase = !this.#cursorPhase;
      const cursor = this.#screen?.cursor();
      if (cursor != null && cursor.visible) this.paintRow(cursor.row);
      this.#blinkCancel = this.#scheduleTimer(step, this.#options.cursorBlinkMs ?? CURSOR_BLINK_MS);
    };
    this.#blinkCancel = this.#scheduleTimer(step, this.#options.cursorBlinkMs ?? CURSOR_BLINK_MS);
  }

  #stopBlink(): void {
    this.#blinkCancel?.();
    this.#blinkCancel = null;
  }
}

/** Monotonic-ish wall clock safe in every host. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
