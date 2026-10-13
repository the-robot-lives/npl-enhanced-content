/**
 * cards plugin — the frame themes.
 *
 * A theme draws the whole card: a top rule carrying the NAME, an underlined
 * title line, the wrapped body between side glyph columns, and a bottom
 * rule carrying the NAME again. One shared layout does the row work; a
 * theme supplies caps, rule fill and the side glyph. Every line of a frame
 * is exactly `width` display columns — CJK- and emoji-safe bodies included
 * — and the title underline (SGR 4) is emitted only when `color` is true
 * (stdout is a terminal); piped or redirected output stays plain.
 *
 * Themes: zigzag (the sketch: /\/\ rules, the NAME in both, | columns),
 * double (heavy box), rounded (light round box), ornate (✦-capped ─✧
 * rules), ascii (7-bit only).
 *
 * Invariant all themes keep: caps and fills are width-1 glyphs, and the
 * side column is one glyph, so inner width is `width - 6` and plain string
 * indexing equals column indexing inside a rule.
 */

import { displayWidth, padDisplay, truncateDisplay, wrapDisplay } from './width.js';
import type { CardFile } from './cardfile.js';

const SGR_UNDERLINE_ON = '\x1b[4m';
const SGR_UNDERLINE_OFF = '\x1b[24m';

export const DEFAULT_CARD_WIDTH = 64;
export const MIN_CARD_WIDTH = 24;
export const MAX_CARD_WIDTH = 120;

export interface CardThemeContext {
  /** The NAME spelled into the top/bottom rules. */
  name: string;
  /** The underlined heading, or null. */
  title: string | null;
  /** Pre-wrapped body lines (plain text, no SGR). */
  body: readonly string[];
  /** Total frame width in display columns. */
  width: number;
  /** True when stdout is a terminal (SGR allowed). */
  color: boolean;
}

export interface CardTheme {
  id: string;
  /** One-line description shown by `render-card --list-themes`. */
  label: string;
  draw(ctx: CardThemeContext): string[];
}

interface FrameSpec {
  side: string;
  topCaps: readonly [string, string];
  topUnit: string;
  bottomCaps: readonly [string, string];
  bottomUnit: string;
}

/** A fill repeated to exactly cols columns (units here are width-1). */
function repeatFill(unit: string, cols: number): string {
  if (cols <= 0) return '';
  let out = unit;
  while (out.length < cols) out += unit;
  return truncateDisplay(out, cols);
}

/** One rule line: caps around the fill, ` NAME ` spliced into the centre. */
function makeRule(caps: readonly [string, string], unit: string, name: string, width: number): string {
  const inner = width - displayWidth(caps[0]) - displayWidth(caps[1]);
  const base = repeatFill(unit, inner);
  const label = ` ${name} `;
  const labelWidth = displayWidth(label);
  if (labelWidth + 2 <= inner) {
    const start = Math.floor((inner - labelWidth) / 2);
    return caps[0] + base.slice(0, start) + label + base.slice(start + labelWidth) + caps[1];
  }
  return caps[0] + base + caps[1];
}

function drawFrame(ctx: CardThemeContext, spec: FrameSpec): string[] {
  const inner = ctx.width - 6; // side glyph + two spaces, on each side
  const blankRow = `${spec.side}  ${' '.repeat(inner)}  ${spec.side}`;
  const rows: string[] = [];
  rows.push(makeRule(spec.topCaps, spec.topUnit, ctx.name, ctx.width));
  rows.push(blankRow);
  if (ctx.title !== null) {
    const plain = truncateDisplay(ctx.title, inner);
    const shown = ctx.color ? SGR_UNDERLINE_ON + plain + SGR_UNDERLINE_OFF : plain;
    rows.push(`${spec.side}  ${shown}${' '.repeat(Math.max(0, inner - displayWidth(plain)))}  ${spec.side}`);
    rows.push(blankRow);
  }
  for (const line of ctx.body) {
    rows.push(`${spec.side}  ${padDisplay(line, inner)}  ${spec.side}`);
  }
  rows.push(blankRow);
  rows.push(makeRule(spec.bottomCaps, spec.bottomUnit, ctx.name, ctx.width));
  return rows;
}

