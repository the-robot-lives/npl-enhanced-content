/**
 * input-layer types — thin re-exports of the published screen contract
 * (src/terminal/screen/types.ts, CORE-V2 §4–§7) plus the input lane's own
 * seams. KeyEvent and the mouse shape are the screen contract's, verbatim;
 * Mods/RawKeyEvent/CellMetrics are lane-local (DOM-normalization seams the
 * screen layer never sees).
 */

export type {
  KeyEvent,
  MouseEvent as MouseEventInfo,
  ScreenPos as SelectionPoint,
  SelectionRange,
} from '../screen/types.js';

/** Modifier flags carried by every key event and used to build mouse mods. */
export interface Mods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** What normalizeKey reads — the subset of KeyboardEvent we need. */
export interface RawKeyEvent {
  key: string;
  /** Physical code (KeyA, Digit3, Period…): the layout-stable base for Ctrl/Alt chords. */
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Renderer cell metrics — the mouse mapping takes these as a parameter. */
export interface CellMetrics {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

/** Mods of a DOM pointer/keyboard event. */
export function modsOf(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): Mods {
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

/**
 * The screen contract's mouse shape carries ctrl/alt/shift flat and no
 * meta (browser-owned, nothing binds it) — this maps our Mods onto it.
 */
export function flatMods(m: Mods): { ctrl: boolean; alt: boolean; shift: boolean } {
  return { ctrl: m.ctrl, alt: m.alt, shift: m.shift };
}

export const NO_MODS: Mods = { ctrl: false, alt: false, shift: false, meta: false };
