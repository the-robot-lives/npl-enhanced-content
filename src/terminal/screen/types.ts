/**
 * screen/types — the CORE-V2 screen-model + app-API contract (§4–§7).
 *
 * This module is the cross-lane contract published FIRST (round-2, §2):
 * every other lane codes against these shapes. It is dependency-free on
 * purpose — types and encoding constants only, no runtime code — so any
 * module can import it without pulling the screen implementation.
 *
 * Terminology map (this file ↔ docs/terminal/CORE-V2.md): `Line` is the
 * doc's ScreenLine, `Damage` is its DamageSet, `App`/`AppContext` are its
 * TerminalApp/AppApi, `MouseEvent` its MouseEventInfo, `ScreenModel` its
 * Screen. Aliases for the doc names are exported at the bottom.
 *
 * Attr bits are 1:1 with the ansi lane's SgrAttrs (src/terminal/ansi/
 * sgr.ts): SGR 1/2/3/4/5/6/7/8/9 set them, 22/23/24/25/27/28/29 clear
 * them, SGR 0 clears them plus colors. REVERSE is stored, never baked —
 * renderers and selection compose it at paint time (§4.1).
 */

/** Cell attribute bit flags (§4.1) — 1:1 with `SgrAttrs` boolean fields. */
export const ATTR = Object.freeze({
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  RAPID_BLINK: 1 << 5,
  REVERSE: 1 << 6,
  HIDDEN: 1 << 7,
  STRIKE: 1 << 8,
});

/** Bit mask of every defined attr flag (emptiness and masking tests). */
export const ATTR_MASK = 0x1ff;

/* ------------------------------------------------------------------ *
 * Color refs (§4.2)
 * ------------------------------------------------------------------ */

/**
 * A fg/bg color reference packed into 16 bits:
 *  - `0x0000–0x00FF` index the terminal palette (16 ANSI + the xterm
 *    240-cube; palette resolution lives in `screen/palette.ts`);
 *  - `0x8000–0xFFFE` index the screen's deduplicated truecolor table
 *    (RGB24 stored once per unique color);
 *  - `COLOR_DEFAULT` = the theme default (the active `data-sem-theme`'s
 *    foreground/background tokens).
 */
export type Color = number;

/** Theme default color (§4.2 `0xFFFF`). */
export const COLOR_DEFAULT = 0xffff;
/** First truecolor-table slot (§4.2 `0x8000`). */
export const COLOR_TRUECOLOR_BASE = 0x8000;
/** Last truecolor-table slot (§4.2 `0xFFFE`). */
export const COLOR_TRUECOLOR_MAX = 0xfffe;

/* ------------------------------------------------------------------ *
 * Cell + line (§4.1, §4.3)
 * ------------------------------------------------------------------ */

/**
 * One character position, logical shape (§4.1). Storage is the SoA `Line`
 * below; `Cell` is what readers (canvas, mirror, tests, golden grids)
 * materialise per position. `code` is the base codepoint (a USV), 0 =
 * blank; `combining` folds combining marks onto the cell; `width` 2 =
 * East-wide glyph, 0 = continuation cell of a wide pair.
 */
export interface Cell {
  code: number;
  combining: number[];
  width: 0 | 1 | 2;
  fg: Color;
  bg: Color;
  attrs: number;
}

/**
 * One screen line — structure-of-arrays storage, `cols` wide (§4.3).
 * Arrays are allocated to exactly `cols`; writers never grow them (the
 * screen reallocates on resize). `combining` is allocated lazily — null
 * until a combining mark lands on this line. Flags:
 *  - `wrapped`: this line is the continuation of a logical line (set by
 *    autowrap; consumed by reflow, selection and copy);
 *  - `dirty`: mutation damage for the current batch;
 *  - `stale`: renderer bookkeeping (line re-used in place since last paint).
 *
 * A line is IMMUTABLE once it leaves the viewport into the scrollback
 * ring — the ring stores refs, so capacity is a memory dial (§4.3).
 */
export interface Line {
  cols: number;
  codes: Uint32Array;
  widths: Uint8Array;
  fg: Uint16Array;
  bg: Uint16Array;
  attrs: Uint16Array;
  /** col → combining marks (rare; null until first use). */
  combining: Map<number, number[]> | null;
  wrapped: boolean;
  dirty: boolean;
  stale: boolean;
}

