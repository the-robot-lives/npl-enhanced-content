/**
 * render/mirror — the offscreen DOM mirror (CORE-V2 §8.1, §9).
 *
 * The v1 DOM renderer, demoted and repurposed: the same light-DOM shape
 * (`#renderLine`'s line divs + styled spans, now the `sem-ansi-*`
 * vocabulary) driven by screen cells instead of `splitSgr`. Visually hidden
 * (clipped, `aria-hidden="false"`), it is the accessibility tree, the
 * surface browser find-in-page and platform text services read, and the
 * text source copy extracts from. Updates derive from the same damage sets
 * the canvas drains, throttled to ≥ 100 ms. Scrollback is not kept as DOM —
 * only the viewport window renders, so cost stays O(rows).
 *
 * Promotion (§8.5): forced-colors / a failed 2d context, the documented
 * `renderer="dom"` attribute, or the context menu's view switch call
 * `setVisible(true)` — the same paint, unclipped, as the visible view.
 *
 * No HTML is ever built from cell content — text lands via textContent only,
 * preserving v1's escaping property.
 */

import { ansiSpanClasses, ansiSpanStyle } from '../ansi/index.js';
import type { AnsiColor, SgrAttrs } from '../ansi/types.js';
import {
  ATTR,
  REF_DEFAULT,
  isTruecolorRef,
  normalizeRange,
  type PaintScreen,
  type Rgb,
  type SelRange,
} from './screen-shape.js';
import type { DamageSet } from './types.js';

export interface MirrorOptions {
  /** Damage-sync throttle floor, ms (§8.1: ≥ 100). */
  minIntervalMs?: number;
  /** Timer injection (tests). */
  schedule(fn: () => void, ms: number): () => void;
  now(): number;
}

const LINE_CLASS = 'sem-term-mirror-line';

export class DOMMirror {
  #screen: PaintScreen | null = null;
  #root: HTMLElement | null = null;
  #body: HTMLElement | null = null;
  #live: HTMLElement | null = null;
  #pendingRows = new Set<number>();
  #pendingAll = false;
  #rowEls = new Map<number, HTMLElement>();
  #scheduled = false;
  #cancel: (() => void) | null = null;
  #lastFlush = -Infinity;
  readonly #minIntervalMs: number;
  readonly #schedule: MirrorOptions['schedule'];
  readonly #now: MirrorOptions['now'];

  constructor(options: MirrorOptions) {
    this.#minIntervalMs = options.minIntervalMs ?? 100;
    this.#schedule = options.schedule;
    this.#now = options.now;
  }

  get element(): HTMLElement | null {
    return this.#root;
  }

  get visible(): boolean {
    return this.#root?.getAttribute('data-visible') === 'true';
  }

  attach(screen: PaintScreen, host: HTMLElement): void {
    this.#screen = screen;
    const doc = host.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'sem-term-mirror';
    root.setAttribute('data-visible', 'false');
    root.setAttribute('role', 'log');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Shell transcript');
    root.setAttribute('aria-hidden', 'false');
    const live = doc.createElement('div');
    live.className = 'sem-term-mirror-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const body = doc.createElement('div');
    body.className = 'sem-term-mirror-body';
    root.append(live, body);
    host.prepend(root);
    this.#root = root;
    this.#body = body;
    this.#live = live;
    this.flushNow(true);
  }

