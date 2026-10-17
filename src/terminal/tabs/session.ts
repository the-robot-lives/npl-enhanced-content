/**
 * tabs/session — one shell tab's session (CORE-V2 §11.2, Epoch 3).
 *
 * The POSIX mental model from the tabs model's docstring, made concrete:
 * **each tab owns one session** — a TerminalCore (cwd, env, aliases,
 * history, `$?`), a Screen with its own scrollback ring and alt buffer,
 * the raw/cooked line disciplines, an AppRunner, and a TitleFeed (OSC 0/2
 * titles + OSC 9 status are scoped to the tab's own output stream). The
 * **VFS is shared per element** — every session core is constructed over
 * the same `Vfs` instance, so files and mounts are common while state is
 * not. Background sessions keep running: an app left in a background tab
 * writes into its own screen and is seen again on switch-back.
 *
 * The session owns no DOM and no Lit state. The element (`sem-terminal.ts`)
 * mirrors the ACTIVE session's user-visible slice (`lines`, cwd, appLive,
 * tui) into its reactive properties and routes keys/paste/mouse to the
 * active session's pipeline; callbacks below are the only paths back.
 */

import { AnsiStateMachine } from '../ansi/index.js';
import { AppRunner } from '../app/runner.js';
import { CookedLine, RawLine } from '../line/discipline.js';
import { Screen } from '../screen/screen.js';
import { ScreenFeed } from '../screen/feed.js';
import type { PaintScreen } from '../render/screen-shape.js';
import { TerminalCore, type ShellLine } from '../terminal-core.js';
import { TitleFeed } from '../title/title-feed.js';
import type { TuiState } from '../tui.js';
import type { Vfs } from '../vfs.js';

/** The element-side callbacks a session needs (all routed by tab identity). */
export interface SessionHost {
  /** Append lines to this session's transcript + paint stream. */
  pushLines(session: TerminalSession, lines: ShellLine[]): void;
  /** This session's discipline submitted a line (Enter) — run it. */
  execLine(session: TerminalSession, line: string): void;
  /** Ctrl+L on this session: viewport clears, scrollback kept (§5.2). */
  clearViewport(session: TerminalSession): void;
  /** Mirror the active discipline's buffer/caret into the visible input. */
  mirrorInput(buffer: string, caret: number): void;
  /** This session's app exited (crash message when it crashed). */
  appExit(session: TerminalSession, code: number, crash: string | null): void;
  /** The prompt label for this session (`~`-abbreviated cwd). */
  cwdLabel(session: TerminalSession): string;
}

export class TerminalSession {
  /** Strip position id from the TabModel (`data-tab-id` mirror). */
  tabId = -1;
  readonly core: TerminalCore;
  readonly screen: Screen;
  readonly feed: ScreenFeed;
  readonly raw = new RawLine();
  readonly runner: AppRunner;
  readonly cooked: CookedLine;
  readonly titleFeed = new TitleFeed();
  /** The session's own ANSI state for transcript rendering (per-tab SGR). */
  readonly ansi = new AnsiStateMachine();
  /** The DOM transcript record (mirrored into the element when active). */
  lines: ShellLine[] = [];
  /** A full-screen app owns this session's screen (§6.2). */
  appLive = false;
  /** The flashcard overlay opened by this session (per-tab). */
  tui: TuiState | null = null;
  /** Read-side adapter for the renderer; built lazily per session. */
  paintScreen: PaintScreen | null = null;
  /** The default strip label when no OSC/TAB_TITLE has set one. */
  defaultLabel: string;
  /** Lifecycle unsubscribes taken at registration. */
  offCoreLine: (() => void) | null = null;
  offTitle: (() => void) | null = null;

  constructor(vfs: Vfs, label: string, host: SessionHost) {
    this.defaultLabel = label;
    this.core = new TerminalCore(vfs);
    this.screen = new Screen({ cols: 80, rows: 24 });
    this.feed = new ScreenFeed(this.screen);
    // OSC tokens tap the chrome feeds before they apply (§11.1, XR-1) —
    // scoped to THIS tab's output stream, like a real terminal's tab.
    this.feed.onTokens = (tokens) => this.titleFeed.feed(tokens);
    this.runner = new AppRunner(this.feed, this.screen, this.raw, (code, crash) =>
      host.appExit(this, code, crash),
    );
    this.cooked = new CookedLine(
      {
        emit: (text) => host.pushLines(this, [{ kind: 'comment', text }]),
        clearViewport: () => host.clearViewport(this),
      },
      () => this.core,
      () => host.cwdLabel(this),
      (buffer, caret) => host.mirrorInput(buffer, caret),
      (line) => host.execLine(this, line),
    );
  }

  /** The strip label: the OSC title when set, else the default. */
  get label(): string {
    const title = this.titleFeed.title;
    return title !== '' ? title : this.defaultLabel;
  }
}
