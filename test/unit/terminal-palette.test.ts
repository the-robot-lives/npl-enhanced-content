// Unit spec — one terminal palette (5.1): canvas, mirror and CSS tokens agree,
// and every colour clears WCAG AA (4.5:1) on the terminal background.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERM_PALETTE, paletteCss, cssColor } from '../../src/terminal/screen/palette.js';
import { DEFAULT_ANSI16, DEFAULT_BG, DEFAULT_FG, cssRgb } from '../../src/terminal/render/screen-shape.js';

const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const css = readFileSync(new URL('../../themes/_vocabulary.css', import.meta.url), 'utf8');
const token = (name: string): string => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase() ?? '';
const hex = (rgb: { r: number; g: number; b: number }): string =>
  `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

describe('terminal palette', () => {
  it('every palette colour is >= 4.5:1 on the terminal background', () => {
    const colours = [TERM_PALETTE.fg, TERM_PALETTE.muted, TERM_PALETTE.accent, ...TERM_PALETTE.ansi];
    for (const c of colours) expect(contrast(c, TERM_PALETTE.bg), c).toBeGreaterThanOrEqual(4.5);
  });

  it('fg and muted stay legible on the chrome and active-tab surfaces', () => {
    for (const surface of [token('--sem-term-chrome'), token('--sem-term-tab-active')]) {
      expect(contrast(TERM_PALETTE.fg, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(TERM_PALETTE.muted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('canvas, mirror and CSS tokens carry the same values', () => {
    expect(DEFAULT_ANSI16.map(hex)).toEqual([...TERM_PALETTE.ansi]);
    expect(hex(DEFAULT_BG)).toBe(TERM_PALETTE.bg);
    expect(hex(DEFAULT_FG)).toBe(TERM_PALETTE.fg);
    expect(cssRgb(DEFAULT_BG)).toBe(`rgb(15 18 22)`);
    TERM_PALETTE.ansi.forEach((c, i) => {
      expect(paletteCss(i)).toBe(`var(--sem-term-ansi-${i}, ${c})`); // mirror fallback == canvas value
      expect(token(`--sem-term-ansi-${i}`)).toBe(c); // CSS token == canvas value
    });
    expect(token('--sem-term-bg')).toBe(TERM_PALETTE.bg);
    expect(token('--sem-term-fg')).toBe(TERM_PALETTE.fg);
    expect(token('--sem-term-muted')).toBe(TERM_PALETTE.muted);
    expect(token('--sem-term-accent')).toBe(TERM_PALETTE.accent);
    expect(cssColor(0xffff, () => null)).toContain('--sem-term-fg');
  });
});
