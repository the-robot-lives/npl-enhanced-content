/**
 * screen/screen — the Screen: buffers, scrollback ring, cursor, damage
 * (CORE-V2 §4).
 *
 * The single source of truth for what is displayed. A plain data
 * structure — the write path never touches DOM or canvas (§4.5), so the
 * core stays DOM-free and Node-testable. Renderers (canvas driver, DOM
 * mirror) read cells and drain damage.
 *
 * Two buffers: primary (`rows × cols` viewport + the scrollback ring)
 * and alternate (`rows × cols`, no scrollback, app lifecycle only).
 * Absolute line numbers count from the ring's oldest retained line, so
 * scrollback eviction never invalidates a live selection — it clips it
 * (§4.3). The viewport can scroll back over ring + viewport; new output
 * while scrolled back does not yank the view.
 *
 * Cursor control covers the §4.4 subset: CUU/CUD/CUF/CUB/CNL/CPL/CUP/
 * HVP/CHA/VPA, DECSC/DECRC save/restore, ED/EL (erased cells take the
 * current SGR background), IL/DL, SU/SD, CR/LF/BS/HT, autowrap
 * (DECAWM, deferred — the cursor rests on the right margin until the
 * next printable, like every real terminal). Origin and insert modes
 * are out of the subset (§4.4); out-of-subset sequences are consumed
 * upstream by the parser, never printed.
 */

import { charWidth, isCombining } from './width.js';
import {
  COLOR_DEFAULT,
  COLS_MAX,
  COLS_MIN,
  ROWS_MAX,
  ROWS_MIN,
  SCROLLBACK_DEFAULT,
  SCROLLBACK_MAX,
  type Buffer,
  type Cell,
  type Color,
  type CursorState,
  type Damage,
  type Line,
  type ScreenModel,
  type ScreenModes,
  type ScreenPos,
  type ScreenTextSource,
  type SelectionRange,
  type StatusFeed,
  type StatusTone,
} from './types.js';

export interface ScreenOptions {
  cols?: number;
  rows?: number;
  /** Scrollback ring capacity (the `scrollback="N"` attribute value). */
  scrollback?: number;
}

const TAB_STOP = 8;

export class Screen implements ScreenModel, ScreenTextSource {
  #cols: number;
  #rows: number;
  readonly primary: Buffer;
  readonly alternate: Buffer;
  #onAlt = false;
  readonly modes: ScreenModes = { autowrap: true, altScreen: false };
  readonly cursor: CursorState = { line: 0, col: 0, visible: true, style: 'block' };

  #savedCursor: { line: number; col: number; attrs: number; fg: Color; bg: Color } | null = null;
  #attrs = 0;
  #fg: Color = COLOR_DEFAULT;
  #bg: Color = COLOR_DEFAULT;

  #ring: Line[] = [];
  #ringCapacity: number;
  /** Absolute top row when scrolled back; -1 = pinned to the bottom. */
  #scrollOffset = -1;
  #pendingWrap = false;

  #selection: SelectionRange | null = null;
  #title = '';
  #status: StatusFeed = { text: '', tone: 'idle' };

  #damage: Damage = { lines: new Set(), cursor: false, scroll: false, full: false };
  #titleHandlers = new Set<(title: string) => void>();
  #statusHandlers = new Set<(status: StatusFeed) => void>();

