import { html, type TemplateResult } from 'lit';
import { AnsiStateMachine, ansiSpans, type AnsiSpan } from './ansi/index.js';
import { SemElement } from '../lit/base.js';
import { TerminalCore, type ShellLine, type WindowAction } from './terminal-core.js';
import {
  parseScriptAttribute,
  startPlayback,
  type PlaybackDriver,
  type PlaybackHandle,
  type PlaybackStep,
} from './playback.js';
import {
  createTuiState,
  tuiCloseFilter,
  tuiIsClose,
  tuiMove,
  tuiOpenFilter,
  tuiPosition,
  tuiSetFilter,
  tuiToggle,
  type TuiAction,
  type TuiState,
} from './tui.js';
import { completeLine } from './complete.js';
import { attachLocalStorage } from './backends/local-storage.js';
import { createS3Backend } from './backends/s3.js';

/**
 * sem-terminal — the reusable terminal core: input, history, transcript,
 * prompt, command dispatch. Knows nothing about SemText; its commands come
 * from plugins.
 *
 * Plugins arrive two ways, per src/terminal/PLUGINS.md:
 *
 *   - programmatically: `el.core.mountPlugin(manifestObject)` — bundled
 *     JS-object manifests, no fetch;
 *   - declaratively: the `plugins` attribute, a space-separated list of
 *     manifest URLs (an integrity hash rides the URL as a fragment:
 *     `…manifest.json#sha256-<hex>`). Each URL loads independently — one
 *     failing prints a stderr line and lands in `core.loadErrors` without
 *     touching the others.
 *
 * Scripted playback: the `script` attribute (a JSON array of steps) or the
 * `playback` property (the array itself) makes the terminal demo itself on
 * open — typing, keys, waits, notes. Escape hands the terminal back to the
 * user; a replay button restarts the script. Skipped when neither is set.
 * `prefers-reduced-motion` runs the whole script instantly.
 *
 * Light DOM per PRD §4 rule 5 / SemElement: `themes/_vocabulary.css`
 * styles the `.sem-shell-*` classes; no shadow root, no `static styles`.
 * Transcript lines render through Lit text bindings only (auto-escaped) —
 * ANSI color from commands like `bat`/`ls` becomes styled spans via
 * the streaming ANSI tokeniser; no HTML is ever built from command output or user input.
 *
 * Zero-JS contract: whatever is authored inside the element is the static
 * transcript (a role="log" div with past lines, NO input element); the
 * first connect replaces it once. See web/demo/shell.html, whose build
 * also emits a script-stripped `.nojs.html` proving the fallback.
 */
export class SemTerminal extends SemElement {
  static properties = {
    cwd: { type: String, state: true },
    lines: { type: Array, state: true },
    plugins: { type: String },
    /** JSON array of playback steps; plays on open. Absent → no playback. */
    script: { type: String },
    /** The playback steps as an array — the property form of `script`. */
    playback: { type: Array },
    playing: { type: Boolean, state: true },
    tui: { type: Object, state: true },
  };

  declare cwd: string;
  declare lines: ShellLine[];
  /**
   * Space-separated manifest URLs to load on connect. Integrity rides the
   * URL fragment: `https://cdn/…/manifest.json#sha256-<64 hex>`.
   */
  declare plugins: string;
  declare script: string;
  declare playback: PlaybackStep[] | null;
  declare playing: boolean;
  declare tui: TuiState | null;

  readonly core = new TerminalCore();

  #history: string[] = [];
  #historyIndex = -1;
  #draft = '';
  #booted = false;
  #playbackHandle: PlaybackHandle | null = null;
  #playbackStopped = false;
  #hasScript = false;
  /** onLine unsubscribe for the core's async line channel. */
  #offLines: (() => void) | null = null;

