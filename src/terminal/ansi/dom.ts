/**
 * ansi/dom — the DOM-facing adapter over the ANSI state machine.
 *
 * `ansiSpans(text, machine)` feeds one chunk of command output through the
 * machine and returns styled span descriptors for the current transcript
 * renderer: text plus class/style strings. Cursor, erase and OSC tokens
 * are consumed here (they have no DOM meaning yet — the Epoch-2 canvas
 * driver owns them), CR and BS are dropped, LF and TAB stay in the text so
 * the existing white-space CSS keeps working. Attribute state carries
 * across calls — create one machine per transcript.
 *
 * `flush()` is deliberately NOT called here: a sequence split across two
 * output chunks stays buffered in the machine until its remainder arrives,
 * so a chunk boundary can never drop it or leak raw escapes as noise.
 *
 * TEMPORARY adapter (CORE-V2): the terminal is going canvas-first — this
 * span adapter remains only until the canvas driver and its hidden a11y /
 * find mirror land, and then serves the mirror. The contract it depends on
 * (text runs + frozen SGR snapshots) is the same one the cell-grid screen
 * model consumes.
 *
 * Blink honours `prefers-reduced-motion` through ANSI_DOM_CSS (the theme
 * block the sem-terminal patch inserts), not through JS.
 */

import type { AnsiStateMachine } from './parser.js';
import { DEFAULT_SGR, type SgrAttrs } from './types.js';

export type { AnsiStateMachine };

/** One rendered run: verbatim text plus its presentation. */
export interface AnsiSpan {
  readonly text: string;
  readonly attrs: SgrAttrs;
  /** Classes matching the vocabulary theme (`sem-ansi-*`); may be empty. */
  readonly classes: readonly string[];
  /** Inline style for 256-colour/truecolour; '' when the classes suffice. */
  readonly style: string;
}

const FLAG_CLASSES: ReadonlyArray<readonly [keyof SgrAttrs, string]> = [
  ['bold', 'sem-ansi-b'],
  ['dim', 'sem-ansi-dim'],
  ['italic', 'sem-ansi-i'],
  ['underline', 'sem-ansi-u'],
  ['strikeout', 'sem-ansi-strike'],
  ['reverse', 'sem-ansi-rev'],
  // rapidBlink (SGR 6) shares the one DOM blink class; reduced-motion gates it.
  ['blink', 'sem-ansi-blink'],
  ['rapidBlink', 'sem-ansi-blink'],
];

/** xterm 256-palette entries 16–255: the 6×6×6 colour cube, then grayscale. */
export function ansiIndexedRgb(n: number): { r: number; g: number; b: number } {
  const levels = [0, 95, 135, 175, 215, 255];
  if (n < 232) {
    const i = n - 16;
    return {
      r: levels[Math.floor(i / 36)] ?? 0,
      g: levels[Math.floor((i % 36) / 6)] ?? 0,
      b: levels[i % 6] ?? 0,
    };
  }
  const v = 8 + (n - 232) * 10;
  return { r: v, g: v, b: v };
}

/**
 * Classes for a snapshot. The 16 base colours map onto the existing
 * `sem-ansi-c30…c37` classes plus the bright (c90…) and background (bg…)
 * families; 256-index and truecolour go inline via `ansiSpanStyle`.
 */
export function ansiSpanClasses(attrs: SgrAttrs): string[] {
  const classes: string[] = [];
  for (const [key, cls] of FLAG_CLASSES) if (attrs[key] === true) classes.push(cls);
  if (attrs.fg.kind === 'named') classes.push(`sem-ansi-c${attrs.fg.code}`);
  if (attrs.bg.kind === 'named') classes.push(`sem-ansi-bg${attrs.bg.code}`);
  if (attrs.fg.kind === 'indexed' && attrs.fg.n < 16) {
    classes.push(`sem-ansi-c${attrs.fg.n < 8 ? 30 + attrs.fg.n : 82 + attrs.fg.n}`);
  }
  if (attrs.bg.kind === 'indexed' && attrs.bg.n < 16) {
    classes.push(`sem-ansi-bg${attrs.bg.n < 8 ? 40 + attrs.bg.n : 92 + attrs.bg.n}`);
  }
  return classes;
}

/** Inline style for everything classes cannot express (and conceal). */
export function ansiSpanStyle(attrs: SgrAttrs): string {
  const parts: string[] = [];
  if (attrs.fg.kind === 'indexed' && attrs.fg.n >= 16) {
    const { r, g, b } = ansiIndexedRgb(attrs.fg.n);
    parts.push(`color:rgb(${r},${g},${b})`);
  } else if (attrs.fg.kind === 'rgb') {
    parts.push(`color:rgb(${attrs.fg.r},${attrs.fg.g},${attrs.fg.b})`);
  }
  if (attrs.bg.kind === 'indexed' && attrs.bg.n >= 16) {
    const { r, g, b } = ansiIndexedRgb(attrs.bg.n);
    parts.push(`background-color:rgb(${r},${g},${b})`);
  } else if (attrs.bg.kind === 'rgb') {
    parts.push(`background-color:rgb(${attrs.bg.r},${attrs.bg.g},${attrs.bg.b})`);
  }
  if (attrs.conceal) parts.push('color:transparent');
  return parts.join(';');
}

/**
 * Tokenise one chunk of output into span descriptors. Runs split on
 * attribute changes (snapshot reference equality) and merge otherwise;
 * LF/TAB stay inside run text; cursor/erase/OSC tokens never produce text.
 */
