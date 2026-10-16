/**
 * apps/nano — the `nano` editor as a full-screen TerminalApp (CORE-V2 §6,
 * round-3 LANE=nano).
 *
 * GNU-nano layout on the alt screen: a reversed title bar (row 0), the
 * edit area, a status/prompt line (rows-3) and the two-row shortcut footer
 * (rows-2, rows-1) — 4 chrome rows, like nano. Editing is line-array based
 * with every mutation funneled through one `#edit()` replace primitive that
 * records the inverse for Alt+U undo / Alt+E redo (typing runs and delete
 * runs coalesce). Line wrap is OFF: long lines scroll horizontally (`left`
 * = first visible cell), a frame row is always buffer line `top + k`, so
 * cursor math stays exact.
 *
 * Platform deviations from GNU nano (the core's app contract, §6.3):
 *  - Ctrl+C is ALWAYS an interrupt (exit 130) and never reaches an app, so
 *    cursor location binds to Alt+C and prompt cancel binds to Escape.
 *    Everything else keeps the GNU chord (^G ^O ^W ^K ^U ^X, Alt+W).
 *
 * Colour reuses the existing sh-highlight tokenizers (html/xml/svg family
 * — the only highlighters in the tree); .sh/.md stay plain. Tabs expand to
 * the screen's TAB_STOP (8) at paint time — the same rule screen.ts uses —
 * so paint and cursor agree. Read-only mounts (vfs backend
 * `writable: false`) open read-only: editing and writing are refused with
 * a status note; viewing, moving and searching work.
 *
 * Ownership per round-3 lane rules: everything here is this lane's; the
 * `nano` CommandSpec (run + app hook) is nano-command.ts; the one-line
 * registration into posixCommands is the tabs-ui Cross-lane request.
 */

import type { App, AppContext, KeyEvent, MouseEvent } from '../../screen/types.js';
import { highlightAnsi, splitSgr } from '../../sh-highlight.js';
import { charWidth, isCombining } from '../../screen/width.js';
import type { CommandContext } from '../../terminal-core.js';

/* ------------------------------------------------------------------ *
 * Paint helpers
 * ------------------------------------------------------------------ */

const RESET = '\x1b[0m';
/** Matches screen.ts TAB_STOP so paint-time expansion and the grid agree. */
const TAB = 8;

/** Languages the existing highlighter covers (sh-highlight.ts); else plain. */
function langOf(name: string | null): string {
  if (name === null) return '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext) ? 'html' : '';
}

interface Geom {
  /** Tab-expanded display text. */
  disp: string;
  /** Start cell of each raw char (combining marks reuse the base cell). */
  starts: number[];
  /** Cell width of each raw char (combining 0, wide 2, tab its spaces). */
  widths: number[];
  /** Display index of each raw char's first display char. */
  dispAt: number[];
  /** Total display cells. */
  total: number;
}

/** Tab-expand + measure a line in one pass (the ONE cursor/paint geometry). */
function geometry(raw: string): Geom {
  let disp = '';
  const starts: number[] = [];
  const widths: number[] = [];
  const dispAt: number[] = [];
  let cell = 0;
  for (const ch of raw) {
    dispAt.push(disp.length);
    if (ch === '\t') {
      const w = TAB - (cell % TAB);
      disp += ' '.repeat(w);
      starts.push(cell);
      widths.push(w);
      cell += w;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (isCombining(cp)) {
      starts.push(starts.length > 0 ? starts[starts.length - 1]! : 0);
      widths.push(0);
      disp += ch;
      continue;
    }
    const w = charWidth(cp);
    starts.push(cell);
    widths.push(w);
    disp += ch;
    cell += w;
  }
  return { disp, starts, widths, dispAt, total: cell };
}

/** Cell of a raw char index (clamped to the line end). */
function cellOf(geom: Geom, charIndex: number): number {
  if (geom.starts.length === 0) return 0;
  const at = Math.max(0, Math.min(geom.starts.length - 1, charIndex));
  return geom.starts[at]!;
}

/** Raw char index whose cell covers `cell` (mouse clicks; last char wins). */
function charAtCell(geom: Geom, cell: number): number {
  let at = 0;
  for (let i = 0; i < geom.starts.length; i++) {
    if (geom.starts[i]! <= cell) at = i;
    else break;
  }
  return at;
}

/** SGR codes active on each raw char (code points line up 1:1 with raw). */
function codesPerChar(colored: string, count: number): string[][] {
  const out: string[][] = [];
  for (const span of splitSgr(colored)) {
    const points = [...span.text];
    for (let i = 0; i < points.length; i++) out.push(span.codes);
  }
  while (out.length < count) out.push([]);
  return out;
}

/** Clip to a cell budget and pad with spaces to exactly `cols` cells. */
function clipPlain(text: string, cols: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCombining(cp) && used > 0) {
      out += ch;
      continue;
    }
    const w = charWidth(cp);
    if (used + w > cols) break;
    out += ch;
    used += w;
  }
  return out + ' '.repeat(Math.max(0, cols - used));
}

