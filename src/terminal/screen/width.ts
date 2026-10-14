/**
 * screen/width — the character-width table (CORE-V2 §4.1, §5.2).
 *
 * ONE width table for the whole terminal: the screen's grid math, the
 * cooked editor's cursor movement, and the canvas driver's glyph layout
 * all agree through it ("grid math and paint agree", §8.3).
 *
 * Returns the cell width of a base codepoint: 1 (narrow) or 2 (East Asian
 * Wide/Fullwidth). Width 0 (continuation cells) is a WRITER decision, not
 * a property of the character — the screen assigns 0 to the cell a wide
 * glyph's second half occupies. Combining marks are folded onto the
 * preceding cell (`isCombining`), never width-0 cells of their own.
 */

/** East Asian Wide + Fullwidth ranges (Unicode 15, the practical set). */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo leading consonants
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols (incl. 0x303F ideographic space edge)
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables + Jamo Extended-B
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms (ASCII block)
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji pictographs (wide in every real terminal)
  [0x1f900, 0x1f9ff], // Supplemental symbols
  [0x20000, 0x2fffd], // CJK Extension B+
  [0x30000, 0x3fffd],
];

/** Combining marks (Mn/Me essentials) — folded onto the previous cell. */
const COMBINING_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x0900, 0x0902],
  [0x093a, 0x093a],
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x1ab0, 0x1aff], // Combining Diacritical Extended
  [0x1dc0, 0x1dff], // Combining Diacritical Supplement
  [0x20d0, 0x20f0], // Combining Symbols
  [0xfe00, 0xfe0f], // Variation selectors
  [0xfe20, 0xfe2f], // Combining Half Marks
  [0x200b, 0x200f], // Zero-width space/marks (fold, never print)
];

const inRanges = (cp: number, ranges: readonly (readonly [number, number])[]): boolean => {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid] as [number, number];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
};

/** Combining mark? Folds onto the preceding cell (never its own cell). */
export function isCombining(cp: number): boolean {
  return inRanges(cp, COMBINING_RANGES);
}

/** Cell width of one base codepoint: 1 narrow, 2 East-wide. */
export function charWidth(cp: number): 1 | 2 {
  if (cp < 0x1100) return 1; // ASCII + Latin fast path
  return inRanges(cp, WIDE_RANGES) ? 2 : 1;
}

/** Text width in cells — the editor's cursor math over a string. */
export function stringWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCombining(cp)) continue;
    width += charWidth(cp);
  }
  return width;
}