  constructor(options: ScreenOptions = {}) {
    this.#cols = clampCols(options.cols ?? 80);
    this.#rows = clampRows(options.rows ?? 24);
    this.#ringCapacity = clampScrollback(options.scrollback ?? SCROLLBACK_DEFAULT);
    this.primary = { kind: 'primary', rows: this.#rows, cols: this.#cols, lines: [] };
    this.alternate = { kind: 'alternate', rows: this.#rows, cols: this.#cols, lines: [] };
    fillBuffer(this.primary, this.#bg);
    fillBuffer(this.alternate, this.#bg);
  }

  /* ------------------------------------------------------------ *
   * geometry + model reads
   * ------------------------------------------------------------ */

  get cols(): number {
    return this.#cols;
  }

  get rows(): number {
    return this.#rows;
  }

  get active(): Buffer {
    return this.#onAlt ? this.alternate : this.primary;
  }

  get altScreen(): boolean {
    return this.#onAlt;
  }

  get selection(): SelectionRange | null {
    return this.#selection;
  }

  get title(): string {
    return this.#title;
  }

  get status(): StatusFeed {
    return this.#status;
  }

  get scrollback(): readonly Line[] {
    return this.#ring;
  }

  /** Total logical rows over ring + viewport (the scrollbar total, §10). */
  totalLines(): number {
    return this.#ring.length + this.primary.rows;
  }

  /** Absolute index of the first visible row. */
  viewportTop(): number {
    return this.#scrollOffset >= 0 ? this.#scrollOffset : this.#ring.length;
  }

  atBottom(): boolean {
    return this.#onAlt || this.#scrollOffset < 0;
  }

  scrolledBack(): boolean {
    return !this.#onAlt && this.#scrollOffset >= 0;
  }

  /** The absolute line `abs` over ring + primary viewport (§4.3). */
  lineAt(abs: number): Line | null {
    if (abs < 0) return null;
    if (abs < this.#ring.length) return this.#ring[abs] ?? null;
    return this.primary.lines[abs - this.#ring.length] ?? null;
  }

  /** The `ScreenTextSource` line count (§7.4). */
  get lineCount(): number {
    return this.totalLines();
  }

  /* ------------------------------------------------------------ *
   * damage (§4.5)
   * ------------------------------------------------------------ */

  /** Take the pending batch (drained lines reset; callers paint it). */
  takeDamage(): Damage {
    const batch = this.#damage;
    for (const line of batch.lines) line.dirty = false;
    this.#damage = { lines: new Set(), cursor: false, scroll: false, full: false };
    return batch;
  }

  #touch(line: Line): void {
    line.dirty = true;
    this.#damage.lines.add(line);
  }

  #touchCursor(): void {
    this.#damage.cursor = true;
  }

  #touchScroll(): void {
    this.#damage.scroll = true;
  }

  #touchFull(): void {
    this.#damage.full = true;
    this.#damage.cursor = true;
    this.#damage.scroll = true;
    for (const line of this.primary.lines) this.#touch(line);
    for (const line of this.alternate.lines) this.#touch(line);
  }

  /* ------------------------------------------------------------ *
   * OSC feeds (§11.1)
   * ------------------------------------------------------------ */

  onTitle(handler: (title: string) => void): () => void {
    this.#titleHandlers.add(handler);
    return () => this.#titleHandlers.delete(handler);
  }

  onStatus(handler: (status: StatusFeed) => void): () => void {
    this.#statusHandlers.add(handler);
    return () => this.#statusHandlers.delete(handler);
  }

  /** OSC 0/2 — control chars stripped, capped at 200 (§11.1). */
  setTitle(title: string): void {
    const clean = title.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
    if (clean === this.#title) return;
    this.#title = clean;
    for (const handler of [...this.#titleHandlers]) handler(clean);
  }

  setStatus(text: string, tone: StatusTone = 'idle'): void {
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '');
    const resolved: StatusTone = tone === 'busy' || tone === 'alert' ? tone : 'idle';
    if (clean === this.#status.text && resolved === this.#status.tone) return;
    this.#status = { text: clean, tone: resolved };
    for (const handler of [...this.#statusHandlers]) handler(this.#status);
  }

  /* ------------------------------------------------------------ *
   * pen (the live SGR fold, screen-side)
   * ------------------------------------------------------------ */

  setPen(attrs: number, fg: Color, bg: Color): void {
    this.#attrs = attrs;
    this.#fg = fg;
    this.#bg = bg;
  }

  get pen(): { attrs: number; fg: Color; bg: Color } {
    return { attrs: this.#attrs, fg: this.#fg, bg: this.#bg };
  }

  /* ------------------------------------------------------------ *
   * cursor movement (§4.4)
   * ------------------------------------------------------------ */

  /** Viewport-relative cursor row inside the active buffer. */
  get cursorRow(): number {
    if (this.#onAlt) return clampIndex(this.cursor.line, this.#rows - 1);
    return clampIndex(this.cursor.line - this.#ring.length, this.#rows - 1);
  }

  /** Absolute move to viewport (col, row) — clamped. */
  moveCursor(row: number, col: number): void {
    this.cursor.line = (this.#onAlt ? 0 : this.#ring.length) + clampIndex(row, this.#rows - 1);
    this.cursor.col = clampIndex(col, this.#cols - 1);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  cursorUp(n: number): void {
    this.#setRow(this.cursorRow - Math.max(1, n));
  }

  cursorDown(n: number): void {
    const target = this.cursorRow + Math.max(1, n);
    if (target > this.#rows - 1) {
      this.#scrollUp(target - (this.#rows - 1));
      this.#setRow(this.#rows - 1);
    } else {
      this.#setRow(target);
    }
  }

  cursorForward(n: number): void {
    this.cursor.col = clampIndex(this.cursor.col + Math.max(1, n), this.#cols - 1);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  cursorBack(n: number): void {
    this.cursor.col = clampIndex(this.cursor.col - Math.max(1, n), 0);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  /** CNL — down n rows, column 0. */
  cursorNextLine(n: number): void {
    this.cursorDown(n);
    this.carriageReturn();
  }

  /** CPL — up n rows, column 0. */
  cursorPrevLine(n: number): void {
    this.cursorUp(n);
    this.carriageReturn();
  }

  /** CHA — column absolute, row unchanged. */
  cursorColumn(col: number): void {
    this.cursor.col = clampIndex(col, this.#cols - 1);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  /** DECSC — save cursor position + pen (§4.4). */
  saveCursor(): void {
    this.#savedCursor = { line: this.cursor.line, col: this.cursor.col, attrs: this.#attrs, fg: this.#fg, bg: this.#bg };
  }

  /** DECRC — restore, or home + keep pen when nothing was saved. */
  restoreCursor(): void {
    const saved = this.#savedCursor;
    if (saved === null) {
      this.moveCursor(0, 0);
      return;
    }
    this.cursor.line = Math.max(0, saved.line);
    this.cursor.col = clampIndex(saved.col, this.#cols - 1);
    this.#attrs = saved.attrs;
    this.#fg = saved.fg;
    this.#bg = saved.bg;
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  #setRow(row: number): void {
    this.cursor.line = (this.#onAlt ? 0 : this.#ring.length) + clampIndex(row, this.#rows - 1);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  /* ------------------------------------------------------------ *
   * printing (§4.1, §4.4)
   * ------------------------------------------------------------ */

  /** Print `text` at the cursor with the current pen. */
  print(text: string): void {
    for (const char of text) {
      const cp = char.codePointAt(0)!;
      if (cp === 0x0a) {
        this.lineFeed();
        continue;
      }
      if (cp === 0x0d) {
        this.carriageReturn();
        continue;
      }
      this.printCodePoint(cp);
    }
  }

  /** One glyph: autowrap (deferred), wide pairs, combining folds. */
  printCodePoint(cp: number): void {
    const marks: number[] = [];
    if (isCombining(cp)) {
      this.#foldCombining(cp);
      return;
    }
    const wide = charWidth(cp) === 2;
    if (this.#pendingWrap) {
      this.#pendingWrap = false;
      const wrapped = this.active.lines[this.cursorRow];
      if (wrapped) wrapped.wrapped = true;
      this.carriageReturn();
      this.lineFeed();
    }
    if (wide && this.cursor.col === this.#cols - 1 && this.modes.autowrap) {
      // A wide glyph never straddles the margin (xterm leaves the last cell blank).
      const wrapped = this.active.lines[this.cursorRow];
      if (wrapped) wrapped.wrapped = true;
      this.carriageReturn();
      this.lineFeed();
    } else if (this.cursor.col >= this.#cols && this.modes.autowrap) {
      const wrapped = this.active.lines[this.cursorRow];
      if (wrapped) wrapped.wrapped = true;
      this.carriageReturn();
      this.lineFeed();
    }
    const line = this.active.lines[this.cursorRow];
    if (line === undefined) return;
    this.#put(line, this.cursor.col, cp, wide ? 2 : 1, marks);
    if (wide) {
      if (this.cursor.col + 1 < this.#cols) {
        line.widths[this.cursor.col + 1] = 0; // continuation cell
        line.bg[this.cursor.col + 1] = this.#bg;
      } else {
        this.cursor.col = this.#cols - 1;
        this.#pendingWrap = this.modes.autowrap;
        this.#touch(line);
        this.#touchCursor();
        return;
      }
      this.cursor.col += 2;
    } else {
      this.cursor.col += 1;
    }
    if (this.cursor.col >= this.#cols) {
      this.cursor.col = this.#cols - 1;
      this.#pendingWrap = this.modes.autowrap;
    }
    this.#touch(line);
    this.#touchCursor();
  }

  /** Fold a combining mark onto the cell just written (or the margin cell). */
  #foldCombining(cp: number): void {
    const line = this.active.lines[this.cursorRow];
    if (line === undefined) return;
    const col = Math.max(0, this.#pendingWrap ? this.#cols - 1 : this.cursor.col - 1);
    line.combining ??= new Map();
    const existing = line.combining.get(col) ?? [];
    existing.push(cp);
    line.combining.set(col, existing);
    this.#touch(line);
  }

  /** LF — down one row; at the bottom margin the viewport scrolls. */
  lineFeed(): void {
    this.#pendingWrap = false;
    const row = this.cursorRow;
    if (row >= this.#rows - 1) {
      this.#scrollUp(1);
      this.#setRow(this.#rows - 1);
    } else {
      this.#setRow(row + 1);
    }
  }

  carriageReturn(): void {
    this.cursor.col = 0;
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  /** BS — one cell left, never past column 0. */
  backspace(): void {
    this.cursorBack(1);
  }

  /** HT — to the next tab stop (every 8 columns). */
  tab(): void {
    const col = this.cursor.col;
    this.cursor.col = Math.min((Math.floor(col / TAB_STOP) + 1) * TAB_STOP, this.#cols - 1);
    this.#pendingWrap = false;
    this.#touchCursor();
  }

  #put(line: Line, col: number, code: number, width: 1 | 2, marks: number[]): void {
    if (col < 0 || col >= line.cols) return;
    line.codes[col] = code;
    line.widths[col] = width;
    line.attrs[col] = this.#attrs;
    line.fg[col] = this.#fg;
    line.bg[col] = this.#bg;
    if (marks.length > 0) {
      line.combining ??= new Map();
      line.combining.set(col, marks);
    }
  }

  /* ------------------------------------------------------------ *
   * erase / insert / delete / scroll (§4.4)
   * ------------------------------------------------------------ */

  /** ED — erase display: 0 cursor→end, 1 start→cursor, 2 all. */
  eraseDisplay(mode: 0 | 1 | 2 = 0): void {
    if (mode === 2) {
      for (const line of this.active.lines) this.#eraseSpan(line, 0, this.#cols - 1);
      this.#touchFull();
      return;
    }
    const row = this.cursorRow;
    for (let r = mode === 0 ? row : 0; r <= (mode === 0 ? this.#rows - 1 : row); r++) {
      const line = this.active.lines[r];
      if (line === undefined) continue;
      const from = mode === 0 && r === row ? this.cursor.col : 0;
      const to = mode === 1 && r === row ? this.cursor.col : this.#cols - 1;
      this.#eraseSpan(line, from, to);
      this.#touch(line);
    }
    this.#touchCursor();
  }

  /** EL — erase line: 0 cursor→eol, 1 sol→cursor, 2 all. */
  eraseLine(mode: 0 | 1 | 2 = 0): void {
    const line = this.active.lines[this.cursorRow];
    if (line === undefined) return;
    if (mode === 2) this.#eraseSpan(line, 0, this.#cols - 1);
    else if (mode === 0) this.#eraseSpan(line, this.cursor.col, this.#cols - 1);
    else this.#eraseSpan(line, 0, this.cursor.col);
    this.#touch(line);
  }

  /** ECH — erase n characters at the cursor (EL fill rules, n cells). */
  eraseChars(n: number): void {
    const line = this.active.lines[this.cursorRow];
    if (line === undefined) return;
    this.#eraseSpan(line, this.cursor.col, this.cursor.col + Math.max(1, n) - 1);
    this.#touch(line);
  }

  /** Erased cells take the current SGR background, no other attrs (§4.4). */
  #eraseSpan(line: Line, from: number, to: number): void {
    for (let col = from; col <= to && col < line.cols; col++) {
      line.codes[col] = 0;
      line.widths[col] = 1;
      line.fg[col] = COLOR_DEFAULT;
      line.bg[col] = this.#bg;
      line.attrs[col] = 0;
    }
    if (line.combining !== null) {
      for (const col of [...line.combining.keys()]) {
        if (col >= from && col <= to) line.combining.delete(col);
      }
    }
  }

  /** IL — insert n blank lines at the cursor row; content shifts down. */
  insertLines(n: number): void {
    const count = Math.max(1, n);
    const row = this.cursorRow;
    for (let i = 0; i < count; i++) {
      this.active.lines.pop();
      this.active.lines.splice(row, 0, blankLine(this.#cols));
    }
    for (const line of this.active.lines) this.#touch(line);
    this.#touchCursor();
  }

  /** DL — delete n lines at the cursor row; blanks fill from the bottom. */
  deleteLines(n: number): void {
    const count = Math.max(1, n);
    const row = this.cursorRow;
    for (let i = 0; i < count; i++) {
      this.active.lines.splice(row, 1);
      this.active.lines.push(blankLine(this.#cols));
    }
    for (const line of this.active.lines) this.#touch(line);
    this.#touchCursor();
  }

  /** SU — scroll content up n; on primary the top lines enter the ring. */
  scrollUp(n: number): void {
    this.#scrollUp(Math.max(1, n));
  }

  /** SD — scroll content down n; the bottom line is lost. */
  scrollDown(n: number): void {
    for (let i = 0; i < Math.max(1, n); i++) {
      this.active.lines.pop();
      this.active.lines.unshift(blankLine(this.#cols));
    }
    for (const line of this.active.lines) this.#touch(line);
    this.#touchScroll();
  }

  #scrollUp(n: number): void {
    for (let i = 0; i < n; i++) {
      const top = this.active.lines.shift();
      if (top !== undefined && !this.#onAlt) this.#pushRing(top);
      this.active.lines.push(blankLine(this.#cols));
    }
    for (const line of this.active.lines) this.#touch(line);
    this.#touchScroll();
  }

  /* ------------------------------------------------------------ *
   * scrollback ring + viewport scroll (§4.3, §10)
   * ------------------------------------------------------------ */

  /** A line enters the ring — immutable from here on (§4.3). */
  #pushRing(line: Line): void {
    line.dirty = false;
    this.#ring.push(line);
    if (this.#ring.length > this.#ringCapacity) this.#evict(this.#ring.length - this.#ringCapacity);
  }

  /**
   * Evict the oldest `count` lines; every absolute coordinate shifts by
   * the eviction (§4.3 — a live selection is clipped, not invalidated).
   */
  #evict(count: number): void {
    if (count <= 0) return;
    this.#ring.splice(0, count);
    this.cursor.line = Math.max(0, this.cursor.line - count);
    if (this.#scrollOffset >= 0) {
      this.#scrollOffset = Math.max(0, this.#scrollOffset - count);
      this.#touchScroll();
    }
    if (this.#selection !== null) {
      const start = { line: this.#selection.start.line - count, col: this.#selection.start.col };
      const end = { line: this.#selection.end.line - count, col: this.#selection.end.col };
      if (end.line < 0) {
        this.#selection = null;
      } else {
        this.#selection = { start: start.line < 0 ? { line: 0, col: 0 } : start, end };
      }
    }
  }

  /** Move the viewport to absolute row `line`; past it → pinned bottom. */
  scrollTo(line: number): void {
    if (this.#onAlt) return; // alt screen: wheel belongs to the app (§7.3)
    const max = Math.max(0, this.totalLines() - this.#rows);
    const target = clampIndex(line, max);
    this.#scrollOffset = target >= this.#ring.length ? -1 : target;
    this.#touchScroll();
  }

  /** Wheel-shaped scroll: positive rows = down toward the bottom. */
  scrollBy(rows: number): void {
    if (this.atBottom() && rows >= 0) return;
    this.scrollTo(this.viewportTop() + rows);
  }

  /* ------------------------------------------------------------ *
   * alternate screen (§6.2 — app lifecycle only)
   * ------------------------------------------------------------ */

  /** Enter the alternate buffer (saves cursor + pen). */
  enterAlternate(): void {
    if (this.#onAlt) return;
    this.saveCursor();
    this.#onAlt = true;
    this.modes.altScreen = true;
    fillBuffer(this.alternate, this.#bg);
    this.cursor.line = 0;
    this.cursor.col = 0;
    this.#pendingWrap = false;
    this.#touchFull();
  }

  /** Leave the alternate buffer; primary + saved cursor restored exactly. */
  exitAlternate(): void {
    if (!this.#onAlt) return;
    this.#onAlt = false;
    this.modes.altScreen = false;
    this.restoreCursor();
    this.#pendingWrap = false;
    this.#touchFull();
  }

  /* ------------------------------------------------------------ *
   * resize + reflow (§4.6)
   * ------------------------------------------------------------ */

  /**
   * Resize. Primary: re-unwrap logical lines (via `wrapped` flags) and
   * re-wrap at the new width — scrollback reflows too; the cursor keeps
   * its logical position, clamped. Alternate: redimensioned in place,
   * top-left anchored, no reflow (apps redraw on `onResize`).
   */
  resize(cols: number, rows: number): void {
    const nextCols = clampCols(cols);
    const nextRows = clampRows(rows);
    if (nextCols === this.#cols && nextRows === this.#rows) return;
    this.#reflowPrimary(nextCols, nextRows);
    this.#redimension(this.alternate, nextCols, nextRows);
    this.#cols = nextCols;
    this.#rows = nextRows;
    this.primary.cols = nextCols;
    this.primary.rows = nextRows;
    this.alternate.cols = nextCols;
    this.alternate.rows = nextRows;
    this.cursor.col = clampIndex(this.cursor.col, nextCols - 1);
    this.cursor.line = Math.max(0, Math.min(this.cursor.line, this.#ring.length + nextRows - 1));
    if (this.#scrollOffset >= 0) this.#scrollOffset = clampIndex(this.#scrollOffset, Math.max(0, this.totalLines() - nextRows));
    this.#pendingWrap = false;
    this.#touchFull();
  }

  #reflowPrimary(cols: number, rows: number): void {
    const before = logicalLines([...this.#ring, ...this.primary.lines]);
    const cursorAbs = this.#ring.length + this.cursorRow;
    // Locate the cursor in logical space before the rebuild (§4.6).
    let logicalIndex = Math.max(0, before.length - 1);
    let logicalCol = this.cursor.col;
    let walked = 0;
    for (let index = 0; index < before.length; index++) {
      const logical = before[index]!;
      const span = logical.rows.length;
      if (cursorAbs < walked + span) {
        logicalIndex = index;
        logicalCol = 0;
        for (let within = 0; within < span; within++) {
          if (walked + within === cursorAbs) {
            logicalCol += this.cursor.col;
            break;
          }
          logicalCol += logical.rows[within]!.cols;
        }
        break;
      }
      walked += span;
    }

    // Rebuild ring + viewport from the re-wrapped logical lines. When the
    // re-wrap is taller than the viewport the stream scrolls: the leading
    // rows move INTO the ring (append at its end) and the new row lands at
    // the viewport bottom — pushing the overflow tail to the ring instead
    // would reorder the stream (tail rows ahead of viewport rows) and
    // break every cursor-row computed from ring+viewport coordinates.
    // Blank groups strictly BELOW the cursor's line are viewport padding,
    // not content: re-wrapping them as rows would scroll real content
    // into the ring and shift the tail up on every metrics settle.
    this.#ring = [];
    this.primary.lines = [];
    for (let group = 0; group < before.length; group++) {
      const logical = before[group]!;
      if (group > logicalIndex && isBlankGroup(logical)) break;
      for (const line of wrapLogical(logical, cols)) {
        if (this.primary.lines.length < rows) this.primary.lines.push(line);
        else {
          this.#pushRing(this.primary.lines.shift()!);
          this.primary.lines.push(line);
        }
      }
    }
    while (this.primary.lines.length < rows) this.primary.lines.push(blankLine(cols));

    // Place the cursor: its logical line's viewport row, clamped (§4.6).
    let placedRow = rows - 1;
    let placedCol = clampIndex(logicalCol, cols - 1);
    let seen = 0;
    const after = logicalLines([...this.#ring, ...this.primary.lines]);
    for (let index = 0; index < after.length; index++) {
      const logical = after[index]!;
      if (index === logicalIndex) {
        // The stream row is the re-wrapped rows of every logical line
        // ABOVE the cursor's, plus the wrap-row offset within its own —
        // `within` alone is the offset inside one logical line and is 0
        // for any unwrapped line, which parked the cursor on the top row
        // and made the next writes clobber the screen head (round-2
        // semtext.dev feedback: boot lines overwritten by start-script
        // output). The cursor's line is an absolute stream row (ring
        // rows first), so place it directly; a row scrolled into the
        // ring or below the fold falls back to the bottom row.
        const within = Math.max(0, Math.min(floorDiv(logicalCol, cols), logical.rows.length - 1));
        const streamRow = seen + within;
        const ringHold = this.#ring.length;
        if (streamRow >= ringHold && streamRow < ringHold + rows) placedRow = streamRow - ringHold;
        else placedRow = Math.max(0, rows - 1);
        placedCol = clampIndex(logicalCol - within * cols, cols - 1);
        break;
      }
      seen += logical.rows.length;
    }
    this.cursor.line = this.#ring.length + placedRow;
    this.cursor.col = placedCol;    if (this.#scrollOffset >= 0) this.#scrollOffset = clampIndex(this.#scrollOffset, Math.max(0, this.totalLines() - rows));
  }

  #redimension(buffer: Buffer, cols: number, rows: number): void {
    const lines: Line[] = [];
    for (let row = 0; row < rows; row++) {
      const source = buffer.lines[row];
      const line = blankLine(cols);
      if (source !== undefined) {
        const width = Math.min(cols, source.cols);
        for (let col = 0; col < width; col++) {
          line.codes[col] = source.codes[col]!;
          line.widths[col] = source.widths[col]!;
          line.fg[col] = source.fg[col]!;
          line.bg[col] = source.bg[col]!;
          line.attrs[col] = source.attrs[col]!;
        }
        if (source.combining !== null) line.combining = new Map(source.combining);
      }
      lines.push(line);
    }
    buffer.lines = lines;
  }

  /* ------------------------------------------------------------ *
   * clear (`clear` / Ctrl+L — §5.2: viewport only, scrollback kept)
   * ------------------------------------------------------------ */

  clearViewport(): void {
    this.primary.lines = Array.from({ length: this.primary.rows }, () => blankLine(this.#cols));
    this.cursor.line = this.#ring.length;
    this.cursor.col = 0;
    this.#pendingWrap = false;
    this.#touchFull();
  }

  /* ------------------------------------------------------------ *
   * selection (§7.3, §9)
   * ------------------------------------------------------------ */

  setSelection(range: SelectionRange | null): void {
    this.#selection = range === null ? null : normalizeRange(range);
    for (const line of this.primary.lines) this.#touch(line);
  }

  /* ------------------------------------------------------------ *
   * cell access + text extraction (§7.4, §9)
   * ------------------------------------------------------------ */

  /** Logical `Cell` read; continuation cells read as blank. */
  cellAt(line: Line, col: number): Cell {
    const index = clampIndex(col, line.cols - 1);
    if (line.widths[index] === 0) {
      return { code: 0, combining: [], width: 0, fg: COLOR_DEFAULT, bg: COLOR_DEFAULT, attrs: 0 };
    }
    return {
      code: line.codes[index] ?? 0,
      combining: line.combining?.get(index) ?? [],
      width: (line.widths[index] ?? 1) as 0 | 1 | 2,
      fg: line.fg[index] ?? COLOR_DEFAULT,
      bg: line.bg[index] ?? COLOR_DEFAULT,
      attrs: line.attrs[index] ?? 0,
    };
  }

  /**
   * The ONE extraction path (§7.4, §9): copy, *Open plain transcript*,
   * and find-in-page all feed from here. Trailing blanks trimmed per
   * line; continuation cells skipped; combining marks ride their base.
   */
  extractText(range: SelectionRange | null = this.#selection): string {
    const total = this.totalLines();
    if (total === 0) return '';
    const from = range === null ? 0 : Math.max(0, range.start.line);
    const to = range === null ? total - 1 : Math.min(range.end.line, total - 1);
    const rectangular = range?.rectangular === true;
    const lines: string[] = [];
    for (let abs = from; abs <= to; abs++) {
      const line = this.lineAt(abs);
      if (line === null) {
        lines.push('');
        continue;
      }
      // Rectangular: EVERY row uses the range's column bounds; stream
      // selection bounds only its two end rows.
      const startCol = range !== null && (rectangular || abs === range.start.line) ? range.start.col : 0;
      const endCol = range !== null && (rectangular || abs === range.end.line) ? range.end.col : line.cols - 1;
      lines.push(lineText(line, startCol, endCol));
    }
    return lines.join('\n');
  }
}

/* ------------------------------------------------------------------ *
 * line factories + text helpers
 * ------------------------------------------------------------------ */

/** A blank line sized `cols`; a pen fills the background (erase fill). */
export function blankLine(cols: number, bg: Color = COLOR_DEFAULT): Line {
  return {
    cols,
    codes: new Uint32Array(cols),
    widths: new Uint8Array(cols).fill(1),
    fg: new Uint16Array(cols).fill(COLOR_DEFAULT),
    bg: new Uint16Array(cols).fill(bg),
    attrs: new Uint16Array(cols),
    combining: null,
    wrapped: false,
    dirty: false,
    stale: false,
  };
}

function fillBuffer(buffer: Buffer, bg: Color): void {
  buffer.lines = Array.from({ length: buffer.rows }, () => blankLine(buffer.cols, bg));
}

/** Serialize a line span to text over [startCol, endCol]; blanks trimmed. */
export function lineText(line: Line, startCol = 0, endCol = line.cols - 1): string {
  let out = '';
  for (let col = startCol; col <= endCol && col < line.cols; col++) {
    const code = line.codes[col]!;
    if (code === 0 || line.widths[col] === 0) continue;
    out += String.fromCodePoint(code);
    const marks = line.combining?.get(col);
    if (marks !== undefined) for (const mark of marks) out += String.fromCodePoint(mark);
  }
  return out.replace(/[ \t]+$/, '');
}

/** Whole-line text (tests, golden grids, plain transcript). */
export function lineString(line: Line): string {
  return lineText(line);
}

/* ------------------------------------------------------------------ *
 * reflow helpers (§4.6)
 * ------------------------------------------------------------------ */

interface LogicalGroup {
  rows: Line[];
}

/** Group consecutive lines into logical lines by the `wrapped` flag. */
export function logicalLines(lines: readonly Line[]): LogicalGroup[] {
  const groups: LogicalGroup[] = [];
  let current: Line[] = [];
  for (const line of lines) {
    current.push(line);
    if (!line.wrapped) {
      groups.push({ rows: current });
      current = [];
    }
  }
  if (current.length > 0) groups.push({ rows: current });
  return groups;
}

/** A logical group whose rows carry no printable cell (viewport padding). */
function isBlankGroup(group: LogicalGroup): boolean {
  for (const row of group.rows) {
    for (let index = 0; index < row.cols; index++) {
      if (row.codes[index] !== 0) return false;
    }
  }
  return true;
}

/** Re-wrap one logical line at `cols`; wide glyphs never straddle. */
export function wrapLogical(group: LogicalGroup, cols: number): Line[] {
  const out: Line[] = [];
  let line = blankLine(cols);
  let col = 0;
  for (const row of group.rows) {
    for (let index = 0; index < row.cols; index++) {
      const code = row.codes[index]!;
      const width = row.widths[index]!;
      const marks = row.combining?.get(index);
      if (code === 0 || width === 0) continue;
      const effective = (width === 2 ? 2 : 1) as 1 | 2;
      if (col + effective > cols) {
        line.wrapped = true;
        out.push(line);
        line = blankLine(cols);
        col = 0;
      }
      line.codes[col] = code;
      line.widths[col] = effective;
      line.attrs[col] = row.attrs[index]!;
      line.fg[col] = row.fg[index]!;
      line.bg[col] = row.bg[index]!;
      if (marks !== undefined && marks.length > 0) {
        line.combining ??= new Map();
        line.combining.set(col, marks);
      }
      if (effective === 2 && col + 1 < cols) {
        line.widths[col + 1] = 0;
        line.bg[col + 1] = row.bg[index]!;
      }
      col += effective;
    }
  }
  out.push(line);
  return out;
}

/* ------------------------------------------------------------------ *
 * misc
 * ------------------------------------------------------------------ */

function normalizeRange(range: SelectionRange): SelectionRange {
  const { start, end } = range;
  const flip = start.line > end.line || (start.line === end.line && start.col > end.col);
  return flip ? { start: end, end: start } : { start, end };
}

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, max)));
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / Math.max(1, b));
}

function clampCols(cols: number): number {
  return Math.max(COLS_MIN, Math.min(Math.floor(cols), COLS_MAX));
}

function clampRows(rows: number): number {
  return Math.max(ROWS_MIN, Math.min(Math.floor(rows), ROWS_MAX));
}

function clampScrollback(n: number): number {
  return Math.max(0, Math.min(Math.floor(n), SCROLLBACK_MAX));
}

/** Unused-parameter guard for selection rebuild bookkeeping. */
export type ScreenPosAlias = ScreenPos;
