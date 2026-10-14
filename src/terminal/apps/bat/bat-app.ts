/**
 * apps/bat — the `bat` pager as a full-screen TerminalApp (CORE-V2 §6).
 *
 * Round-1 `bat` printed a guttered, syntax-coloured dump into the
 * transcript. On a terminal (ctx.color) the command now hands the screen
 * to this app instead (CommandSpec.app, CORE-V2 §6.4): alternate screen,
 * raw keys, a status/search bar, wheel scrolling, `/` search with n/N,
 * `:q`, `q` and Esc to exit. The piped / no-TTY path keeps `run()` — the
 * cat-like guttered print — so pipelines and redirects are unchanged.
 *
 * Ownership per round-2 lane rules: this module owns everything except
 * the one-field registration on the bat CommandSpec (plus its man entry),
 * which is handed to the integrate lane as a Cross-lane request.
 *
 * Syntax colour reuses sh-highlight.ts read-only (the html/xml/svg
 * tokenizer); the ScreenFeed turns its SGR whitelist into cell attrs, so
 * colour needs no new code here. Long lines are TRUNCATED to the viewport
 * (less -S chop), never soft-wrapped: frame row k is always logical entry
 * `top + k`, which keeps scroll/search/resize math exact. `--plain` pages
 * bare content (no header, no gutter, no colour) but still pages.
 */

import type { App, AppContext, KeyEvent, MouseEvent } from '../../screen/types.js';
import { highlightAnsi, splitSgr, type SgrSpan } from '../../sh-highlight.js';
import { charWidth, isCombining } from '../../screen/width.js';
import type { CommandContext } from '../../terminal-core.js';

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

/** One file handed to the pager (operand or piped stdin). */
interface BatPage {
  name: string;
  content: string;
}

/** Invocation flags — the same surface `run()` accepts (kept in step). */
interface BatFlags {
  /** --plain / -p: no header, no gutter, no colour — but still page. */
  plain: boolean;
  /** -l LANG / --language=LANG: force the highlight language. */
  lang: string | null;
  /** --color=when (`never` suppresses colour inside the pager too). */
  color: 'auto' | 'always' | 'never';
}

/** One frame row: a file header or a numbered source line. */
type BatRow =
  | { kind: 'header'; name: string }
  | { kind: 'line'; no: number; gutter: number; text: string; lang: string };

/** A committed search: pattern, the rows it hits, cursor into the hits. */
interface BatSearch {
  pattern: string;
  hits: number[];
  at: number;
}

/** The prompt state (typed on the status bar, less-style). */
interface BatPrompt {
  mode: 'search' | 'quit';
  buffer: string;
}

const RESET = '\x1b[0m';

function inferLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) return 'html';
  return 'text';
}

/** Display-width truncate a span list to `budget` cells (less -S chop). */
function truncateRuns(runs: readonly SgrSpan[], budget: number): SgrSpan[] {
  const out: SgrSpan[] = [];
  let left = budget;
  for (const span of runs) {
    if (left <= 0) break;
    let taken = '';
    let used = 0;
    for (const ch of span.text) {
      const cp = ch.codePointAt(0)!;
      if (isCombining(cp)) {
        taken += ch; // folds onto the previous cell, free
        continue;
      }
      const w = charWidth(cp);
      if (used + w > left) break;
      taken += ch;
      used += w;
    }
    if (taken !== '') out.push({ text: taken, codes: span.codes });
    left -= used;
  }
  return out;
}

/**
 * Split spans at `cuts` (plain-text offsets) and append `extra` codes to
 * the covered pieces — the search-highlight overlay, composed with the
 * syntax colour already on the spans.
 */
function overlayRuns(runs: readonly SgrSpan[], cuts: Array<[number, number]>, extra: string[]): SgrSpan[] {
  if (cuts.length === 0) return [...runs];
  const out: SgrSpan[] = [];
  let plain = 0; // plain-text offset of the current span start
  const push = (text: string, codes: string[]): void => {
    if (text !== '') out.push({ text, codes });
  };
  for (const span of runs) {
    const spanEnd = plain + span.text.length;
    let at = 0; // offset within the span
    for (const [start, end] of cuts) {
      const s = Math.max(start, plain);
      const e = Math.min(end, spanEnd);
      if (s >= e) continue;
      const a = s - plain;
      const b = e - plain;
      push(span.text.slice(at, a), span.codes);
      push(span.text.slice(a, b), [...span.codes, ...extra]);
      at = b;
    }
    push(span.text.slice(at), span.codes);
    plain = spanEnd;
  }
  return out;
}

