/**
 * keys — key normalization and the chord grammar (CORE-V2 §7.1, §7.5).
 *
 * Every physical keydown and every scripted key becomes one KeyEvent
 * { key, ctrl, alt, shift, meta } where `key` is a printable single
 * character as itself or a named key (Enter, Escape, Backspace, Delete,
 * Tab, Arrow*, Home, End, PageUp/PageDown, Insert, F1–F12, Space). Meta is
 * carried but reserved: nothing in v2 binds it.
 *
 * One string grammar names any of them — `sendKeys`, playback `key` steps
 * and documentation all speak it:
 *
 *     keyspec := chord? base
 *     chord   := ( "Ctrl+" | "Alt+" | "Shift+" )+
 *     base    := printable-char | "<" name ">"     "a", "?", "<Enter>",
 *                                                  "<Ctrl+L>", "<Alt+.>"
 *
 * Bracketed names accept the aliases the docs use (<Down>, <PgDn>, <Esc>)
 * and v1 playback's bare names (parseKeyToken('Enter') is the named key) so
 * scripts, the demo runner and tests cannot drift apart. parseSendKeys
 * throws InputSpecError on a malformed token — specs are authored
 * artifacts, and a silent mistyped key is a bug report waiting to happen.
 */

import { type KeyEvent, type Mods, type RawKeyEvent } from './types.js';

/** The canonical named keys. ContextMenu is chrome-only (§7.3): the input model intercepts it. */
export const NAMED_KEYS: ReadonlySet<string> = new Set([
  'Enter', 'Escape', 'Backspace', 'Delete', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Space', 'ContextMenu',
]);

/** Spoken aliases → canonical names, case-insensitive. */
const ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  cr: 'Enter',
  return: 'Enter',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  spacebar: 'Space',
  ...Object.fromEntries([...NAMED_KEYS].map((k) => [k.toLowerCase(), k])),
};

/** DOM key values that are the modifier keys themselves — never KeyEvents. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
]);

/** Modifier keys for the chord grammar (accept the common spellings). */
const CHORD_WORDS: Readonly<Record<string, keyof Mods>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  opt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/** `KeyA` → 'a', `Digit3` → '3', `Period` → '.' — the physical base for Ctrl/Alt chords. */
function baseFromCode(code: string | undefined): string | null {
  if (!code) return null;
  if (code.startsWith('Key')) {
    const ch = code.slice(3);
    return ch.length === 1 && /[A-Z]/.test(ch) ? ch.toLowerCase() : null;
  }
  if (code.startsWith('Digit')) {
    const ch = code.slice(5);
    return ch.length === 1 && ch >= '0' && ch <= '9' ? ch : null;
  }
  const PUNCT: Readonly<Record<string, string>> = {
    Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
    Backquote: '`', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
    Space: ' ', IntlBackslash: '\\',
  };
  return PUNCT[code] ?? null;
}

/** A DOM KeyboardEvent-shaped value → KeyEvent, or null when it is not a key. */
export function normalizeKey(ev: RawKeyEvent): KeyEvent | null {
  const k = ev.key;
  if (k === '' || k === 'Unidentified' || k === 'Dead' || k === 'Process') return null;
  if (MODIFIER_KEYS.has(k)) return null; // the modifier keydown itself
  const mods: Mods = { ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey, meta: ev.metaKey };
  // DOM events speak canonical names only — aliases (Down, PgDn, Esc) live
  // in the grammar (parseKeyToken), never in KeyboardEvent.key.
  const named = k === ' ' ? 'Space' : NAMED_KEYS.has(k) ? k : null;
  if (named) return { key: named, ...mods };
  if (k.length === 1) {
    if (!mods.ctrl && !mods.alt) return { key: k, ...mods }; // as typed — layout stays honest
    // Ctrl/Alt held: browsers deliver layout-composed chars (Alt+O is 'ø' on
    // macOS). Chords are physical, so derive the base from the key's code.
    const base = baseFromCode(ev.code) ?? (/[a-zA-Z]/.test(k) ? k.toLowerCase() : k);
    return { key: base, ...mods };
  }
  return null; // unknown named key (media keys, IME internals) — not a KeyEvent
}

