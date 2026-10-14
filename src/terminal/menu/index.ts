/**
 * menu — public barrel for the dom-menu lane (CORE-V2 §8.5).
 *
 * The context menu (§8.5c) and the `renderer="dom"` view preference
 * (§8.5b) live here; the integrating element (sem-terminal, r2 Wave-B)
 * constructs `ContextMenuController` against a `MenuHost` bound to its
 * internals and delegates the view choice to the sem-shell subclass via
 * `DomMenuViewControl`. The automatic fallback (§8.5a) is the canvas
 * renderer's refusal signal calling `markCanvasUnavailable()` on the shell.
 */

export { buildMenuItems } from './actions.js';
export { ContextMenuController, type ContextMenuOptions } from './context-menu.js';
export { MENU_DOM_CSS } from './css.js';
export { openPlainTranscript, type TranscriptView } from './transcript.js';
export {
  isRendererChoice,
  isViewStorageKey,
  nullViewControl,
  readStoredView,
  resolveViewChoice,
  selectAllRange,
  viewStorageKey,
  writeStoredView,
  type DomMenuViewControl,
  type RendererChoice,
  type ViewResolution,
} from './view.js';
export type { MenuHost, MenuItemSpec } from './types.js';
