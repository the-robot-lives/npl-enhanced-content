/**
 * menu/types — the context-menu contract (CORE-V2 §8.5).
 *
 * The menu module owns the DOM menu and the view-preference rules; the
 * integrating element (sem-terminal, r2 Wave-B) owns the seams. Everything
 * the menu can do arrives through `MenuHost`, which is what keeps this
 * module unit-testable with a fake host and decoupled from the element's
 * private internals.
 *
 * `MenuHost` deliberately mirrors the user-visible verbs of §8.5 so the
 * same action list can later be rendered by the shared window-chrome
 * actions registry (§8.5 Chrome reuse): Copy, Select all, Paste, Find,
 * the view switch, the plain transcript, and the browser-menu passthrough.
 */

import type { RendererChoice } from './view.js';

/**
 * One menu row. `hint` is the short right-aligned note (a disabled reason
 * or an affordance) — it is presentational and aria-hidden; the accessible
 * name stays the label alone.
 */
export interface MenuItemSpec {
  /** Stable verb id — e2e and tests key off this, never the label. */
  readonly id:
    | 'copy'
    | 'select-all'
    | 'paste'
    | 'find'
    | 'switch-view'
    | 'clear'
    | 'transcript'
    | 'browser-menu';
  readonly label: string;
  /** Disabled items stay focusable (aria-disabled) but never activate. */
  readonly disabled: boolean;
  /** Short right-aligned note; aria-hidden presentational text. */
  readonly hint?: string;
  readonly activate: (host: MenuHost) => void;
}

/**
 * The seams the integrating element supplies (all sync except copy/paste,
 * which ride the clipboard). The menu never reaches into the element.
 */
export interface MenuHost {
  /** §7.4 copy ladder over the live selection (InputModel.copySelection). */
  copySelection(): Promise<boolean> | boolean;
  /** Select the whole buffer (ring + active viewport). */
  selectAll(): void;
  /** Clipboard read → the one paste path; the host owns the failure hint. */
  pasteFromClipboard(): void;
  /** The running app's find verb (the pager's `/`); no-op when none. */
  activateFind(): void;
  /** `clear` (§5.2): viewport clears, scrollback ring survives. */
  clearTerminal(): void;
  /** ring + primary through the one extractText → text/plain in a new context. */
  openTranscript(): void;
  /** The view the element currently paints (§8.5b/c). */
  currentView(): RendererChoice;
  /** Apply the other view and persist it for the browsing session. */
  switchView(to: RendererChoice): void;
  /** False once forced-colors / a failed 2d context refused the canvas (§8.5a). */
  canvasAvailable(): boolean;
  /** Whether the platform grants clipboard READ (§7.4 — Copy always works). */
  clipboardReadAvailable(): boolean;
  /** Whether a running app declares a find verb (§8.5: disabled + hint otherwise). */
  findAvailable(): boolean;
  /**
   * Arm the §8.5c one-shot passthrough: the surface's NEXT `contextmenu`
   * event reaches the browser unmodified (the custom menu closes first).
   * The surface's handler disarms after one event.
   */
  armBrowserPassthrough(): void;
  /** The element surface: aria-haspopup carrier + focus return target. */
  surface(): HTMLElement;
}
