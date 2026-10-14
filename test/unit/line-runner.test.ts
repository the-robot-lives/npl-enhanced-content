// Unit spec — line discipline + app runner (CORE-V2 §5, §6)
//
// Feature: the cooked editor
//   Scenario: up stashes the draft; down past newest restores it
//   Scenario: the control table moves caret and kills text
//   Scenario: Ctrl+C abandons the line; Ctrl+D on empty is a no-op
//   Scenario: Ctrl+L clears the viewport through the host
//   Scenario: Enter submits through onLine after history lands
// Feature: the runner
//   Scenario: spawn brackets start; exit tears down in order
//   Scenario: a crashing stop still restores the primary and reports
//   Scenario: Ctrl+C exits 130; a second spawn is refused while live

import { describe, it, expect } from 'vitest';
import { CookedLine, RawLine, abbreviateHome } from '../../src/terminal/line/discipline.js';
import { AppRunner } from '../../src/terminal/app/runner.js';
import { Screen } from '../../src/terminal/screen/screen.js';
import { ScreenFeed } from '../../src/terminal/screen/feed.js';
import type { TerminalCore } from '../../src/terminal/terminal-core.js';
import type { App, AppContext, KeyEvent } from '../../src/terminal/screen/types.js';

const key = (k: string, ctrl = false): KeyEvent => ({ key: k, ctrl, alt: false, shift: false, meta: false });

const type = (cooked: CookedLine, text: string): void => {
  for (const ch of text) cooked.key(key(ch));
};

describe('the cooked editor', () => {
  const make = () => {
    const cleared: number[] = [];
    const lines: string[] = [];
    const cooked = new CookedLine(
      { emit: () => {}, clearViewport: () => cleared.push(1) },
      () => null as unknown as TerminalCore,
      () => '~',
    );
    return { cooked, cleared, lines };
  };

  it('up stashes the draft; down past newest restores it', () => {
    const { cooked } = make();
    type(cooked, 'first');
    cooked.key(key('Enter'));
    type(cooked, 'draft');
    cooked.key(key('ArrowUp'));
    expect(cooked.buffer).toBe('first');
    cooked.key(key('ArrowDown')); // past newest → draft back
    expect(cooked.buffer).toBe('draft');
  });

  it('the control table moves the caret and kills text', () => {
    const { cooked } = make();
    type(cooked, 'hello world');
    cooked.key(key('a', true));
    expect(cooked.caret).toBe(0);
    cooked.key(key('e', true));
    expect(cooked.caret).toBe(cooked.buffer.length);
    cooked.key(key('w', true)); // caret at end: kill the last word back
    expect(cooked.buffer).toBe('hello ');
    cooked.key(key('u', true));
    expect(cooked.buffer).toBe('');
  });

  it('Ctrl+C abandons the line; Ctrl+D on empty is a no-op', () => {
    const { cooked } = make();
    type(cooked, 'doomed');
    expect(cooked.key(key('c', true))).toBe(true);
    expect(cooked.buffer).toBe('');
    expect(cooked.key(key('d', true))).toBe(true);
    expect(cooked.buffer).toBe(''); // no-op, never EOF
    type(cooked, 'xy');
    cooked.key(key('a', true)); // caret home → D deletes forward
    cooked.key(key('d', true));
    expect(cooked.buffer).toBe('y');
  });

  it('Ctrl+L clears the viewport through the host', () => {
    const { cooked, cleared } = make();
    expect(cooked.key(key('l', true))).toBe(true);
    expect(cleared).toHaveLength(1);
  });

  it('Enter submits through onLine after history lands', () => {
    const seen: string[] = [];
    const cooked = new CookedLine(
      { emit: () => {}, clearViewport: () => {} },
      () => null as unknown as TerminalCore,
      () => '~',
      () => {},
      (line) => seen.push(line),
    );
    type(cooked, 'echo hi');
    cooked.key(key('Enter'));
    expect(seen).toEqual(['echo hi']);
    expect(cooked.buffer).toBe('');
    cooked.key(key('ArrowUp'));
    expect(cooked.buffer).toBe('echo hi');
  });

  it('abbreviateHome folds $HOME to ~ only at a path boundary', () => {
    expect(abbreviateHome('/home/t/src', '/home/t')).toBe('~/src');
    expect(abbreviateHome('/home/other', '/home/t')).toBe('/home/other');
    expect(abbreviateHome('/home/t', '/home/t')).toBe('~');
  });
});

describe('the runner', () => {
  const makeApp = () => {
    const calls: string[] = [];
    const box: { api: AppContext | null } = { api: null };
    const app: App = {
      id: 'fake-app',
      start: (context) => {
        box.api = context;
        calls.push('start');
      },
      stop: () => {
        calls.push('stop');
      },
      key: () => {
        calls.push('key');
      },
      paste: () => {
        calls.push('paste');
      },
      mouse: () => {
        calls.push('mouse');
      },
      resize: () => {
        calls.push('resize');
      },
    };
    return { app, calls, box };
  };

  it('spawn brackets start; exit tears down in order', () => {
    const screen = new Screen({ scrollback: 100 });
    const feed = new ScreenFeed(screen);
    const raw = new RawLine();
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(feed, screen, raw, (code, crash) => exits.push([code, crash]));
    const run = makeApp();
    const app = run.app;
    const calls = run.calls;
    expect(runner.spawn(app)).toBe(true);
    expect(runner.active).toBe(true);
    expect(calls).toEqual(['start']);
    runner.key(key('q'));
    expect(calls).toContain('key');
    run.box.api!.exit(0); // the app asks out through its context
    expect(exits).toEqual([[0, null]]);
    expect(runner.active).toBe(false);
    expect(calls).toContain('stop');
    expect(screen.altScreen).toBe(false);
  });

  it('a crashing stop still restores the primary and reports', () => {
    const screen = new Screen({ scrollback: 100 });
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(new ScreenFeed(screen), screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    const boom = makeApp();
    (boom.app as { stop: () => void }).stop = () => {
      throw new Error('stop blew up');
    };
    expect(runner.spawn(boom.app)).toBe(true);
    screen.enterAlternate();
    boom.box.api!.exit(3);
    expect(exits[0]?.[0]).toBe(3);
    expect(exits[0]?.[1]).toContain('stop blew up');
    expect(screen.altScreen).toBe(false); // restored despite the crash
  });

  it('Ctrl+C exits 130; a second spawn is refused while live', () => {
    const screen = new Screen({ scrollback: 100 });
    const exits: Array<[number, string | null]> = [];
    const runner = new AppRunner(new ScreenFeed(screen), screen, new RawLine(), (code, crash) => exits.push([code, crash]));
    const first = makeApp();
    expect(runner.spawn(first.app)).toBe(true);
    expect(runner.spawn(makeApp().app)).toBe(false);
    expect(runner.requestInterrupt()).toBe(true);
    expect(exits).toEqual([[130, null]]);
  });
});