const zigzagTheme: CardTheme = {
  id: 'zigzag',
  label: 'the sketch: /\\/\\ rules with the NAME in both, | columns',
  draw(ctx) {
    return drawFrame(ctx, {
      side: '|',
      topCaps: ['', ''],
      topUnit: '/\\',
      bottomCaps: ['', ''],
      bottomUnit: '\\/',
    });
  },
};

const doubleTheme: CardTheme = {
  id: 'double',
  label: 'a heavy double-line box, ║ columns',
  draw(ctx) {
    return drawFrame(ctx, {
      side: '║',
      topCaps: ['╔', '╗'],
      topUnit: '═',
      bottomCaps: ['╚', '╝'],
      bottomUnit: '═',
    });
  },
};

const roundedTheme: CardTheme = {
  id: 'rounded',
  label: 'a light rounded box, │ columns',
  draw(ctx) {
    return drawFrame(ctx, {
      side: '│',
      topCaps: ['╭', '╮'],
      topUnit: '─',
      bottomCaps: ['╰', '╯'],
      bottomUnit: '─',
    });
  },
};

const ornateTheme: CardTheme = {
  id: 'ornate',
  label: '✦-capped ─✧ rules, │ columns',
  draw(ctx) {
    return drawFrame(ctx, {
      side: '│',
      topCaps: ['✦', '✦'],
      topUnit: '─✧',
      bottomCaps: ['✦', '✦'],
      bottomUnit: '✧─',
    });
  },
};

const asciiTheme: CardTheme = {
  id: 'ascii',
  label: '7-bit only: + rules, | columns',
  draw(ctx) {
    return drawFrame(ctx, {
      side: '|',
      topCaps: ['+', '+'],
      topUnit: '-',
      bottomCaps: ['+', '+'],
      bottomUnit: '-',
    });
  },
};

/** The themes in registry order — zigzag first, the default. */
export const CARD_THEMES: readonly CardTheme[] = [zigzagTheme, doubleTheme, roundedTheme, ornateTheme, asciiTheme];

export function themeIds(): string[] {
  return CARD_THEMES.map((theme) => theme.id);
}

/** Resolve a theme id; null/empty picks the default (zigzag). Unknown ids throw. */
export function resolveCardTheme(id: string | null | undefined): CardTheme {
  if (id === null || id === undefined || id === '') return zigzagTheme;
  const found = CARD_THEMES.find((theme) => theme.id === id);
  if (!found) {
    throw new Error(`render-card: unknown theme "${id}" (knows: ${themeIds().join(', ')})`);
  }
  return found;
}

/** Clamp a requested width into the supported range (non-finite → default). */
export function clampCardWidth(width: number | null | undefined): number {
  if (width === null || width === undefined || !Number.isFinite(width)) return DEFAULT_CARD_WIDTH;
  return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.trunc(width)));
}

/**
 * The full card as transcript lines: wrap the description to the theme's
 * inner width, then let the theme draw. `opts.width` overrides the card
 * header's width; both fall back to DEFAULT_CARD_WIDTH, clamped.
 */
export function renderCardLines(card: CardFile, opts: { width?: number; theme?: string; color: boolean }): string[] {
  const width = clampCardWidth(opts.width ?? card.width);
  const theme = resolveCardTheme(opts.theme ?? card.theme);
  const inner = width - 6;
  const body: string[] = [];
  for (const paragraph of card.description.split('\n')) {
    for (const line of wrapDisplay(paragraph, inner)) body.push(line);
  }
  return theme.draw({ name: card.name, title: card.title, body, width, color: opts.color });
}
