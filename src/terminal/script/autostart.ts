/**
 * autostart — the `start-script` attribute contract, end to end.
 *
 * A shell (or any SemText element that supplies a driver) declares:
 *
 *     <sem-shell start-script="landing-code">   named script (the bundle's)
 *     <sem-shell start-script="[...]">          the `script` attr's JSON
 *     <sem-shell start-script="$ bat …">        inline line-format script
 *
 * The demo does not run at boot. It starts the first time the element is
 * at least half in view, pauses while the element is out of view or the
 * tab is hidden, resumes when both are true, and never restarts — one
 * play per page load, with Escape handing the terminal to the user at
 * any point. prefers-reduced-motion plays the whole script at full speed.
 *
 * attachAutostart(target, driver, options) is the only entry point: the
 * element keeps ownership of its DOM; the handle it gets back is disposed
 * in disconnectedCallback.
 */

import { parseDemoScript, resolveScriptValue, type DemoStep } from './demo-format.js';
import { runDemoScript, type DemoDriver, type DemoRun } from './demo-runner.js';
import { createPausableScheduler, realClock, type PausableScheduler, type ScriptClock } from './pausable-scheduler.js';
import { watchInView, watchVisible, type VisibilitySource } from './in-view.js';

export interface AutostartOptions {
  /** The attribute carrying the script value (default `start-script`). */
  attribute?: string;
  /**
   * Explicit demo-format script text overriding the attribute. Hosts that
   * resolve the attribute themselves — the start-script FILE fetch in
   * sem-shell — pass the fetched body here.
   */
  script?: string;
  /** Fraction visible that counts as in view (default 0.5). */
  start?: number;
  /** Injectable IntersectionObserver constructor (tests). */
  IntersectionObserver?: typeof IntersectionObserver;
  /** Injectable clock for the pausable scheduler (tests). */
  clock?: ScriptClock;
  /** Injected jitter source (tests); forwarded to the runner. */
  rand?(): number;
  /** Runner timing overrides (defaults in demo-runner.ts). */
  typeMs?: number;
  waitMs?: number;
  pauseMs?: number;
  /** Grace between "in view" and the first typed key — boot lines settle. */
  startDelayMs?: number;
  /** Flips true when the demo takes the input, false when it releases it. */
  onRunning?: (running: boolean) => void;
  /** An `@expect` missed; message names the missing text. */
  onFail?: (message: string) => void;
}

export interface AutostartHandle {
  dispose(): void;
}

export function attachAutostart(target: HTMLElement, driver: DemoDriver, options: AutostartOptions = {}): AutostartHandle {
  const steps =
    options.script !== undefined
      ? parseDemoScript(options.script)
      : resolveScriptValue(target.getAttribute(options.attribute ?? 'start-script'));
  if (steps === null) return { dispose: () => undefined };

  const clock = options.clock ?? realClock;
  const scheduler: PausableScheduler = createPausableScheduler(clock);
  const view = target.ownerDocument?.defaultView ?? undefined;
  const reduced =
    typeof view?.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let run: DemoRun | null = null;
  let started = false;
  let disposed = false;
  let inView = false;
  let visible = true;

  const sync = (): void => {
    if (disposed) return;
    if (inView && visible) scheduler.resume();
    else scheduler.pause();
  };

  const begin = (): void => {
    if (started || disposed) return;
    started = true;
    // Let the boot lines land before the first key — the parent's own
    // playback uses the same beat (350ms after connect).
    scheduler.schedule(
      () => {
        if (disposed || driver.stopped()) return;
        run = runDemoScript(steps, driver, {
          scheduler,
          reducedMotion: reduced,
          rand: options.rand,
          typeMs: options.typeMs,
          waitMs: options.waitMs,
          pauseMs: options.pauseMs,
          onDone: () => {
            run = null;
            options.onRunning?.(false);
          },
          onFail: (message) => {
            run = null;
            options.onRunning?.(false);
            options.onFail?.(message);
          },
        });
        options.onRunning?.(true);
      },
      options.startDelayMs ?? 350,
    );
  };

  const onKey = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape' && run !== null) {
      run.stop();
      run = null;
      options.onRunning?.(false);
    }
  };
  target.addEventListener('keydown', onKey);

  const inViewWatch = watchInView(target, {
    start: options.start ?? 0.5,
    IntersectionObserver: options.IntersectionObserver,
    onShown: () => {
      inView = true;
      begin();
      sync();
    },
    onHidden: () => {
      inView = false;
      sync();
    },
  });
  const document = target.ownerDocument as (Document & VisibilitySource) | null;
  const visibleWatch = watchVisible(document ?? target, {
    onShown: () => {
      visible = true;
      sync();
    },
    onHidden: () => {
      visible = false;
      sync();
    },
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      run?.stop();
      run = null;
      scheduler.dispose();
      inViewWatch.dispose();
      visibleWatch.dispose();
      target.removeEventListener('keydown', onKey);
    },
  };
}

export { parseDemoScript, resolveScriptValue };
export type { DemoStep };
