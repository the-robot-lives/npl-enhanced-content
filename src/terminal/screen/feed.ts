/**
 * screen/feed — folds the ansi lane's token stream into the Screen
 * (CORE-V2 §4; the parser is the gate, the screen the sink).
 *
 * One `ScreenFeed` owns an `AnsiStateMachine` and applies every token it
 * emits: text runs print through the pen, SGR snapshots become attr bits
 * + color refs (1:1 with the ansi lane's `SgrAttrs`, §4.1), cursor/erase
 * tokens drive the §4.4 ops, `csi` tokens carry IL/DL/SU/SD/ECH and the
 * DECSET/DECRST private modes we honour (DECAWM, DECTCEM — the alt
 * screen stays app-lifecycle-only and is never set by a sequence, §4.4),
 * control chars are CR/LF/BS/HT, and OSC 0/1/2 feed the title, OSC 9 the
 * status (§11.1). Unknown sequences never reach this module as text —
 * the parser consumed them.
 *
 * The write path is batched by the Screen's damage set; nothing here
 * touches DOM or canvas.
 */

import { AnsiStateMachine, type AnsiToken, type SgrAttrs } from '../ansi/index.js';
import { ATTR, COLOR_DEFAULT, type Color } from './types.js';
import { TruecolorTable } from './palette.js';
import { Screen } from './screen.js';

export class ScreenFeed {
  readonly screen: Screen;
  readonly machine = new AnsiStateMachine();
  readonly truecolor = new TruecolorTable();

  constructor(screen: Screen) {
    this.screen = screen;
  }

  /** Feed one chunk of (ANSI-bearing) text into the screen. */
  write(chunk: string): void {
    this.apply(this.machine.write(chunk));
  }

  /** Flush the parser state machine (end of stream) and apply. */
  flush(): void {
    this.apply(this.machine.flush());
  }

  /** Reset parser attributes (the element's `clear` path). */
  reset(): void {
    this.machine.reset();
    this.screen.setPen(0, COLOR_DEFAULT, COLOR_DEFAULT);
  }

  /** Apply one token batch — also the path for tokens produced elsewhere. */
  apply(tokens: readonly AnsiToken[]): void {
    for (const token of tokens) this.applyToken(token);
  }

  applyToken(token: AnsiToken): void {
    switch (token.type) {
      case 'text':
        this.#printRun(token.text, token.attrs);
        return;
      case 'sgr':
        this.#setPen(token.attrs);
        return;
      case 'cursor':
        this.#cursor(token.final, token.params);
        return;
      case 'erase':
        if (token.final === 'J') this.screen.eraseDisplay(clampErase(token.mode));
        else this.screen.eraseLine(clampErase(token.mode));
        return;
      case 'control':
        if (token.char === '\n') this.screen.lineFeed();
        else if (token.char === '\r') this.screen.carriageReturn();
        else if (token.char === '\b') this.screen.backspace();
        else if (token.char === '\t') this.screen.tab();
        return;
      case 'csi':
        this.#csi(token.final, token.params, token.prefix);
        return;
      case 'osc':
        this.#osc(token.code, token.data);
        return;
    }
  }

  /* ------------------------------------------------------------ *
   * SGR → pen (§4.1: bits 1:1 with SgrAttrs; §4.2 color refs)
   * ------------------------------------------------------------ */

