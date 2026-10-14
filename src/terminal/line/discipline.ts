/**
 * line/discipline — the line editor, relocated from the v1 element
 * (CORE-V2 §5). The visible `<input>` stays the IME/composition surface,
 * but the buffer of record now lives here: every key flows through
 * `key(ev)` against a string + caret, and the element mirrors the result.
 *
 * Cooked mode (§5.2) = the v1 editor, preserved semantics verbatim:
 *  - history with draft: up at the newest stashes the in-flight buffer;
 *    down past the newest restores it (v1 `#navigate`);
 *  - completion via `completeLine` (v1 `#complete`): extend, or print the
 *    candidate list capped at 8 then `… +N more`;
 *  - the control table: Ctrl+A/E/B/F (caret), Ctrl+K/U (kill), Ctrl+W and
 *    Alt+Backspace (kill word), Ctrl+L (clear viewport, scrollback kept),
 *    Ctrl+P/N (history), Enter (submit), Backspace/Delete;
 *  - Ctrl+C abandons the line and re-prints a fresh prompt (NEW — v1 had
 *    no meaning for it); Ctrl+D on an empty buffer is a no-op (never EOF);
 *    on a non-empty buffer it deletes forward.
 * The prompt stays `<cwd> $` with `$HOME` abbreviated — no PS1 (§5.2).
 *
 * Raw mode (§5.3) hands keys to an attached full-screen app; attach/detach
 * bracket the app's lifetime and are driven by the AppRunner.
 */

import { completeLine } from '../complete.js';
import type { TerminalCore } from '../terminal-core.js';
import type { KeyEvent, LineDiscipline } from '../screen/types.js';
import { stringWidth } from '../screen/width.js';

/** What cooked mode needs from its surroundings — nothing DOM. */
export interface CookedHost {
  /** Print one line of plain text above the prompt (completion lists). */
  emit(text: string): void;
  /** Ctrl+L — clear the viewport; scrollback is kept (§5.2). */
  clearViewport(): void;
}

export class CookedLine implements LineDiscipline {
  readonly mode = 'cooked' as const;

  #buffer = '';
  #caret = 0;
  readonly #history: string[] = [];
  #historyIndex = -1;
  #draft = '';

  constructor(
    private readonly host: CookedHost,
    private readonly core: () => TerminalCore,
    private readonly prompt: () => string,
    /** Buffer/caret mirror — the element keeps its input in sync. */
    private readonly onChange: (buffer: string, caret: number) => void = () => {},
    /** The shell callback: a line was submitted (Enter) — run it. */
    private readonly onLine: (line: string) => void = () => {},
  ) {}

  get buffer(): string {
    return this.#buffer;
  }

  get caret(): number {
    return this.#caret;
  }

