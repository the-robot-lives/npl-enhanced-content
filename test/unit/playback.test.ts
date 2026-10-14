// Unit spec — the playback runner (src/terminal/playback.ts): pure
// scheduling against an injected driver + timer, no DOM.
//
// Feature: the step types
//   Scenario: type types char by char (delayMs between), run executes
//   Scenario: key presses a named key; comment prints a note; wait pauses
//   Scenario: an unknown step type is skipped, the script keeps going
// Feature: control
//   Scenario: stop() halts between steps and running flips false
//   Scenario: driver.stopped() (user Escape) halts too, without onDone
//   Scenario: the script finishing calls onDone exactly once
// Feature: reduced motion
//   Scenario: a type step lands whole, waits are zero — one synchronous pass
// Feature: parseScriptAttribute
//   Scenario: a JSON array of steps parses; junk, non-arrays and bad JSON are null

import { describe, it, expect } from 'vitest';
import { startPlayback, parseScriptAttribute, type PlaybackDriver, type PlaybackStep } from '../../src/terminal/playback.js';

/** A manual scheduler: steps run only when tests flush the queue. */
function makeClock(): { schedule: (fn: () => void, ms: number) => void; flush(): number; pending(): number } {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    schedule: (fn, ms) => queue.push({ fn, ms }),
    flush(): number {
      let maxMs = -1;
      while (queue.length > 0) {
        const { fn, ms } = queue.shift()!;
        maxMs = Math.max(maxMs, ms);
        fn();
      }
      return maxMs;
    },
    pending: () => queue.length,
  };
}

interface SpyDriver extends PlaybackDriver {
  typed: string;
  keys: string[];
  ran: number;
  comments: string[];
}

function makeDriver(stoppedNow = false): SpyDriver {
  return {
    typed: '',
    keys: [],
    ran: 0,
    comments: [],
    type: (text) => {
      driver.typed += text;
    },
    pressKey: (key) => {
      driver.keys.push(key);
    },
    run: () => {
      driver.ran++;
    },
    comment: (text) => {
      driver.comments.push(text);
    },
    open: () => false,
    stopped: () => driver.stoppedNow || stoppedNow,
  };
}
let driver: SpyDriver;

describe('the step types', () => {
  it('type types char by char with delayMs gaps; run executes the line', () => {
    driver = makeDriver();
    const clock = makeClock();
    const steps: PlaybackStep[] = [
      { type: 'type', text: 'ls', delayMs: 30 },
      { type: 'run' },
    ];
    const handle = startPlayback(steps, driver, { schedule: clock.schedule });
    expect(driver.typed).toBe('l'); // first char lands synchronously
    const maxMs = clock.flush();
    expect(driver.typed).toBe('ls');
    expect(driver.ran).toBe(1);
    expect(maxMs).toBe(30);
    expect(handle.running).toBe(false);
  });

  it('key presses a named key; comment prints a note; wait pauses', () => {
    driver = makeDriver();
    const clock = makeClock();
    const delays: number[] = [];
    const schedule = (fn: () => void, ms: number): void => {
      delays.push(ms);
      clock.schedule(fn, ms);
    };
    startPlayback(
      [
        { type: 'comment', text: 'hello' },
        { type: 'key', key: 'Enter' },
        { type: 'wait', ms: 500 },
        { type: 'key', key: 'ArrowDown' },
      ],
      driver,
      { schedule },
    );
    clock.flush();
    expect(driver.comments).toEqual(['hello']);
    expect(driver.keys).toEqual(['Enter', 'ArrowDown']);
    expect(delays).toContain(500);
  });

  it('a wait without ms defaults, and an unknown step type is skipped', () => {
    driver = makeDriver();
    const clock = makeClock();
    const delays: number[] = [];
    const schedule = (fn: () => void, ms: number): void => {
      delays.push(ms);
      clock.schedule(fn, ms);
    };
    startPlayback([{ type: 'wait' }, { type: 'vanish' as never }, { type: 'comment', text: 'still here' }], driver, { schedule });
    clock.flush();
    expect(delays).toContain(250);
    expect(driver.comments).toEqual(['still here']);
  });
});

describe('control', () => {
  it('stop() halts between steps; running flips false', () => {
    driver = makeDriver();
    const clock = makeClock();
    const handle = startPlayback(
      [
        { type: 'type', text: 'abc' },
        { type: 'comment', text: 'never' },
      ],
      driver,
      { schedule: clock.schedule },
    );
    expect(handle.running).toBe(true);
    handle.stop();
    expect(handle.running).toBe(false);
    clock.flush();
    expect(driver.comments).toEqual([]); // the halted step never ran
  });

  it('driver.stopped() (the user pressed Escape) halts too, without onDone', () => {
    driver = makeDriver(true); // stopped from the start
    const clock = makeClock();
    let done = 0;
    startPlayback([{ type: 'comment', text: 'nope' }], driver, { schedule: clock.schedule, onDone: () => done++ });
    clock.flush();
    expect(driver.comments).toEqual([]);
    expect(done).toBe(0);
    expect(clock.pending()).toBe(0); // nothing left scheduled
  });

  it('the script finishing calls onDone exactly once', () => {
    driver = makeDriver();
    let done = 0;
    startPlayback([{ type: 'comment', text: 'a' }, { type: 'comment', text: 'b' }], driver, {
      schedule: (fn) => fn(),
      onDone: () => done++,
    });
    expect(done).toBe(1);
  });
});

describe('reduced motion', () => {
  it('type lands whole, waits are zero — the whole script runs synchronously', () => {
    driver = makeDriver();
    const clock = makeClock();
    const delays: number[] = [];
    const schedule = (fn: () => void, ms: number): void => {
      delays.push(ms);
      clock.schedule(fn, ms);
    };
    const handle = startPlayback(
      [
        { type: 'type', text: 'ls -l', delayMs: 40 },
        { type: 'wait', ms: 900 },
        { type: 'run' },
      ],
      driver,
      { reducedMotion: true, schedule },
    );
    expect(driver.typed).toBe('ls -l'); // whole word, immediately
    clock.flush();
    expect(delays.every((ms) => ms === 0)).toBe(true); // no typing delay, no waits
    expect(driver.ran).toBe(1);
    expect(handle.running).toBe(false);
  });
});

describe('parseScriptAttribute', () => {
  it('a JSON array of steps parses; step entries without a type are dropped', () => {
    const steps = parseScriptAttribute('[{"type":"type","text":"ls"},{"type":"run"},{"junk":1}]');
    expect(steps).toHaveLength(2);
    expect(steps![0]).toEqual({ type: 'type', text: 'ls' });
  });

  it('junk of every shape is null', () => {
    expect(parseScriptAttribute(null)).toBeNull();
    expect(parseScriptAttribute('')).toBeNull();
    expect(parseScriptAttribute('   ')).toBeNull();
    expect(parseScriptAttribute('not json')).toBeNull();
    expect(parseScriptAttribute('{"type":"run"}')).toBeNull(); // object, not array
    expect(parseScriptAttribute('"run"')).toBeNull();
  });
});
