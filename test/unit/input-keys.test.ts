// Unit spec — key normalization and the chord grammar
// (src/terminal/input/keys.ts, CORE-V2 §7.1). Plain Node, no DOM: the
// KeyboardEvent is just a shape.
//
// Feature: normalizeKey
//   Scenario: printable characters stay themselves, flags ride along
//   Scenario: named keys canonicalize; Space comes from ' '
//   Scenario: aliases are not accepted from the DOM (only the grammar has them)
//   Scenario: modifier-only keydowns, Dead and Unidentified are not KeyEvents
//   Scenario: Ctrl/Alt chords derive a layout-stable base from the key code
// Feature: parseKeyToken
//   Scenario: bare printable chars, bare v1 names, bracketed names, aliases
//   Scenario: chords compose in any order and lower the Ctrl letter
//   Scenario: '+' as a base char parses ('<+>', '<Ctrl++>')
//   Scenario: unknown names and empty tokens throw InputSpecError
// Feature: describeKey round-trips through parseKeyToken
// Feature: parseSendKeys
//   Scenario: literal segments type char by char, spaces become Space
//   Scenario: <…> tokens interleave with literals
//   Scenario: '<<' escapes a literal '<'; '<' with no '>' is literal
//   Scenario: a well-formed token that does not parse throws with the offset

import { describe, expect, it } from 'vitest';
import {
  InputSpecError,
  NAMED_KEYS,
  describeKey,
  normalizeKey,
  parseKeyToken,
  parseSendKeys,
} from '../../src/terminal/input/keys.js';
import type { RawKeyEvent } from '../../src/terminal/input/types.js';