/** Which of the two buffers a `Buffer` is (§4.3). */
export type BufferKind = 'primary' | 'alternate';

/**
 * One screen buffer: `rows × cols` of lines, row 0 at the top. The
 * primary buffer's scrollback lives on the screen (the `scrollback`
 * ring), not here — a buffer is exactly the viewport.
 */
export interface Buffer {
  readonly kind: BufferKind;
  rows: number;
  cols: number;
  /** Row-ordered viewport lines; index 0 = top row. Length === rows. */
  lines: Line[];
}

/* ------------------------------------------------------------------ *
 * Damage (§4.5)
 * ------------------------------------------------------------------ */

/**
 * The write-path damage batch (§4.5). Every mutation marks line(s) dirty
 * and/or sets `cursor` (cursor moved or visibility changed) and/or
 * `scroll` (the viewport scrolled over scrollback). `full` marks a
 * everything-changed frame (resize, alternate-screen switch, ED 2) —
 * renderers repaint all rows. Batched per microtask; renderers drain per
 * animation frame. Nothing in the write path touches DOM or canvas.
 */
export interface Damage {
  readonly lines: Set<Line>;
  cursor: boolean;
  scroll: boolean;
  full: boolean;
}

/* ------------------------------------------------------------------ *
 * Cursor, modes, selection (§4.4, §7.3)
 * ------------------------------------------------------------------ */

/** Cursor glyph style (§8.3); apps may set it via the `ScreenWriter`. */
export type CursorStyle = 'block' | 'underline' | 'beam';

/**
 * The drawn cursor (§4.4): `(line, col)` in absolute-line space
 * (`line` = viewport-top + row of the cell it occupies), plus the
 * cursor-visible mode (DECTCEM — apps hide it, the pager at idle) and
 * the app-set glyph style. Blink is a renderer concern (§8.3), not state.
 */
export interface CursorState {
  line: number;
  col: number;
  visible: boolean;
  style: CursorStyle;
}

/**
 * The small xterm mode subset (§4.4). `autowrap` is DECAWM (default on).
 * `altScreen` is app lifecycle only — never settable by commands. The
 * cursor-visible mode lives on `CursorState.visible`. Origin mode and
 * insert mode are OUT of the subset — not implemented (§4.4).
 */
export interface ScreenModes {
  autowrap: boolean;
  altScreen: boolean;
}

/**
 * A position in absolute-line space: `line` numbers logical lines
 * monotonically from the ring's oldest retained line, `col` is the 0-based
 * cell column. Scrollback eviction never invalidates a live selection —
 * it clips it (§4.3). Reflow-safe: selection addresses logical lines.
 */
export interface ScreenPos {
  line: number;
  col: number;
}

/** A selection range, start/end in absolute-line space (§7.3, §9). */
export interface SelectionRange {
  start: ScreenPos;
  end: ScreenPos;
}

/* ------------------------------------------------------------------ *
 * OSC feeds (§11.1)
 * ------------------------------------------------------------------ */

/** Status-line tone for the window-chrome status dot (§11.1). */
export type StatusTone = 'idle' | 'busy' | 'alert';

/** The OSC 9 status feed value: text + tone (§11.1). */
export interface StatusFeed {
  text: string;
  tone: StatusTone;
}

/* ------------------------------------------------------------------ *
 * Input shapes (§7)
 * ------------------------------------------------------------------ */

/**
 * One normalized key event (§7.1) — the single shape physical keys,
 * scripted keys and `sendKeys` all become. `key` is the normalized name:
 * printable single characters as themselves; named keys `Enter`,
 * `Escape`, `Backspace`, `Delete`, `Tab`, `ArrowUp/Down/Left/Right`,
 * `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `F1`–`F12`, `Space`.
 * `meta` is observed but reserved (browser-owned; no v2 behavior binds it).
 */
export interface KeyEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/**
 * One mouse event delivered to an app that requested reporting (§7.3) —
 * internally SGR-1006-shaped; we never synthesize legacy encodings. `col`,
 * `row` are 0-based cell coordinates. `button` 0/1/2 = left/middle/right
 * (movement/drag events carry the active button); wheel events carry
 * `dx`/`dy` deltas instead. `press`/`release`/`drag` are click-shaped;
 * `wheel` is scroll-shaped.
 */
