/**
 * pausable-scheduler — a timer queue a script can freeze mid-flight.
 *
 * The demo runner needs three things plain setTimeout cannot do:
 * pause (the element scrolled out of view or the tab went hidden — the
 * next typing tick must NOT fire until the shell is seen again), resume
 * (continue exactly where it stopped, with the remaining delay intact),
 * and dispose (the element went away — cancel everything).
 *
 * The clock is injected so a unit test drives the whole schedule with a
 * manual queue and no real timers.
 */

export interface ScriptClock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

/** The real browser/node clock; tests inject a manual one. */
export const realClock: ScriptClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface PausableScheduler {
  schedule(fn: () => void, ms: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  readonly frozen: boolean;
  readonly pending: number;
}

interface Entry {
  key: number;
  fn: () => void;
  /** Live timer id, or null while frozen. */
  timer: unknown;
  /** Wall-clock time this timer is due (only meaningful while armed). */
  dueAt: number;
  /** Milliseconds still to wait before `fn` runs. */
  remaining: number;
}

export function createPausableScheduler(clock: ScriptClock = realClock): PausableScheduler {
  const live = new Map<number, Entry>();
  let frozen = false;
  let seq = 0;

  const fire = (entry: Entry): (() => void) => {
    return () => {
      live.delete(entry.key);
      entry.fn();
    };
  };

  const arm = (entry: Entry): void => {
    entry.dueAt = clock.now() + entry.remaining;
    entry.timer = clock.set(fire(entry), entry.remaining);
  };

  return {
    schedule(fn: () => void, ms: number): void {
      const entry: Entry = { key: seq++, fn, timer: null, dueAt: 0, remaining: Math.max(0, ms) };
      live.set(entry.key, entry);
      if (frozen) return; // stays unarmed until resume()
      arm(entry);
    },
    pause(): void {
      if (frozen) return;
      frozen = true;
      for (const entry of live.values()) {
        if (entry.timer !== null) {
          clock.clear(entry.timer);
          entry.timer = null;
          entry.remaining = Math.max(0, entry.dueAt - clock.now());
        }
      }
    },
    resume(): void {
      if (!frozen) return;
      frozen = false;
      for (const entry of live.values()) if (entry.timer === null) arm(entry);
    },
    dispose(): void {
      for (const entry of live.values()) if (entry.timer !== null) clock.clear(entry.timer);
      live.clear();
    },
    get frozen(): boolean {
      return frozen;
    },
    get pending(): number {
      return live.size;
    },
  };
}
