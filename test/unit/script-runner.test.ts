// script-runner — playback through a driver, and the pausable scheduler.
import { describe, it, expect } from 'vitest';
import { runDemoScript, type DemoDriver } from '../../src/terminal/script/demo-runner.js';
import { createPausableScheduler, realClock, type ScriptClock } from '../../src/terminal/script/pausable-scheduler.js';

function makeClock(): ScriptClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { fn: () => void; due: number }>();
  return {
    now: () => now,
    set: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    clear: (id) => void timers.delete(id),
    advance: (ms) => {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.due <= now)
        .sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn();
      }
    },
    pending: () => timers.size,
  };
}

function makeScheduler() {
  const clock = makeClock();
  const scheduler = createPausableScheduler(clock);
  return { scheduler, clock };
}

interface SpyDriver extends DemoDriver {
  calls: string[];
  lines: string[];
  stopFlag: boolean;
}

function makeDriver(transcript: string[] = []): SpyDriver {
  const calls: string[] = [];
  const lines: string[] = [];
  const driver: SpyDriver = {
    calls,
    lines,
    stopFlag: false,
    type: (t) => void calls.push('type:' + t),
    pressKey: (k) => void calls.push('key:' + k),
    run: () => void calls.push('run'),
    comment: (t) => {
      lines.push(t);
      calls.push('comment');
    },
    open: () => false,
    stopped: () => driver.stopFlag,
    transcript: () => transcript,
  };
  return driver;
}

/** Drain until settled: play every timer that comes due. */
function drain(sched: ReturnType<typeof makeScheduler>, budget = 200): void {
  for (let i = 0; i < budget && sched.scheduler.pending > 0; i++) sched.clock.advance(1);
}

describe('runDemoScript', () => {
  it('types a $ line char by char, then executes, then beats', () => {
    const sched = makeScheduler();
    const driver = makeDriver();
    runDemoScript([{ type: 'type', text: 'ls' }, { type: 'run' }], driver, {
      scheduler: sched.scheduler,
      rand: () => 0.9, // never jitters
      typeMs: 10,
    });
    expect(driver.calls).toEqual(['type:l']); // the first character lands synchronously
    sched.clock.advance(10); // one beat types the rest and executes
    expect(driver.calls).toEqual(['type:l', 'type:s', 'run']);
    sched.clock.advance(1000); // the inter-command beat elapses
    expect(sched.scheduler.pending).toBe(0);
    expect(driver.calls).toEqual(['type:l', 'type:s', 'run']); // nothing more prints
    sched.clock.advance(10);
    expect(driver.calls).toEqual(['type:l', 'type:s', 'run']);
  });

  it('one key in four lands late (jitter)', () => {
    const sched = makeScheduler();
    const driver = makeDriver();
    runDemoScript([{ type: 'type', text: 'ab' }], driver, {
      scheduler: sched.scheduler,
      rand: () => 0, // always jitters: 2.5x the base delay
      typeMs: 10,
    });
    expect(driver.calls).toEqual(['type:a']); // first char is synchronous
    sched.clock.advance(10); // the jittered gap is 25ms: not yet
    expect(driver.calls).toEqual(['type:a']);
    sched.clock.advance(15);
    expect(driver.calls).toEqual(['type:a', 'type:b']);
  });

  it('reduced motion plays the whole word at once with no waits', () => {
    const sched = makeScheduler();
    const driver = makeDriver();
    runDemoScript([{ type: 'type', text: 'ls' }, { type: 'run' }, { type: 'wait', ms: 500 }], driver, {
      scheduler: sched.scheduler,
      reducedMotion: true,
    });
    expect(driver.calls).toEqual(['type:ls', 'run']);
    expect(sched.scheduler.pending).toBe(0);
  });

  it('@expect passes on a transcript hit and halts on a miss', () => {
    const sched = makeScheduler();
    const good = makeDriver(['token rotation']);
    const onFail: string[] = [];
    runDemoScript(
      [{ type: 'expect', text: 'rotation' }, { type: 'comment', text: 'next' }],
      good,
      { scheduler: sched.scheduler, onFail: (m) => void onFail.push(m) },
    );
    drain(sched);
    expect(good.calls).toContain('comment'); // the next step ran
    expect(onFail).toEqual([]);

    const bad = makeDriver([]);
    const misses: string[] = [];
    const run = runDemoScript([{ type: 'expect', text: 'nope' }], bad, {
      scheduler: sched.scheduler,
      onFail: (m) => void misses.push(m),
    });
    drain(sched);
    expect(misses.length).toBe(1);
    expect(bad.lines.join('\n')).toContain('expect failed');
    expect(run.running).toBe(false);
  });

  it('a driver that reports stopped halts between ticks', () => {
    const sched = makeScheduler();
    const driver = makeDriver();
    driver.stopFlag = true;
    const run = runDemoScript([{ type: 'type', text: 'ls' }], driver, {
      scheduler: sched.scheduler,
      typeMs: 5,
    });
    sched.clock.advance(50);
    expect(driver.calls).toEqual([]);
    expect(run.running).toBe(false);
  });

  it('stop() ends the run', () => {
    const sched = makeScheduler();
    const driver = makeDriver();
    const run = runDemoScript([{ type: 'type', text: 'ls' }], driver, {
      scheduler: sched.scheduler,
      typeMs: 5,
    });
    expect(run.running).toBe(true);
    expect(driver.calls).toEqual(['type:l']); // first char landed synchronously
    run.stop();
    expect(run.running).toBe(false);
    sched.clock.advance(50);
    expect(driver.calls).toEqual(['type:l']); // halted: never a second character
  });
});

describe('createPausableScheduler', () => {
  it('pause freezes pending timers; resume fires them with time left intact', () => {
    const clock = makeClock();
    const scheduler = createPausableScheduler(clock);
    const fired: number[] = [];
    scheduler.schedule(() => void fired.push(1), 100);
    clock.advance(50); // half the delay burned
    expect(fired).toEqual([]);
    scheduler.pause();
    clock.advance(500); // frozen: nothing fires no matter how long passes
    expect(fired).toEqual([]);
    scheduler.resume();
    clock.advance(50); // only the remaining 50ms still owed
    expect(fired).toEqual([1]);
  });

  it('a schedule() while frozen stays armed until resume', () => {
    const clock = makeClock();
    const scheduler = createPausableScheduler(clock);
    scheduler.pause();
    const fired: number[] = [];
    scheduler.schedule(() => void fired.push(1), 10);
    clock.advance(100);
    expect(fired).toEqual([]);
    scheduler.resume();
    clock.advance(10);
    expect(fired).toEqual([1]);
  });

  it('dispose cancels everything', () => {
    const clock = makeClock();
    const scheduler = createPausableScheduler(clock);
    const fired: number[] = [];
    scheduler.schedule(() => void fired.push(1), 10);
    scheduler.dispose();
    clock.advance(100);
    expect(fired).toEqual([]);
  });

  it('the real clock is a plain timeout wrapper', () => {
    expect(realClock.now()).toBeGreaterThan(0);
  });
});