const key = (overrides: Partial<RawKeyEvent>): RawKeyEvent => ({
  key: '',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

const bare = (k: string): RawKeyEvent => key({ key: k });

describe('normalizeKey', () => {
  it('keeps printable characters as themselves, flags riding along', () => {
    expect(normalizeKey(bare('a'))).toEqual({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
    expect(normalizeKey(key({ key: '?', shiftKey: true }))).toMatchObject({ key: '?', shift: true });
    expect(normalizeKey(bare('Ö'))).toMatchObject({ key: 'Ö' });
  });

  it('canonicalizes named keys; Space comes from " "', () => {
    for (const name of ['Enter', 'Escape', 'Backspace', 'Delete', 'Tab', 'ArrowUp', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'F1', 'F12']) {
      expect(normalizeKey(bare(name))?.key).toBe(name);
    }
    expect(normalizeKey(bare(' '))).toMatchObject({ key: 'Space' });
    expect(normalizeKey(key({ key: 'ArrowDown', shiftKey: true }))).toEqual({
      key: 'ArrowDown', ctrl: false, alt: false, shift: true, meta: false,
    });
  });

  it('does not take grammar aliases from the DOM — the DOM speaks canonical names', () => {
    expect(normalizeKey(bare('Down'))).toBeNull(); // alias lives in the grammar, not on KeyboardEvent
    expect(normalizeKey(bare('PgDn'))).toBeNull();
    expect(normalizeKey(bare('Esc'))).toBeNull();
  });

  it('drops modifier-only keydowns, Dead, Process and Unidentified', () => {
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified']) {
      expect(normalizeKey(bare(k))).toBeNull();
    }
    expect(normalizeKey(key({ key: '' }))).toBeNull();
  });

  it('derives a layout-stable base for Ctrl/Alt chords from the key code', () => {
    // macOS Alt+O delivers 'ø' — the chord is physical, so the code wins.
    expect(normalizeKey(key({ key: 'ø', code: 'KeyO', altKey: true }))).toMatchObject({ key: 'o', alt: true });
    expect(normalizeKey(key({ key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true }))).toMatchObject({
      key: 'l', ctrl: true, shift: true,
    });
    expect(normalizeKey(key({ key: '5', code: 'Digit5', ctrlKey: true }))).toMatchObject({ key: '5', ctrl: true });
    // Punctuation chords via code: Alt+. is the v1 "repeat argument" chord.
    expect(normalizeKey(key({ key: '>', code: 'Period', altKey: true, shiftKey: true }))).toMatchObject({
      key: '.', alt: true, shift: true,
    });
    // Without a code, fall back to lowercasing a letter; other chars pass through.
    expect(normalizeKey(key({ key: 'G', ctrlKey: true }))).toMatchObject({ key: 'g', ctrl: true });
    expect(normalizeKey(key({ key: '~', altKey: true }))).toMatchObject({ key: '~', alt: true });
  });

  it('lets the ContextMenu key through normalization — the model intercepts it', () => {
    expect(normalizeKey(bare('ContextMenu'))).toMatchObject({ key: 'ContextMenu' });
  });
});

describe('parseKeyToken', () => {
  it('parses bare chars, bare v1 names, bracketed names and aliases', () => {
    expect(parseKeyToken('a')).toMatchObject({ key: 'a', ctrl: false, alt: false, shift: false, meta: false });
    expect(parseKeyToken('?')).toMatchObject({ key: '?' });
    expect(parseKeyToken('Enter')).toMatchObject({ key: 'Enter' }); // v1 playback vocabulary
    expect(parseKeyToken('<Enter>')).toMatchObject({ key: 'Enter' });
    expect(parseKeyToken('<Down>')).toMatchObject({ key: 'ArrowDown' });
    expect(parseKeyToken('<PgDn>')).toMatchObject({ key: 'PageDown' });
    expect(parseKeyToken('<Esc>')).toMatchObject({ key: 'Escape' });
    expect(parseKeyToken('pgup')).toMatchObject({ key: 'PageUp' }); // case-insensitive names
    expect(parseKeyToken('<Space>')).toMatchObject({ key: 'Space' });
  });

  it('composes chords in any order and lowers the Ctrl letter', () => {
    expect(parseKeyToken('<Ctrl+L>')).toEqual({ key: 'l', ctrl: true, alt: false, shift: false, meta: false });
    expect(parseKeyToken('<Shift+Tab>')).toMatchObject({ key: 'Tab', shift: true });
    expect(parseKeyToken('Ctrl+Shift+P')).toMatchObject({ key: 'p', ctrl: true, shift: true });
    expect(parseKeyToken('<Alt+.>')).toMatchObject({ key: '.', alt: true });
    expect(parseKeyToken('<Shift+Ctrl+Alt+F3>')).toMatchObject({ key: 'F3', shift: true, ctrl: true, alt: true });
  });

  it('parses "+" as a base character', () => {
    expect(parseKeyToken('<+>')).toMatchObject({ key: '+' });
    expect(parseKeyToken('<Ctrl++>')).toMatchObject({ key: '+', ctrl: true });
  });

  it('throws InputSpecError on junk', () => {
    expect(() => parseKeyToken('')).toThrow(InputSpecError);
    expect(() => parseKeyToken('<')).toThrow(InputSpecError);
    expect(() => parseKeyToken('<>')).toThrow(InputSpecError);
    expect(() => parseKeyToken('<Ctrl>')).toThrow(InputSpecError);
    expect(() => parseKeyToken('<Bogus>')).toThrow(InputSpecError);
    expect(() => parseKeyToken('Not a key at all')).toThrow(InputSpecError);
  });
});

describe('describeKey round-trips through parseKeyToken', () => {
  const samples = [
    { key: 'a', ctrl: false, alt: false, shift: false, meta: false },
    { key: '?', ctrl: false, alt: false, shift: true, meta: false },
    { key: 'l', ctrl: true, alt: false, shift: false, meta: false },
    { key: '.', alt: true, ctrl: false, shift: false, meta: false },
    { key: 'Tab', ctrl: false, alt: false, shift: true, meta: false },
    { key: 'Enter', ctrl: false, alt: false, shift: false, meta: false },
    { key: 'ArrowDown', ctrl: true, alt: false, shift: true, meta: false },
    { key: 'Space', ctrl: true, alt: false, shift: false, meta: false },
    { key: 'F5', ctrl: false, alt: true, shift: false, meta: false },
    { key: 'x', ctrl: false, alt: false, shift: false, meta: true },
  ];
  it('for every sample: describe → parse is the identity', () => {
    for (const ev of samples) {
      expect(parseKeyToken(describeKey(ev))).toEqual(ev);
    }
  });
  it('names every canonical key', () => {
    for (const name of NAMED_KEYS) {
      expect(parseKeyToken(`<${name}>`).key).toBe(name);
    }
  });
});

describe('parseSendKeys', () => {
  it('types literal segments char by char; spaces become Space', () => {
    expect(parseSendKeys('ls -l')).toEqual([
      { key: 'l' }, { key: 's' }, { key: 'Space' }, { key: '-' }, { key: 'l' },
    ].map((e) => ({ ...e, ctrl: false, alt: false, shift: false, meta: false })));
  });

  it('interleaves literals and tokens', () => {
    const events = parseSendKeys('bat demo/example-deck.sem.html<Enter>');
    expect(events.slice(0, 4).map((e) => e.key)).toEqual(['b', 'a', 't', 'Space']);
    expect(events.at(-1)).toEqual({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false });
    expect(parseSendKeys('<Down><Down><PgDn>').map((e) => e.key)).toEqual(['ArrowDown', 'ArrowDown', 'PageDown']);
  });

  it('escapes a literal "<" with "<<" and keeps an unterminated "<" literal', () => {
    expect(parseSendKeys('a<<b').map((e) => e.key)).toEqual(['a', '<', 'b']);
    expect(parseSendKeys('a<b').map((e) => e.key)).toEqual(['a', '<', 'b']);
  });

  it('throws with the spec offset on a malformed token', () => {
    try {
      parseSendKeys('ab<Bogus>cd');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InputSpecError);
      expect((error as InputSpecError).position).toBe(2);
    }
  });

  it('parses the empty spec to no events', () => {
    expect(parseSendKeys('')).toEqual([]);
  });
});
