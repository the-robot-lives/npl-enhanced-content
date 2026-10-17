/**
 * cards plugin — the frame themes.
 *
 * A theme draws the whole card: a top rule carrying the NAME, a title (and
 * optional subtitle), the wrapped body between side glyph columns, optional
 * sections under their own headings, an optional footer, and a bottom rule
 * carrying the NAME again. One shared layout does the row work; a theme
 * supplies caps, rule fill and the side glyph. Every line of a frame is
 * exactly `width` display columns — CJK- and emoji-safe bodies included —
 * measured with the screen model's width table (see width.ts).
 *
 * Colour (only when `color` — stdout is a terminal; pipes stay plain):
 * each theme carries a Tier-1 SGR accent with a dark/light variant, picked
 * by `resolveCardBackground` (the COLORFGBG convention, overridable).
 * Frame rules, the title (bold+underline) and section headings (bold) take
 * the accent; the subtitle is italic, the footer dim; body text stays
 * uncoloured so copy/paste keeps clean text. `ascii` deliberately has no
 * accent — it is the theme you pick when nothing may decorate the bytes.
 *
 * Themes: zigzag (the sketch: /\/\ rules, | columns), double (heavy box —
 * ═ rules, ║ columns), rounded (light round box), ornate (✦-capped ─✧
 * rules), heavy (━ rules, ┃ columns), blueprint (dashed ┄ rules on │
 * columns), block (solid half-block bars), minimal (rule-only: two rules
 * and the text between, no side columns), ascii (7-bit only).
 *
 * Invariant all themes keep: caps and fills are width-1 glyphs, and the
 * side column is one glyph, so inner width is `width - 6` and plain string
 * indexing equals column indexing inside a rule. `minimal` has no side
 * columns (inner = width); its blank rows are full-width spaces so the
 * every-line-exactly-`width` invariant still holds.
 */

import { displayWidth, padDisplay, truncateDisplay, wrapDisplay } from './width.js';
import type { CardFile, CardSection } from './cardfile.js';
import { splitSections } from './cardfile.js';

const SGR_RESET = '\x1b[0m';
const SGR_UNDERLINE_ON = '\x1b[1;4m';
const SGR_ITALIC_ON = '\x1b[3m';
const SGR_DIM_ON = '\x1b[2m';
const SGR_BOLD_ON = '\x1b[1m';

export const DEFAULT_CARD_WIDTH = 64;
export const MIN_CARD_WIDTH = 24;
export const MAX_CARD_WIDTH = 120;

/** Terminal background the colour palettes adapt to. */
export type CardBackground = 'dark' | 'light';

/**
 * The background from the environment: the classic COLORFGBG convention
 * (`fg;bg` — the LAST field is the background; 7/15 = white-ish → light).
 * Absent or unparseable ⇒ dark, the terminal default.
 */
export function resolveCardBackground(env?: Record<string, string>): CardBackground {
  const fgbg = env?.COLORFGBG;
  if (fgbg !== undefined && fgbg !== '') {
    const bg = Number.parseInt(fgbg.split(';').pop() ?? '', 10);
    if (Number.isFinite(bg)) return bg >= 7 ? 'light' : 'dark';
  }
  return 'dark';
}

/** SGR "on" sequences for the theme's accent, per background. */
export interface CardAccent {
  dark: string | null;
  light: string | null;
}

export interface CardThemeSection {
  /** The "#"-heading text, or null for the prose before any heading. */
  heading: string | null;
  /** Pre-wrapped body lines (plain text, no SGR). */
  body: readonly string[];
}

export interface CardThemeContext {
  /** The NAME spelled into the top/bottom rules. */
  name: string;
  /** The underlined heading, or null. */
  title: string | null;
  /** The line under the title, or null. */
  subtitle: string | null;
  /** The body split into sections, each pre-wrapped. */
  sections: readonly CardThemeSection[];
  /** The line above the bottom rule, or null. */
  footer: string | null;
  /** Total frame width in display columns. */
  width: number;
  /** True when stdout is a terminal (SGR allowed). */
  color: boolean;
  /** Which palette variant the accent uses. */
  background: CardBackground;
}

export interface CardTheme {
  id: string;
  /** One-line description shown by `render-card --list-themes`. */
  label: string;
  /** Per-background accent, or null for a deliberately colourless theme. */
  accent: CardAccent | null;
  draw(ctx: CardThemeContext): string[];
}