  /** Full prompt text with the caret column, for grid painting. */
  promptRow(): { text: string; caret: number } {
    const ps = `${this.prompt()} $ `;
    return { text: ps, caret: stringWidth(ps) + stringWidth(this.#buffer.slice(0, this.#caret)) };
  }

  /** The visible input is edited natively (IME, drag); adopt its state. */
  syncFrom(buffer: string, caret: number): void {
    this.#buffer = buffer;
    this.#caret = Math.max(0, Math.min(caret, buffer.length));
    // Adopting native text is NOT history movement: the draft stays.
  }

  onSubmit(line: string): void {
    if (line.trim() !== '') {
      this.#history.push(line);
      this.#draft = '';
      this.#historyIndex = -1;
    }
    this.#buffer = '';
    this.#caret = 0;
    this.onChange(this.#buffer, this.#caret);
  }

  /** Cooked mode never attaches an app — no-op to satisfy §5's shape. */
  attach(): void {}

  detach(): void {
    this.#buffer = '';
    this.#caret = 0;
    this.#historyIndex = -1;
    this.#draft = '';
  }

  key(ev: KeyEvent): boolean {
    const key = ev.key;
    if (ev.ctrl && !ev.alt && !ev.meta) {
      if (this.#control(key)) return true;
    }
    if (ev.alt && !ev.ctrl && !ev.meta && key === 'Backspace') {
      this.#killWord();
      return true;
    }
    switch (key) {
      case 'Enter':
        this.#submit();
        return true;
      case 'Backspace':
        if (this.#caret > 0) {
          this.#buffer = this.#buffer.slice(0, this.#caret - 1) + this.#buffer.slice(this.#caret);
          this.#caret -= 1;
        }
        break;
      case 'Delete':
        if (this.#caret < this.#buffer.length) this.#buffer = this.#buffer.slice(0, this.#caret) + this.#buffer.slice(this.#caret + 1);
        break;
      case 'ArrowLeft':
        if (this.#caret > 0) this.#caret -= 1;
        break;
      case 'ArrowRight':
        if (this.#caret < this.#buffer.length) this.#caret += 1;
        break;
      case 'Home':
        this.#caret = 0;
        break;
      case 'End':
        this.#caret = this.#buffer.length;
        break;
      case 'ArrowUp':
        this.#navigate(-1);
        break;
      case 'ArrowDown':
        this.#navigate(1);
        break;
      case 'Tab':
        if (ev.shift) return false; // Shift+Tab keeps its focus meaning
        this.#complete();
        return true;
      default:
        if (!ev.ctrl && !ev.meta && !ev.alt && key.length === 1) {
          this.#buffer = this.#buffer.slice(0, this.#caret) + key + this.#buffer.slice(this.#caret);
          this.#caret += 1;
        } else {
          return false; // modifier-only or composed key — not ours
        }
    }
    this.onChange(this.#buffer, this.#caret);
    return true;
  }

  /** The named control keys; true when the key was consumed. */
  #control(key: string): boolean {
    switch (key) {
      case 'a': // caret to start
        this.#caret = 0;
        break;
      case 'e': // caret to end
        this.#caret = this.#buffer.length;
        break;
      case 'b': // back one
        if (this.#caret > 0) this.#caret -= 1;
        break;
      case 'f': // forward one
        if (this.#caret < this.#buffer.length) this.#caret += 1;
        break;
      case 'k': // kill to end of line
        this.#buffer = this.#buffer.slice(0, this.#caret);
        break;
      case 'u': // kill to start of line
        this.#buffer = this.#buffer.slice(this.#caret);
        this.#caret = 0;
        break;
      case 'w': // kill word back
        this.#killWord();
        break;
      case 'p':
        this.#navigate(-1);
        break;
      case 'n':
        this.#navigate(1);
        break;
      case 'l': // clear the viewport, scrollback kept (§5.2)
        this.host.clearViewport();
        break;
      case 'c': // abandon the line, fresh prompt (§5.2 NEW)
        this.#buffer = '';
        this.#caret = 0;
        break;
      case 'd': // empty: no-op (never EOF); non-empty: delete forward
        if (this.#buffer.length === 0) return true;
        if (this.#caret < this.#buffer.length) this.#buffer = this.#buffer.slice(0, this.#caret) + this.#buffer.slice(this.#caret + 1);
        break;
      default:
        return false; // unclaimed control key — let the shell see it
    }
    this.onChange(this.#buffer, this.#caret);
    return true;
  }

  #killWord(): void {
    const before = this.#buffer.slice(0, this.#caret);
    const trimmed = before.replace(/\S+\s*$/, '');
    this.#buffer = trimmed + this.#buffer.slice(this.#caret);
    this.#caret = trimmed.length;
    this.onChange(this.#buffer, this.#caret);
  }

  /** History with draft — v1 `#navigate`, byte for byte. */
  #navigate(delta: number): void {
    if (this.#history.length === 0) return;
    if (this.#historyIndex === -1) {
      if (delta > 0) return;
      this.#draft = this.#buffer;
      this.#historyIndex = this.#history.length - 1;
    } else {
      this.#historyIndex += delta;
      if (this.#historyIndex >= this.#history.length) {
        this.#historyIndex = -1;
        this.#buffer = this.#draft;
        this.#caret = this.#buffer.length;
        return;
      }
      if (this.#historyIndex < 0) this.#historyIndex = 0;
    }
    this.#buffer = this.#history[this.#historyIndex] ?? '';
    this.#caret = this.#buffer.length;
    this.onChange(this.#buffer, this.#caret);
  }

  /** Tab completion — v1 `#complete`: extend, or list capped at 8. */
  #complete(): void {
    if (this.#buffer === '') return; // empty line: Tab keeps its focus meaning
    const outcome = completeLine(this.#buffer, this.core());
    if (outcome.kind === 'none') return;
    this.#buffer = outcome.line;
    this.#caret = outcome.line.length;
    if (outcome.kind === 'list') {
      const shown = outcome.candidates.slice(0, 8);
      const rest = outcome.candidates.length - shown.length;
      this.host.emit(shown.join('  ') + (rest > 0 ? `  … +${rest} more` : ''));
    }
    this.onChange(this.#buffer, this.#caret);
  }

  #submit(): void {
    const line = this.#buffer;
    this.onSubmit(line); // history + draft reset, buffer cleared
    this.onLine(line); // the shell callback — run it (§5.1)
  }
}

/** `$HOME/...` → `~/...` for the prompt (§5.2 — the only abbreviation). */
export function abbreviateHome(cwd: string, home: string): string {
  if (home !== '' && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
  return cwd;
}

/* ------------------------------------------------------------------ *
 * raw mode (§5.3)
 * ------------------------------------------------------------------ */

export class RawLine implements LineDiscipline {
  readonly mode = 'raw' as const;

  #app: import('../screen/types.js').App | null = null;

  /** Enter raw mode on behalf of `app` (the runner drives screen state). */
  attach(app: import('../screen/types.js').App): void {
    this.#app = app;
  }

  /** Exit raw mode; the runner restores the primary screen. */
  detach(): void {
    this.#app = null;
  }

  get attached(): boolean {
    return this.#app !== null;
  }

  /** Raw mode never submits a line — no-op to satisfy §5's shape. */
  onSubmit(): void {}

  key(ev: KeyEvent): void {
    this.#app?.key(ev);
  }

  paste(text: string): void {
    this.#app?.paste?.(text);
  }

  mouse(ev: import('../screen/types.js').MouseEvent): void {
    this.#app?.mouse?.(ev);
  }

  resize(cols: number, rows: number): void {
    this.#app?.resize?.(cols, rows);
  }
}
