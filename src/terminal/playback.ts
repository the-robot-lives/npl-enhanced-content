/**
 * playback — scripted self-demo for <sem-terminal> (src/terminal/PLUGINS.md
 * § scripted playback).
 *
 * A script is a list of steps the terminal performs on open, so a page can
 * demo its tools unattended:
 *
 *   { type: 'type',    text: 'ls -l', delayMs?: number }  types char by char
 *   { type: 'key',     key: 'Enter' | 'ArrowDown' | … }     one named keypress
 *   { type: 'wait',    ms?: number }                        pause between steps
 *   { type: 'run' }                                          executes the line
 *   { type: 'comment', text: '…' }                          a note, not run
 *
 * The runner is pure scheduling: every terminal effect goes through the
 * injected PlaybackDriver, and time through an injected scheduler, so a
 * unit test drives a script against a fake terminal with no timers at all.
 * Escape (or anything else that stops the driver) halts between steps; the
 * element flips `prefers-reduced-motion` into `reducedMotion`, which runs
 * the whole script at full speed — no typing delay, zero waits.
 */

export type PlaybackStep =
  | { type: 'type'; text: string; delayMs?: number }
  | { type: 'key'; key: string }
  | { type: 'wait'; ms?: number }
  | { type: 'run' }
  | { type: 'comment'; text: string };

/** What the terminal exposes to the script. All sync, all side-effecting. */
export interface PlaybackDriver {
  /** Append text (one character per call in normal motion) to the input. */
  type(text: string): void;
  /** A named key press — routed to the input, or an open TUI view. */
  pressKey(key: string): void;
  /** Execute whatever is currently typed. */
  run(): void;
  /** Print a note line that is not executed. */
  comment(text: string): void;
  /** True while an interactive view (TUI) is open and should take keys. */
  open(): boolean;
  /** True once the user has taken over (Escape) or the element went away. */
  stopped(): boolean;
}

export interface PlaybackOptions {
  /** prefers-reduced-motion: full speed, no typing delay, no waits. */
  reducedMotion?: boolean;
  /** Timer. Defaults to setTimeout; tests inject a manual queue. */
  schedule?(fn: () => void, ms: number): void;
  /** Called when the script finishes on its own (not on stop()). */
  onDone?(): void;
}

export interface PlaybackHandle {
  stop(): void;
  readonly running: boolean;
}

const DEFAULT_TYPE_MS = 45;
const DEFAULT_WAIT_MS = 250;

export function startPlayback(steps: PlaybackStep[], driver: PlaybackDriver, options: PlaybackOptions = {}): PlaybackHandle {
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const reduced = options.reducedMotion === true;
  let index = 0;
  let running = true;
  let stopped = false;

  const finish = (): void => {
    if (stopped) return;
    running = false;
    options.onDone?.();
  };

  const next = (ms: number): void => {
    if (stopped || driver.stopped()) {
      running = false;
      return;
    }
    if (ms <= 0) {
      step();
      return;
    }
    schedule(() => {
      if (stopped || driver.stopped()) {
        running = false;
        return;
      }
      step();
    }, ms);
  };

  function step(): void {
    const s = steps[index++];
    if (!s) {
      finish();
      return;
    }
    if (stopped || driver.stopped()) {
      running = false; // the user took over before this step landed
      return;
    }
    switch (s.type) {
      case 'type': {
        if (s.text === '') {
          next(0);
          return;
        }
        if (reduced) {
          driver.type(s.text); // full speed: the whole word lands at once
          next(0);
          return;
        }
        let at = 0;
        const perChar = s.delayMs ?? DEFAULT_TYPE_MS;
        const typeOne = (): void => {
          if (stopped || driver.stopped()) {
            running = false;
            return;
          }
          driver.type(s.text[at++]);
          if (at < s.text.length) schedule(typeOne, perChar);
          else next(0);
        };
        typeOne();
        return;
      }
      case 'key':
        driver.pressKey(s.key);
        next(0);
        return;
      case 'wait':
        next(reduced ? 0 : Math.max(0, s.ms ?? DEFAULT_WAIT_MS));
        return;
      case 'run':
        driver.run();
        next(0);
        return;
      case 'comment':
        driver.comment(s.text);
        next(0);
        return;
      default:
        next(0); // unknown step type: skip, keep the script alive
    }
  }

  step();
  return {
    stop(): void {
      stopped = true;
      running = false;
    },
    get running(): boolean {
      return running && !stopped;
    },
  };
}

/** Parse a `script` attribute value (JSON array of steps). null → no script. */
export function parseScriptAttribute(value: string | null | undefined): PlaybackStep[] | null {
  if (value == null || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (s): s is PlaybackStep =>
        typeof s === 'object' && s !== null && typeof (s as { type?: unknown }).type === 'string',
    );
  } catch {
    return null;
  }
}