/** Text width in cells (width.ts is char-wise; this is the string form). */
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCombining(cp)) continue;
    w += charWidth(cp);
  }
  return w;
}

/** Serialize runs with a reset before each one — no style leakage. */
function serialize(runs: Array<{ text: string; codes: string[] }>): string {
  let out = '';
  for (const run of runs) {
    out += RESET;
    for (const code of run.codes) out += `\x1b[${code}m`;
    out += run.text;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

interface Pos {
  row: number;
  col: number;
}

/** One recorded edit: the range [start, end) held `old`, now holds `text`. */
interface EditOp {
  start: Pos;
  end: Pos;
  old: string;
  text: string;
}

type Prompt =
  | { mode: 'write'; buffer: string; exitAfter: boolean }
  | { mode: 'search'; buffer: string }
  | { mode: 'confirm-exit' };

interface Match {
  row: number;
  col: number;
  len: number;
}

/** VFS surface injected by nano-command (keeps the editor core testable). */
export interface NanoIo {
  /** Persist the buffer; returns an error message or null. */
  write(path: string, text: string): string | null;
  /** Resolve a (possibly relative) name against the spawn cwd. */
  resolve(name: string): string;
}

const HELP_LINES: readonly string[] = [
  'nano — key bindings',
  '',
  '  arrows, Home/End, PgUp/PgDn     move (Ctrl+A / Ctrl+E: line start/end)',
  '  type, Backspace, Delete, Enter  edit the buffer',
  '  Ctrl+O                          write (asks for the file name)',
  '  Ctrl+X                          exit (asks to save when modified)',
  '  Ctrl+W                          search (case-insensitive)',
  '  Alt+W                           search for the same string again',
  '  Ctrl+K / Ctrl+U                 cut line / paste',
  '  Alt+U / Alt+E                   undo / redo',
  '  Alt+C                           cursor location (Ctrl+C interrupts)',
  '  Ctrl+G                          this help; any key returns',
  '',
  'Read-only files open without editing; the mouse places the cursor and',
  'the wheel scrolls. Long lines scroll sideways — wrapping is off.',
];

/* ------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------ */

export interface NanoOptions {
  /** Resolved absolute VFS path; null for an untitled buffer. */
  path: string | null;
  /** File content (or piped stdin / '' for a new buffer). */
  content: string;
  /** True when the covering VFS backend is not writable. */
  readonly: boolean;
  /** VFS write/resolve surface. */
  io: NanoIo;
}

export class NanoEditor implements App {
  readonly id = 'nano';

  #api: AppContext | null = null;
  #path: string | null;
  #name: string | null;
  readonly #io: NanoIo;
  #lines: string[];
  #trailingNewline: boolean;
  #cy = 0;
  #cx = 0;
  #want: number | null = null; // sticky cursor column (cells) while moving up/down
  #top = 0;
  #left = 0;
  #modified = false;
  readonly #readonly: boolean;
  #view: 'edit' | 'help' = 'edit';
  #prompt: Prompt | null = null;
  #note: string | null = null;
  #search: string | null = null;
  #match: Match | null = null;
  #cutbuffer: string[] = [];
  #lastWasCut = false;
  #undo: EditOp[] = [];
  #redo: EditOp[] = [];
  #geoms = new Map<number, Geom>();

  constructor(options: NanoOptions) {
    this.#path = options.path;
    this.#name = options.path === null ? null : options.path.split('/').pop() || options.path;
    this.#io = options.io;
    this.#readonly = options.readonly;
    const text = options.content;
    this.#trailingNewline = text !== '' && text.endsWith('\n');
    this.#lines = text === '' ? [''] : this.#trailingNewline ? text.slice(0, -1).split('\n') : text.split('\n');
  }

  /* -- lifecycle ------------------------------------------------------ */

  start(api: AppContext): void {
    this.#api = api;
    this.#top = 0;
    this.#left = 0;
    api.setTitle(`nano ${this.#name ?? '(new buffer)'}`);
    api.requestMouse(true);
    const empty = this.#lines.length === 1 && this.#lines[0] === '';
    this.#note = this.#readonly
      ? '[ File is read-only ]'
      : empty
        ? '[ New Buffer ]'
        : `[ Read ${this.#lines.length} line${this.#lines.length === 1 ? '' : 's'} ]`;
    this.paint();
  }

  /** The runner reallocates the screen first; paint re-reads #api.cols/rows. */
  resize(_cols: number, _rows: number): void {
    this.#invalidate();
    this.#ensureVisible();
    this.paint();
  }

  stop(): void {
    this.#api = null;
  }

  a11ySummary(): string {
    if (this.#view === 'help') return 'nano: key bindings';
    const where = `line ${this.#cy + 1} of ${this.#lines.length}, column ${this.#cx + 1}`;
    const state =
      this.#prompt !== null
        ? this.#prompt.mode === 'write'
          ? `answering file name to write: ${this.#prompt.buffer}`
          : this.#prompt.mode === 'search'
            ? `answering search: ${this.#prompt.buffer}`
            : 'answering: save modified buffer?'
        : this.#readonly
          ? 'read-only'
          : this.#modified
            ? 'modified'
            : 'unmodified';
    return `nano: editing ${this.#name ?? 'a new buffer'}, ${where}, ${state}`;
  }

  /** The context menu's Find… verb (CORE-V2 §8.5) — the pager's pattern. */
  find(): void {
    if (this.#view === 'help') return;
    this.#openPrompt({ mode: 'search', buffer: this.#search ?? '' });
  }

  /* -- geometry cache -------------------------------------------------- */

  #invalidate(): void {
    this.#geoms.clear();
  }

  #geom(row: number): Geom {
    let geom = this.#geoms.get(row);
    if (geom === undefined) {
      geom = geometry(this.#lines[row] ?? '');
      this.#geoms.set(row, geom);
    }
    return geom;
  }

  /* -- text edits (the ONE mutation primitive) -------------------------- */

  #text(start: Pos, end: Pos): string {
    if (start.row === end.row) return this.#lines[start.row]!.slice(start.col, end.col);
    const parts: string[] = [this.#lines[start.row]!.slice(start.col)];
    for (let r = start.row + 1; r < end.row; r++) parts.push(this.#lines[r]!);
    parts.push(this.#lines[end.row]!.slice(0, end.col));
    return parts.join('\n');
  }

  #offset(pos: Pos): number {
    let n = pos.col;
    for (let r = 0; r < pos.row; r++) n += this.#lines[r]!.length + 1;
    return n;
  }

  #advance(pos: Pos, text: string): Pos {
    const nl = text.lastIndexOf('\n');
    if (nl === -1) return { row: pos.row, col: pos.col + text.length };
    return { row: pos.row + text.slice(0, nl).split('\n').length, col: text.length - nl - 1 };
  }

  /**
   * Replace [start, end) with `text`, record the inverse, move the cursor
   * to the end of the inserted text. `coalesce` folds a plain single-char
   * insert/delete into the previous undo entry (typing / delete runs).
   */
  #edit(start: Pos, end: Pos, text: string, coalesce = false): void {
    const old = this.#text(start, end);
    if (old === text) return;
    const op: EditOp = { start: { ...start }, end: { ...end }, old, text };
    const last = this.#undo[this.#undo.length - 1];
    let merged = false;
    if (coalesce && last !== undefined && last.start.row === start.row) {
      if (old === '' && text.length === 1 && !text.includes('\n') && last.start.col + last.text.length === start.col && last.text !== '') {
        last.text += text; // typing run
        last.end = this.#advance(last.start, last.text);
        merged = true;
      } else if (text === '' && old.length === 1 && last.text === '' && last.start.col === start.col && last.old.length === 1) {
        last.old = old + last.old; // Delete-key run
        last.end = { ...end };
        merged = true;
      } else if (text === '' && old.length === 1 && last.text === '' && start.col + old.length === last.start.col) {
        last.start = { ...start }; // Backspace run (leftwards)
        last.old = old + last.old;
        merged = true;
      }
    }
    if (!merged) this.#undo.push(op);
    if (this.#undo.length > 1000) this.#undo.shift();
    this.#redo = [];
    this.#apply(start, end, text);
    this.#lastWasCut = false;
    this.#modified = true;
    this.#match = null;
    const at = this.#advance(start, text);
    this.#cy = at.row;
    this.#cx = at.col;
    this.#want = null;
    this.#invalidate();
    this.#ensureVisible();
  }

  /** Apply an operation to the line array (no bookkeeping). */
  #apply(start: Pos, end: Pos, text: string): void {
    const before = this.#lines[start.row]!.slice(0, start.col);
    const after = this.#lines[end.row]!.slice(end.col);
    const middle = text.split('\n');
    const rows: string[] =
      middle.length === 1
        ? [before + middle[0]! + after]
        : [before + middle[0]!, ...middle.slice(1, -1), middle[middle.length - 1]! + after];
    this.#lines = [...this.#lines.slice(0, start.row), ...rows, ...this.#lines.slice(end.row + 1)];
  }

  /* -- undo / redo ------------------------------------------------------ */

  #invert(op: EditOp, onto: EditOp[]): void {
    const end = this.#advance(op.start, op.text);
    this.#apply(op.start, end, op.old);
    onto.push({ start: { ...op.start }, end, old: op.text, text: op.old });
    this.#modified = true;
    this.#match = null;
    this.#cy = op.start.row;
    this.#cx = op.start.col;
    this.#want = null;
    this.#invalidate();
    this.#ensureVisible();
  }

  #undoEdit(): void {
    if (this.#readonly) return this.#readonlyNote();
    const op = this.#undo.pop();
    if (op === undefined) {
      this.#note = '[ Nothing to undo ]';
      return;
    }
    this.#invert(op, this.#redo);
    this.#note = '[ Undid ]';
  }

  #redoEdit(): void {
    if (this.#readonly) return this.#readonlyNote();
    const op = this.#redo.pop();
    if (op === undefined) {
      this.#note = '[ Nothing to redo ]';
      return;
    }
    this.#invert(op, this.#undo);
    this.#note = '[ Redid ]';
  }

  /* -- scrolling -------------------------------------------------------- */

  #editRows(): number {
    return Math.max(1, (this.#api?.rows ?? 24) - 4); // title + status + 2 footer rows
  }

  #ensureVisible(): void {
    const rows = this.#editRows();
    if (this.#cy < this.#top) this.#top = this.#cy;
    if (this.#cy >= this.#top + rows) this.#top = this.#cy - rows + 1;
    if (this.#top > Math.max(0, this.#lines.length - 1)) this.#top = Math.max(0, this.#lines.length - 1);
    const cols = this.#api?.cols ?? 80;
    const cell = cellOf(this.#geom(this.#cy), this.#cx);
    if (cell < this.#left) this.#left = cell;
    if (cell >= this.#left + cols) this.#left = cell - cols + 1;
    // No dead space past the end of the longest visible line (cursor-safe:
    // the cursor line is part of that max, so the cursor stays on screen).
    let longest = 0;
    const shown = Math.min(this.#lines.length - this.#top, rows);
    for (let r = this.#top; r < this.#top + shown; r++) longest = Math.max(longest, this.#geom(r).total);
    this.#left = Math.min(this.#left, Math.max(0, longest - cols + 1));
  }

  /* -- cursor movement --------------------------------------------------- */

  #moveHoriz(delta: -1 | 1): void {
    if (delta === -1) {
      if (this.#cx > 0) this.#cx--;
      else if (this.#cy > 0) {
        this.#cy--;
        this.#cx = this.#lines[this.#cy]!.length;
      }
    } else {
      if (this.#cx < this.#lines[this.#cy]!.length) this.#cx++;
      else if (this.#cy < this.#lines.length - 1) {
        this.#cy++;
        this.#cx = 0;
      }
    }
    this.#want = null;
    this.#ensureVisible();
  }

  #moveVert(delta: -1 | 1): void {
    const target = this.#cy + delta;
    if (target < 0 || target > this.#lines.length - 1) return;
    const want = this.#want ?? cellOf(this.#geom(this.#cy), this.#cx);
    this.#cy = target;
    this.#cx = this.#columnAt(target, want);
    this.#want = want;
    this.#ensureVisible();
  }

  #page(delta: -1 | 1): void {
    const step = Math.max(1, this.#editRows() - 2);
    const target = Math.max(0, Math.min(this.#lines.length - 1, this.#cy + delta * step));
    if (target === this.#cy) return;
    const want = this.#want ?? cellOf(this.#geom(this.#cy), this.#cx);
    this.#cy = target;
    this.#cx = this.#columnAt(target, want);
    this.#want = want;
    this.#ensureVisible();
  }

  /** Char index on `row` for a wanted cell column (0 on empty lines). */
  #columnAt(row: number, want: number): number {
    const geom = this.#geom(row);
    if (geom.total === 0) return 0;
    return charAtCell(geom, Math.min(want, geom.total - 1));
  }

  #lineStart(): void {
    this.#cx = 0;
    this.#want = null;
    this.#ensureVisible();
  }

  #lineEnd(): void {
    this.#cx = this.#lines[this.#cy]!.length;
    this.#want = null;
    this.#ensureVisible();
  }

  /* -- editing commands --------------------------------------------------- */

  #insertText(text: string): void {
    if (this.#readonly) return this.#readonlyNote();
    if (text === '') return;
    this.#edit({ row: this.#cy, col: this.#cx }, { row: this.#cy, col: this.#cx }, text, text.length === 1);
  }

  #backspace(): void {
    if (this.#readonly) return this.#readonlyNote();
    if (this.#cx > 0) {
      const ch = this.#lines[this.#cy]!.slice(this.#cx - 1, this.#cx);
      this.#edit({ row: this.#cy, col: this.#cx - 1 }, { row: this.#cy, col: this.#cx }, '', ch.length === 1);
    } else if (this.#cy > 0) {
      this.#edit({ row: this.#cy - 1, col: this.#lines[this.#cy - 1]!.length }, { row: this.#cy, col: 0 }, '');
    }
  }

  #deleteKey(): void {
    if (this.#readonly) return this.#readonlyNote();
    const line = this.#lines[this.#cy]!;
    if (this.#cx < line.length) {
      const ch = line.slice(this.#cx, this.#cx + 1);
      this.#edit({ row: this.#cy, col: this.#cx }, { row: this.#cy, col: this.#cx + 1 }, '', ch.length === 1);
    } else if (this.#cy < this.#lines.length - 1) {
      this.#edit({ row: this.#cy, col: this.#cx }, { row: this.#cy + 1, col: 0 }, '');
    }
  }

  #cutLine(): void {
    if (this.#readonly) return this.#readonlyNote();
    const line = this.#lines[this.#cy]!;
    const lastRow = this.#cy === this.#lines.length - 1;
    if (lastRow && line === '') {
      this.#note = '[ Nothing to cut ]';
      return;
    }
    if (!this.#lastWasCut) this.#cutbuffer = [];
    if (lastRow) {
      this.#cutbuffer.push(line);
      this.#edit({ row: this.#cy, col: 0 }, { row: this.#cy, col: line.length }, '');
    } else {
      this.#cutbuffer.push(`${line}\n`);
      this.#edit({ row: this.#cy, col: 0 }, { row: this.#cy + 1, col: 0 }, '');
    }
    this.#lastWasCut = true;
    this.#note = `[ Cut ${this.#cutbuffer.length === 1 ? '1 line' : `${this.#cutbuffer.length} lines`} ]`;
  }

  #paste(): void {
    if (this.#readonly) return this.#readonlyNote();
    const text = this.#cutbuffer.join('');
    if (text === '') {
      this.#note = '[ Cutbuffer is empty ]';
      return;
    }
    this.#edit({ row: this.#cy, col: this.#cx }, { row: this.#cy, col: this.#cx }, text);
    this.#note = '[ Pasted ]';
  }

  /* -- search -------------------------------------------------------------- */

  #runSearch(needle: string): void {
    this.#prompt = null;
    if (needle === '') {
      this.#search = null;
      this.#match = null;
      this.paint();
      return;
    }
    this.#search = needle;
    const hay = needle.toLowerCase();
    const findIn = (row: number, from: number, to: number): Match | null => {
      const line = this.#lines[row]!.toLowerCase();
      const at = line.indexOf(hay, from);
      if (at !== -1 && at < to) return { row, col: at, len: needle.length };
      return null;
    };
    let match: Match | null = null;
    let wrapped = false;
    for (let row = this.#cy; row < this.#lines.length && match === null; row++) {
      match = findIn(row, row === this.#cy ? this.#cx + 1 : 0, this.#lines[row]!.length + 1);
    }
    if (match === null) {
      wrapped = true;
      for (let row = 0; row <= this.#cy && match === null; row++) {
        match = findIn(row, 0, row === this.#cy ? this.#cx : this.#lines[row]!.length + 1);
      }
    }
    if (match === null) {
      this.#match = null;
      this.#note = `[ "${needle}" not found ]`;
      this.paint();
      return;
    }
    this.#match = match;
    this.#cy = match.row;
    this.#cx = match.col;
    this.#want = null;
    this.#ensureVisible();
    this.#note = wrapped ? '[ Search Wrapped ]' : null;
    this.paint();
  }

  #searchAgain(): void {
    if (this.#search === null) {
      this.#note = '[ No previous search ]';
      return;
    }
    this.#runSearch(this.#search);
  }

  /* -- write / exit ---------------------------------------------------------- */

  #bufferText(): string {
    const joined = this.#lines.join('\n');
    return this.#trailingNewline ? `${joined}\n` : joined;
  }

  #commitWrite(name: string, exitAfter: boolean): void {
    this.#prompt = null;
    const trimmed = name.trim();
    if (trimmed === '') {
      this.#note = '[ No file name ]';
      this.paint();
      return;
    }
    const path = this.#io.resolve(trimmed);
    const error = this.#io.write(path, this.bufferText);
    if (error !== null) {
      this.#note = `[ ${error} ]`;
      this.paint();
      return;
    }
    this.#path = path;
    this.#name = path.split('/').pop() || path;
    this.#modified = false;
    this.#note = `[ Wrote ${this.#lines.length} line${this.#lines.length === 1 ? '' : 's'} to ${this.#name} ]`;
    this.#api?.setTitle(`nano ${this.#name}`);
    if (exitAfter) {
      this.#api?.exit(0);
      return;
    }
    this.paint();
  }

  #requestExit(): void {
    if (!this.#modified) {
      this.#api?.exit(0);
      return;
    }
    this.#prompt = { mode: 'confirm-exit' };
    this.#note = null;
    this.paint();
  }

  #confirmExit(yes: boolean): void {
    this.#prompt = null;
    if (!yes) {
      this.#api?.exit(0);
      return;
    }
    if (this.#path === null) {
      this.#prompt = { mode: 'write', buffer: '', exitAfter: true };
      this.paint();
      return;
    }
    const error = this.#io.write(this.#path, this.bufferText);
    if (error !== null) {
      this.#note = `[ ${error} ]`;
      this.paint();
      return;
    }
    this.#modified = false;
    this.#api?.exit(0);
  }

  /* -- location (Alt+C — Ctrl+C interrupts, §6.3) ------------------------------ */

  #showLocation(): void {
    const lines = this.#lines.length;
    const cell = cellOf(this.#geom(this.#cy), this.#cx);
    const pct = lines <= 1 ? 100 : Math.round((this.#cy / (lines - 1)) * 100);
    this.#note = `[ Line ${this.#cy + 1} of ${lines} (${pct}%), col ${cell + 1} ]`;
  }

  #readonlyNote(): void {
    this.#note = '[ File is read-only ]';
  }

  /* -- keys --------------------------------------------------------------------- */

  key(ev: KeyEvent): void {
    if (this.#view === 'help') {
      this.#view = 'edit';
      this.#note = null;
      this.paint();
      return;
    }
    if (this.#prompt !== null) {
      this.#promptKey(ev);
      return;
    }
    this.#note = null;
    if (ev.ctrl) {
      switch (ev.key) {
        case 'a':
          this.#lineStart();
          break;
        case 'e':
          this.#lineEnd();
          break;
        case 'g':
          this.#view = 'help';
          break;
        case 'k':
          this.#cutLine();
          break;
        case 'o':
          this.#openWritePrompt(false);
          break;
        case 'u':
          this.#paste();
          break;
        case 'w':
          this.find();
          break;
        case 'x':
          this.#requestExit();
          break;
        default:
          break;
      }
      this.paint();
      return;
    }
    if (ev.alt) {
      switch (ev.key) {
        case 'w':
          this.#searchAgain();
          break;
        case 'u':
          this.#undoEdit();
          break;
        case 'e':
          this.#redoEdit();
          break;
        case 'c':
          this.#showLocation();
          break;
        default:
          break;
      }
      this.paint();
      return;
    }
    switch (ev.key) {
      case 'ArrowLeft':
        this.#moveHoriz(-1);
        break;
      case 'ArrowRight':
        this.#moveHoriz(1);
        break;
      case 'ArrowUp':
        this.#moveVert(-1);
        break;
      case 'ArrowDown':
        this.#moveVert(1);
        break;
      case 'Home':
        this.#lineStart();
        break;
      case 'End':
        this.#lineEnd();
        break;
      case 'PageUp':
        this.#page(-1);
        break;
      case 'PageDown':
        this.#page(1);
        break;
      case 'Backspace':
        this.#backspace();
        break;
      case 'Delete':
        this.#deleteKey();
        break;
      case 'Enter':
        this.#insertText('\n');
        break;
      case 'Tab':
        this.#insertText('\t');
        break;
      case 'Space':
        this.#insertText(' ');
        break;
      default:
        if (ev.key.length === 1) this.#insertText(ev.key);
        break;
    }
    this.paint();
  }

  #openWritePrompt(exitAfter: boolean): void {
    if (this.#readonly) {
      this.#readonlyNote();
      return;
    }
    this.#openPrompt({ mode: 'write', buffer: this.#name ?? '', exitAfter });
  }

  #openPrompt(prompt: Prompt): void {
    this.#prompt = prompt;
    this.#note = null;
    this.paint();
  }

  #promptKey(ev: KeyEvent): void {
    const prompt = this.#prompt!;
    if (prompt.mode === 'confirm-exit') {
      if (ev.ctrl || ev.meta) return;
      if (ev.key === 'y' || ev.key === 'Y') this.#confirmExit(true);
      else if (ev.key === 'n' || ev.key === 'N') this.#confirmExit(false);
      else if (ev.key === 'Escape') {
        this.#prompt = null;
        this.paint();
      }
      return;
    }
    if (ev.ctrl || ev.meta) {
      if (ev.ctrl && !ev.alt && ev.key === 'o' && prompt.mode === 'write') {
        this.#commitWrite(prompt.buffer, prompt.exitAfter);
      }
      return;
    }
    switch (ev.key) {
      case 'Escape':
        this.#prompt = null;
        this.#note = null;
        this.paint();
        return;
      case 'Enter':
        if (prompt.mode === 'search') this.#runSearch(prompt.buffer);
        else this.#commitWrite(prompt.buffer, prompt.exitAfter);
        return;
      case 'Backspace':
        prompt.buffer = prompt.buffer.slice(0, -1);
        this.paint();
        return;
      case 'Space':
        prompt.buffer += ' ';
        this.paint();
        return;
      default:
        if (ev.key.length === 1) {
          prompt.buffer += ev.key;
          this.paint();
        }
        return;
    }
  }

  /* -- mouse / paste --------------------------------------------------------------- */

  mouse(ev: MouseEvent): void {
    if (this.#view === 'help') return;
    if (ev.kind === 'wheel') {
      const maxTop = Math.max(0, this.#lines.length - this.#editRows());
      const top = Math.max(0, Math.min(maxTop, this.#top + ev.dy));
      if (top !== this.#top) {
        this.#top = top;
        this.paint();
      }
      return;
    }
    if (ev.kind !== 'press') return;
    if (ev.row < 1 || ev.row - 1 >= this.#editRows()) return; // not the edit area
    const row = this.#top + (ev.row - 1);
    if (row > this.#lines.length - 1) return;
    this.#cy = row;
    this.#cx = charAtCell(this.#geom(row), ev.col + this.#left);
    this.#want = null;
    this.#ensureVisible();
    this.paint();
  }

  paste(text: string): void {
    if (this.#prompt !== null && this.#prompt.mode !== 'confirm-exit') {
      for (const ch of text) {
        if (ch >= ' ' && ch !== '\x7f') this.#prompt.buffer += ch;
      }
      this.paint();
      return;
    }
    const clean = text.replace(/\r\n?/g, '\n');
    if (clean !== '') this.#insertText(clean);
    this.paint();
  }

  /* -- paint -------------------------------------------------------------------------- */

  paint(): void {
    const api = this.#api;
    if (api === null) return;
    const cols = api.cols;
    const rows = api.rows;
    const out = api.screen;
    out.moveTo(0, 0);
    out.eraseDisplay(2);
    out.write(`${this.#titleBar(cols)}\r\n`);
    if (this.#view === 'help') {
      this.#paintHelp(api);
      return;
    }
    const editRows = this.#editRows();
    for (let r = 0; r < editRows; r++) {
      const index = this.#top + r;
      out.write(`${this.#paintRow(index, this.#lines[index] ?? '', cols)}\r\n`);
    }
    out.moveTo(0, rows - 3);
    out.write(this.#statusLine(cols));
    out.moveTo(0, rows - 2);
    out.write(`${this.#footerRow(0, cols)}\r\n`);
    out.write(this.#footerRow(1, cols));
    this.#placeCursor();
    api.setStatus(`nano: ${this.#name ?? 'new buffer'}, line ${this.#cy + 1} of ${this.#lines.length}`, this.#modified ? 'busy' : 'idle');
  }

  #paintHelp(api: AppContext): void {
    const out = api.screen;
    for (let r = 0; r < this.#editRows(); r++) {
      const text = HELP_LINES[r] ?? '';
      out.write(`${RESET}\x1b[2m${clipPlain(text, api.cols)}${RESET}\r\n`);
    }
    out.moveTo(0, api.rows - 3);
    out.write(`${RESET}\x1b[7m${clipPlain(' press any key to return to the buffer', api.cols)}${RESET}`);
    out.moveTo(0, api.rows - 2);
    out.write(`${RESET}\x1b[7m${' '.repeat(api.cols)}${RESET}\r\n`);
    out.write(`${RESET}\x1b[7m${' '.repeat(api.cols)}${RESET}`);
    out.setCursorVisible(false);
    api.setStatus('nano: key bindings', 'idle');
  }

  #titleBar(cols: number): string {
    const text = clipPlain(`nano  ${this.#name ?? 'New Buffer'}${this.#modified ? ' Modified' : ''}`, cols);
    const pad = Math.max(0, cols - textWidth(text));
    const lead = Math.floor(pad / 2);
    return `${RESET}\x1b[7m${' '.repeat(lead)}${text}${' '.repeat(pad - lead)}${RESET}`;
  }

  /** One edit-area row: syntax colour + match overlay + horizontal slice. */
  #paintRow(index: number, raw: string, cols: number): string {
    const geom = this.#geom(index);
    const lang = langOf(this.#path);
    const colored = lang !== '' ? highlightAnsi(raw, lang) : raw;
    const codes = codesPerChar(colored, geom.starts.length);
    const match =
      this.#match !== null && this.#match.row === index
        ? ([this.#match.col, this.#match.col + this.#match.len] as const)
        : null;
    const left = this.#left;
    const right = left + cols;
    const runs: Array<{ text: string; codes: string[] }> = [];
    let buffer = '';
    let active: string[] = [];
    let started = false;
    let prevIncluded = true;
    const flush = (): void => {
      if (buffer !== '') runs.push({ text: buffer, codes: active });
      buffer = '';
    };
    for (let i = 0; i < geom.starts.length; i++) {
      const s = geom.starts[i]!;
      const w = geom.widths[i]!;
      let include: boolean;
      if (w === 0) include = prevIncluded; // combining folds onto its base
      else include = s >= left && s + w <= right;
      prevIncluded = include;
      if (!include) continue;
      const text = geom.disp.slice(geom.dispAt[i]!, i + 1 < geom.dispAt.length ? geom.dispAt[i + 1]! : undefined);
      const base = codes[i] ?? [];
      const want = match !== null && i >= match[0] && i < match[1] ? [...base, '7'] : base;
      if (!started || want.join(' ') !== active.join(' ')) {
        flush();
        active = want;
        started = true;
      }
      buffer += text;
    }
    flush();
    return serialize(runs);
  }

  #statusLine(cols: number): string {
    let text: string | null = null;
    const prompt = this.#prompt;
    if (prompt !== null) {
      if (prompt.mode === 'write') text = `File Name to Write: ${prompt.buffer}`;
      else if (prompt.mode === 'search') text = `Search: ${prompt.buffer}`;
      else text = 'Save modified buffer?  Y Yes / N No / Esc Cancel';
    } else if (this.#note !== null) {
      text = this.#note;
    }
    if (text === null) return `${RESET}\x1b[7m${' '.repeat(cols)}${RESET}`;
    return `${RESET}\x1b[7m${clipPlain(` ${text}`, cols)}${RESET}`;
  }

  /** One footer row of five chords; unimplemented ones print dim. */
  #footerRow(row: 0 | 1, cols: number): string {
    const items: Array<[string, string, boolean]> =
      row === 0
        ? [
            ['^G', 'Help', false],
            ['^O', 'Write Out', false],
            ['^W', 'Where Is', false],
            ['^K', 'Cut', false],
            ['^T', 'Execute', true],
          ]
        : [
            ['^X', 'Exit', false],
            ['^R', 'Read File', true],
            ['^\\', 'Replace', true],
            ['^U', 'Paste', false],
            ['^C', 'Location', true],
          ];
    const runs: Array<{ text: string; codes: string[] }> = [];
    let used = 0;
    for (const [key, label, dim] of items) {
      const chunk = `${key} ${label}`.padEnd(15, ' ');
      let text = '';
      let taken = 0;
      for (const ch of chunk) {
        const w = charWidth(ch.codePointAt(0)!);
        if (used + taken + w > cols) break;
        text += ch;
        taken += w;
      }
      if (text === '') break;
      runs.push({ text, codes: dim ? ['2'] : [] });
      used += taken;
    }
    return `${serialize(runs)}${RESET}`;
  }

  #placeCursor(): void {
    const api = this.#api;
    if (api === null) return;
    const prompt = this.#prompt;
    if (prompt !== null && prompt.mode !== 'confirm-exit') {
      const prefix = prompt.mode === 'write' ? 'File Name to Write: '.length : 'Search: '.length;
      api.screen.moveTo(Math.min(api.cols - 1, prefix + prompt.buffer.length), api.rows - 3);
      api.screen.setCursorVisible(true);
      api.screen.setCursorStyle('block');
      return;
    }
    if (prompt !== null) {
      api.screen.setCursorVisible(false);
      return;
    }
    const geom = this.#geom(this.#cy);
    const cell = this.#cx < geom.starts.length ? geom.starts[this.#cx]! : geom.total;
    api.screen.moveTo(Math.max(0, Math.min(api.cols - 1, cell - this.#left)), 1 + (this.#cy - this.#top));
    api.screen.setCursorVisible(true);
    api.screen.setCursorStyle('block');
  }

  /* -- test surface (read-only views of private state) ------------------- */

  /** @internal vitest hook — the buffer lines. */
  get lines(): readonly string[] {
    return this.#lines;
  }

  /** @internal vitest hook / io surface — the buffer text per the trailing-newline policy. */
  get bufferText(): string {
    return this.#bufferText();
  }

  /** @internal vitest hook — the dirty flag. */
  get modified(): boolean {
    return this.#modified;
  }

  /** @internal vitest hook — the resolved path (updated on save-as). */
  get path(): string | null {
    return this.#path;
  }
}

/* ------------------------------------------------------------------ *
 * The CommandSpec.app hook (CORE-V2 §6.4)
 * ------------------------------------------------------------------ */

/**
 * Decide the buffer from `ctx` (mirrors `run()`'s validation exactly) and
 * return the editor. Null on every path run() must report: not a tty, an
 * option-like word, more than one operand, or a directory operand.
 */
export function nanoApp(ctx: CommandContext): NanoEditor | null {
  if (!ctx.color) return null;
  const operands: string[] = [];
  for (const a of ctx.args) {
    if (a.startsWith('-') && a !== '-') return null; // run() reports the option
    operands.push(a);
  }
  if (operands.length > 1) return null; // run() reports it
  const io: NanoIo = {
    write: (path, text) => {
      try {
        ctx.vfs.mountFile(path, text);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    resolve: (name) => ctx.vfs.resolve(ctx.state.cwd, name),
  };
  if (operands.length === 1) {
    const path = ctx.vfs.resolve(ctx.state.cwd, operands[0]!);
    const node = ctx.vfs.nodeAt(path);
    if (node !== null && node.kind === 'dir') return null; // run() reports it
    const backend = ctx.vfs.backendFor(path);
    const file = node !== null && node.kind === 'file' ? node : null;
    return new NanoEditor({ path, content: file?.content ?? '', readonly: backend !== null && !backend.writable, io });
  }
  // No operand: piped stdin becomes the buffer, else a fresh untitled one.
  return new NanoEditor({ path: null, content: ctx.stdin ?? '', readonly: false, io });
}
