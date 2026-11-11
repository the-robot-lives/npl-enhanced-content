/**
 * screen/palette — color-ref resolution (CORE-V2 §4.2).
 *
 * fg/bg cells store 16-bit refs (see types.ts): 0–255 index the terminal
 * palette (16 ANSI + the xterm 240-cube), 0x8000–0xFFFE index a
 * deduplicated truecolor table, 0xFFFF is the theme default. This module
 * is the ONE place refs become colors — `cssColor` for the DOM mirror,
 * the same string serving as the canvas fill style — so paint and mirror
 * cannot drift (§4.2).
 *
 * Theme mapping: the 16 ANSI slots resolve to the `--sem-term-ansi-<n>` custom
 * properties (themes/_vocabulary.css), whose fallbacks are TERM_PALETTE —
 * the one palette the canvas, mirror and class CSS share (§9, 4.5:1). Extended-cube + truecolor refs resolve
 * to literal colors (they are absolute, not themed).
 */

import { COLOR_DEFAULT, COLOR_TRUECOLOR_BASE, COLOR_TRUECOLOR_MAX } from './types.js';

/** CSS color for one palette index 0–255. Index 0–15 → themed tokens. */
export function paletteCss(index: number): string {
  if (index < 16) return `var(--sem-term-ansi-${index}, ${ANSI_FALLBACKS[index] as string})`;
  return cubeCss(index);
}

/**
 * Cube color for index 16–255: 16–231 the 6×6×6 cube, 232–255 the gray
 * ramp (xterm layout). Literal RGB — never themed.
 */
export function cubeCss(index: number): string {
  if (index < 232) {
    const n = index - 16;
    const r = CUBE_LEVELS[Math.floor(n / 36) as 0 | 1 | 2 | 3 | 4 | 5];
    const g = CUBE_LEVELS[Math.floor(n / 6) % 6];
    const b = CUBE_LEVELS[n % 6];
    return `rgb(${r} ${g} ${b})`;
  }
  const gray = (index - 232) * 10 + 8;
  return `rgb(${gray} ${gray} ${gray})`;
}

/** CSS for a truecolor-table ref (0x8000–0xFFFE) given the stored RGB. */
export function truecolorCss(r: number, g: number, b: number): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * CSS for any color ref: palette index, truecolor table ref, or the
 * theme default. Unknown refs resolve to the theme default (never throw —
 * the screen is fed by the parser, but refs can come from saved state).
 */
export function cssColor(ref: number, truecolorAt: (slot: number) => readonly [number, number, number] | null): string {
  if (ref === COLOR_DEFAULT) return DEFAULT_FG_CSS;
  if (ref >= COLOR_TRUECOLOR_BASE && ref <= COLOR_TRUECOLOR_MAX) {
    const rgb = truecolorAt(ref - COLOR_TRUECOLOR_BASE);
    return rgb === null ? DEFAULT_FG_CSS : truecolorCss(rgb[0], rgb[1], rgb[2]);
  }
  if (ref >= 0 && ref <= 255) return paletteCss(ref);
  return DEFAULT_FG_CSS;
}

/**
 * Register one RGB in a deduplicating truecolor table. Returns the ref
 * (0x8000 + slot). Table growth is capped — a full table re-uses the last
 * slot (the parser feeds real documents; 2^15 colors is far beyond reach,
 * and never growing memory without bound is the screen's rule).
 */
export class TruecolorTable {
  /** packed RGB → table slot. */
  readonly #rgb = new Map<number, number>();
  /** slot → packed RGB (reverse lookup for `at`, O(1)). */
  readonly #slots = new Map<number, number>();
  #next = 0;

  get size(): number {
    return this.#rgb.size;
  }

  intern(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const known = this.#rgb.get(key);
    if (known !== undefined) return COLOR_TRUECOLOR_BASE + known;
    const slot = Math.min(this.#next, COLOR_TRUECOLOR_MAX - COLOR_TRUECOLOR_BASE);
    this.#next++;
    this.#rgb.set(key, slot);
    this.#slots.set(slot, key);
    return COLOR_TRUECOLOR_BASE + slot;
  }

  /** RGB stored at a table slot, or null. */
  at(slot: number): readonly [number, number, number] | null {
    const key = this.#slots.get(slot);
    if (key === undefined) return null;
    return [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff];
  }
}

/** The 6 cube levels, xterm order (0, 95, 135, 175, 215, 255). */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

/**
 * THE terminal palette (dark; the canvas is the source of truth). Every
 * paint path reads it: the canvas via render/screen-shape, the DOM mirror via
 * `paletteCss` (these values are the `var()` fallbacks), and the class CSS
 * via the `--sem-term-*` tokens in themes/_vocabulary.css, which MUST carry
 * the same values (a unit test pins the two together). Every colour is at
 * least 4.5:1 on `bg` (WCAG AA) — slots 0/8 are lightened for that.
 */
export const TERM_PALETTE = Object.freeze({
  bg: '#0f1216',
  fg: '#d7dee7',
  muted: '#9aa7b5',
  accent: '#7ec8a2',
  ansi: Object.freeze([
    '#7a8494', '#e5534e', '#7dc475', '#ddb267', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
    '#8b94a3', '#f06c74', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d7dee7',
  ]) as readonly string[],
});

const ANSI_FALLBACKS: readonly string[] = TERM_PALETTE.ansi;
const DEFAULT_FG_CSS = `var(--sem-term-fg, ${TERM_PALETTE.fg})`;