  /** Queue a damage batch; the throttle floor decides when it lands. */
  drain(damage: DamageSet): void {
    if (this.#screen === null) return;
    if (damage.scroll) {
      this.#pendingAll = true;
    } else {
      for (const line of damage.lines) {
        const row = this.#screen.rowOfLine(line);
        if (row !== null) this.#pendingRows.add(row);
      }
    }
    if (this.#scheduled) return;
    this.#scheduled = true;
    const elapsed = this.#now() - this.#lastFlush;
    const delay = Math.max(0, this.#minIntervalMs - elapsed);
    this.#cancel = this.#schedule(() => {
      this.#scheduled = false;
      this.#cancel = null;
      this.flushNow(false);
    }, delay);
  }

  /** Paint the pending damage now (also the test seam). */
  flushNow(all = false): void {
    this.#lastFlush = this.#now();
    const screen = this.#screen;
    const body = this.#body;
    if (screen === null || body === null) return;
    if (all || this.#pendingAll) {
      body.replaceChildren();
      this.#rowEls.clear();
      for (let row = 0; row < screen.rows; row++) this.renderRow(row);
    } else {
      for (const row of this.#pendingRows) this.renderRow(row);
    }
    this.#pendingAll = false;
    this.#pendingRows.clear();
  }

  renderRow(row: number): void {
    const screen = this.#screen;
    const body = this.#body;
    if (screen === null || body === null) return;
    const abs = screen.absoluteLineAt(row);
    const line = screen.lineAt(row);
    const existing = this.#rowEls.get(row) ?? null;
    if (line === null || abs === null) {
      existing?.remove(); // absent rows render nothing (extractText agrees)
      this.#rowEls.delete(row);
      return;
    }
    let el = existing;
    if (el === null) {
      el = body.ownerDocument.createElement('div');
      body.append(el);
      this.#rowEls.set(row, el);
    }
    el.className = LINE_CLASS;
    el.setAttribute('data-abs', String(abs));
    if (line.wrapped) el.setAttribute('data-wrapped', '');
    else el.removeAttribute('data-wrapped');
    el.replaceChildren(...spansForLine(body.ownerDocument, screen, line));
  }

  /**
   * The live-region summary channel (§9): app screens announce a compact
   * summary line on change instead of diffing 2,000 cells into speech.
   */
  announce(text: string): void {
    if (this.#live === null || this.#live.textContent === text) return;
    this.#live.textContent = text;
  }

  /** Promotion switch (§8.5): true → the mirror is the visible view. */
  setVisible(visible: boolean): void {
    this.#root?.setAttribute('data-visible', visible ? 'true' : 'false');
  }

  /**
   * Map a platform selection inside the mirror to a screen range
   * (absoluteLine, col) — find-in-page hits and native selection land here,
   * then paint on canvas as selection-overlay rects (§9).
   */
  rangeFromSelection(selection: Selection): SelRange | null {
    const body = this.#body;
    if (body === null || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const start = this.#pointFor(range.startContainer, range.startOffset);
    const end = this.#pointFor(range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    return normalizeRange({
      start: { line: start.line, col: start.col },
      end: { line: end.line, col: end.col },
    });
  }

  #pointFor(container: Node, offset: number): { line: number; col: number } | null {
    const parent = container.nodeType === container.TEXT_NODE ? container.parentElement : (container as HTMLElement);
    const div = parent?.closest(`.${LINE_CLASS}`) as HTMLElement | null;
    if (div === null || div.parentElement !== this.#body) return null;
    const abs = Number(div.getAttribute('data-abs'));
    if (!Number.isFinite(abs)) return null;
    const units = this.#unitsBefore(div, container, offset);
    return { line: abs, col: this.#colForUnits(div, units) };
  }

  /** UTF-16 units strictly before (node, offset) within the line div. */
  #unitsBefore(div: HTMLElement, container: Node, offset: number): number {
    const walker = div.ownerDocument.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let units = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node === container) return units + offset;
      units += (node.textContent ?? '').length;
    }
    return units;
  }