  constructor() {
    super();
    this.cwd = this.core.state.cwd;
    this.lines = [];
    this.plugins = '';
    this.script = '';
    this.playback = null;
    this.playing = false;
    this.tui = null;
    this.core.mountKinds.set('s3', {
      id: 's3',
      help: 'S3 bucket over https (read-only unless the page sets a signer)',
      create: (args: string[]) => createS3Backend(args, this.core.s3Signer ?? undefined),
    });
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', 'Terminal');
    this.#offLines?.();
    this.#offLines = this.core.onLine((line) => this.appendLines([line]));
    this.core.vfs.onError = (error) => {
      this.appendLines([{ kind: 'stderr', text: `${error.backend}: ${error.path}: ${error.message}` }]);
    };
    if (!this.#booted) {
      this.#booted = true;
      this.replaceChildren(); // the authored zero-JS transcript is replaced
      this.lines = [{ kind: 'stdout', text: 'sem-terminal — type help.' }];
      this.#loadPluginsAttribute();
      this.#attachStorage();
      this.#maybeStartPlayback();
    }
  }

  disconnectedCallback(): void {
    this.#stopPlayback(false);
    this.#offLines?.();
    this.#offLines = null;
    super.disconnectedCallback();
  }

  /**
   * The `local-storage` attribute: persist this shell's tree under
   * `semtext:shell:v1:<key>`. Bare attribute → the element's id is the
   * key; no id → one stderr warning, no persistence. Seeding vs restore
   * waits for a microtask so plugins mounted in subclass callbacks land
   * first; the factory state is kept for `storage reset`.
   */
  #attachStorage(): void {
    const attribute = this.getAttribute('local-storage');
    if (attribute === null) return;
    const key = attribute === '' ? this.id : attribute;
    if (key === '') {
      this.appendLines([
        { kind: 'stderr', text: 'local-storage: give this element an id (or local-storage="key") — persistence off' },
      ]);
      return;
    }
    const backend = attachLocalStorage(this.core.vfs, { key });
    // Boot mounts re-seed storage (their flushes write the fresh tree);
    // peek NOW, before any of that, so a reload restores the user's tree
    // instead of the one the boot itself just seeded.
    const stored = backend.peekStored();
    queueMicrotask(() => {
      const outcome = backend.restore(stored);
      if (outcome === 'corrupt') {
        this.appendLines([{ kind: 'stderr', text: 'local-storage: stored state was unreadable — re-seeded' }]);
      }
    });
  }

  /** Load every declared manifest URL; failures are isolated + recorded. */
  #loadPluginsAttribute(): void {
    for (const url of this.plugins.split(/\s+/)) {
      if (url === '') continue;
      void this.core.loadPluginFromUrl(url).then((result) => {
        if (result.ok && result.plugin) {
          this.appendLines([{ kind: 'stdout', text: `plugin loaded: ${result.plugin.name} ${result.plugin.version}` }]);
        } else {
          this.appendLines([{ kind: 'stderr', text: `plugin ${url}: ${result.error}` }]);
        }
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * scripted playback
   * ---------------------------------------------------------------- */

  /** The steps to play: the property wins over the `script` attribute. */
  #scriptSteps(): PlaybackStep[] | null {
    if (this.playback && this.playback.length > 0) return this.playback;
    return parseScriptAttribute(this.getAttribute('script'));
  }

  #maybeStartPlayback(): void {
    const steps = this.#scriptSteps();
    if (!steps) return;
    this.#hasScript = true;
    const view = this.ownerDocument?.defaultView ?? window;
    // Let the plugin mount lines land before the typing begins.
    view.setTimeout(() => this.#startPlayback(steps), 350);
  }

  #reducedMotion(): boolean {
    const view = this.ownerDocument?.defaultView ?? window;
    return typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  #startPlayback(steps: PlaybackStep[]): void {
    this.#teardownPlayback();
    this.#playbackStopped = false;
    const input = this.#inputEl();
    if (input) {
      input.value = '';
      input.readOnly = true; // the script owns the keyboard until Escape
    }
    this.playing = true;
    const view = this.ownerDocument?.defaultView ?? window;
    this.#playbackHandle = startPlayback(steps, this.#driver(), {
      reducedMotion: this.#reducedMotion(),
      schedule: (fn, ms) => view.setTimeout(fn, ms),
      onDone: () => {
        this.playing = false; // the script finished on its own
        this.#releaseInput(false);
      },
    });
  }

  /** Escape (or the element going away): the user takes over. */
  #stopPlayback(announce: boolean): void {
    const wasPlaying = this.playing;
    this.#teardownPlayback();
    this.#playbackStopped = true;
    if (wasPlaying) this.#releaseInput(announce);
  }

  #teardownPlayback(): void {
    this.#playbackHandle?.stop();
    this.#playbackHandle = null;
    this.playing = false;
  }

  #releaseInput(announce: boolean): void {
    const input = this.#inputEl();
    if (input) {
      input.value = '';
      input.readOnly = false;
      input.focus();
    }
    if (announce) this.appendLines([{ kind: 'comment', text: 'playback stopped — the terminal is yours.' }]);
  }

  #driver(): PlaybackDriver {
    return {
      type: (text) => {
        const input = this.#inputEl();
        if (input) input.value += text;
      },
      run: () => this.#submitInput(),
      pressKey: (key) => this.#playbackKey(key),
      comment: (text) => this.appendLines([{ kind: 'comment', text }]),
      open: () => this.tui !== null,
      stopped: () => this.#playbackStopped,
    };
  }

  /** Where a playback key lands: the TUI when open, else the input line. */
  #playbackKey(key: string): void {
    if (this.tui) {
      this.#tuiKey(key);
      return;
    }
    if (key === 'Enter') {
      this.#submitInput();
      return;
    }
    if (key === 'ArrowUp') this.#navigate(-1);
    else if (key === 'ArrowDown') this.#navigate(1);
  }

  /** The replay button: stop where it is, start over. */
  #restartPlayback(): void {
    const steps = this.#scriptSteps();
    if (!steps) return;
    this.#startPlayback(steps);
  }

  /* ---------------------------------------------------------------- *
   * render
   * ---------------------------------------------------------------- */

  render(): TemplateResult {
    return html`
      <div class="sem-shell-frame" @click=${this.#focusInput} @keydown=${this.#onFrameKeydown}>
        ${this.#hasScript
          ? html`<button type="button" class="sem-shell-replay" aria-label="Replay the scripted demo" @click=${this.#restartPlayback}>
              replay
            </button>`
          : null}
        <div class="sem-shell-transcript" role="log" aria-live="polite" aria-label="Shell transcript">
          ${this.lines.map((line) => this.#renderLine(line))}
        </div>
        ${this.tui ? this.#renderTui() : this.#renderPrompt()}
      </div>
    `;
  }

  #renderPrompt(): TemplateResult {
    return html`
      <form class="sem-shell-prompt" @submit=${this.#onSubmit}>
        <label class="sem-shell-ps1" for="sem-shell-input">${this.cwd} $</label>
        <input
          id="sem-shell-input"
          class="sem-shell-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-label="Shell command"
          @keydown=${this.#onKeydown}
        />
      </form>
    `;
  }

  /** The flashcard view: boxed panels, keyboard-driven, read-only. */
  #renderTui(): TemplateResult {
    const state = this.tui!;
    const card = state.cards[state.index] ?? null;
    return html`
      <div class="sem-tui" role="dialog" aria-label="SemText cards — read-only view" tabindex="0" @keydown=${this.#onTuiOverlayKeydown}>
        <div class="sem-tui-head">
          tui — ${state.title} · ${tuiPosition(state)}${state.filter !== '' ? ` · filter: ${state.filter}` : ''}
        </div>
        ${card === null
          ? html`<div class="sem-tui-front sem-tui-empty">no cards match the filter</div>`
          : html`
              <div class="sem-tui-card sem-tui-front">${card.front}</div>
              ${state.expanded
                ? html`
                    <div class="sem-tui-card sem-tui-back">${card.back}</div>
                    ${card.meta !== '' ? html`<div class="sem-tui-meta">${card.meta}</div>` : null}
                  `
                : null}
            `}
        ${state.filtering
          ? html`<input
              class="sem-tui-filter"
              placeholder="filter cards…"
              aria-label="Filter cards"
              .value=${state.filter}
              @input=${this.#onTuiFilterInput}
              @keydown=${this.#onTuiFilterKeydown}
            />`
          : null}
        <div class="sem-tui-hint">&#8593;/k &#8595;/j move &middot; Enter expand &middot; / filter &middot; q close</div>
      </div>
    `;
  }

  #ansi = new AnsiStateMachine();

  #renderLine(line: ShellLine): TemplateResult {
    const cls =
      line.kind === 'cmd'
        ? 'sem-shell-line sem-shell-cmd'
        : line.kind === 'stderr'
          ? 'sem-shell-line sem-shell-error'
          : line.kind === 'status'
            ? 'sem-shell-line sem-shell-status'
            : line.kind === 'comment'
              ? 'sem-shell-line sem-shell-comment'
              : 'sem-shell-line';
    // stdout/stderr stream through the ANSI tokeniser — one machine per
    // element, so attributes persist across lines like a real terminal.
    // Every other kind is shell chrome: bypass the parser, render verbatim.
    if (line.kind !== 'stdout' && line.kind !== 'stderr') {
      return html`<div class=${cls}>${line.text}</div>`;
    }
    const spans = ansiSpans(line.text, this.#ansi);
    return html`<div class=${cls}>
      ${spans.map(
        (span) =>
          span.classes.length === 0 && span.style === ''
            ? html`${span.text}`
            : html`<span class=${span.classes.join(' ')} style=${span.style}>${span.text}</span>`,
      )}
    </div>`;
  }

  appendLines(newLines: ShellLine[]): void {
    this.lines = [...this.lines, ...newLines];
  }

  /* ---------------------------------------------------------------- *
   * input handling
   * ---------------------------------------------------------------- */

  #focusInput(): void {
    if (this.tui) return;
    this.#inputEl()?.focus();
  }

  #inputEl(): HTMLInputElement | null {
    return this.querySelector('.sem-shell-input') as HTMLInputElement | null;
  }

  #onSubmit(event: Event): void {
    event.preventDefault();
    this.#submitInput();
  }

  #submitInput(): void {
    const input = this.#inputEl();
    if (!input) return;
    const value = input.value;
    input.value = '';
    this.#exec(value);
  }

  #exec(value: string): void {
    const result = this.core.execLine(value);
    this.cwd = result.state.cwd;
    if (result.clear) {
      this.lines = [];
      this.#ansi.reset();
      this.#ansi.reset();
    } else {
      this.appendLines(result.lines);
    }
    if (value.trim() !== '') {
      this.#history.push(value);
      this.#draft = '';
      this.#historyIndex = -1;
    }
    for (const action of result.actions) {
      if (action.kind === 'window') this.#openWindow(action);
      else if (action.kind === 'tui') this.#openTui(action);
    }
  }

  /**
   * The only side effects the core can request. `window`: content into a
   * new window — the blob carries exactly the bytes the command emitted (a
   * stored virtual file, verbatim — nothing built from user input);
   * `noopener,noreferrer` cuts the window-opener channel both ways.
   * `tui`: the read-only flashcard view over extracted records.
   */
  #openWindow(action: WindowAction): void {
    const view = this.ownerDocument?.defaultView ?? window;
    const url = view.URL.createObjectURL(new view.Blob([action.blob], { type: action.contentType }));
    const win = view.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      this.appendLines([{ kind: 'stderr', text: `open: ${action.filename}: the browser blocked the pop-up window` }]);
    }
    view.setTimeout(() => view.URL.revokeObjectURL(url), 60_000);
  }

  #openTui(action: TuiAction): void {
    this.tui = createTuiState(action.cards, action.title);
    void this.updateComplete.then(() => (this.querySelector('.sem-tui') as HTMLElement | null)?.focus());
  }

  #touchTui(): void {
    if (this.tui) this.tui = { ...this.tui }; // new reference → Lit re-renders
  }

  /** Escape priority: filter row owns it; else close the TUI; else stop playback. */
  #onFrameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (this.tui?.filtering) return; // the filter input handles its own Escape
    if (this.tui) {
      event.preventDefault();
      this.#closeTui(true);
      return;
    }
    if (this.playing) {
      event.preventDefault();
      this.#stopPlayback(true);
    }
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.#navigate(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.#navigate(1);
    } else if (event.key === 'Tab' && !event.shiftKey) {
      const input = event.target as HTMLInputElement;
      if (input.value === '') return; // empty line: Tab moves focus, as usual
      event.preventDefault();
      this.#complete(input);
    } else if (event.key === 'l' && event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.lines = [];
    }
  }

  /**
   * Tab completion: extend the input when one completion exists (or a
   * longest common prefix applies); with several candidates and nothing
   * common to add, print them once — capped at 8, then "… +N more".
   */
  #complete(input: HTMLInputElement): void {
    const outcome = completeLine(input.value, this.core);
    if (outcome.kind === 'none') return;
    input.value = outcome.line;
    if (outcome.kind === 'list') {
      const shown = outcome.candidates.slice(0, 8);
      const rest = outcome.candidates.length - shown.length;
      this.appendLines([{ kind: 'comment', text: shown.join('  ') + (rest > 0 ? `  … +${rest} more` : '') }]);
    }
  }

  /* ---------------------------------------------------------------- *
   * the flashcard view
   * ---------------------------------------------------------------- */

  /** One TUI key, physical or from playback. Returns true when it closed. */
  #tuiKey(key: string): boolean {
    const state = this.tui;
    if (!state) return false;
    if (tuiIsClose(key)) {
      this.#closeTui(false);
      return true;
    }
    if (key === 'ArrowDown' || key === 'j') {
      tuiMove(state, 1);
      this.#touchTui();
    } else if (key === 'ArrowUp' || key === 'k') {
      tuiMove(state, -1);
      this.#touchTui();
    } else if (key === 'Enter') {
      tuiToggle(state);
      this.#touchTui();
    } else if (key === '/') {
      tuiOpenFilter(state);
      this.#touchTui();
      void this.updateComplete.then(() => (this.querySelector('.sem-tui-filter') as HTMLInputElement | null)?.focus());
    }
    return false;
  }

  #onTuiOverlayKeydown(event: KeyboardEvent): void {
    const state = this.tui;
    if (!state) return;
    if ((event.target as HTMLElement | null)?.classList?.contains('sem-tui-filter')) return; // filter owns its keys
    this.#tuiKey(event.key);
    if (['ArrowDown', 'ArrowUp', 'Enter', '/', 'q', 'Escape'].includes(event.key)) event.preventDefault();
  }

  /** `userInitiated` (Escape) also stops a running script — `q` does not. */
  #closeTui(userInitiated: boolean): void {
    this.tui = null;
    if (userInitiated && this.playing) this.#stopPlayback(true);
    this.#inputEl()?.focus();
  }

  #onTuiFilterInput(event: Event): void {
    const state = this.tui;
    if (!state) return;
    tuiSetFilter(state, (event.target as HTMLInputElement).value);
    this.#touchTui();
  }

  #onTuiFilterKeydown(event: KeyboardEvent): void {
    const state = this.tui;
    if (!state) return;
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      tuiCloseFilter(state);
      this.#touchTui();
      (this.querySelector('.sem-tui') as HTMLElement | null)?.focus();
    }
  }

  /** Up/down through history; down past the newest restores the draft. */
  #navigate(delta: number): void {
    const input = this.#inputEl();
    if (!input || this.#history.length === 0) return;
    if (this.#historyIndex === -1) {
      if (delta > 0) return;
      this.#draft = input.value;
      this.#historyIndex = this.#history.length - 1;
    } else {
      this.#historyIndex += delta;
      if (this.#historyIndex >= this.#history.length) {
        this.#historyIndex = -1;
        input.value = this.#draft;
        return;
      }
      if (this.#historyIndex < 0) this.#historyIndex = 0;
    }
    input.value = this.#history[this.#historyIndex];
  }
}

SemElement.register('sem-terminal', SemTerminal);
