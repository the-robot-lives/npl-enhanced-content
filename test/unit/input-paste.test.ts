// Unit spec — the paste/copy pipeline (src/terminal/input/paste.ts,
// CORE-V2 §7.4). No DOM: the copy ladder runs against injected transports.
//
// Feature: multiline detection
//   Scenario: LF, CRLF and CR all count
// Feature: markPastedNewlines
//   Scenario: every newline flavor becomes the visible ⏎ token
//   Scenario: single-line text passes through untouched
// Feature: pasteForCooked
//   Scenario: single-line pastes stay verbatim; multiline pastes bracket
// Feature: copyText
//   Scenario: clipboard write wins when it resolves
//   Scenario: a clipboard rejection falls through to the hidden-input copy
//   Scenario: with no transport the copy fails honestly (false)

import { describe, expect, it } from 'vitest';
import {
  PASTE_MARK,
  copyText,
  isMultiline,
  markPastedNewlines,
  pasteForCooked,
} from '../../src/terminal/input/paste.js';

describe('multiline detection', () => {
  it('counts LF, CRLF and CR', () => {
    expect(isMultiline('plain')).toBe(false);
    expect(isMultiline('a\nb')).toBe(true);
    expect(isMultiline('a\r\nb')).toBe(true);
    expect(isMultiline('a\rb')).toBe(true);
    expect(isMultiline('')).toBe(false);
  });
});

describe('markPastedNewlines', () => {
  it('turns every newline flavor into the visible token', () => {
    expect(markPastedNewlines('a\nb')).toBe(`a${PASTE_MARK}b`);
    expect(markPastedNewlines('a\r\nb\rc\nd')).toBe(`a${PASTE_MARK}b${PASTE_MARK}c${PASTE_MARK}d`);
  });
  it('leaves single-line text alone', () => {
    expect(markPastedNewlines('no newlines')).toBe('no newlines');
  });
});

describe('pasteForCooked', () => {
  it('keeps single-line pastes verbatim', () => {
    expect(pasteForCooked('ls -l')).toEqual({ text: 'ls -l', multiline: false });
  });
  it('brackets multiline pastes so a blob can never auto-execute', () => {
    const out = pasteForCooked('mkdir demo\ncd demo\nls');
    expect(out.multiline).toBe(true);
    expect(out.text).toBe(`mkdir demo${PASTE_MARK}cd demo${PASTE_MARK}ls`);
    expect(out.text).not.toContain('\n');
  });
});

describe('copyText', () => {
  it('uses the clipboard transport when it resolves', async () => {
    const written: string[] = [];
    const ok = await copyText('copied', {
      writeText: async (text) => {
        written.push(text);
      },
    });
    expect(ok).toBe(true);
    expect(written).toEqual(['copied']);
  });

  it('falls through to the hidden-input copy on a clipboard rejection', async () => {
    let execRan = false;
    const ok = await copyText('copied', {
      writeText: async () => {
        throw new Error('NotAllowedError'); // file:// permission denied
      },
      execCommandCopy: () => {
        execRan = true;
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(execRan).toBe(true);
  });

  it('fails honestly when every transport is gone', async () => {
    expect(await copyText('copied', {})).toBe(false);
    const ok = await copyText('copied', {
      writeText: async () => {
        throw new Error('no');
      },
      execCommandCopy: () => false, // execCommand refused too
    });
    expect(ok).toBe(false);
  });
});
