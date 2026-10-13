/**
 * demo-runner — plays a DemoStep[] through a driver.
 *
 * A JS port of tabbing-on's demo-runner loop: headings land at once,
 * `$` lines type char by char (with a natural jitter) and then execute,
 * keys press, sleeps pause, `@expect` asserts the transcript. Every
 * terminal effect goes through the injected DemoDriver; every timing
 * through the injected PausableScheduler — so pause/resume (in-view,
 * tab-hidden) and a unit test's manual clock are the same mechanism.
 *
 * Escape (driver.stopped()) halts between ticks; the element then owns
 * the terminal again. An `@expect` miss prints a comment and halts with
 * onFail — a demo that lies about its subject must not keep playing.
 */

import { DEFAULT_PAUSE_MS, DEFAULT_TYPE_MS, DEFAULT_WAIT_MS, type DemoStep } from './demo-format.js';
import type { PausableScheduler } from './pausable-scheduler.js';

/** What the terminal exposes to a running demo. All sync, all side-effecting. */
export interface DemoDriver {
  /** Append text (one character per call in normal motion) to the input. */
  type(text: string): void;
  /** One named key press — routed to the input, or an open TUI view. */
  pressKey(key: string): void;
  /** Execute whatever is currently typed. */
  run(): void;
  /** Print a note line that is not executed. */
  comment(text: string): void;
  /** True while an interactive view (TUI) is open and should take keys. */
  open(): boolean;
  /** True once the user has taken over (Escape) or the element went away. */
  stopped(): boolean;
  /** The transcript so far — what `@expect` asserts against. */
  transcript(): string[];
}

export interface DemoRunOptions {
  /** Pauses and resumes ride the scheduler, so in-view hiding just works. */
  scheduler: PausableScheduler;
  /** prefers-reduced-motion: full speed, no typing delay, no waits. */
  reducedMotion?: boolean;
  /** Jitter source (default Math.random); a test pins one. */
  rand?(): number;
  /** Base per-character delay (default 45ms). */
  typeMs?: number;
  /** Default pause for `@sleep` without a value (default 400ms). */
  waitMs?: number;
  /** The beat after an executed command (default 900ms). */
  pauseMs?: number;
  /** The demo finished on its own (not on stop, not on expect-fail). */
  onDone?(): void;
  /** An `@expect` missed — message says what was not on screen. */
  onFail?(message: string): void;
}

export interface DemoRun {
  stop(): void;
  readonly running: boolean;
}

export function runDemoScript(steps: DemoStep[], driver: DemoDriver, options: DemoRunOptions): DemoRun {
  const { scheduler } = options;
  const reduced = options.reducedMotion === true;
  const rand = options.rand ?? Math.random;
  const typeMs = options.typeMs ?? DEFAULT_TYPE_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;

  let index = 0;
  let running = true;
  let finished = false;

  const halted = (): boolean => !running || driver.stopped();

  const after = (ms: number, next: () => void): void => {
    if (halted()) {
      running = false;
      return;
    }
    if (ms <= 0) {
      next();
      return;
    }
    scheduler.schedule(() => {
      if (halted()) {
        running = false;
        return;
      }
      next();
    }, ms);
  };

  const finishDone = (): void => {
    if (finished) return;
    finished = true;
    running = false;
    options.onDone?.();
  };

  const failStop = (message: string): void => {
    if (finished) return;
    finished = true;
    running = false;
    driver.comment(`expect failed: ${message}`);
    options.onFail?.(message);
  };

  /** One-in-four keys lands late, like a human between strokes. */
  const jitter = (base: number): number => (rand() < 0.25 ? Math.round(base * 2.5) : base);

  const step = (): void => {
    if (halted()) {
      running = false;
      return;
    }
    const s = steps[index++];
    if (s === undefined) {
      finishDone();
      return;
    }
    switch (s.type) {
      case 'comment':
        driver.comment(s.text);
        after(0, step);
        return;
      case 'key':
        driver.pressKey(s.key);
        after(0, step);
        return;
      case 'run':
        driver.run();
        after(reduced ? 0 : pauseMs, step);
        return;
      case 'wait':
        after(reduced ? 0 : Math.max(0, s.ms ?? waitMs), step);
        return;
      case 'expect': {
        const on = driver.transcript().join('\n');
        if (on.includes(s.text)) {
          after(0, step);
          return;
        }
        failStop(`"${s.text}" is not on screen`);
        return;
      }
      case 'type': {
        if (s.text === '') {
          after(0, step);
          return;
        }
        if (reduced) {
          driver.type(s.text); // full speed: the whole word lands at once
          after(0, step);
          return;
        }
        let at = 0;
        const per = s.delayMs ?? typeMs;
        const one = (): void => {
          if (halted()) {
            running = false;
            return;
          }
          driver.type(s.text.charAt(at++));
          if (at < s.text.length) after(jitter(per), one);
          else after(0, step);
        };
        one();
        return;
      }
      default:
        after(0, step); // unknown step type: skip, keep the demo alive
    }
  };

  step();
  return {
    stop(): void {
      running = false;
    },
    get running(): boolean {
      return running && !driver.stopped() && !finished;
    },
  };
}
