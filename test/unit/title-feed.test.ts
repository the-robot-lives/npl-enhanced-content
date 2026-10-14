// Unit spec — src/terminal/title/title-feed.ts · OSC 0/1/2 titles + OSC 9 status (CORE-V2 §11.1)
//
// Feature: the title feed turns the parser's OSC tokens into the chrome's
//   two observables — title and status — and never touches the screen.
//   Scenario: OSC 0 sets title+icon, OSC 2 title only, OSC 1 icon only
//   Scenario: titles are sanitized (C0/DEL/C1 stripped) and capped at 200
//   Scenario: the v1 consume path parses an OSC split across writes
//   Scenario: OSC 9 one-part keeps the tone; toned forms set it
//   Scenario: the title stack saves and restores, depth-capped
//   Scenario: shell-side setTitle/setStatus mirror the feed
//   Scenario: subscribers get one notification per mutating call
//   Scenario: non-OSC tokens are ignored; reset returns to a fresh feed

import { describe, it, expect } from 'vitest';
import { AnsiStateMachine } from '../../src/terminal/ansi/index.js';
import {
  TitleFeed,
  TITLE_MAX_LENGTH,
  TITLE_STACK_CAP,
  sanitizeTitle,
} from '../../src/terminal/title/title-feed.js';

/** Run raw output through the real parser and feed the tokens to the feed. */
function feed(feedInstance: TitleFeed, raw: string): void {
  const machine = new AnsiStateMachine();
  feedInstance.feed(machine.write(raw));
}

describe('title-feed', () => {
  it('maps OSC 0 to title+icon, OSC 2 to title only, OSC 1 to icon only', () => {
    const t = new TitleFeed();
    feed(t, '\x1b]0;SemText — shell\x07');
    expect(t.title).toBe('SemText — shell');
    expect(t.iconName).toBe('SemText — shell');

    feed(t, '\x1b]2;window title\x1b\\'); // ST terminator
    expect(t.title).toBe('window title');
    expect(t.iconName).toBe('SemText — shell'); // OSC 2 leaves the icon alone

    feed(t, '\x1b]1;icon name\x07');
    expect(t.iconName).toBe('icon name');
    expect(t.title).toBe('window title'); // OSC 1 leaves the title alone
  });

  it('sanitizes control chars out of titles and caps the length at 200', () => {
    expect(sanitizeTitle('a\u0000b\u0007c\u001bd\u007fe\u009ff')).toBe('abcdef');
    expect(sanitizeTitle('x'.repeat(250)).length).toBe(TITLE_MAX_LENGTH);

    const t = new TitleFeed();
    feed(t, `\x1b]2;${'y'.repeat(500)}\x07`);
    expect(t.title.length).toBe(TITLE_MAX_LENGTH);
    // Non-ASCII printable text survives (accents are content, not controls).
    feed(t, '\x1b]2;naïve — ünicode\x07');
    expect(t.title).toBe('naïve — ünicode');
  });

  it('parses an OSC split across consume() writes exactly once', () => {
    const t = new TitleFeed();
    t.consume('building \x1b]2;se');
    expect(t.title).toBe(''); // not terminated yet — nothing set, nothing printed
    t.consume('mtext\x07 done');
    expect(t.title).toBe('semtext');
  });

  it('keeps the tone on a one-part OSC 9 and sets it on toned forms', () => {
    const t = new TitleFeed();
    feed(t, '\x1b]9;indexing 12 files\x07');
    expect(t.status).toEqual({ text: 'indexing 12 files', tone: 'idle' });

    feed(t, '\x1b]9;busy;indexing 34 more\x07');
    expect(t.status).toEqual({ text: 'indexing 34 more', tone: 'busy' });

    feed(t, '\x1b]9;done\x07'); // toneless — busy persists until told otherwise
    expect(t.status).toEqual({ text: 'done', tone: 'busy' });

    feed(t, '\x1b]9;alert;disk nearly full\x07');
    expect(t.status).toEqual({ text: 'disk nearly full', tone: 'alert' });

    feed(t, '\x1b]9;idle;idle;with;semicolons\x07');
    expect(t.status).toEqual({ text: 'idle;with;semicolons', tone: 'idle' });
  });

  it('saves and restores titles on the stack, depth-capped', () => {
    const t = new TitleFeed();
    t.setTitle('prompt');
    t.push();
    t.setTitle('npm install (running)');
    expect(t.pop()).toBe(true);
    expect(t.title).toBe('prompt');
    expect(t.pop()).toBe(false); // empty stack

    for (let i = 0; i < TITLE_STACK_CAP + 5; i++) t.push();
    expect(t.stackDepth).toBe(TITLE_STACK_CAP);
  });

  it('accepts shell-side setTitle/setStatus like the screen model does', () => {
    const t = new TitleFeed();
    t.setTitle('~/notes $');
    t.setStatus('direnv: loaded .envrc', 'busy');
    expect(t.title).toBe('~/notes $');
    expect(t.status).toEqual({ text: 'direnv: loaded .envrc', tone: 'busy' });
  });

  it('notifies once per mutating call and stops after unsubscribe', () => {
    const t = new TitleFeed();
    let count = 0;
    const off = t.subscribe(() => count++);

    feed(t, '\x1b]2;one\x1b\\\x1b]9;busy;working\x07'); // two changes, one batch
    expect(count).toBe(1);

    feed(t, '\x1b]2;one\x1b\\'); // no change — no notification
    expect(count).toBe(1);

    off();
    feed(t, '\x1b]2;two\x07');
    expect(count).toBe(1);
    expect(t.title).toBe('two'); // the change landed even with no listeners
  });

  it('ignores non-OSC tokens and other OSC codes; reset clears everything', () => {
    const t = new TitleFeed();
    let count = 0;
    t.subscribe(() => count++);

    const machine = new AnsiStateMachine();
    t.feed(machine.write('plain text \x1b[1mstyled\x1b[0m \x1b]8;;https://example.com\x1b\\link'));
    expect(count).toBe(0); // hyperlink (OSC 8) is not a chrome feed
    expect(t.title).toBe('');

    feed(t, '\x1b]2;somewhere\x07');
    expect(count).toBe(1);
    t.reset();
    expect(t.title).toBe('');
    expect(t.status).toEqual({ text: '', tone: 'idle' });
    expect(t.stackDepth).toBe(0);
  });
});