interface FrameSpec {
  side: string;
  /** The right side glyph when it differs (half-block bars). */
  sideRight?: string;
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

/** The accent SGR "on" for a context, honouring color + theme + background. */
function accentOn(ctx: CardThemeContext, theme: { accent: CardAccent | null }): string {
  if (!ctx.color || theme.accent === null) return '';
  return ctx.background === 'light' ? (theme.accent.light ?? '') : (theme.accent.dark ?? '');
}

function drawFrame(ctx: CardThemeContext, spec: FrameSpec, theme: CardTheme): string[] {
  const hasSides = spec.side !== '';
  const inner = hasSides ? ctx.width - 6 : ctx.width; // side glyph + two spaces, on each side
  const right = spec.sideRight ?? spec.side;
  const accent = accentOn(ctx, theme);
  // Colourless themes (ascii) get no SGR anywhere — not even the title
  // underline; that is their whole point.
  const sgrAllowed = ctx.color && theme.accent !== null;
  const paint = (sgr: string, text: string): string =>
    sgrAllowed && sgr !== '' ? sgr + text + SGR_RESET : text;

  // A content row: the (possibly SGR-carrying) text padded to inner, boxed.
  const row = (text: string): string => {
    if (!hasSides) return text + ' '.repeat(Math.max(0, inner - displayWidth(text)));
    return `${spec.side}  ${text}${' '.repeat(Math.max(0, inner - displayWidth(text)))}  ${right}`;
  };
  const blank = (): string =>
    hasSides ? `${spec.side}  ${' '.repeat(inner)}  ${right}` : ' '.repeat(ctx.width);
  const rule = (caps: readonly [string, string], unit: string): string =>
    paint(accent, makeRule(caps, unit, ctx.name, ctx.width));

  const rows: string[] = [];
  rows.push(rule(spec.topCaps, spec.topUnit));
  rows.push(blank());
  if (ctx.title !== null) {
    const shown = paint(accent + SGR_UNDERLINE_ON, truncateDisplay(ctx.title, inner));
    rows.push(row(shown));
    if (ctx.subtitle !== null) rows.push(row(paint(SGR_ITALIC_ON, truncateDisplay(ctx.subtitle, inner))));
    rows.push(blank());
  } else if (ctx.subtitle !== null) {
    rows.push(row(paint(SGR_ITALIC_ON, truncateDisplay(ctx.subtitle, inner))));
    rows.push(blank());
  }
  let first = true;
  for (const section of ctx.sections) {
    if (section.heading !== null) {
      if (!first || ctx.title !== null) rows.push(blank());
      rows.push(row(paint(accent + SGR_BOLD_ON, truncateDisplay(section.heading, inner))));
    } else if (!first) {
      rows.push(blank());
    }
    first = false;
    for (const line of section.body) rows.push(row(padDisplay(line, inner)));
  }
  if (ctx.footer !== null) {
    rows.push(blank());
    rows.push(row(paint(SGR_DIM_ON, truncateDisplay(ctx.footer, inner))));
  }
  rows.push(blank());
  rows.push(rule(spec.bottomCaps, spec.bottomUnit));
  return rows;
}

const zigzagTheme: CardTheme = {
  id: 'zigzag',
  label: 'the sketch: /\\/\\ rules with the NAME in both, | columns',
  accent: { dark: '\x1b[95m', light: '\x1b[35m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '|',
        topCaps: ['', ''],
        topUnit: '/\\',
        bottomCaps: ['', ''],
        bottomUnit: '\\/',
      },
      zigzagTheme,
    );
  },
};

const doubleTheme: CardTheme = {
  id: 'double',
  label: 'a heavy double-line box, ║ columns',
  accent: { dark: '\x1b[96m', light: '\x1b[36m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '║',
        topCaps: ['╔', '╗'],
        topUnit: '═',
        bottomCaps: ['╚', '╝'],
        bottomUnit: '═',
      },
      doubleTheme,
    );
  },
};

const roundedTheme: CardTheme = {
  id: 'rounded',
  label: 'a light rounded box, │ columns',
  accent: { dark: '\x1b[94m', light: '\x1b[34m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '│',
        topCaps: ['╭', '╮'],
        topUnit: '─',
        bottomCaps: ['╰', '╯'],
        bottomUnit: '─',
      },
      roundedTheme,
    );
  },
};

const ornateTheme: CardTheme = {
  id: 'ornate',
  label: '✦-capped ─✧ rules, │ columns',
  accent: { dark: '\x1b[93m', light: '\x1b[33m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '│',
        topCaps: ['✦', '✦'],
        topUnit: '─✧',
        bottomCaps: ['✦', '✦'],
        bottomUnit: '✧─',
      },
      ornateTheme,
    );
  },
};

const heavyTheme: CardTheme = {
  id: 'heavy',
  label: 'a solid heavy box: ━ rules, ┃ columns',
  accent: { dark: '\x1b[91m', light: '\x1b[31m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '┃',
        topCaps: ['┏', '┓'],
        topUnit: '━',
        bottomCaps: ['┗', '┛'],
        bottomUnit: '━',
      },
      heavyTheme,
    );
  },
};

const blueprintTheme: CardTheme = {
  id: 'blueprint',
  label: 'drafting board: dashed ┄ rules, │ columns',
  accent: { dark: '\x1b[36m', light: '\x1b[34m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '│',
        topCaps: ['┌', '┐'],
        topUnit: '┄',
        bottomCaps: ['└', '┘'],
        bottomUnit: '┄',
      },
      blueprintTheme,
    );
  },
};

