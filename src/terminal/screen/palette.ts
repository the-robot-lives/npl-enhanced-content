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
 * Theme mapping: the 16 ANSI slots resolve to the `--sem-ansi-<n>` custom
 * properties the terminal CSS block defines per theme (contrast-checked
 * 4.5:1 against the theme background, §9), with hard fallbacks so a bare
 * document still renders legibly. Extended-cube + truecolor refs resolve
 * to literal colors (they are absolute, not themed).
 */

import { COLOR_DEFAULT, COLOR_TRUECOLOR_BASE, COLOR_TRUECOLOR_MAX } from './types.js';

/** CSS color for one palette index 0–255. Index 0–15 → themed tokens. */
export function paletteCss(index: number): string {
  if (index < 16) return `var(--sem-ansi-${index}, ${ANSI_FALLBACKS[index] as string})`;
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
  if (ref === COLOR_DEFAULT) return 'var(--sem-fg, currentColor)';
  if (ref >= COLOR_TRUECOLOR_BASE && ref <= COLOR_TRUECOLOR_MAX) {
    const rgb = truecolorAt(ref - COLOR_TRUECOLOR_BASE);
    return rgb === null ? 'var(--sem-fg, currentColor)' : truecolorCss(rgb[0], rgb[1], rgb[2]);
  }
  if (ref >= 0 && ref <= 255) return paletteCss(ref);
  return 'var(--sem-fg, currentColor)';
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
 * Hard fallbacks for the 16 ANSI slots (xterm defaults) — used only when
 * the theme's `--sem-ansi-<n>` ramp is absent (bare documents, unit DOM).
 */
const ANSI_FALLBACKS: readonly string[] = [
  '#3b3b3b', // 0 black (theme ramps keep it readable on light bg)
  '#c92a2a', // 1 red
  '#2b8a3e', // 2 green
  '#e8590c', // 3 yellow
  '#1971c2', // 4 blue
  '#9c36b5', // 5 magenta
  '#0c8599', // 6 cyan
  '#5c5f66', // 7 white (light gray — pure white is invisible on light bg)
  '#686a72', // 8 bright black
  '#f03e3e', // 9 bright red
  '#40c057', // 10 bright green
  '#fab005', // 11 bright yellow
  '#4dabf7', // 12 bright blue
  '#e64980', // 13 bright magenta
  '#66d9e8', // 14 bright cyan
  '#dee2e6', // 15 bright white
];
