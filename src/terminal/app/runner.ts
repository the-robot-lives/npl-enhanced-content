/**
 * app/runner — the full-screen app lifecycle (CORE-V2 §6.2, §5.3).
 *
 * Spawn = save cursor → enter alternate screen → attach raw mode →
 * `app.start(api)`. Exit = `app.stop()` (guaranteed, crash or not) →
 * detach raw → leave alternate → the primary screen and cursor are
 * restored exactly. The runner guarantees teardown even when start/key
 * throws — a crashed app never leaves the shell in raw mode on the alt
 * buffer. Ctrl+C while an app is active interrupts it with exit 130
 * (§6.3); the app never sees the key.
 */

import type { App, AppContext, KeyEvent, MouseEvent, ScreenWriter } from '../screen/types.js';
import { ScreenFeed } from '../screen/feed.js';
import { Screen } from '../screen/screen.js';
import { RawLine } from '../line/discipline.js';

export class AppRunner {
  #app: App | null = null;
  #mouseReport = false;

  constructor(
    private readonly feed: ScreenFeed,
    private readonly screen: Screen,
    private readonly raw: RawLine,
    /** Called once per run with the exit code (and crash message, if any). */
    private readonly onExit: (code: number, crash: string | null) => void,
  ) {}

  get active(): boolean {
    return this.#app !== null;
  }

  get app(): App | null {
    return this.#app;
  }

  get mouseReporting(): boolean {
    return this.#mouseReport;
  }

  /** Spawn an app; false when one is already running. */
  spawn(app: App): boolean {
    if (this.#app !== null) return false;
    this.#app = app;
    this.#mouseReport = false;
    this.screen.saveCursor();
    this.screen.enterAlternate();
    this.raw.attach(app);
    try {
      app.start(this.#context(app));
      return true;
    } catch (error) {
      this.#teardown(1, error instanceof Error ? error.message : String(error));
      return true; // it DID start; it crashed — the exit line already printed
    }
  }

  /** Key event during an app; false when no app is attached. */
  key(ev: KeyEvent): boolean {
    const app = this.#app;
    if (app === null) return false;
    try {
      app.key(ev);
    } catch (error) {
      this.#teardown(1, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  paste(text: string): boolean {
    const app = this.#app;
    if (app === null) return false;
    try {
      app.paste?.(text);
    } catch (error) {
      this.#teardown(1, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  mouse(ev: MouseEvent): boolean {
    if (!this.#mouseReport) return false;
    const app = this.#app;
    if (app === null) return false;
    try {
      app.mouse?.(ev);
    } catch (error) {
      this.#teardown(1, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  resize(cols: number, rows: number): boolean {
    const app = this.#app;
    if (app === null) return false;
    try {
      app.resize?.(cols, rows);
    } catch (error) {
      this.#teardown(1, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  /** Ctrl+C while an app is active — interrupt, exit 130 (§6.3). */
  requestInterrupt(): boolean {
    if (this.#app === null) return false;
    this.#teardown(130, null);
    return true;
  }

  /** Screen resize during an app: redimension alt, then onResize. */
  onScreenResized(cols: number, rows: number): void {
    if (this.#app !== null) this.resize(cols, rows);
  }

  #context(app: App): AppContext {
    const runner = this;
    const screen: ScreenWriter = {
      write: (text: string): void => runner.feed.write(text),
      writeln: (text = ''): void => runner.feed.write(`${text}\r\n`),
      moveTo: (col: number, row: number): void => runner.screen.moveCursor(row, col),
      eraseDisplay: (mode: 0 | 1 | 2 = 0): void => runner.screen.eraseDisplay(mode),
      eraseLine: (mode: 0 | 1 | 2 = 0): void => runner.screen.eraseLine(mode),
      setCursorVisible: (visible: boolean): void => {
        runner.screen.cursor.visible = visible;
      },
      setCursorStyle: (style): void => {
        runner.screen.cursor.style = style;
      },
    };
    return {
      screen,
      get cols(): number {
        return runner.screen.cols;
      },
      get rows(): number {
        return runner.screen.rows;
      },
      setTitle: (title: string): void => runner.screen.setTitle(title),
      setStatus: (text: string, tone?): void => runner.screen.setStatus(text, tone),
      requestMouse: (report: boolean): void => {
        runner.#mouseReport = report;
      },
      exit: (code = 0): void => {
        // Only the live app may exit itself through this binding.
        if (runner.#app === app) runner.#teardown(code, null);
      },
    };
  }

  /** The ONLY teardown path: stop (guarded) → detach → restore. */
  #teardown(code: number, crash: string | null): void {
    const app = this.#app;
    if (app === null) return;
    this.#app = null;
    this.#mouseReport = false;
    try {
      app.stop();
    } catch {
      // stop() crashing must never block the restore below (§5.3).
    }
    this.raw.detach();
    this.screen.exitAlternate();
    this.onExit(code, crash);
  }
}