/** A parse failure with the offset it failed at. */
export class InputSpecError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
    this.name = 'InputSpecError';
  }
}

/**
 * Parse ONE key token: a bare printable char, a bare canonical/alias name
 * ('Enter', 'PgDn'), or a bracketed chord ('<Ctrl+Shift+Tab>', '<Alt+.>').
 * Throws InputSpecError on anything else.
 */
export function parseKeyToken(token: string): KeyEvent {
  const s = token.trim();
  if (s === '') throw new InputSpecError('empty key spec', 0);
  let body = s;
  if (s.startsWith('<')) {
    if (!s.endsWith('>') || s.length < 3) throw new InputSpecError(`unterminated <…> key token: ${s}`, 0);
    body = s.slice(1, -1);
  }
  const mods: Mods = { ctrl: false, alt: false, shift: false, meta: false };
  let rest = body;
  for (;;) {
    const plus = rest.indexOf('+');
    if (plus === -1) break;
    const word = rest.slice(0, plus).trim().toLowerCase();
    const flag = CHORD_WORDS[word];
    if (!flag) break; // not a modifier — the '+' belongs to the base char ('<+>', '<Ctrl++>')
    mods[flag] = true;
    rest = rest.slice(plus + 1);
  }
  if (rest === '') throw new InputSpecError(`missing key name in "${token}"`, 0);
  if (rest.length === 1) {
    if (mods.ctrl && /[a-z]/i.test(rest)) rest = rest.toLowerCase(); // Ctrl+L means ctrl + 'l'
    return rest === ' ' ? { key: 'Space', ...mods } : { key: rest, ...mods };
  }
  const canonical = ALIASES[rest.toLowerCase()];
  if (!canonical) throw new InputSpecError(`unknown key name "${rest}" in "${token}"`, 0);
  return { key: canonical, ...mods };
}

/** The canonical spelling of a KeyEvent — parseKeyToken(describeKey(k)) round-trips. */
export function describeKey(ev: KeyEvent): string {
  const chord =
    (ev.ctrl ? 'Ctrl+' : '') + (ev.alt ? 'Alt+' : '') + (ev.shift ? 'Shift+' : '') + (ev.meta ? 'Meta+' : '');
  if (chord !== '') return `<${chord}${ev.key}>`;
  return NAMED_KEYS.has(ev.key) ? `<${ev.key}>` : ev.key;
}

function charKey(ch: string): KeyEvent {
  return ch === ' ' ? { key: 'Space', ctrl: false, alt: false, shift: false, meta: false } : { key: ch, ctrl: false, alt: false, shift: false, meta: false };
}

/**
 * Parse a full sendKeys spec (CORE-V2 §7.5): literal segments type as
 * chars, `<…>` tokens are keys, `<<` escapes a literal '<'. A '<' with no
 * closing '>' anywhere after it is literal (someone typing 'a<b' is not a
 * key spec); a well-formed token that does not parse throws InputSpecError.
 */
export function parseSendKeys(spec: string): KeyEvent[] {
  const out: KeyEvent[] = [];
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (ch === '<') {
      if (spec[i + 1] === '<') {
        out.push(charKey('<'));
        i += 2;
        continue;
      }
      const close = spec.indexOf('>', i);
      if (close !== -1) {
        const token = spec.slice(i, close + 1);
        try {
          out.push(parseKeyToken(token));
        } catch (error) {
          const at = i + (error instanceof InputSpecError ? error.position : 0);
          throw new InputSpecError(`sendKeys: ${(error as Error).message}`, at);
        }
        i = close + 1;
        continue;
      }
      out.push(charKey('<')); // no '>' ever follows — literal
      i += 1;
      continue;
    }
    out.push(charKey(ch));
    i += 1;
  }
  return out;
}