export function ansiSpans(text: string, machine: AnsiStateMachine): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let runText = '';
  let runAttrs: SgrAttrs | null = null;
  const endRun = (): void => {
    if (runText === '' || runAttrs === null) return;
    spans.push({ text: runText, attrs: runAttrs, classes: ansiSpanClasses(runAttrs), style: ansiSpanStyle(runAttrs) });
    runText = '';
    runAttrs = null; // the next text run takes whatever snapshot is then in force
  };
  const tokens = machine.write(text);
  for (const token of tokens) {
    if (token.type === 'text') {
      // The snapshot rides on the token (the machine's live state has moved
      // on); runs split where the snapshot reference changes.
      if (runAttrs !== token.attrs) endRun();
      if (runAttrs === null) runAttrs = token.attrs;
      runText += token.text;
      continue;
    }
    if (token.type === 'control') {
      if (token.char === '\n' || token.char === '\t') {
        runText += token.char; // verbatim, as today: the white-space CSS decides wrapping
        continue;
      }
      continue; // \r and \b: dropped — a line transcript cannot move a cursor
    }
    // sgr / cursor / erase / csi / osc: consumed. SGR already applied by the
    // machine; the run in flight keeps its snapshot, the next text run takes
    // the new one.
  }
  endRun();
  return spans;
}

/**
 * Theme CSS for the classes `ansiSpans` emits, in the vocabulary theme's
 * selector convention. Bright/background palettes are drafts keyed to the
 * existing c30…c37 values; blink honours prefers-reduced-motion. The
 * sem-terminal patch inserts this block into themes/_vocabulary.css (a
 * shared theme file — never committed by the ansi lane).
 */
export const ANSI_DOM_CSS = `
sem-terminal .sem-ansi-i, sem-shell .sem-ansi-i { font-style: italic; }
sem-terminal .sem-ansi-u, sem-shell .sem-ansi-u { text-decoration: underline; }
sem-terminal .sem-ansi-strike, sem-shell .sem-ansi-strike { text-decoration: line-through; }
sem-terminal .sem-ansi-rev, sem-shell .sem-ansi-rev { filter: invert(1); }
sem-terminal .sem-ansi-blink, sem-shell .sem-ansi-blink { animation: sem-ansi-blink 1.1s step-end infinite; }
@keyframes sem-ansi-blink { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) {
  sem-terminal .sem-ansi-blink, sem-shell .sem-ansi-blink { animation: none; }
}
sem-terminal .sem-ansi-c90, sem-shell .sem-ansi-c90 { color: #9aa5b1; }
sem-terminal .sem-ansi-c91, sem-shell .sem-ansi-c91 { color: #ff8f7a; }
sem-terminal .sem-ansi-c92, sem-shell .sem-ansi-c92 { color: #8fd6a0; }
sem-terminal .sem-ansi-c93, sem-shell .sem-ansi-c93 { color: #e6c77a; }
sem-terminal .sem-ansi-c94, sem-shell .sem-ansi-c94 { color: #7ab8e6; }
sem-terminal .sem-ansi-c95, sem-shell .sem-ansi-c95 { color: #c79ae6; }
sem-terminal .sem-ansi-c96, sem-shell .sem-ansi-c96 { color: #6fd3d3; }
sem-terminal .sem-ansi-c97, sem-shell .sem-ansi-c97 { color: #f2f5f8; }
sem-terminal .sem-ansi-bg40, sem-shell .sem-ansi-bg40 { background: rgba(107,114,128,.35); }
sem-terminal .sem-ansi-bg41, sem-shell .sem-ansi-bg41 { background: rgba(255,143,122,.28); }
sem-terminal .sem-ansi-bg42, sem-shell .sem-ansi-bg42 { background: rgba(143,214,160,.28); }
sem-terminal .sem-ansi-bg43, sem-shell .sem-ansi-bg43 { background: rgba(230,199,122,.28); }
sem-terminal .sem-ansi-bg44, sem-shell .sem-ansi-bg44 { background: rgba(122,184,230,.28); }
sem-terminal .sem-ansi-bg45, sem-shell .sem-ansi-bg45 { background: rgba(199,154,230,.28); }
sem-terminal .sem-ansi-bg46, sem-shell .sem-ansi-bg46 { background: rgba(111,211,211,.28); }
sem-terminal .sem-ansi-bg47, sem-shell .sem-ansi-bg47 { background: rgba(214,221,230,.22); }
sem-terminal .sem-ansi-bg100, sem-shell .sem-ansi-bg100 { background: rgba(107,114,128,.35); }
sem-terminal .sem-ansi-bg101, sem-shell .sem-ansi-bg101 { background: rgba(255,143,122,.28); }
sem-terminal .sem-ansi-bg102, sem-shell .sem-ansi-bg102 { background: rgba(143,214,160,.28); }
sem-terminal .sem-ansi-bg103, sem-shell .sem-ansi-bg103 { background: rgba(230,199,122,.28); }
sem-terminal .sem-ansi-bg104, sem-shell .sem-ansi-bg104 { background: rgba(122,184,230,.28); }
sem-terminal .sem-ansi-bg105, sem-shell .sem-ansi-bg105 { background: rgba(199,154,230,.28); }
sem-terminal .sem-ansi-bg106, sem-shell .sem-ansi-bg106 { background: rgba(111,211,211,.28); }
sem-terminal .sem-ansi-bg107, sem-shell .sem-ansi-bg107 { background: rgba(214,221,230,.22); }
`;