  /** Map a UTF-16 unit count within a row to its cell column. */
  #colForUnits(div: HTMLElement, units: number): number {
    const body = this.#body;
    const screen = this.#screen;
    if (body === null || screen === null) return 0;
    const row = Array.prototype.indexOf.call(body.children, div);
    const line = screen.lineAt(row);
    if (line === null) return 0;
    let seen = 0;
    for (let col = 0; col < screen.cols; col++) {
      const cell = line.cell(col);
      if (cell.width === 0) continue;
      if (cell.code === 0) {
        if (seen >= units) return col;
        seen += 1;
        continue;
      }
      const len = String.fromCodePoint(cell.code).length
        + cell.combining.reduce((n, m) => n + String.fromCodePoint(m).length, 0);
      if (seen + len > units) return col;
      seen += len;
    }
    return 0;
  }

  detach(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#scheduled = false;
    this.#pendingAll = false;
    this.#pendingRows.clear();
    this.#rowEls.clear();
    this.#root?.remove();
    this.#root = null;
    this.#body = null;
    this.#live = null;
    this.#screen = null;
  }
}

/* ------------------------------------------------------------------ *
 * cells → v1 span shape
 * ------------------------------------------------------------------ */

/** Cell attribute bits → the ansi lane's SGR snapshot shape (1:1, §4.1). */
export function cellToSgr(attrs: number, fgRef: number, bgRef: number, rgbOf: (ref: number, layer: 'fg' | 'bg') => Rgb | null): SgrAttrs {
  const color = (ref: number, layer: 'fg' | 'bg'): AnsiColor => {
    if (ref === REF_DEFAULT) return { kind: 'default' };
    if (isTruecolorRef(ref)) {
      const rgb = rgbOf(ref, layer);
      return rgb === null ? { kind: 'default' } : { kind: 'rgb', r: rgb.r, g: rgb.g, b: rgb.b };
    }
    return { kind: 'indexed', n: ref };
  };
  return {
    bold: (attrs & ATTR.BOLD) !== 0,
    dim: (attrs & ATTR.DIM) !== 0,
    italic: (attrs & ATTR.ITALIC) !== 0,
    underline: (attrs & ATTR.UNDERLINE) !== 0,
    blink: (attrs & ATTR.BLINK) !== 0,
    rapidBlink: false,
    reverse: (attrs & ATTR.REVERSE) !== 0,
    conceal: (attrs & ATTR.HIDDEN) !== 0,
    strikeout: (attrs & ATTR.STRIKE) !== 0,
    fg: color(fgRef, 'fg'),
    bg: color(bgRef, 'bg'),
  };
}

type SpanNode = Text | HTMLElement;

/**
 * Style runs for one screen line — the v1 `#renderLine` span shape
 * (plain runs are bare text; styled runs are `<span class="sem-ansi-*">`).
 */
export function spansForLine(doc: Document, screen: PaintScreen, line: NonNullable<ReturnType<PaintScreen['lineAt']>>): SpanNode[] {
  const out: SpanNode[] = [];
  let runText = '';
  let runKey: string | null = null;
  let runAttrs: SgrAttrs | null = null;
  const endRun = (): void => {
    if (runText === '' || runKey === null || runAttrs === null) return;
    const classes = ansiSpanClasses(runAttrs);
    const style = ansiSpanStyle(runAttrs);
    if (classes.length === 0 && style === '') {
      out.push(doc.createTextNode(runText));
    } else {
      const el = doc.createElement('span');
      el.setAttribute('class', classes.join(' '));
      if (style !== '') el.setAttribute('style', style);
      el.textContent = runText;
      out.push(el);
    }
    runText = '';
  };
  for (let col = 0; col < screen.cols; col++) {
    const cell = line.cell(col);
    if (cell.width === 0) continue; // continuation of the wide cell to the left
    const key = `${cell.attrs}:${cell.fg}:${cell.bg}`;
    if (key !== runKey) {
      endRun();
      runKey = key;
      runAttrs = cellToSgr(cell.attrs, cell.fg, cell.bg, (ref, layer) => screen.rgbOf(ref, layer));
    }
    runText += cell.code === 0
      ? ' '
      : String.fromCodePoint(cell.code) + cell.combining.map((m) => String.fromCodePoint(m)).join('');
  }
  endRun();
  return out;
}