/** Serialize spans: reset + explicit codes before each run, no leakage. */
function serialize(runs: readonly SgrSpan[]): string {
  let out = '';
  for (const span of runs) {
    out += RESET;
    for (const code of span.codes) out += `\x1b[${code}m`;
    out += span.text;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The pager app
 * ------------------------------------------------------------------ */

export class BatPager implements App {
  readonly id = 'bat';

  #api: AppContext | null = null;
  #rows: BatRow[] = [];
  #top = 0;
  #search: BatSearch | null = null;
  #prompt: BatPrompt | null = null;
  #note: string | null = null;

  constructor(
    private readonly pages: readonly BatPage[],
    private readonly flags: BatFlags,
  ) {}

  /* -- lifecycle ------------------------------------------------------ */

  start(api: AppContext): void {
    this.#api = api;
    const rows: BatRow[] = [];
    for (const page of this.pages) {
      const text = page.content;
      const lines = text === '' ? [] : text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      const lang = this.flags.lang ?? inferLang(page.name);
      const gutter = String(Math.max(1, lines.length)).length;
      if (!this.flags.plain) rows.push({ kind: 'header', name: page.name });
      for (let i = 0; i < lines.length; i++) {
        rows.push({ kind: 'line', no: i + 1, gutter, text: lines[i]!, lang });
      }
    }
    this.#rows = rows;
    this.#top = 0;
    this.#search = null;
    this.#prompt = null;
    this.#note = null;
    if (!this.flags.plain) api.setTitle(`bat ${this.pages[0]?.name ?? ''}`.trim());
    api.requestMouse(true); // wheel deltas arrive at mouse() (§7.3)
    this.paint();
  }

  resize(): void {
    this.paint();
  }

  stop(): void {
    this.#api = null;
  }

  a11ySummary(): string {
    const { first, last, total } = this.#position();
    const searching = this.#search !== null ? `, searching /${this.#search.pattern}` : '';
    return `pager: lines ${first} to ${last} of ${total}${searching}`;
  }

  /** The context menu's Find… verb (CORE-V2 §8.5) — the pager's `/`. */
  find(): void {
    this.#openPrompt('search');
  }

  /* -- keys ------------------------------------------------------------ */

  key(ev: KeyEvent): void {
    if (this.#prompt !== null) {
      this.#promptKey(ev);
      return;
    }
    if (ev.ctrl || ev.alt || ev.meta) return;
    switch (ev.key) {
      case 'ArrowUp':
      case 'k':
        this.#scrollBy(-1);
        return;
      case 'ArrowDown':
      case 'j':
        this.#scrollBy(1);
        return;
      case 'PageUp':
        this.#scrollBy(-(this.#contentRows() - 1));
        return;
      case 'PageDown':
        this.#scrollBy(this.#contentRows() - 1); // one context line kept
        return;
      case 'Home':
      case 'g':
        this.#scrollTo(0);
        return;
      case 'End':
      case 'G':
        this.#scrollTo(this.#maxTop());
        return;
      case '/':
        this.#openPrompt('search');
        return;
      case ':':
        this.#openPrompt('quit');
        return;
      case 'n':
        this.#stepHit(1);
        return;
      case 'N':
        this.#stepHit(-1);
        return;
      case 'q':
        this.#api?.exit(0);
        return;
      case 'Escape':
        // §6.3: Escape is an app key. With a search up, clear it first;
        // a second Esc (or no search) exits.
        if (this.#search !== null) {
          this.#search = null;
          this.#note = null;
          this.paint();
        } else {
          this.#api?.exit(0);
        }
        return;
      default:
        return;
    }
  }

  #promptKey(ev: KeyEvent): void {
    const prompt = this.#prompt!;
    if (ev.ctrl || ev.alt || ev.meta) return;
    switch (ev.key) {
      case 'Escape':
        this.#prompt = null;
        this.#note = null;
        this.paint();
        return;
      case 'Enter':
        if (prompt.mode === 'search') this.#commitSearch(prompt.buffer);
        else this.#commitQuit(prompt.buffer);
        return;
      case 'Backspace':
        prompt.buffer = prompt.buffer.slice(0, -1);
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

  /* -- mouse / paste ----------------------------------------------------- */

  mouse(ev: MouseEvent): void {
    if (ev.kind === 'wheel') this.#scrollBy(ev.dy);
  }

  paste(text: string): void {
    if (this.#prompt === null) return;
    for (const ch of text) {
      if (ch >= ' ' && ch !== '\x7f') this.#prompt.buffer += ch;
    }
    this.paint();
  }

  /* -- scrolling / search ------------------------------------------------ */

  #contentRows(): number {
    return Math.max(1, (this.#api?.rows ?? 24) - 1); // last row is the bar
  }

  #maxTop(): number {
    return Math.max(0, this.#rows.length - this.#contentRows());
  }

  #scrollBy(delta: number): void {
    this.#scrollTo(this.#top + delta);
  }

  #scrollTo(top: number): void {
    const clamped = Math.max(0, Math.min(this.#maxTop(), top));
    if (clamped !== this.#top) {
      this.#top = clamped;
      this.paint();
    }
  }

  #openPrompt(mode: 'search' | 'quit'): void {
    this.#prompt = { mode, buffer: mode === 'search' ? (this.#search?.pattern ?? '') : '' };
    this.#note = null;
    this.paint();
  }

  #commitSearch(pattern: string): void {
    this.#prompt = null;
    if (pattern === '') {
      this.#search = null; // empty pattern: clear the highlights
      this.#note = null;
      this.paint();
      return;
    }
    const needle = pattern.toLowerCase();
    const hits: number[] = [];
    for (let i = 0; i < this.#rows.length; i++) {
      const row = this.#rows[i]!;
      if (row.kind === 'line' && row.text.toLowerCase().includes(needle)) hits.push(i);
    }
    if (hits.length === 0) {
      this.#search = { pattern, hits, at: -1 };
      this.#note = `no match: /${pattern}`;
      this.paint();
      return;
    }
    const at = hits.findIndex((hit) => hit >= this.#top);
    const hitAt = at === -1 ? 0 : at;
    this.#search = { pattern, hits, at: hitAt };
    this.#note = null;
    this.#scrollTo(hits[hitAt]!);
    this.paint(); // prompt cleared even when the scroll didn't move
  }

  #stepHit(step: 1 | -1): void {
    const search = this.#search;
    if (search === null || search.hits.length === 0) {
      this.#note = search === null ? 'no previous search' : 'no match';
      this.paint();
      return;
    }
    search.at = (search.at + step + search.hits.length) % search.hits.length;
    this.#note = null;
    this.#scrollTo(search.hits[search.at]!);
    this.paint();
  }

  #commitQuit(buffer: string): void {
    this.#prompt = null;
    const command = buffer.trim();
    if (command === 'q' || command === 'q!' || command === 'quit' || command === 'qa') {
      this.#api?.exit(0);
      return;
    }
    this.#note = command === '' ? null : `unknown command: :${command} (try :q)`;
    this.paint();
  }

  /* -- paint -------------------------------------------------------------- */

  #position(): { first: number; last: number; total: number } {
    const total = this.#rows.reduce((n, row) => (row.kind === 'line' ? n + 1 : n), 0);
    if (total === 0) return { first: 0, last: 0, total: 0 };
    let first = 0;
    let last = 0;
    const end = Math.min(this.#rows.length, this.#top + this.#contentRows());
    for (let i = this.#top; i < end; i++) {
      const row = this.#rows[i]!;
      if (row.kind !== 'line') continue;
      if (first === 0) first = row.no;
      last = row.no;
    }
    return { first, last, total };
  }

  /** Hit ranges of the active search on one line's plain text. */
  #hitsOn(text: string): Array<[number, number]> {
    const search = this.#search;
    if (search === null || search.pattern === '') return [];
    const ranges: Array<[number, number]> = [];
    const hay = text.toLowerCase();
    const needle = search.pattern.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      ranges.push([at, at + needle.length]);
      at = hay.indexOf(needle, at + needle.length);
    }
    return ranges;
  }

  /** The runs for one line row: gutter + truncated, coloured body. */
  #bodyRuns(row: Extract<BatRow, { kind: 'line' }>, budget: number, current: boolean): SgrSpan[] {
    const coloured = this.flags.color !== 'never' && !this.flags.plain;
    const source = coloured ? highlightAnsi(row.text, row.lang) : row.text;
    const runs = truncateRuns(splitSgr(source), budget);
    const ranges = this.#hitsOn(row.text);
    return ranges.length > 0 ? overlayRuns(runs, ranges, current ? ['1', '7'] : ['7']) : runs;
  }

  paint(): void {
    const api = this.#api;
    if (api === null) return;
    const cols = api.cols;
    const rows = api.rows;
    const content = this.#contentRows();
    const { first, last, total } = this.#position();
    const search = this.#search;
    const currentRow = search !== null && search.at >= 0 ? (search.hits[search.at] ?? -1) : -1;
    const out = api.screen;
    out.moveTo(0, 0);
    out.eraseDisplay(2);
    for (let r = 0; r < content; r++) {
      const index = this.#top + r;
      const row = this.#rows[index];
      if (row === undefined) break; // erased blank below the last entry
      out.write(this.#renderRow(row, cols, index === currentRow) + '\r\n');
    }
    out.moveTo(0, api.rows - 1); // the bar is pinned to the bottom row
    out.write(this.#statusBar(cols));
    if (this.#prompt !== null) {
      const prefix = this.#prompt.mode === 'search' ? '/' : ':';
      out.setCursorVisible(true);
      out.setCursorStyle('block');
      out.moveTo(Math.min(cols - 1, prefix.length + this.#prompt.buffer.length), rows - 1);
    } else {
      out.setCursorVisible(false);
    }
    if (total > 0) api.setStatus(`${first}-${last} / ${total} lines`, 'idle');
  }

  #renderRow(row: BatRow, cols: number, current: boolean): string {
    if (row.kind === 'header') {
      return serialize(truncateRuns([{ text: `File: ${row.name}`, codes: ['1'] }], cols));
    }
    if (this.flags.plain) {
      return serialize(this.#bodyRuns(row, cols, current));
    }
    const num = String(row.no).padStart(row.gutter);
    const chrome = truncateRuns(
      [
        { text: num, codes: ['2'] },
        { text: ' │ ', codes: ['2'] },
      ],
      cols,
    );
    const budget = Math.max(1, cols - (num.length + 3));
    return serialize(chrome) + serialize(this.#bodyRuns(row, budget, current));
  }

  #statusBar(cols: number): string {
    let text: string;
    if (this.#prompt !== null) {
      const prefix = this.#prompt.mode === 'search' ? '/' : ':';
      const hint = this.#prompt.mode === 'search' ? '  (Enter: search, Esc: cancel)' : '  (q quits)';
      text = `${prefix}${this.#prompt.buffer}${hint}`;
    } else {
      const { first, last, total } = this.#position();
      const where = total === 0 ? 'empty' : `lines ${first}-${last} of ${total}`;
      const search = this.#search?.pattern !== undefined && this.#search.pattern !== '' ? `  /${this.#search.pattern}` : '';
      const note = this.#note !== null ? `  ${this.#note}` : '';
      text = ` ${where}${search}${note}  / search · :q quit · q/Esc exit`;
    }
    return serialize(truncateRuns([{ text, codes: ['7'] }], cols)) + RESET;
  }
}

/* ------------------------------------------------------------------ *
 * The CommandSpec.app hook (CORE-V2 §6.4)
 * ------------------------------------------------------------------ */

/**
 * The `app` field of the bat CommandSpec — the exact signature of
 * `CommandSpec.app`. Claims the tty case only: parse errors and missing
 * operands return null so `run()` keeps reporting them exactly as it does
 * today (single error line, exit status — no double reporting).
 */
export function batApp(ctx: CommandContext): App | null {
  if (!ctx.color) return null; // not a tty — run() is the renderer
  const args: string[] = [];
  for (const a of ctx.args) {
    if (a.length > 1 && a[0] === '-' && a[1] !== '-' && !/^-.\d+$/.test(a)) {
      for (const ch of a.slice(1)) args.push('-' + ch);
    } else {
      args.push(a);
    }
  }
  let plain = false;
  let lang: string | null = null;
  let color: BatFlags['color'] = 'auto';
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--plain' || a === '-p') plain = true;
    else if (a === '-l') lang = args[++i] ?? null;
    else if (a.startsWith('--language=')) lang = a.slice('--language='.length);
    else if (a === '--color=always' || a === '--color=never' || a === '--color' || a === '--color=auto') {
      color = (a.split('=')[1] ?? 'always') as BatFlags['color'];
    } else if (a.startsWith('-')) {
      return null; // unknown option — run() reports it, identical text
    } else operands.push(a);
  }
  const pages: BatPage[] = [];
  if (operands.length === 0) {
    if (ctx.stdin === null) return null; // run() prints the usage error
    pages.push({ name: 'stdin', content: ctx.stdin });
  } else {
    for (const operand of operands) {
      const path = ctx.vfs.resolve(ctx.state.cwd, operand);
      const node = ctx.vfs.nodeAt(path);
      if (node === null || node.kind !== 'file') return null; // run() reports
      pages.push({ name: operand, content: node.content });
    }
  }
  return new BatPager(pages, { plain, lang, color });
}
