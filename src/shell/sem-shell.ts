import type { PropertyValues } from 'lit';
import { SemElement } from '../lit/base.js';
import { SemTerminal } from '../terminal/sem-terminal.js';
import type { ShellLine, TerminalCore } from '../terminal/terminal-core.js';
import { lineText } from '../terminal/screen/screen.js';
import { demoPlugin } from '../terminal/plugins/demo/plugin.js';
import { posixPlugin } from '../terminal/plugins/posix/plugin.js';
import { cardsPlugin } from '../terminal/plugins/cards/plugin.js';
import { attachAutostart } from '../terminal/script/autostart.js';
import type { AutostartHandle } from '../terminal/script/autostart.js';
import { looksLikeScriptPath, resolveScriptValue } from '../terminal/script/demo-format.js';
import type { DemoDriver } from '../terminal/script/demo-runner.js';
import {
  nullViewControl,
  readStoredView,
  resolveViewChoice,
  writeStoredView,
  type DomMenuViewControl,
  type RendererChoice,
} from '../terminal/menu/index.js';

/**
 * sem-shell — the SemText demo terminal: <sem-terminal> configured with the
 * bundled plugins and nothing more.
 *
 * Two JS-object manifests mount locally (no fetch):
 *
 *   - posix-sh   the POSIX-style command set over the virtual file system
 *                (src/terminal/plugins/posix/): ls, cat, bat, grep, pipes,
 *                redirects, $?, export/alias/history...
 *   - semtext-demo the /demo documents and the semtext/open commands
 *                (src/terminal/plugins/demo/)
 *
 * Then it demonstrates the PLUGINS.md CDN rule by attempting a third plugin
 * from an absolute https URL with no integrity hash: the loader refuses it
 * BEFORE any network request, prints the refusal as a stderr line, and
 * records it on core.loadErrors.
 *
 * Real remote plugins are the parent element's job:
 * `<sem-terminal plugins="https://cdn/…/manifest.json#sha256-… …">`.
 *
 * In-view autostart: the `start-script` attribute names a demo (a script in
 * src/terminal/script/landing-scripts.ts), inlines a demo-format line
 * script, or carries the `script` attribute's JSON. The demo plays the
 * first time the element is half in view, pauses out of view and on a
 * hidden tab, and plays once per page load (src/terminal/script/README.md).
 * Escape hands the terminal back at any point. Unlike `script` — which
 * plays at boot — `start-script` waits for a reader: a landing page's tabs
 * stay still until each shell is actually looked at.
 */
export class SemShell extends SemTerminal {
  /**
   * `renderer` — the visible paint (CORE-V2 §8.5b): `"canvas"` (the
   * default spelling) or `"dom"` (pins the mirror's paint — a printable
   * docs page, a bug report that must show the DOM view). Observed live
   * (property and attribute); still bounded by §8.5a — if the canvas was
   * refused (forced-colors, failed 2d context) the DOM view shows
   * regardless. `...SemTerminal.properties` — Lit subclasses that declare
   * `static properties` shadow the parent's table without the spread.
   */
  static properties = {
    ...SemTerminal.properties,
    // reflect: the pin is author-visible state — setting `.renderer` updates
    // the attribute too (§8.5b: observed live as property AND attribute).
    renderer: { type: String, reflect: true },
  };

  declare renderer: string;

  #shellBooted = false;
  #autostart: AutostartHandle | null = null;
  #autoRunning = false;
  /** Only the first session gets the boot novelty lines (§11.2: tabs are quiet). */
  #firstSessionHooked = false;
  /** The CDN-refusal demo plays once per element, not once per tab. */
  #cdnDemoShown = false;
  /**
   * The fetched start-script FILE body (r2 follow-up): kept so the replay
   * button can re-attach the same demo — `#hasScript` alone can't, the
   * autostart handle consumed the fetched text.
   */
  #fetchedScript: string | null = null;

  /** The view the element paints right now (§8.5). */
  #view: RendererChoice = 'dom';
  /** False until the canvas renderer proves available (§8.5a bounds everything). */
  #canvasAvailable = false;
  /**
   * Injected storage for tests; default is the browsing session's
   * sessionStorage (§8.5c — per element, per session, never a cookie).
   */
  viewStorage: Storage | null | undefined;
  /**
   * The integrator's seam (r2-canvas): applies the view choice to the live
   * renderer (`useDomView()` / `useCanvasView()`). Until a canvas renderer
   * is wired, the DOM transcript is the only paint and this stays null.
   */
  viewDelegate: ((choice: RendererChoice) => void) | null = null;
  /**
   * What the terminal's context menu reads (the r2 dom-menu patch on
   * sem-terminal casts this off the element). Answers for the moment of
   * the call, so the menu's switch label and availability are always live.
   */
  readonly semView: DomMenuViewControl = {
    current: () => this.#view,
    switchTo: (next) => this.#setView(next),
    canvasAvailable: () => this.#canvasAvailable,
  };

