/**
 * cards plugin — display-width aware text layout.
 *
 * Terminal columns are not characters: CJK ideographs, Hangul and most
 * emoji render two cells wide, combining marks and zero-width characters
 * render none. The frame and the wrapper below measure in DISPLAY columns
 * so a card never spills past its border, whatever script the body uses.
 *
 * Pragmatic by design (no grapheme clustering): East Asian Wide/Fullwidth
 * and the common emoji blocks count 2, combining marks / ZWJ / variation
 * selectors count 0, everything else 1. Regional-indicator pairs (flags)
 * count 1 each so a flag pair totals the two cells it renders as; a lone
 * indicator is a degenerate input. Documented limitation, not a bug.
 */

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Misc emoji (faces, hands)
  [0x1f680, 0x1f6ff], // Transport
  [0x1f900, 0x1f9ff], // Supplemental symbols
  [0x1fa70, 0x1faff], // Extended-A symbols
  [0x20000, 0x2fffd], // CJK Ext B-F
  [0x30000, 0x3fffd],
];

const ZERO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // Combining diacritics
  [0x0483, 0x0489], // Combining Cyrillic
  [0x0591, 0x05bd], // Hebrew points (common case)
  [0x064b, 0x065f], // Arabic diacritics
  [0x200b, 0x200f], // Zero-width space/marks, RLM/LRM
  [0x200d, 0x200d], // ZWJ
  [0x2060, 0x2064], // Word joiner etc.
  [0x20d0, 0x20f0], // Combining symbols
  [0xfe00, 0xfe0f], // Variation selectors
  [0xfeff, 0xfeff], // BOM
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/** Display columns of one code point. */
export function codePointWidth(cp: number): number {
  if (inRanges(cp, ZERO_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

const SGR_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

/** The text without ANSI SGR (escape) sequences. */
export function stripSgr(text: string): string {
  return text.replace(SGR_PATTERN, '');
}

/** Display columns of a string, SGR sequences excluded. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of stripSgr(text)) width += codePointWidth(ch.codePointAt(0)!);
  return width;
}

/** Cut to at most max display columns; a cut never splits a surrogate pair. */
export function truncateDisplay(text: string, max: number): string {
  if (max < 1) return '';
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = codePointWidth(ch.codePointAt(0)!);
    if (width + w > max) break;
    out += ch;
    width += w;
  }
  return out;
}

/** Pad with spaces to exactly max display columns (overlong input truncated). */
export function padDisplay(text: string, max: number): string {
  return truncateDisplay(text, max) + ' '.repeat(Math.max(0, max - displayWidth(text)));
}

/**
 * Word-wrap one line (no \n inside) to max display columns. Words break on
 * spaces; a CJK/emoji run breaks between any two wide characters; an
 * unbreakable narrow run longer than max hard-breaks at the column edge.
 * Empty input wraps to one empty line. Never returns a line wider than max.
 */
export function wrapDisplay(text: string, max: number): string[] {
  const limit = Math.max(1, max);
  if (text === '') return [''];

  type Atom = { text: string; width: number; breakBefore: boolean };
  const atoms: Atom[] = [];
  let narrowRun = '';
  let narrowWidth = 0;
  const flushRun = (): void => {
    if (narrowRun !== '') {
      atoms.push({ text: narrowRun, width: narrowWidth, breakBefore: false });
      narrowRun = '';
      narrowWidth = 0;
    }
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const w = codePointWidth(cp);
    if (w === 0) {
      // Combining marks glue onto the preceding character wherever it sits.
      if (narrowRun !== '') narrowRun += ch;
      else if (atoms.length > 0) atoms[atoms.length - 1]!.text += ch;
      continue;
    }
    if (w === 1) {
      if (ch === ' ') {
        flushRun();
        atoms.push({ text: ' ', width: 1, breakBefore: true });
      } else {
        narrowRun += ch;
        narrowWidth += 1;
      }
      continue;
    }
    // Wide character: its own atom, breakable on both sides.
    flushRun();
    atoms.push({ text: ch, width: w, breakBefore: true });
  }
  flushRun();

  const lines: string[] = [];
  const push = (s: string): void => {
    lines.push(s.replace(/ +$/, '')); // no trailing spaces at a break
  };
  let line = '';
  let lineWidth = 0;
  for (const atom of atoms) {
    if (atom.breakBefore) {
      // Whitespace or wide char: never starts a line with spaces, break freely.
      if (atom.text === ' ') {
        if (line !== '' && lineWidth + 1 <= limit) {
          line += ' ';
          lineWidth += 1;
        }
        continue;
      }
      if (line !== '' && lineWidth + atom.width <= limit) {
        line += atom.text;
        lineWidth += atom.width;
        continue;
      }
      if (line !== '') {
        push(line);
        line = '';
        lineWidth = 0;
      }
      // A wide atom is one glyph — it cannot split. A limit below its width
      // is a degenerate call; the glyph renders on a line of its own.
      line = atom.text;
      lineWidth = atom.width;
      continue;
    }
    // Narrow run: append whole, else start a new line with it, else hard-slice.
    if (lineWidth + atom.width <= limit) {
      line += atom.text;
      lineWidth += atom.width;
      continue;
    }
    if (line !== '') {
      lines.push(line);
      line = '';
      lineWidth = 0;
    }
    let rest = atom.text;
    while (displayWidth(rest) > limit) {
      const head = truncateDisplay(rest, limit);
      lines.push(head);
      rest = rest.slice(head.length);
    }
    line = rest;
    lineWidth = displayWidth(rest);
  }
  lines.push(line);
  return lines;
}
