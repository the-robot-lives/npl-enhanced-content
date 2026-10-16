import { html, type PropertyValues, type TemplateResult } from 'lit';
import { ansiSpans, type AnsiSpan } from './ansi/index.js';
import { SemElement } from '../lit/base.js';
import {
  TerminalCore,
  type ExecResult,
  type ShellLine,
  type TabAction,
  type WindowAction,
} from './terminal-core.js';
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
import { attachLocalStorage } from './backends/local-storage.js';
import { createS3Backend } from './backends/s3.js';
import { Screen, lineText } from './screen/screen.js';
import { COLS_MAX, COLS_MIN, ROWS_MAX, ROWS_MIN } from './screen/types.js';
import { abbreviateHome } from './line/discipline.js';
import { TabModel, type ShellTab } from './tabs/tabs-model.js';
import { TerminalSession, type SessionHost } from './tabs/session.js';
import { TitleFeed } from './title/title-feed.js';
import { Vfs } from './vfs.js';
import { onEnvFeed } from './env/direnv.js';
import { InputModel } from './input/index.js';
import {
  ContextMenuController,
  MENU_DOM_CSS,
  nullViewControl,
  openPlainTranscript,
  selectAllRange,
  type DomMenuViewControl,
  type MenuHost,
} from './menu/index.js';
import { createCanvasRenderer } from './render/canvas.js';
import { DOMMirror } from './render/mirror.js';
import { screenView, type PaintScreen, type Rgb } from './render/screen-shape.js';
import type { CanvasRenderer } from './render/canvas.js';
import type { CellMetrics, ScreenRenderer } from './render/types.js';
import { renderTabStrip, renderWindowTitlebar } from '../shared/window-chrome.js';
import '../shared/sem-scroll.js'; // side-effect: register <sem-scroll> (§10)
import type { KeyEvent } from './screen/types.js';
import type { AppSpawnAction } from './terminal-core.js';

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
    /** A full-screen app owns the screen (§6.2) — prompt hidden, keys raw. */
    appLive: { type: Boolean, state: true },
    /** `tabs` — keep the tab strip visible even with a single tab (§11.3). */
    tabs: { type: Boolean },
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
  declare appLive: boolean;
  declare tabs: boolean;

  /* -- shell-v3 tabs (§11.2, Epoch 3): per-tab sessions over one VFS -- */
  /** The ONE virtual file system — files and mounts are common; state is not. */
  readonly #vfs = new Vfs();
  /** Every live session, oldest first (strip order mirrors the TabModel). */
  readonly #sessions: TerminalSession[] = [];
  /** The session the strip points at — the source of every active-path read. */
  #session: TerminalSession;
  /** The session whose execLine is on the stack (direnv TAB_TITLE attribution). */
  #executing: TerminalSession | null = null;
  /** Plugin URLs from the `plugins` attribute — re-loaded per session core. */
  #pluginUrls: string[] = [];
  /** The element-side callbacks sessions call back through. */
  readonly #sessionHost: SessionHost = {
    pushLines: (session, lines) => this.#pushLines(session, lines),
    execLine: (session, line) => this.#execLine(session, line),
    clearViewport: (session) => this.#clearTranscript(session),
    mirrorInput: (buffer, caret) => this.#mirrorInput(buffer, caret),
    appExit: (session, code, crash) => this.#onAppExit(session, code, crash),
    cwdLabel: (session) => abbreviateHome(session.core.state.cwd, session.core.state.env.HOME ?? '/'),
  };

  /** The ACTIVE session's core: per-tab cwd/env/history/aliases over the shared VFS. */
  get core(): TerminalCore {
    return this.#session.core;
  }

  /** The ACTIVE session's screen — its own scrollback ring and alt buffer. */
  get screen(): Screen {
    return this.#session.screen;
  }

  /** The ACTIVE session's OSC chrome feed (§11.1); titles scope to the tab. */
  get titleFeed(): TitleFeed {
    return this.#session.titleFeed;
  }

  #booted = false;
  #playbackHandle: PlaybackHandle | null = null;
  #playbackStopped = false;
  #hasScript = false;

  /* -- shell-v2 canvas paint path (CORE-V2 §8; integration of r2-canvas) -- */
  /** The canvas driver; null until first attach (or after a forced detach). */
  #renderer: (CanvasRenderer & ScreenRenderer) | null = null;
  /** Standalone mirror when the factory itself refused (forced-colors). */
  #mirrorOnly: DOMMirror | null = null;
  /** True when the mirror is the visible view (§8.5 promotion). */
  #domView = false;
  /** Theme ANSI-16 RGB cache — invalidated whenever metrics change. */
  #ansiCache: Array<Rgb | null> = [];

  /* -- shell-v2 chrome (§11; osc-tabs XR-1/XR-3, env-direnv TAB_THEME) -- */
  /** Tab model — ids are strip positions; sessions live in `#sessions`. */
  readonly tabModel = new TabModel('shell');
  /** TAB_TITLE/TAB_THEME from the direnv feed (§12 chrome vars). */
  #tabTheme: string | null = null;
  #offEnv: (() => void) | null = null;
  #offTabs: (() => void) | null = null;
  /** Confirm-close pending on this tab id (a live app owns its screen). */
  #confirmingClose: number | null = null;
  /** Cancels the confirm-close reminder timer. */
  #confirmTimer: (() => void) | null = null;

  /* -- shell-v2 context menu (§8.5; dom-menu integrate patch) -- */
  #browserPassthroughArmed = false;
  #menu = new ContextMenuController(this.#menuHost());
  /** The surface the input model is attached to (attach is not idempotent). */
  #inputSurface: HTMLElement | null = null;

  /* -- shell-v2 core-screen wiring (CORE-V2 §4–§8) -- */
  /**
   * The ONE input path (§7.5): physical keys (via the input element's
   * keydown), playback `pressKey`, and programmatic `sendKeys` all land in
   * the same pipeline — routed to the ACTIVE session below. The DOM surface
   * attach (hidden input, mouse, selection) stays OFF while the visible
   * `<input>` is the IME surface — it flips on with the canvas renderer,
   * whose canvas has no native input surface.
   */
  readonly #input = new InputModel({
    dispatchKey: (ev) => this.#routeKey(ev),
    isRawMode: () => this.appLive,
    isAltScreen: () => this.screen.altScreen,
    insertCooked: (text) => this.#insertCooked(text),
    pasteRaw: (text) => {
      if (this.appLive) this.#session.runner.paste(text);
    },
    dispatchMouse: (info) => {
      this.#session.runner.mouse(info);
    },
    onWheelScroll: (dy) => {
      this.screen.scrollBy(dy);
      this.requestUpdate();
      return true;
    },
    // Mouse selection moves between frames — refresh so the drag paints.
    rowToAbsoluteLine: (row) => {
      this.requestUpdate();
      return row + this.screen.viewportTop();
    },
    // Only valid post-attach (canvas request 7); the placeholder covers
    // the pre-attach window (happy-dom, first frames).
    metrics: () => {
      const live = this.#renderer?.metrics();
      if (live !== undefined && live.cols > 0) {
        return { cols: live.cols, rows: live.rows, cellWidth: live.cellWidth, cellHeight: live.cellHeight };
      }
      return { cols: this.screen.cols, rows: this.screen.rows, cellWidth: 8, cellHeight: 16 };
    },
    getLineText: (line) => {
      const l = this.screen.lineAt(line);
      return l === null ? '' : lineText(l);
    },
    openContextMenu: (anchor) => {
      if (this.#browserPassthroughArmed) {
        this.#browserPassthroughArmed = false;
        return; // one-shot native-menu passthrough (§8.5c Browser menu…)
      }
      this.#menu.open(anchor);
    },
  });

  constructor() {
    super();
    // Session 1 exists before anything reads `this.core`. The TabModel
    // self-seeds its first tab (a shell always has a current session), so
    // the seed session binds to THAT tab instead of adding another.
    this.#session = this.#createSession('shell', this.tabModel.tabs[0]!);
    this.cwd = this.core.state.cwd;
    this.lines = [];
    this.plugins = '';
    this.script = '';
    this.playback = null;
    this.playing = false;
    this.tui = null;
    this.appLive = false;
    this.tabs = false;
    // The strip's active tab IS the active session — the model's changes
    // (add/close/activate/keys) repoint the element here.
    this.#offTabs = this.tabModel.subscribe(() => {
      const id = this.tabModel.activeId;
      if (id !== null) this.#repointSession(id);
      this.requestUpdate();
    });
  }

  /* ---------------------------------------------------------------- *
   * per-tab sessions (§11.2, Epoch 3)
   * ---------------------------------------------------------------- */

  /** Build a session over an EXISTING tab entry (the model owns tab ids). */
  #createSession(label: string, tab: ShellTab): TerminalSession {
    const session = new TerminalSession(this.#vfs, label, this.#sessionHost);
    session.tabId = tab.id;
    this.#setupCoreBase(session);
    this.#sessions.push(session);
    return session;
  }

  /** Non-virtual per-session wiring: s3 kind, core lines, OSC titles. */
  #setupCoreBase(session: TerminalSession): void {
    session.core.mountKinds.set('s3', {
      id: 's3',
      help: 'S3 bucket over https (read-only unless the page sets a signer)',
      create: (args: string[]) => createS3Backend(args, session.core.s3Signer ?? undefined),
    });
    // Shared-VFS errors route to whichever tab is on screen.
    this.#vfs.onError = (error) => {
      this.#pushLines(this.#session, [{ kind: 'stderr', text: `${error.backend}: ${error.path}: ${error.message}` }]);
    };
    session.offCoreLine = session.core.onLine((line) => this.#pushLines(session, [line]));
    // Per-tab titles (§11.3): the session's OSC 0/2 title (and TAB_TITLE
    // via setTitle) names its strip entry; the active feed also paints the
    // title bar, so its changes re-render.
    session.offTitle = session.titleFeed.subscribe(() => {
      this.tabModel.setTitle(session.tabId, session.label);
      if (session === this.#session) this.requestUpdate();
    });
  }

  /**
   * Per-session command setup. The base class loads nothing; hosts with
   * bundled plugins mount them on EVERY session core (sem-shell overrides
   * this), and the `plugins` attribute URLs re-load per session. `emit`
   * appends transcript lines to THIS session (hook time may precede the
   * session becoming active, so `appendLines` would land elsewhere).
   * Called once per session, after it becomes addressable.
   */
  protected configureSessionCore(_core: TerminalCore, _emit: (lines: ShellLine[]) => void): void {
    void _core;
    void _emit;
  }

  /** Run the (virtual) command setup + the `plugins` attribute URLs. */
  #hookSession(session: TerminalSession): void {
    this.configureSessionCore(session.core, (lines) => this.#pushLines(session, lines));
    for (const url of this.#pluginUrls) {
      void session.core.loadPluginFromUrl(url).then((result) => {
        if (result.ok && result.plugin) {
          this.#pushLines(session, [{ kind: 'stdout', text: `plugin loaded: ${result.plugin.name} ${result.plugin.version}` }]);
        } else {
          this.#pushLines(session, [{ kind: 'stderr', text: `plugin ${url}: ${result.error}` }]);
        }
      });
    }
  }

  /** Transcript + paint append for ONE session (background-safe). */
  #pushLines(session: TerminalSession, newLines: ShellLine[]): void {
    // Every shell-emitted kind streams onto the session's grid — the canvas
    // is the paint path (§8); texts carry no separators: each ends CRLF.
    for (const line of newLines) {
      session.feed.write(`${line.text}\r\n`);
    }
    session.lines = [...session.lines, ...newLines];
    if (session === this.#session) this.lines = session.lines;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', 'Terminal');
    // .envrc chrome feeds — TAB_TITLE titles the tab whose cd loaded it
    // (attributed through #executing), TAB_THEME the tab strip (§11.3/§12).
    this.#offEnv?.();
    this.#offEnv = onEnvFeed((feed) => {
      const session = this.#executing ?? this.#session;
      const title = feed.vars.TAB_TITLE;
      if (title !== undefined) session.titleFeed.setTitle(title);
      const theme = feed.vars.TAB_THEME;
      if (theme !== undefined) this.#applyTabTheme(theme);
    });
    if (!this.#booted) {
      this.#booted = true;
      this.replaceChildren(); // the authored zero-JS transcript is replaced
      this.lines = [{ kind: 'stdout', text: 'sem-terminal — type help.' }];
      this.#pluginUrls = this.plugins.split(/\s+/).filter((url) => url !== '');
      this.#attachStorage();
      this.#hookSession(this.#session); // bundled plugins + attribute URLs
      this.#maybeStartPlayback();
    }
    // The canvas surface needs a rendered frame first; reconnects re-run
    // this and the guard makes it idempotent (§8 attach).
    void this.updateComplete.then(() => this.#ensureRenderer());
    this.#applyTabTheme();
    this.#menu.attach();
    this.#injectMenuCss();
  }

  disconnectedCallback(): void {
    this.#stopPlayback(false);
    this.#menu.detach();
    this.#input.detach();
    this.#inputSurface = null;
    this.#offEnv?.();
    this.#offEnv = null;
    // Per-session subscriptions (core lines, OSC titles) and the TabModel
    // subscription live for the element's lifetime — sessions and the
    // model outlive a disconnect, so nothing is torn down here.
    // Reconnect re-attaches: the guard + firstUpdated cover both paths.
    this.#renderer?.detach();
    this.#renderer = null;
    this.#mirrorOnly?.detach();
    this.#mirrorOnly = null;
    this.#domView = false;
    super.disconnectedCallback();
  }

  protected firstUpdated(): void {
    this.#ensureRenderer();
  }

  /** Drain the screen's damage batch after every render (§8: per frame). */
  protected override updated(_changed: PropertyValues): void {
    this.#drain();
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
    this.markScripted();
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

  /** Where a playback key lands: the TUI when open, else the input path —
   * the SAME pipeline physical keys take (§7.5). */
  #playbackKey(key: string): void {
    if (this.tui) {
      this.#tuiKey(key);
      return;
    }
    this.#input.handleSingleKey(key);
  }

  /** Programmatic keys (§7.5): the sendKeys grammar — typing's twin. */
  sendKeys(spec: string): void {
    this.#input.sendKeys(spec);
  }

  /** The InputHost dispatch seam: raw → the active app, cooked → its discipline. */
  #routeKey(ev: KeyEvent): void {
    if (this.appLive) {
      this.#session.runner.key(ev);
      this.#touchApp();
      return;
    }
    const input = this.#inputEl();
    if (input) {
      const caret = input.selectionStart ?? input.value.length;
      this.#session.cooked.syncFrom(input.value, caret);
    }
    this.#session.cooked.key(ev);
    this.#mirrorInput(this.#session.cooked.buffer, this.#session.cooked.caret);
  }

  /** Cooked paste/composition insert: one key event per code point. */
  #insertCooked(text: string): void {
    for (const char of text) {
      this.#session.cooked.key({ key: char, ctrl: false, alt: false, shift: false, meta: false });
    }
    this.#mirrorInput(this.#session.cooked.buffer, this.#session.cooked.caret);
  }

  /** The replay button: stop where it is, start over. */
  #restartPlayback(): void {
    const steps = this.#scriptSteps();
    if (!steps) return;
    this.#startPlayback(steps);
  }

  /**
   * The replay button: stop where it is, start over. A subclass may replay
   * through a different channel — sem-shell's start-script autostart keeps
   * its own handle and re-attaches it here.
   */
  protected replayScript(): void {
    this.#restartPlayback();
  }

  /**
   * The element has a replayable script — the boot `script`/`playback` flow
   * marks itself; a subclass channel (start-script, fetched or inline) calls
   * this so the replay button renders for it too (r2 follow-up: the FETCH
   * flow never saw `#hasScript`).
   */
  protected markScripted(): void {
    if (!this.#hasScript) {
      this.#hasScript = true;
      this.requestUpdate();
    }
  }

  /* ---------------------------------------------------------------- *
   * render
   * ---------------------------------------------------------------- */

  render(): TemplateResult {
    const tabs = this.tabModel.tabs;
    // Alt screen: no scrollback — total==visible hides the scrollbar (§10).
    const total = this.screen.altScreen ? this.screen.rows : this.screen.totalLines();
    return html`
      <div class="sem-shell-frame" @click=${this.#focusInput} @keydown=${this.#onFrameKeydown}>
        ${renderWindowTitlebar({ title: this.titleFeed.title || 'sem shell', tone: this.titleFeed.status.tone })}
        ${tabs.length > 1 || this.tabs
          ? html`<div class="sem-term-tabs" @click=${this.#onTabStripClick} @keydown=${this.#onTabStripKeydown}>
              ${renderTabStrip({
                tabs: tabs.map((tab) => ({
                  id: String(tab.id),
                  title: tab.id === this.#confirmingClose ? `${tab.title} — confirm close?` : tab.title,
                  active: tab.id === this.tabModel.activeId,
                })),
                label: 'Shell tabs',
                closable: true,
              })}
              <button
                type="button"
                class="sem-window-tab-new"
                aria-label="New tab"
                title="New tab (Ctrl+Shift+T)"
                @click=${() => this.#newTab()}
              >
                +
              </button>
            </div>`
          : null}
        ${this.#hasScript
          ? html`<button type="button" class="sem-shell-replay" aria-label="Replay the scripted demo" @click=${() => this.replayScript()}>
              replay
            </button>`
          : null}
        <div class="sem-term-surface">
          <sem-scroll
            class="sem-term-scrollbar"
            .total=${total}
            .visible=${this.screen.rows}
            .offset=${this.screen.viewportTop()}
            .onscrollto=${(row: number) => this.#onScrollTo(row)}
          ></sem-scroll>
        </div>
        <div class="sem-shell-transcript" role="log" aria-live="polite" aria-label="Shell transcript">
          ${this.lines.map((line) => this.#renderLine(line))}
        </div>
        ${this.appLive ? null : this.tui ? this.#renderTui() : this.#renderPrompt()}
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
    // stdout/stderr stream through the ANSI tokeniser — the ACTIVE session's
    // own machine, so attributes persist across its lines like a real
    // terminal (and never leak across tabs). Every other kind is shell
    // chrome: bypass the parser, render verbatim.
    if (line.kind !== 'stdout' && line.kind !== 'stderr') {
      return html`<div class=${cls}>${line.text}</div>`;
    }
    const spans = ansiSpans(line.text, this.#session.ansi);
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
    this.#pushLines(this.#session, newLines);
  }

  /* ---------------------------------------------------------------- *
   * canvas paint path (§8) — the r2-canvas integration
   * ---------------------------------------------------------------- */

  /** Attach the renderer once the surface exists; idempotent on reconnect. */
  #ensureRenderer(): void {
    if (this.#renderer !== null || this.#domView) return;
    const surface = this.querySelector('.sem-term-surface');
    if (!(surface instanceof HTMLElement)) return;
    const result = createCanvasRenderer({
      onUnavailable: () => {
        // §8.5: the mirror IS the a11y tree; promote it to the view. The
        // renderer mounts its own mirror at attach, so useDomView is all.
        this.#domView = true;
        this.#renderer?.useDomView();
        this.dataset.paint = 'dom';
        this.#markCanvasUnavailable();
      },
      onMetricsChange: (metrics) => this.#onMetrics(metrics),
    });
    if (!result.ok) {
      this.#markCanvasUnavailable();
      this.#startMirrorOnly(surface, result.reason);
      return;
    }
    const renderer = result.renderer;
    // Bridge sem-shell's §8.5 view preference onto the live renderer —
    // BEFORE markCanvasAvailable re-resolves and applies the choice. An
    // author-installed delegate (or the shell's test seam) wins untouched.
    const shell = this as {
      viewDelegate?: (choice: 'canvas' | 'dom') => void;
      markCanvasAvailable?: () => void;
    };
    if (shell.viewDelegate == null) {
      shell.viewDelegate = (choice) => {
        if (choice === 'dom') {
          renderer.useDomView();
          this.dataset.paint = 'dom';
        } else {
          renderer.useCanvasView();
          this.dataset.paint = 'canvas';
        }
      };
    }
    this.#renderer = renderer;
    renderer.attach(this.#paintScreenFor(this.#session), surface);
    this.dataset.paint = 'canvas';
    shell.markCanvasAvailable?.();
    // The paint path owns the input surface from here on (bat lane's
    // required flip — core-screen deviation 2): hidden input (IME/paste),
    // mouse/selection, wheel, and the context menu all ride the surface.
    this.#ensureInputAttached(surface);
    this.#onMetrics(renderer.metrics());
  }

  /** §8.5a: the shell (when present) learns the canvas proved available. */
  #markCanvasAvailable(): void {
    (this as { markCanvasAvailable?: () => void }).markCanvasAvailable?.();
  }

  #markCanvasUnavailable(): void {
    (this as { markCanvasUnavailable?: () => void }).markCanvasUnavailable?.();
  }

  /**
   * Factory refused (forced-colors): mount a standalone mirror as the
   * visible view; #drain drives it directly.
   */
  #startMirrorOnly(surface: HTMLElement, reason: 'forced-colors' | 'no-2d-context'): void {
    void reason; // the state attribute records it; the paint is the same
    const view = this.ownerDocument?.defaultView ?? undefined;
    const mirror = new DOMMirror({
      schedule: (fn, ms) => {
        if (view === undefined) {
          fn();
          return () => {};
        }
        const id = view.setTimeout(fn, ms);
        return () => view.clearTimeout(id);
      },
      now: () => (view !== undefined && typeof view.performance?.now === 'function' ? view.performance.now() : Date.now()),
    });
    mirror.attach(this.#paintScreenFor(this.#session), surface);
    mirror.setVisible(true);
    this.#mirrorOnly = mirror;
    this.#domView = true;
    this.dataset.paint = 'dom';
    // The mirror-only fallback paints the same surface — the input rides it
    // there too (wheel, selection, context menu have no canvas to lean on).
    this.#ensureInputAttached(surface);
  }

  /**
   * Attach the input model to the paint surface exactly once per surface
   * (InputModel.attach is not idempotent — double-attach leaks listeners).
   */
  #ensureInputAttached(surface: HTMLElement): void {
    if (this.#inputSurface === surface) return;
    this.#input.detach();
    this.#input.attach(surface);
    this.#inputSurface = surface;
  }

  /**
   * The renderer's read-side adapter, built lazily PER SESSION — it reads
   * that session's screen and truecolour map (the renderer re-attaches to
   * the next session's adapter on tab switch; §11.2 switch = swap screens).
   */
  #paintScreenFor(session: TerminalSession): PaintScreen {
    if (session.paintScreen === null) {
      session.paintScreen = screenView(session.screen, {
        truecolorAt: (slot) => session.feed.truecolor.at(slot),
        ansiRgb: (index) => this.#themeAnsi(index),
      });
    }
    return session.paintScreen;
  }

  /** Metrics settled (attach, font load, zoom): refit the screen (§8.3). */
  #onMetrics(metrics: CellMetrics): void {
    this.#ansiCache = [];
    if (metrics.cols <= 0 || metrics.rows <= 0) return;
    const cols = Math.max(COLS_MIN, Math.min(COLS_MAX, metrics.cols));
    const rows = Math.max(ROWS_MIN, Math.min(ROWS_MAX, metrics.rows));
    if (cols !== this.screen.cols || rows !== this.screen.rows) {
      this.screen.resize(cols, rows);
      this.#session.runner.onScreenResized(cols, rows);
    }
    // Keep the surface exactly rows tall: auto-height pages (the demo
    // cards) wrap the terminal in normal flow, and the canvas is 100% of
    // the surface box. Guarded so the resize observer settles, not loops.
    const surface = this.querySelector('.sem-term-surface');
    if (surface instanceof HTMLElement) {
      const height = Math.round(rows * metrics.cellHeight);
      if (Math.abs(surface.clientHeight - height) > 1) surface.style.height = `${height}px`;
    }
    this.requestUpdate();
  }

  /** The batched damage repaint — one call per frame (§8 drain). */
  #drain(): void {
    if (this.#renderer === null && this.#mirrorOnly === null) return;
    const damage = this.screen.takeDamage();
    if (this.#renderer !== null) this.#renderer.drain(damage);
    else this.#mirrorOnly?.drain(damage);
  }

  /** Theme ANSI-16 from the --sem-ansi-N tokens, cached until metrics move. */
  #themeAnsi(index: number): Rgb | null {
    const cached = this.#ansiCache[index];
    if (cached !== undefined) return cached;
    const view = this.ownerDocument?.defaultView;
    let rgb: Rgb | null = null;
    if (view !== null && view !== undefined && typeof view.getComputedStyle === 'function') {
      rgb = parseRgbToken(view.getComputedStyle(this).getPropertyValue(`--sem-ansi-${index}`).trim());
    }
    this.#ansiCache[index] = rgb;
    return rgb;
  }

  /** TAB_THEME (§12): frame attribute hook — theming styles stay in the lane's CSS block. */
  #applyTabTheme(theme?: string): void {
    if (theme !== undefined) this.#tabTheme = theme;
    const frame = this.querySelector('.sem-shell-frame');
    if (frame !== null) frame.setAttribute('data-sem-tab-theme', this.#tabTheme ?? 'default');
  }

  /** Scrollbar request (§10): move the viewport, drain follows in updated(). */
  #onScrollTo(row: number): void {
    this.screen.scrollTo(row);
    this.requestUpdate();
  }

  /* ---------------------------------------------------------------- *
   * context menu (§8.5c) — the dom-menu lane's MenuHost seams
   * ---------------------------------------------------------------- */

  /** sem-shell's view control when present; a null object otherwise. */
  #shellView(): DomMenuViewControl {
    return (this as { semView?: DomMenuViewControl }).semView ?? nullViewControl;
  }

  #menuHost(): MenuHost {
    const self = this;
    return {
      copySelection: () => self.#input.copySelection(),
      selectAll: () => {
        const range = selectAllRange(self.screen.totalLines());
        if (range === null) return;
        self.#input.selection.begin(0, 0, false);
        self.#input.selection.extend(range.end.line, range.end.col);
        self.screen.setSelection(range);
      },
      pasteFromClipboard: () => {
        void navigator.clipboard
          ?.readText()
          .then((text) => self.#input.handlePaste(text))
          .catch(() => self.appendLines([{ kind: 'stderr', text: 'clipboard read refused' }]));
      },
      activateFind: () => self.#session.runner.app?.find?.(),
      clearTerminal: () => self.#execLine(self.#session, 'clear'),
      openTranscript: () => {
        const view = self.ownerDocument?.defaultView;
        if (view !== null && view !== undefined) openPlainTranscript(self.screen.extractText(null), view);
      },
      currentView: () => self.#shellView().current(),
      switchView: (to) => self.#shellView().switchTo(to),
      canvasAvailable: () => self.#shellView().canvasAvailable(),
      clipboardReadAvailable: () => typeof navigator.clipboard?.readText === 'function',
      findAvailable: () => self.#session.runner.app?.find !== undefined,
      armBrowserPassthrough: () => {
        self.#browserPassthroughArmed = true;
      },
      surface: () => self,
    };
  }

  /** The menu's stylesheet: one <style> per document, guarded by marker. */
  #injectMenuCss(): void {
    const doc = this.ownerDocument;
    if (doc === null || typeof doc.createElement !== 'function') return;
    const styles = doc.querySelectorAll('style');
    for (const style of styles) {
      if (style.textContent?.includes('── shell-v2-dom-menu ──')) return;
    }
    const sheet = doc.createElement('style');
    sheet.textContent = MENU_DOM_CSS;
    doc.head?.appendChild(sheet);
  }

  /* ---------------------------------------------------------------- *
   * tab strip + sessions (§11.2/§11.3, Epoch 3)
   * ---------------------------------------------------------------- */

  /** Strip clicks: close buttons by data-tab-close, else activate the tab. */
  #onTabStripClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const close = target?.closest('[data-tab-close]');
    if (close !== null) {
      const id = Number((close as HTMLElement).getAttribute('data-tab-close'));
      if (Number.isFinite(id)) void this.#closeTab(id);
      return;
    }
    const tab = target?.closest('[role="tab"]');
    const id = tab === null || tab === undefined ? Number.NaN : Number((tab as HTMLElement).getAttribute('data-tab-id'));
    if (Number.isFinite(id)) this.#activateTab(id);
  }

  /** Strip keys (§11.2): roving focus — ArrowLeft/Right/Home/End. */
  #onTabStripKeydown(event: KeyboardEvent): void {
    const target = this.tabModel.stripKeyToTarget(event.key);
    if (target === null) return;
    event.preventDefault();
    this.#activateTab(target);
    (this.querySelector(`[data-tab-id="${target}"]`) as HTMLElement | null)?.focus();
  }

  #activateTab(id: number): void {
    // The #offTabs subscription repoints the session + swaps the paint.
    this.tabModel.activate(id);
  }

  /**
   * Follow the TabModel's active tab: mirror the session's user-visible
   * slice and move the paint path onto its screen. A background session
   * keeps running — an app left behind writes into its own screen and is
   * seen again on switch-back.
   */
  #repointSession(id: number): void {
    const next = this.#sessions.find((session) => session.tabId === id);
    if (next === undefined || next === this.#session) return;
    const previous = this.#session;
    // Drop the outgoing view's pending damage; the screen itself is kept.
    previous.screen.takeDamage();
    this.#session = next;
    this.lines = next.lines;
    this.cwd = next.core.state.cwd;
    this.appLive = next.appLive;
    this.tui = next.tui;
    const surface = this.querySelector('.sem-term-surface');
    if (surface instanceof HTMLElement) {
      if (this.#renderer !== null) {
        this.#renderer.detach();
        this.#renderer.attach(this.#paintScreenFor(next), surface);
        // Preserve the §8.5 view choice across the re-attach.
        if (this.dataset.paint === 'dom') this.#renderer.useDomView();
      } else if (this.#mirrorOnly !== null) {
        this.#mirrorOnly.detach();
        this.#mirrorOnly.attach(this.#paintScreenFor(next), surface);
        this.#mirrorOnly.setVisible(true);
      }
    }
    // The visible input adopts the session's own editing buffer.
    const input = this.#inputEl();
    if (input !== null) {
      input.value = next.cooked.buffer;
      try {
        input.setSelectionRange(next.cooked.caret, next.cooked.caret);
      } catch {
        // input types without selection support — value is enough
      }
    }
    this.requestUpdate();
  }

  /** New tab (Ctrl+Shift+T, the + button, `tab new`): a fresh session. */
  #newTab(label?: string): void {
    const name = label?.trim() ?? '';
    const tab = this.tabModel.add(name === '' ? `shell ${this.tabModel.count + 1}` : name);
    if (tab === null) {
      this.#pushLines(this.#session, [{ kind: 'stderr', text: 'tab: the shell is at its 9-tab limit' }]);
      return;
    }
    const session = this.#createSession(tab.title, tab);
    this.#hookSession(session); // the new core gets the same command set
    this.#repointSession(session.tabId);
  }

  /**
   * Close by id. A full-screen app is asked first: the first ×/Ctrl+Shift+W
   * on a live tab announces and arms a short confirm; the second acts
   * (§11.2). The last tab never closes. Returns true when a tab closed.
   */
  #closeTab(id: number | null): boolean {
    if (id === null || this.tabModel.count <= 1) return false;
    const session = this.#sessions.find((entry) => entry.tabId === id);
    if (session === undefined) return false;
    if (session.appLive && this.#confirmingClose !== id) {
      this.#confirmingClose = id;
      this.#pushLines(session, [
        { kind: 'comment', text: `tab: "${session.label}" is running a full-screen app — close again to confirm` },
      ]);
      const view = this.ownerDocument?.defaultView ?? window;
      const timer = view.setTimeout(() => {
        if (this.#confirmingClose === id) {
          this.#confirmingClose = null;
          this.requestUpdate();
        }
      }, 4_000);
      this.#confirmTimer?.();
      this.#confirmTimer = () => view.clearTimeout(timer);
      this.requestUpdate();
      return false;
    }
    this.#confirmingClose = null;
    this.#confirmTimer?.();
    this.#confirmTimer = null;
    if (session.appLive) session.runner.requestInterrupt(); // exit 130, then close
    if (!this.tabModel.close(id)) return false;
    this.#disposeSession(session);
    return true;
  }

  /** Drop a closed tab's session: unsubscribe, leave the strip order. */
  #disposeSession(session: TerminalSession): void {
    session.offCoreLine?.();
    session.offTitle?.();
    const index = this.#sessions.indexOf(session);
    if (index !== -1) this.#sessions.splice(index, 1);
  }

  /** The `tab` builtin's action (the core stays DOM-free; data only). */
  #onTabAction(session: TerminalSession, action: TabAction): void {
    switch (action.op) {
      case 'new': {
        const before = this.tabModel.count;
        this.#newTab(action.target);
        if (this.tabModel.count > before) {
          this.#pushLines(session, [{ kind: 'comment', text: `tab: opened ${this.#session.label}` }]);
        }
        return;
      }
      case 'close': {
        const id = this.#tabIdFromPosition(action.target);
        if (id === null) {
          this.#pushLines(session, [{ kind: 'stderr', text: `tab close: no tab at position ${action.target ?? '(missing)'}` }]);
          return;
        }
        const label = this.#sessions.find((entry) => entry.tabId === id)?.label ?? `tab ${id}`;
        if (this.tabModel.count <= 1) {
          this.#pushLines(session, [{ kind: 'stderr', text: 'tab close: the last tab stays open' }]);
          return;
        }
        this.#confirmingClose = id; // an explicit command needs no double ask
        this.#closeTab(id);
        this.#pushLines(session, [{ kind: 'comment', text: `tab: closed ${label}` }]);
        return;
      }
      case 'rename': {
        const name = (action.target ?? '').trim();
        const id = this.tabModel.activeId;
        if (id === null || !this.tabModel.setTitle(id, name)) {
          this.#pushLines(session, [{ kind: 'stderr', text: 'tab rename: give the active tab a new name (`tab rename <name>`)' }]);
          return;
        }
        this.#pushLines(session, [{ kind: 'comment', text: `tab: renamed tab ${this.tabModel.indexOf(id) + 1} to "${name}"` }]);
        return;
      }
      case 'list': {
        const lines: ShellLine[] = [];
        const tabs = this.tabModel.tabs;
        for (let i = 0; i < tabs.length; i++) {
          const tab = tabs[i]!;
          const live = this.#sessions.some((entry) => entry.tabId === tab.id && entry.appLive);
          const marker = tab.id === this.tabModel.activeId ? '*' : ' ';
          lines.push({ kind: 'stdout', text: `${i + 1}${marker} ${tab.title}${live ? '  (app running)' : ''}` });
        }
        this.#pushLines(session, lines);
        return;
      }
    }
  }

  /** `tab close [n]`: 1-based strip position → tab id; default the active. */
  #tabIdFromPosition(position: string | undefined): number | null {
    if (position === undefined) return this.tabModel.activeId;
    const tab = this.tabModel.tabs[Number(position) - 1];
    return tab?.id ?? null;
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
    // The discipline owns history/draft; the form path submits externally.
    const cooked = this.#session.cooked;
    cooked.syncFrom(value, value.length);
    cooked.onSubmit(value);
    input.value = '';
    this.#execLine(this.#session, value);
  }

  /**
   * Run one line in ONE session (usually the active one). The `#executing`
   * bracket attributes synchronous side channels fired inside the pipeline
   * — the direnv TAB_TITLE feed — to the session whose `cd` caused them.
   */
  #execLine(session: TerminalSession, value: string): void {
    this.#executing = session;
    let result: ExecResult;
    try {
      result = session.core.execLine(value);
    } finally {
      this.#executing = null;
    }
    if (session === this.#session) this.cwd = result.state.cwd;
    if (result.clear) {
      this.#clearTranscript(session);
    } else {
      this.#pushLines(session, result.lines);
    }
    for (const action of result.actions) {
      if (action.kind === 'window') this.#openWindow(action);
      else if (action.kind === 'tui') this.#openTui(session, action);
      else if (action.kind === 'app') this.#spawnApp(session, (action as AppSpawnAction).app);
      else if (action.kind === 'tab') this.#onTabAction(session, action);
    }
  }

  /**
   * `clear` / Ctrl+L (§5.2): the DOM transcript empties, parser attribute
   * state resets, and the SCREEN keeps its scrollback — only the viewport
   * clears (§4.6), so the plain-transcript ring survives the wipe. The
   * session owns each of those state pieces.
   */
  #clearTranscript(session: TerminalSession = this.#session): void {
    session.lines = [];
    session.ansi.reset();
    session.feed.reset();
    session.screen.clearViewport();
    session.titleFeed.reset();
    if (session === this.#session) this.lines = [];
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

  #openTui(session: TerminalSession, action: TuiAction): void {
    session.tui = createTuiState(action.cards, action.title);
    this.tui = session.tui;
    void this.updateComplete.then(() => (this.querySelector('.sem-tui') as HTMLElement | null)?.focus());
  }

  #touchTui(): void {
    if (this.tui) {
      this.tui = { ...this.tui }; // new reference → Lit re-renders
      this.#session.tui = this.tui;
    }
  }

  /**
   * The §6.3 Escape ladder, raw-app aware: an attached app owns Escape
   * first (its key), then the filter row, the TUI, then playback stop.
   * Ctrl+C during an app interrupts it with exit 130 (§6.3).
   */
  #onFrameKeydown(event: KeyboardEvent): void {
    // Tab chrome (§11.3) outranks everything, including the app ladder:
    // Ctrl+Shift+T opens a tab, Ctrl+Shift+W closes the active one (a live
    // app gets a confirm), Ctrl+PgUp/PgDn cycle, Alt+1..9 jump.
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        this.#newTab();
        return;
      }
      if (key === 'w') {
        event.preventDefault();
        this.#closeTab(this.tabModel.activeId);
        return;
      }
    }
    // Ctrl+PgUp/PgDn cycle, Alt+1..9 jump. Only meaningful past one tab.
    if (this.tabModel.count > 1) {
      const target = this.tabModel.keyToTarget({
        key: event.key,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
      if (target !== null) {
        event.preventDefault();
        this.#activateTab(target);
        return;
      }
    }
    if (this.appLive) {
      if (event.key === 'c' && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        this.#session.runner.requestInterrupt();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#session.runner.key({ key: 'Escape', ctrl: false, alt: false, shift: false, meta: false });
        this.#touchApp();
      }
      return;
    }
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

  /**
   * Keys land in the CookedLine discipline (§5.2) — the v1 semantics,
   * relocated: history-with-draft, completion, the control table. The
   * visible input is adopted before each key (IME/drag stay native) and
   * re-mirrored after. Raw mode hands keys to the app instead (§5.3).
   */
  #onKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (this.appLive) {
      event.preventDefault();
      this.#input.handleKey(toKeyEvent(event));
      this.#touchApp();
      return;
    }
    const caret = input.selectionStart ?? input.value.length;
    this.#session.cooked.syncFrom(input.value, caret);
    if (this.#session.cooked.key(toKeyEvent(event))) {
      event.preventDefault();
      this.#mirrorInput(this.#session.cooked.buffer, this.#session.cooked.caret);
    }
  }

  /** Push discipline state back into the visible input (the IME surface). */
  #mirrorInput(buffer: string, caret: number): void {
    const input = this.#inputEl();
    if (!input || input.value === buffer) return;
    input.value = buffer;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // input types without selection support — value is enough
    }
  }

  /* ---------------------------------------------------------------- *
   * full-screen apps (§6)
   * ---------------------------------------------------------------- */

  /** Spawn an app action from the session's core: alt screen, raw keys. */
  #spawnApp(session: TerminalSession, app: import('./screen/types.js').App): void {
    if (!session.runner.spawn(app)) return;
    session.appLive = true;
    if (session === this.#session) this.appLive = true;
    void this.updateComplete.then(() => {
      this.#input.focus(); // the canvas has no native focus surface
      this.#touchApp();
    });
  }

  /** Runner exit callback: status line + `$?`, prompt restored (§6.2). */
  #onAppExit(session: TerminalSession, code: number, crash: string | null): void {
    session.appLive = false;
    session.core.state.lastStatus = code;
    const lines: ShellLine[] = [];
    if (crash !== null) lines.push({ kind: 'stderr', text: `${crash}` });
    lines.push({ kind: 'status', text: `exit ${code}` });
    this.#pushLines(session, lines);
    if (session === this.#session) {
      this.appLive = false;
      void this.updateComplete.then(() => this.#inputEl()?.focus());
    }
  }

  /** The screen changed under the app: repaint via drain + park the IME. */
  #touchApp(): void {
    this.requestUpdate();
    const metrics = this.#renderer?.metrics();
    if (metrics === undefined || metrics.cellHeight <= 0) return;
    if (this.screen.altScreen && this.screen.cursor.visible) {
      // IME caret parking (canvas request 7): sit at the app's cursor cell.
      // Alt rows are the full viewport; clamp guards the scroll edge case.
      const row = Math.max(0, Math.min(this.screen.rows - 1, this.screen.cursor.line - this.screen.viewportTop()));
      const col = Math.max(0, Math.min(this.screen.cols - 1, this.screen.cursor.col));
      this.#input.moveCursorHint(col * metrics.cellWidth, row * metrics.cellHeight);
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

  /** Up/down through history; down past the newest restores the draft.
   * Thin delegate — playback and tests drive this; the state of record
   * lives in the CookedLine discipline (§5.2). */
  #navigate(delta: number): void {
    const input = this.#inputEl();
    if (!input) return;
    const caret = input.selectionStart ?? input.value.length;
    const cooked = this.#session.cooked;
    cooked.syncFrom(input.value, caret);
    cooked.key({ key: delta < 0 ? 'ArrowUp' : 'ArrowDown', ctrl: false, alt: false, shift: false, meta: false });
    this.#mirrorInput(cooked.buffer, cooked.caret);
  }
}

SemElement.register('sem-terminal', SemTerminal);

/** DOM KeyboardEvent → the normalized KeyEvent the discipline/app take (§7.1). */
function toKeyEvent(event: KeyboardEvent): KeyEvent {
  return { key: event.key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
}

/**
 * A `--sem-ansi-N` token → RGB for the canvas palette: `#rgb`, `#rrggbb`,
 * `rgb(r g b)` / `rgb(r, g, b)` (computed styles may normalize either way).
 * Anything else → null (the renderer falls back to its default set).
 */
function parseRgbToken(token: string): Rgb | null {
  const value = token.trim();
  if (value === '') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const expanded = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
    const n = Number.parseInt(expanded, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const fn = /^rgba?\(\s*(\d{1,3})[ ,]+(\d{1,3})[ ,]+(\d{1,3})/.exec(value);
  if (fn !== null) {
    const r = Number(fn[1]);
    const g = Number(fn[2]);
    const b = Number(fn[3]);
    if (r <= 255 && g <= 255 && b <= 255) return { r, g, b };
  }
  return null;
}