  connectedCallback(): void {
    super.connectedCallback();
    if (this.#shellBooted) return;
    this.#shellBooted = true;
    this.setAttribute('aria-label', 'SemText shell');
    // Plugin mounting happens in configureSessionCore — EVERY session core
    // (each tab) needs the bundled command set, and the base class hooks
    // session 1 during its own connectedCallback above.
    this.#attachAutostart();
    this.#resolveView();
  }

  /**
   * Per-session command setup (§11.2): the bundled manifests mount on every
   * tab's core, so `help`/`ls`/`bat` work everywhere. The boot novelty —
   * the "type help" banner and the CDN-refusal demo — stays with the FIRST
   * session; a new tab is a fresh shell, not a fresh demo.
   */
  protected override configureSessionCore(core: TerminalCore, emit: (lines: ShellLine[]) => void): void {
    const lines: ShellLine[] = [];
    for (const manifest of [posixPlugin, demoPlugin, cardsPlugin]) {
      const mounted = core.mountPlugin(manifest);
      if (mounted.ok) {
        lines.push({
          kind: 'stdout',
          text: `plugin ${manifest.name} ${manifest.version} mounted — ${manifest.commands.length} commands`,
        });
      } else {
        lines.push({ kind: 'stderr', text: `plugin ${manifest.name}: ${mounted.error}` });
      }
    }
    if (!this.#firstSessionHooked) {
      this.#firstSessionHooked = true;
      lines.push({ kind: 'stdout', text: 'type help to begin — or press replay to watch the demo.' });
    }
    emit(lines);
    // The CDN-rule demo: absolute https, no integrity — refused pre-fetch.
    // Asserted via core.loadErrors in the unit tests (session 1's core is
    // the active `el.core` at boot).
    if (!this.#cdnDemoShown) {
      this.#cdnDemoShown = true;
      void core.loadPluginFromUrl('https://cdn.noizu.com/semtext/plugins/extra/manifest.json').then((result) => {
        if (!result.ok) {
          emit([{ kind: 'stderr', text: `plugin https://cdn.noizu.com/…: ${result.error}` }]);
        }
      });
    }
  }

  /**
   * Live `renderer` changes (§8.5b: observed, property and attribute) —
   * the author's pin re-applies over any stored session switch.
   */
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('renderer')) this.#resolveView();
  }

  disconnectedCallback(): void {
    this.#autostart?.dispose();
    this.#autostart = null;
    super.disconnectedCallback();
  }

  /* ------------------------------------------------------------------ *
   * the visible paint (CORE-V2 §8.5)
   * ------------------------------------------------------------------ */

  /** The view the element currently paints — `"canvas"` or `"dom"`. */
  get viewChoice(): RendererChoice {
    return this.#view;
  }

  /** Whether the canvas renderer proved available (§8.5a). */
  get canvasAvailable(): boolean {
    return this.#canvasAvailable;
  }

  /**
   * The canvas renderer constructed cleanly (§8.5a) — re-resolve: the
   * default flips dom → canvas unless the author pinned `renderer="dom"`
   * or the user's stored switch already chose the text view.
   */
  markCanvasAvailable(): void {
    this.#canvasAvailable = true;
    this.#resolveView();
  }

  /**
   * The canvas was refused — forced-colors or a failed 2d context
   * (§8.5a). The DOM view shows for the runtime; the forced fallback is
   * NOT the user's switch and is never persisted.
   */
  markCanvasUnavailable(): void {
    this.#canvasAvailable = false;
    this.#resolveView();
  }

  /** Boot / attribute-change decision (menu/view.ts precedence). */
  #resolveView(): void {
    this.#view = resolveViewChoice({
      attr: this.getAttribute('renderer'),
      stored: readStoredView(this.#sessionStorage(), this.id || 'default'),
      canvasAvailable: this.#canvasAvailable,
    });
    this.#applyView();
  }

  /** A user switch (§8.5c): apply + persist for the browsing session. */
  #setView(next: RendererChoice): void {
    if (next === 'canvas' && !this.#canvasAvailable) return; // bounded by §8.5a
    this.#view = next;
    writeStoredView(this.#sessionStorage(), this.id || 'default', next);
    this.#applyView();
  }

  #applyView(): void {
    this.viewDelegate?.(this.#view);
  }

  #sessionStorage(): Storage | null {
    if (this.viewStorage !== undefined) return this.viewStorage;
    try {
      return this.ownerDocument?.defaultView?.sessionStorage ?? null;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * in-view autostart (src/terminal/script/)
   * ------------------------------------------------------------------ */

  #attachAutostart(): void {
    const value = this.getAttribute('start-script');
    if (value === null) return;
    // A site-path value names a fetchable demo-format file (the landing's
    // `/demo/scripts/<tab>.txt`). r2 parsed such values inline as a single
    // comment step, so the demos never typed. Fetch, then attach with the
    // body; a failed fetch leaves the static transcript untouched.
    if (looksLikeScriptPath(value)) {
      void this.#fetchStartScript(value);
      return;
    }
    this.#autostart = attachAutostart(this, this.#demoDriver(), {
      onRunning: (running) => this.#autoRunningChanged(running),
    });
    // The attribute resolved to a real script → the replay button shows
    // (the boot playback path marks itself the same way).
    if (resolveScriptValue(value) !== null) this.markScripted();
  }

  async #fetchStartScript(path: string): Promise<void> {
    try {
      // A relative path resolves against the document; a non-http base
      // (about:blank in tests, sandboxed docs) keeps the raw path.
      let url: URL | string = path;
      try {
        url = new URL(path, this.ownerDocument?.baseURI ?? location.href);
      } catch {
        /* keep the raw path */
      }
      const response = await fetch(url);
      if (!response.ok) return;
      const body = (await response.text()).trim();
      if (body === '') return;
      // A late fetch after a disconnect (which nulls the handle) must not
      // re-attach into a detached element; nor double-attach on reconnect.
      if (this.#autostart !== null || !this.isConnected) return;
      this.#fetchedScript = body;
      this.markScripted(); // r2 follow-up: the FETCH flow never set #hasScript
      this.#autostart = attachAutostart(this, this.#demoDriver(), {
        script: body,
        onRunning: (running) => this.#autoRunningChanged(running),
      });
    } catch {
      // No fetchable script (offline, 404, blocked): the static fallback
      // transcript stays; never throw from a landing page.
    }
  }

  /**
   * The replay button. A fetched start-script file re-attaches its saved
   * body (the autostart handle consumed the text; the attribute alone is
   * just a path). Any other scripted flow — the boot `script`/`playback`
   * attributes, or an inline start-script — falls back to the terminal's
   * boot playback restart.
   */
  protected override replayScript(): void {
    if (this.#fetchedScript === null) {
      super.replayScript();
      return;
    }
    this.#autostart?.dispose();
    this.#autostart = null;
    this.#autostart = attachAutostart(this, this.#demoDriver(), {
      script: this.#fetchedScript,
      onRunning: (running) => this.#autoRunningChanged(running),
    });
  }

  /** The script owns the keyboard while it runs; the reader takes it back. */
  #autoRunningChanged(running: boolean): void {
    if (running === this.#autoRunning) return;
    this.#autoRunning = running;
    const input = this.#shellInput();
    if (input === null) return;
    input.readOnly = running;
    if (!running) input.focus();
  }

  /**
   * The demo drives the element the way a reader does: real DOM events on
   * the prompt form and the input line (and the TUI view while open) — no
   * reaching into private terminal state. Enter submits through the form;
   * every other key lands on the surface that has it.
   */
  /** The prompt input; the parent keeps its own accessor private. */
  #shellInput(): HTMLInputElement | null {
    return this.querySelector('.sem-shell-input') as HTMLInputElement | null;
  }

  #demoDriver(): DemoDriver {
    const keyDown = (key: string): KeyboardEvent =>
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    const tapTui = (key: string): void => {
      const view = this.querySelector('.sem-tui') as HTMLElement | null;
      view?.dispatchEvent(keyDown(key));
    };
    const tapInput = (key: string): void => {
      this.#shellInput()?.dispatchEvent(keyDown(key));
    };
    const submitForm = (): void => {
      const form = this.querySelector('.sem-shell-prompt') as HTMLFormElement | null;
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    return {
      type: (text: string): void => {
        if (this.tui !== null) {
          for (const ch of Array.from(text)) tapTui(ch);
          return;
        }
        const input = this.#shellInput();
        if (input !== null) input.value += text;
      },
      pressKey: (key: string): void => {
        if (this.tui !== null) {
          tapTui(key);
          return;
        }
        if (key === 'Enter') {
          submitForm();
          return;
        }
        tapInput(key);
      },
      run: submitForm,
      comment: (text: string): void => {
        this.appendLines([{ kind: 'comment', text }]);
      },
      open: (): boolean => this.tui !== null,
      stopped: (): boolean => this.#autostart === null,
      // @expect is a contains check — while an app holds the alt surface
      // it must assert what is ON SCREEN (the bat lane's integrate patch).
      transcript: (): string[] => {
        if (this.appLive) {
          const rows: string[] = [];
          for (let row = 0; row < this.screen.rows; row++) {
            const line = this.screen.alternate.lines[row];
            if (line !== undefined) rows.push(lineText(line));
          }
          return rows;
        }
        return this.lines.map((line) => line.text);
      },
    };
  }
}

SemElement.register('sem-shell', SemShell);