export interface MouseEvent {
  kind: 'press' | 'release' | 'drag' | 'wheel';
  button: 0 | 1 | 2;
  col: number;
  row: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Wheel deltas in lines (positive = down/right); 0 for non-wheel. */
  dx: number;
  dy: number;
}

/* ------------------------------------------------------------------ *
 * Line discipline (§5)
 * ------------------------------------------------------------------ */

/**
 * The line-discipline strategy (§5.1): cooked (the shell line editor —
 * history with draft, Tab completion, the control-char table) or raw
 * (verbatim forwarding to an owning app). The discipline owns the prompt
 * row: cooked paints prompt + buffer + in-grid cursor onto the primary
 * screen's last line(s); raw paints nothing (the app owns every cell).
 */
export interface LineDiscipline {
  mode: 'cooked' | 'raw';
  /** Physical/scripted key events, already normalized (§7.1). */
  key(ev: KeyEvent): void;
  /** Cooked only: the shell callback when a line is submitted. */
  onSubmit(line: string): void;
  /** Raw only: enter raw mode on behalf of `app` (§5.3). */
  attach(app: App): void;
  /** Raw only: exit raw mode, restore cooked (§5.3). */
  detach(): void;
}

/* ------------------------------------------------------------------ *
 * App API (§6)
 * ------------------------------------------------------------------ */

/**
 * The typed façade apps draw through (§6.1): append ANSI-bearing text
 * through the parser into the screen (the parser is the gate — unknown
 * sequences are consumed, never printed) plus cursor helpers. Apps may
 * also emit raw ANSI strings via `write`.
 */
export interface ScreenWriter {
  /** ANSI-bearing text, parser-gated, written at the cursor. */
  write(text: string): void;
  /** `write` + newline (CR LF semantics at the screen). */
  writeln(text?: string): void;
  /** Absolute cursor move to 0-based viewport `(col, row)`, clamped. */
  moveTo(col: number, row: number): void;
  /** ED — erase display (0 cursor→end, 1 start→cursor, 2 all). */
  eraseDisplay(mode?: 0 | 1 | 2): void;
  /** EL — erase line (0 cursor→eol, 1 sol→cursor, 2 all). */
  eraseLine(mode?: 0 | 1 | 2): void;
  /** Show/hide the cursor (DECTCEM). */
  setCursorVisible(visible: boolean): void;
  /** Set the drawn cursor glyph style (§8.3). */
  setCursorStyle(style: CursorStyle): void;
}

/**
 * The app-side API handed to `App.start` (§6.1). `exit` is the ONLY way
 * out — the runner detaches and restores the primary screen (§6.2).
 */
export interface AppContext {
  readonly screen: ScreenWriter;
  readonly cols: number;
  readonly rows: number;
  /** OSC 0/2 feed (§11.1) — sets the window/tab title. */
  setTitle(title: string): void;
  /** OSC 9 feed (§11.1) — the chrome status line. */
  setStatus(text: string, tone?: StatusTone): void;
  /** Opt in to mouse reporting; events arrive at `App.mouse` (§7.3). */
  requestMouse(report: boolean): void;
  /** Exit the app; the runner tears down and prints `exit N` (§6.2). */
  exit(code?: number): void;
}

/**
 * A full-screen terminal app (§6.1) — a guest, not an owner: it receives
 * events and draws through the same Screen API anyone else uses. Additive
 * surfaces (all optional, beyond CORE-V2 §6.1):
 *  - `a11ySummary` — compact announcement line emitted on change (§9);
 *  - `semantic` — hybrid mode: light-DOM content surface kept in the a11y
 *    tree alongside the grid (§9);
 *  - `find` — the app's find verb (the pager's `/`); absent ⇒ the terminal
 *    context menu disables Find… with a hint (§8.5).
 */
export interface App {
  readonly id: string;
  start(api: AppContext): void | Promise<void>;
  /** Raw-mode key delivery (§5.3) — the app decides what Ctrl+C means. */
  key(ev: KeyEvent): void;
  resize?(cols: number, rows: number): void;
  /** Bracketed-paste content (§7.4). */
  paste?(text: string): void;
  /** Only called when the app requested mouse reporting (§7.3). */
  mouse?(ev: MouseEvent): void;
  /** App teardown — guaranteed by the runner, crash or not (§5.3). */
  stop(): void;
  a11ySummary?(): string;
  semantic?(): HTMLElement;
  find?(): void;
}

