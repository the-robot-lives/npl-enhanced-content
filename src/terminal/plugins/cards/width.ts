/**
 * cards plugin — display-width aware text layout.
 *
 * MEASUREMENT is delegated to the screen model's one width table
 * (`screen/width.ts`, CORE-V2 §4.1/§8.3: "grid math and paint agree") — a
 * card is measured exactly like everything else the terminal prints. This
 * module keeps only the LAYOUT helpers the card frame needs: SGR-stripping
 * width/truncate/pad and the display-column wrapper.
 *
 * Terminal columns are not characters: CJK ideographs, Hangul and most
 * emoji render two cells wide, combining marks fold onto the previous cell
 * and render none. The frame and the wrapper below measure in DISPLAY
 * columns so a card never spills past its border, whatever script the body
 * uses. Pragmatic by design (no grapheme clustering): a lone regional
 * indicator or a ZWJ emoji sequence may measure short — the documented
 * screen-model limitation, shared, not a cards bug.
 */

import { charWidth, isCombining } from '../../screen/width.js';

/**
 * Display columns of one code point, under the screen model's table.
 * Combining marks count 0 (they fold onto the preceding cell); wide
 * glyphs count 2; everything else 1.
 */
export function codePointWidth(cp: number): number {
  if (isCombining(cp)) return 0;
  return charWidth(cp);
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
