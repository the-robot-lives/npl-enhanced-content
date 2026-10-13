/**
 * ansi — shared token + attribute types for the ANSI/VT state machine
 * (src/terminal/ansi/parser.ts) and its DOM adapter (dom.ts).
 *
 * Stage 1 (Epoch 1): tokenise command output into text, SGR attribute
 * snapshots, cursor/erase/other CSI, and OSC sequences. The tokens are
 * deliberately renderer-neutral: the current DOM renderer keeps text +
 * attribute snapshots, the Epoch-2 canvas driver adds cursor/erase
 * semantics. Nothing here prints raw escapes — unknown or unsupported
 * sequences are consumed into typed tokens (or dropped at flush), never
 * leaked into rendered text.
 */

/** Foreground/background colour: default, one of the 16 named codes, 256-palette index, or RGB. */
export type AnsiColor =
  | { readonly kind: 'default' }
  | { readonly kind: 'named'; readonly code: number }
  | { readonly kind: 'indexed'; readonly n: number }
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

/**
 * One SGR attribute snapshot — the full state in force after applying a
 * sequence. Snapshots are frozen; `applySgr` derives a new one per change
 * so renderers can hold a reference without copying.
 */
export interface SgrAttrs {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  /** SGR 6 (rapid blink); renderers may treat it like `blink`. */
  rapidBlink: boolean;
  /** SGR 7 (reverse video). */
  reverse: boolean;
  /** SGR 8 (conceal). */
  conceal: boolean;
  /** SGR 9 (strikeout). */
  strikeout: boolean;
  fg: AnsiColor;
  bg: AnsiColor;
}

/** The all-defaults snapshot every stream starts in (also what SGR 0 returns to). */
export const DEFAULT_SGR: SgrAttrs = Object.freeze({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  rapidBlink: false,
  reverse: false,
  conceal: false,
  strikeout: false,
  fg: Object.freeze({ kind: 'default' }) as AnsiColor,
  bg: Object.freeze({ kind: 'default' }) as AnsiColor,
});

/**
 * One token out of the streaming parser.
 *
 * - `text` — a printable run (verbatim, may contain no control chars),
 *   carrying the frozen SGR snapshot in force when the run was cut. The
 *   snapshot rides on the token because the machine's live state has
 *   already moved on by the time a consumer sees the token.
 * - `sgr` — an SGR sequence; `attrs` is the snapshot in force AFTER it.
 * - `cursor` — cursor movement (CUU/CUD/CUF/CUB/CNL/CPL/CHA/CUP/VPA + ESC 7/8 save/restore).
 * - `erase` — ED (J) / EL (K); `mode` is the first parameter, default 0.
 * - `csi` — any other CSI (private modes, DSR, scroll…); consumed, never rendered by DOM.
 * - `osc` — OSC `code;data` (window title, hyperlinks…); terminated by BEL or ST.
 * - `control` — a C0 control the renderers may want (LF, CR, BS, TAB); everything
 *   else C0 is dropped silently.
 */
export type AnsiToken =
  | { readonly type: 'text'; readonly text: string; readonly attrs: SgrAttrs }
  | { readonly type: 'sgr'; readonly attrs: SgrAttrs }
  | { readonly type: 'cursor'; readonly final: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'd' | 's' | 'u'; readonly params: readonly (number | null)[] }
  | { readonly type: 'erase'; readonly final: 'J' | 'K'; readonly mode: number }
  | { readonly type: 'csi'; readonly final: string; readonly params: readonly (number | null)[]; readonly prefix: string }
  | { readonly type: 'osc'; readonly code: number; readonly data: string }
  | { readonly type: 'control'; readonly char: '\n' | '\r' | '\b' | '\t' };
