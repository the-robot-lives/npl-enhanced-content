/**
 * ansi/sgr — SGR (Select Graphic Rendition, `ESC[…m`) parameter semantics.
 *
 * `applySgr` folds one sequence's parameter groups into the next attribute
 * snapshot. Snapshots are frozen and shared by reference: a span rendered
 * before the next SGR keeps the attributes it was created with, and
 * renderers can hold a snapshot without copying. Unknown parameters are
 * consumed and ignored — never leaked into rendered text.
 *
 * Supported: 0 reset; 1 bold; 2 dim; 3 italic; 4 (and 4:n) underline; 5/6
 * blink; 7 reverse; 8 conceal; 9 strikeout; 21 (double underline → the one
 * DOM weight); 22–29 individual resets; 30–37/90–97 foreground;
 * 40–47/100–107 background; 38/48 extended colour (256-index and RGB, in
 * both the `38;5;n` semicolon and `38:5:n` colon forms); 58/59 underline
 * colour (parameters consumed, no DOM attribute yet).
 */

import { DEFAULT_SGR, type AnsiColor, type SgrAttrs } from './types.js';

/** One CSI parameter slot: a number, or null for an empty (`;`-doubled) slot. */
export type SgrParam = number | null;

/**
 * Split a CSI parameter body (`38;5;196`, `1;38:2::7;0;255`, ``) into
 * groups of slots. An empty body yields one empty group (SGR with no
 * parameters = reset, per ECMA-48). Malformed pieces become null slots —
 * applySgr ignores them instead of throwing.
 */
export function splitCsiParams(body: string): readonly (readonly SgrParam[])[] {
  if (body === '') return [[]];
  const groups: SgrParam[][] = [];
  for (const piece of body.split(';')) {
    if (piece === '') {
      groups.push([]);
      continue;
    }
    const slots: SgrParam[] = [];
    for (const sub of piece.split(':')) {
      if (sub === '') {
        slots.push(null);
        continue;
      }
      const n = Number(sub);
      slots.push(Number.isFinite(n) ? n : null);
    }
    groups.push(slots);
  }
  return groups;
}

const freezeColor = (color: AnsiColor): AnsiColor => Object.freeze(color);

const named = (code: number): AnsiColor => freezeColor({ kind: 'named', code });
const indexed = (n: number): AnsiColor => freezeColor({ kind: 'indexed', n });
const rgb = (r: number, g: number, b: number): AnsiColor => freezeColor({ kind: 'rgb', r, g, b });

const inByteRange = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= 255;

/**
 * Parse an extended colour (SGR 38 foreground / 48 background / 58
 * underline colour) starting at group `i`. Returns the colour (null when
 * the parameters are malformed — the sequence is consumed, colour kept)
 * and how many groups were consumed.
 *
 * Colon form: `38:5:n` or `38:2:[cs]:r:g:b` — everything in one group; a
 * colourspace slot (xterm's `38:2::r:g:b`) is skipped by taking the last
 * three slots as r,g,b.
 * Semicolon form: `38;5;n` / `38;2;r;g;b` — the mode and values live in
 * the following groups; a broken mode consumes the 38 and the mode so the
 * remaining groups still parse as plain SGRs.
 */
function extendedColor(
  groups: readonly (readonly SgrParam[])[],
  i: number,
): { color: AnsiColor | null; consumed: number } {
  const g = groups[i];
  if (g.length >= 2) {
    const mode = g[1];
    if (mode === 5 && inByteRange(g[2] ?? null)) return { color: indexed(g[2] as number), consumed: 1 };
    if (mode === 2 && g.length >= 5) {
      const tail = g.slice(g.length - 3);
      if (tail.every(inByteRange)) {
        return { color: rgb(tail[0] as number, tail[1] as number, tail[2] as number), consumed: 1 };
      }
    }
    return { color: null, consumed: 1 };
  }
  const mode = groups[i + 1]?.[0] ?? null;
  if (mode === 5) {
    const n = groups[i + 2]?.[0] ?? null;
    return { color: inByteRange(n) ? indexed(n) : null, consumed: 3 };
  }
  if (mode === 2) {
    const slots = [groups[i + 2]?.[0] ?? null, groups[i + 3]?.[0] ?? null, groups[i + 4]?.[0] ?? null];
    return { color: slots.every(inByteRange) ? rgb(slots[0] as number, slots[1] as number, slots[2] as number) : null, consumed: 5 };
  }
  // Missing or invalid mode: consume the 38 plus a mode slot when present,
  // so a following `31` cannot be misread as part of the broken sequence.
  return { color: null, consumed: groups.length > i + 1 ? 2 : 1 };
}

/**
 * Fold one SGR sequence's parameter groups into the next (frozen) snapshot.
 * `ESC[m` and a leading empty parameter both mean SGR 0 (reset); after a
 * reset the remaining parameters in the same sequence still apply.
 */
export function applySgr(prev: SgrAttrs, groups: readonly (readonly SgrParam[])[]): SgrAttrs {
  let a = prev;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const base = g.length === 0 ? 0 : (g[0] ?? 0);
    switch (base) {
      case 0:
        a = DEFAULT_SGR;
        continue;
      case 1: a = { ...a, bold: true }; break;
      case 2: a = { ...a, dim: true }; break;
      case 3: a = { ...a, italic: true }; break;
      case 4:
        // Plain 4 = underline on; the colon form's first subparameter 0 turns it off.
        a = { ...a, underline: g.length > 1 ? g[1] !== 0 : true };
        break;
      case 5: a = { ...a, blink: true }; break;
      case 6: a = { ...a, rapidBlink: true }; break;
      case 7: a = { ...a, reverse: true }; break;
      case 8: a = { ...a, conceal: true }; break;
      case 9: a = { ...a, strikeout: true }; break;
      case 21:
        // ITU T.416 double underline; the DOM keeps a single underline weight.
        a = { ...a, underline: true };
        break;
      case 22: a = { ...a, bold: false, dim: false }; break;
      case 23: a = { ...a, italic: false }; break;
      case 24: a = { ...a, underline: false }; break;
      case 25: a = { ...a, blink: false, rapidBlink: false }; break;
      case 27: a = { ...a, reverse: false }; break;
      case 28: a = { ...a, conceal: false }; break;
      case 29: a = { ...a, strikeout: false }; break;
      case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
        a = { ...a, fg: named(base) };
        break;
      case 38: {
        const { color, consumed } = extendedColor(groups, i);
        if (color !== null) a = { ...a, fg: color };
        i += consumed - 1;
        break;
      }
      case 39: a = { ...a, fg: DEFAULT_SGR.fg }; break;
      case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
        a = { ...a, bg: named(base) };
        break;
      case 48: {
        const { color, consumed } = extendedColor(groups, i);
        if (color !== null) a = { ...a, bg: color };
        i += consumed - 1;
        break;
      }
      case 49: a = { ...a, bg: DEFAULT_SGR.bg }; break;
      case 58:
        // Underline colour: parameters consumed so they cannot leak; no DOM attribute yet.
        i += extendedColor(groups, i).consumed - 1;
        break;
      case 59: break; // default underline colour
      case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
        a = { ...a, fg: named(base) };
        break;
      case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
        a = { ...a, bg: named(base) };
        break;
      default:
        break; // unknown/unsupported parameter — consumed, never rendered
    }
  }
  return Object.freeze(a);
}
