// @vitest-environment happy-dom
// script-autostart — the start-script contract: waits for view, pauses,
// resumes, releases on Escape, goes full speed under reduced motion.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachAutostart } from '../../src/terminal/script/autostart.js';
import type { DemoDriver } from '../../src/terminal/script/demo-runner.js';
import type { ScriptClock } from '../../src/terminal/script/pausable-scheduler.js';
import '../../src/shell/sem-shell.js';

function makeClock(): ScriptClock & { advance(ms: number): void } {
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
      const due = [...timers.entries()].filter(([, t]) => t.due <= now).sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn();
      }
    },
  };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  constructor(private readonly cb: (entries: { target: Element; intersectionRatio: number }[]) => void) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  show(target: Element, ratio: number): void {
    this.cb([{ target, intersectionRatio: ratio }]);
  }
}

function makeDriver() {
  const calls: string[] = [];
  const lines: string[] = [];
  const driver: DemoDriver = {
    type: (t) => void calls.push('type:' + t),
    pressKey: (k) => void calls.push('key:' + k),
    run: () => void calls.push('run'),
    comment: (t) => {
      lines.push(t);
      calls.push('comment');
    },
    open: () => false,
    stopped: () => false,
    transcript: () => lines,
  };
  return { driver, calls, lines };
}

describe('attachAutostart', () => {
  afterEach(() => {
    FakeIntersectionObserver.instances = [];
  });

  it('waits for view, starts after the delay, pauses out of view, resumes', () => {
    FakeIntersectionObserver.instances = [];
    const clock = makeClock();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { driver, calls } = makeDriver();
    const running: boolean[] = [];
    target.setAttribute('start-script', '$ ls -la');
    const handle = attachAutostart(target, driver, {
      clock,
      IntersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
      startDelayMs: 20,
      typeMs: 5,
      rand: () => 0.9,
      onRunning: (r) => void running.push(r),
    });

    clock.advance(1000); // out of view: nothing has happened
    expect(calls).toEqual([]);
    FakeIntersectionObserver.instances[0]!.show(target, 0.6);
    clock.advance(19); // inside the start delay: still waiting
    expect(calls).toEqual([]);
    clock.advance(1); // the grace period ends; the run begins
    expect(running).toEqual([true]);
    clock.advance(5 * 2); // two characters of 'ls -la' at 5ms each
    expect(calls).toEqual(['type:l', 'type:s']);

    FakeIntersectionObserver.instances[0]!.show(target, 0.01); // scrolled away: pause
    clock.advance(1000);
    expect(calls).toEqual(['type:l', 'type:s']); // frozen mid-word
    FakeIntersectionObserver.instances[0]!.show(target, 0.9); // looked at again
    clock.advance(5); // only the remaining delay is owed
    expect(calls).toEqual(['type:l', 'type:s', 'type: ']);
    for (let i = 0; i < 400; i++) clock.advance(5); // word, run, beat, wait, done
    expect(calls).toContain('run');
    expect(running).toEqual([true, false]);
    handle.dispose();
  });

  it('Escape stops the run and releases the input', () => {
    FakeIntersectionObserver.instances = [];
    const clock = makeClock();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { driver, calls } = makeDriver();
    const running: boolean[] = [];
    target.setAttribute('start-script', '$ ls');
    const handle = attachAutostart(target, driver, {
      clock,
      IntersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
      startDelayMs: 10,
      typeMs: 5,
      rand: () => 0.9,
      onRunning: (r) => void running.push(r),
    });
    FakeIntersectionObserver.instances[0]!.show(target, 0.6);
    clock.advance(10 + 5); // first character typed
    expect(calls).toEqual(['type:l']);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(running).toEqual([true, false]);
    calls.length = 0;
    clock.advance(1000);
    expect(calls).toEqual([]); // the demo never types again
    handle.dispose();
  });

  it('reduced motion plays instantly once shown', () => {
    FakeIntersectionObserver.instances = [];
    const clock = makeClock();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { driver, calls } = makeDriver();
    const view = target.ownerDocument.defaultView!;
    vi.spyOn(view, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    target.setAttribute('start-script', '$ ls');
    const handle = attachAutostart(target, driver, {
      clock,
      IntersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
      startDelayMs: 10,
    });
    FakeIntersectionObserver.instances[0]!.show(target, 0.6);
    clock.advance(10);
    expect(calls).toEqual(['type:ls', 'run']);
    handle.dispose();
  });

  it('no attribute means no demo, and dispose is always safe', () => {
    const clock = makeClock();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { driver, calls } = makeDriver();
    const handle = attachAutostart(target, driver, { clock });
    clock.advance(1000);
    expect(calls).toEqual([]);
    expect(() => handle.dispose()).not.toThrow();
    handle.dispose();
  });
});

describe('sem-shell start-script wiring', () => {
  it('starts below-the-fold fallback, locks the input while running, Escape releases', async () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const shell = document.createElement('sem-shell') as HTMLElement;
    shell.setAttribute('start-script', '$ echo hi');
    document.body.appendChild(shell);
    // happy-dom has no IntersectionObserver: the fallback starts the demo.
    await vi.waitFor(
      () => {
        const input = shell.querySelector('.sem-shell-input') as HTMLInputElement | null;
        expect(input).not.toBeNull();
        expect(input!.readOnly).toBe(true);
      },
      { timeout: 3000, interval: 50 },
    );
    shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const released = shell.querySelector('.sem-shell-input') as HTMLInputElement;
    expect(released.readOnly).toBe(false);
    shell.remove();
  }, 10000);
});

describe('attachAutostart script option (r2.1 fetch flow)', () => {
  it('an explicit script overrides the attribute value', () => {
    FakeIntersectionObserver.instances = [];
    const clock = makeClock();
    const target = document.createElement('div');
    target.setAttribute('start-script', '/demo/scripts/site.txt');
    document.body.appendChild(target);
    const { driver, calls } = makeDriver();
    const handle = attachAutostart(target, driver, {
      clock,
      IntersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
      script: '# fetched\n$ echo fetched-ok',
    });
    // The explicit script plays even though the attribute names a file —
    // the fetch flow's contract: the host resolves, autostart executes.
    FakeIntersectionObserver.instances[0]!.show(target, 0.9);
    clock.advance(5000); // delay, typing and the run elapse
    expect(calls).toContain('type:echo fetched-ok');
    expect(calls).toContain('run');
    handle.dispose();
    target.remove();
  });
});