  #printRun(text: string, attrs: SgrAttrs): void {
    this.#setPen(attrs);
    this.screen.print(text);
  }

  #setPen(attrs: SgrAttrs): void {
    const bits =
      (attrs.bold ? ATTR.BOLD : 0) |
      (attrs.dim ? ATTR.DIM : 0) |
      (attrs.italic ? ATTR.ITALIC : 0) |
      (attrs.underline ? ATTR.UNDERLINE : 0) |
      (attrs.blink ? ATTR.BLINK : 0) |
      (attrs.rapidBlink ? ATTR.RAPID_BLINK : 0) |
      (attrs.reverse ? ATTR.REVERSE : 0) |
      (attrs.conceal ? ATTR.HIDDEN : 0) |
      (attrs.strikeout ? ATTR.STRIKE : 0);
    this.screen.setPen(bits, this.#colorRef(attrs.fg), this.#colorRef(attrs.bg));
  }

  #colorRef(color: SgrAttrs['fg']): Color {
    if (color.kind === 'default') return COLOR_DEFAULT;
    if (color.kind === 'named') {
      // SGR param form: 30–37/90–97 fg, 40–47/100–107 bg → palette slot.
      const code = color.code;
      if (code >= 30 && code <= 37) return code - 30;
      if (code >= 90 && code <= 97) return code - 90 + 8;
      if (code >= 40 && code <= 47) return code - 40;
      if (code >= 100 && code <= 107) return code - 100 + 8;
      return COLOR_DEFAULT;
    }
    if (color.kind === 'indexed') return color.n & 0xff;
    return this.truecolor.intern(color.r, color.g, color.b);
  }

  /* ------------------------------------------------------------ *
   * cursor tokens (§4.4)
   * ------------------------------------------------------------ */

  #cursor(final: string, params: readonly (number | null)[]): void {
    const at = (index: number, fallback: number): number => params[index] ?? fallback;
    switch (final) {
      case 'A':
        this.screen.cursorUp(Math.max(1, at(0, 1)));
        return;
      case 'B':
        this.screen.cursorDown(Math.max(1, at(0, 1)));
        return;
      case 'C':
        this.screen.cursorForward(Math.max(1, at(0, 1)));
        return;
      case 'D':
        this.screen.cursorBack(Math.max(1, at(0, 1)));
        return;
      case 'E':
        this.screen.cursorNextLine(Math.max(1, at(0, 1)));
        return;
      case 'F':
        this.screen.cursorPrevLine(Math.max(1, at(0, 1)));
        return;
      case 'G':
        this.screen.cursorColumn(Math.max(0, at(0, 1)) - 1);
        return;
      case 'H':
        this.screen.moveCursor(Math.max(0, at(0, 1)) - 1, Math.max(0, at(1, 1)) - 1);
        return;
      case 'd':
        this.screen.moveCursor(Math.max(0, at(0, 1)) - 1, this.screen.cursor.col);
        return;
      case 's':
        this.screen.saveCursor();
        return;
      case 'u':
        this.screen.restoreCursor();
        return;
    }
  }

  /* ------------------------------------------------------------ *
   * other CSI (IL/DL/SU/SD/ECH + DECSET/DECRST subset)
   * ------------------------------------------------------------ */

  #csi(final: string, params: readonly (number | null)[], prefix: string): void {
    const at = (index: number, fallback: number): number => params[index] ?? fallback;
    if (prefix === '?') {
      // DECSET/DECRST — only the §4.4 subset; the alt screen is app
      // lifecycle only, never settable by a sequence.
      const set = final === 'h';
      if (final !== 'h' && final !== 'l') return;
      for (const param of params) {
        if (param === 7) this.screen.modes.autowrap = set;
        else if (param === 25) this.screen.cursor.visible = set;
      }
      return;
    }
    switch (final) {
      case 'L':
        this.screen.insertLines(Math.max(1, at(0, 1)));
        return;
      case 'M':
        this.screen.deleteLines(Math.max(1, at(0, 1)));
        return;
      case 'S':
        this.screen.scrollUp(Math.max(1, at(0, 1)));
        return;
      case 'T':
        this.screen.scrollDown(Math.max(1, at(0, 1)));
        return;
      case 'X':
        // ECH — erase n characters AT the cursor (EL's fill rules, n cells only).
        this.screen.eraseChars(Math.max(1, at(0, 1)));
        return;
      default:
        return; // out of the subset — consumed
    }
  }

  /* ------------------------------------------------------------ *
   * OSC feeds (§11.1)
   * ------------------------------------------------------------ */

  #osc(code: number, data: string): void {
    if (code === 0 || code === 1 || code === 2) {
      this.screen.setTitle(data);
      return;
    }
    if (code === 9) {
      // `9;text` — or `9;tone;text` with tone idle|busy|alert (§11.1).
      const semi = data.indexOf(';');
      if (semi > 0) {
        const head = data.slice(0, semi);
        if (head === 'idle' || head === 'busy' || head === 'alert') {
          this.screen.setStatus(data.slice(semi + 1), head);
          return;
        }
      }
      this.screen.setStatus(data);
    }
  }
}

/** ED/EL mode from the token: only 0/1/2 are meaningful. */
function clampErase(mode: number): 0 | 1 | 2 {
  return mode === 1 ? 1 : mode === 2 ? 2 : 0;
}