const blockTheme: CardTheme = {
  id: 'block',
  label: 'solid half-block bars: ▌▐ columns',
  accent: { dark: '\x1b[97m', light: '\x1b[30m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '▌',
        sideRight: '▐',
        topCaps: ['▛', '▜'],
        topUnit: '▀',
        bottomCaps: ['▙', '▟'],
        bottomUnit: '▄',
      },
      blockTheme,
    );
  },
};

const minimalTheme: CardTheme = {
  id: 'minimal',
  label: 'rule-only: two rules and the text between, no side columns',
  accent: { dark: '\x1b[90m', light: '\x1b[90m' },
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '',
        topCaps: ['', ''],
        topUnit: '─',
        bottomCaps: ['', ''],
        bottomUnit: '─',
      },
      minimalTheme,
    );
  },
};

const asciiTheme: CardTheme = {
  id: 'ascii',
  label: '7-bit only: + rules, | columns (never coloured)',
  accent: null,
  draw(ctx) {
    return drawFrame(
      ctx,
      {
        side: '|',
        topCaps: ['+', '+'],
        topUnit: '-',
        bottomCaps: ['+', '+'],
        bottomUnit: '-',
      },
      asciiTheme,
    );
  },
};

/**
 * The themes in registry order — zigzag first, the default; the round-3
 * themes (heavy, blueprint, block, minimal) follow the round-1 five so
 * existing ids keep their positions.
 */
export const CARD_THEMES: readonly CardTheme[] = [
  zigzagTheme,
  doubleTheme,
  roundedTheme,
  ornateTheme,
  heavyTheme,
  blueprintTheme,
  blockTheme,
  minimalTheme,
  asciiTheme,
];

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

export interface RenderCardOptions {
  width?: number;
  theme?: string;
  color: boolean;
  background?: CardBackground;
}

/** Split + wrap a description into theme sections at the frame's inner width. */
function themeSections(card: CardFile, inner: number): CardThemeSection[] {
  return splitSections(card.description).map((section) => ({
    heading: section.heading,
    body: section.body.split('\n').flatMap((line) => wrapDisplay(line, inner)),
  }));
}

/**
 * The full card as transcript lines: wrap the description to the theme's
 * inner width, then let the theme draw. `opts.width` overrides the card
 * header's width; both fall back to DEFAULT_CARD_WIDTH, clamped.
 * `opts.background` picks the accent variant (default dark).
 */
export function renderCardLines(card: CardFile, opts: RenderCardOptions): string[] {
  const width = clampCardWidth(opts.width ?? card.width);
  const theme = resolveCardTheme(opts.theme ?? card.theme);
  const inner = width - 6;
  return theme.draw(
    {
      name: card.name,
      title: card.title,
      subtitle: card.subtitle,
      sections: themeSections(card, inner),
      footer: card.footer,
      width,
      color: opts.color,
      background: opts.background ?? 'dark',
    },
  );
}

/**
 * The card as heading + text — NO frame glyphs at all: the a11y/reading
 * form. The DOM mirror and screen readers get title, subtitle, body
 * sections and footer as clean prose; never a box-drawing character.
 */
export function renderCardPlain(card: CardFile, opts: { width?: number; color: boolean }): string[] {
  const width = clampCardWidth(opts.width ?? card.width);
  const paint = (sgr: string, text: string): string => (opts.color && sgr !== '' ? sgr + text + SGR_RESET : text);
  const lines: string[] = [];
  lines.push(paint(SGR_BOLD_ON, card.title ?? card.name));
  if (card.subtitle !== null) lines.push(paint(SGR_ITALIC_ON, card.subtitle));
  let first = true;
  for (const section of splitSections(card.description)) {
    if (section.heading !== null) {
      lines.push('');
      lines.push(paint(SGR_BOLD_ON, section.heading));
    } else if (!first) {
      lines.push('');
    }
    first = false;
    for (const paragraph of section.body.split('\n')) {
      for (const line of wrapDisplay(paragraph, width)) lines.push(line);
    }
  }
  if (card.footer !== null) {
    lines.push('');
    lines.push(paint(SGR_DIM_ON, `— ${card.footer}`));
  }
  return lines;
}

/**
 * The built-in gallery sample — the card `render-card --themes` draws in
 * every registered theme so the frames compare like for like.
 */
export function galleryCard(): CardFile {
  return {
    name: 'render-card',
    title: 'Theme gallery',
    subtitle: 'one card, drawn in every theme',
    description:
      'The same content in each registered frame. Pick one with --theme <id>; narrow the frame with --width <n>.\n' +
      '## Reading mode\n' +
      'render-card --plain prints this card with no frame glyphs at all.',
    footer: 'render-card --themes',
    theme: null,
    width: null,
    warnings: [],
  };
}