/* ------------------------------------------------------------------ *
 * The screen model (§4)
 * ------------------------------------------------------------------ */

/**
 * Screen-read side of the model: buffers, ring, cursor, feeds, damage,
 * selection, scroll (§4). The write path lives on the `Screen`
 * implementation (`screen/screen.ts`); renderers and lanes read here.
 */
export interface ScreenModel {
  readonly cols: number;
  readonly rows: number;
  readonly primary: Buffer;
  readonly alternate: Buffer;
  /** `alternate` while an app owns the screen, else `primary` (§6.2). */
  readonly active: Buffer;
  readonly modes: ScreenModes;
  readonly cursor: CursorState;
  readonly selection: SelectionRange | null;
  /** Current OSC 0/2 title (control chars stripped, capped 200 — §11.1). */
  readonly title: string;
  readonly status: StatusFeed;

  /** Take the pending damage batch (returns it, starts a fresh one). */
  takeDamage(): Damage;

  /** Subscribe to the OSC 0/2 title feed → unsubscribe (§11.1). */
  onTitle(handler: (title: string) => void): () => void;
  /** Subscribe to the OSC 9 status feed → unsubscribe (§11.1). */
  onStatus(handler: (status: StatusFeed) => void): () => void;

  /** Set the title from the shell side (tabs model, direnv hooks). */
  setTitle(title: string): void;
  /** Set the status from the shell side (direnv hooks). */
  setStatus(text: string, tone?: StatusTone): void;

  /** Set/clear the selection (canvas overlay + mirror + copy, §9). */
  setSelection(range: SelectionRange | null): void;

  /** The scrollback ring, oldest retained line first (§4.3). */
  readonly scrollback: readonly Line[];

  /** Total logical lines over ring + active viewport (scrollbar §10). */
  totalLines(): number;
  /** Absolute index of the first visible row (scrollbar §10). */
  viewportTop(): number;
  /** Move the viewport; scroll damage follows (§10). */
  scrollTo(line: number): void;
  /** Whether the viewport sits at the bottom (wheel stickiness §7.3). */
  atBottom(): boolean;
  /** True when the user is scrolled back over scrollback. */
  scrolledBack(): boolean;

  /** The absolute line `abs` (ring + viewport), or null out of range. */
  lineAt(abs: number): Line | null;

  /** Resize + reflow (§4.6): primary rewraps, alternate redimensions. */
  resize(cols: number, rows: number): void;
}

/* ------------------------------------------------------------------ *
 * Text extraction (§7.4, §9) — the ONE copy source
 * ------------------------------------------------------------------ */

/**
 * Read-side view over absolute lines used by the one `extractText`
 * (§7.4): copy, the context menu's *Open plain transcript*, and the
 * mirror's find-in-page all feed from this, so canvas selection and
 * mirror selection copy identical text (§9).
 */
export interface ScreenTextSource {
  /** Total logical lines (ring + viewport). */
  readonly lineCount: number;
  lineAt(abs: number): Line | null;
}

/** The signature of the shared `extractText` (implemented in screen.ts). */
export type ExtractText = (source: ScreenTextSource, range: SelectionRange | null) => string;

/* ------------------------------------------------------------------ *
 * Limits (§4.3, §4.6)
 * ------------------------------------------------------------------ */

/** Scrollback ring defaults/hard cap (§4.3; the `scrollback="N"` attr). */
export const SCROLLBACK_DEFAULT = 5_000;
export const SCROLLBACK_MAX = 50_000;
/** Geometry clamps (§4.6). */
export const COLS_MIN = 20;
export const COLS_MAX = 500;
export const ROWS_MIN = 4;
export const ROWS_MAX = 200;

/* ------------------------------------------------------------------ *
 * CORE-V2 doc-name aliases — lanes coding against the doc verbatim
 * ------------------------------------------------------------------ */

export type ScreenLine = Line;
export type Screen = ScreenModel;
export type DamageSet = Damage;
export type ScreenDamage = Damage;
export type TerminalApp = App;
export type AppApi = AppContext;
export type MouseEventInfo = MouseEvent;
export type ScreenBuffer = Buffer;
