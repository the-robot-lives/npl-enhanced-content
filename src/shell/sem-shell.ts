import type { ShellLine } from '../terminal/terminal-core.js';
import { SemElement } from '../lit/base.js';
import { SemTerminal } from '../terminal/sem-terminal.js';
import { demoPlugin } from '../terminal/plugins/demo/plugin.js';
import { posixPlugin } from '../terminal/plugins/posix/plugin.js';
import { cardsPlugin } from '../terminal/plugins/cards/plugin.js';
import { attachAutostart } from '../terminal/script/autostart.js';
import type { AutostartHandle } from '../terminal/script/autostart.js';
import type { DemoDriver } from '../terminal/script/demo-runner.js';

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
  #shellBooted = false;
  #autostart: AutostartHandle | null = null;
  #autoRunning = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.#shellBooted) return;
    this.#shellBooted = true;
    this.setAttribute('aria-label', 'SemText shell');

    const lines: ShellLine[] = [];
    for (const manifest of [posixPlugin, demoPlugin, cardsPlugin]) {
      const mounted = this.core.mountPlugin(manifest);
      if (mounted.ok) {
        lines.push({
          kind: 'stdout',
          text: `plugin ${manifest.name} ${manifest.version} mounted — ${manifest.commands.length} commands`,
        });
      } else {
        lines.push({ kind: 'stderr', text: `plugin ${manifest.name}: ${mounted.error}` });
      }
    }
    lines.push({ kind: 'stdout', text: 'type help to begin — or press replay to watch the demo.' });
    this.appendLines(lines);
    // The CDN-rule demo: absolute https, no integrity — refused pre-fetch.
    void this.core
      .loadPluginFromUrl('https://cdn.noizu.com/semtext/plugins/extra/manifest.json')
      .then((result) => {
        if (!result.ok) {
          this.appendLines([{ kind: 'stderr', text: `plugin https://cdn.noizu.com/…: ${result.error}` }]);
        }
      });
    this.#attachAutostart();
  }

  disconnectedCallback(): void {
    this.#autostart?.dispose();
    this.#autostart = null;
    super.disconnectedCallback();
  }

  /* ------------------------------------------------------------------ *
   * in-view autostart (src/terminal/script/)
   * ------------------------------------------------------------------ */

  #attachAutostart(): void {
    if (this.getAttribute('start-script') === null) return;
    this.#autostart = attachAutostart(this, this.#demoDriver(), {
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
      transcript: (): string[] => this.lines.map((line) => line.text),
    };
  }
}

SemElement.register('sem-shell', SemShell);
