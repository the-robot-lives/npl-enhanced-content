/**
 * menu/view — the renderer-view preference (CORE-V2 §8.5a/b/c).
 *
 * Canvas is the one default paint (§8.2); the DOM mirror paint becomes the
 * visible view three ways. This module owns the DECISION and the SESSION
 * persistence; the integrating element applies it to the live renderer.
 *
 * Precedence, boot / attribute-change time (`resolveViewChoice`):
 *
 *   1. §8.5a — a refused canvas (`forced-colors`, failed 2d context) pins
 *      `dom` no matter what anything else says. The bound nobody crosses.
 *   2. `renderer="dom"` — the author's pin (§8.5b). `renderer="canvas"` is
 *      the default spelling, not a pin: it loses to the user's stored
 *      switch, exactly like an absent attribute.
 *   3. the stored per-element session switch (§8.5c,
 *      `semtext-view:<element-id>` in sessionStorage).
 *   4. `canvas` — the one default (§8.2).
 *
 * Runtime user switches bypass 2 by design: a user may leave an author's
 * pin for the browsing session (the menu offers the switch "per current
 * view"), but the pin re-applies on the next boot and on any live
 * attribute change.
 */

import type { SelectionRange } from '../screen/types.js';

/** The two paints the element can show (§8.5). */
export type RendererChoice = 'canvas' | 'dom';

export function isRendererChoice(value: unknown): value is RendererChoice {
  return value === 'canvas' || value === 'dom';
}

/** §8.5c — per element, for the browsing session; no cookie, no cross-session. */
export function viewStorageKey(elementId: string): string {
  return `semtext-view:${elementId}`;
}

const STORAGE_KEY_PREFIX = 'semtext-view:';

export function isViewStorageKey(key: string): boolean {
  return key.startsWith(STORAGE_KEY_PREFIX);
}

/** Read the stored switch; anything unreadable/foreign is simply absent. */
export function readStoredView(storage: Storage | null, elementId: string): RendererChoice | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(viewStorageKey(elementId));
    return isRendererChoice(raw) ? raw : null;
  } catch {
    return null; // private mode / disabled storage — the preference just doesn't persist
  }
}

/** Persist the user's switch. Storage failures are silent by design. */
export function writeStoredView(storage: Storage | null, elementId: string, choice: RendererChoice): void {
  if (storage === null) return;
  try {
    storage.setItem(viewStorageKey(elementId), choice);
  } catch {
    // quota / disabled storage — the switch still applies for this page
  }
}

export interface ViewResolution {
  /** The `renderer` attribute as authored (null when absent). */
  attr: string | null;
  /** The stored §8.5c switch, when present and well-formed. */
  stored: RendererChoice | null;
  /** False once the canvas was refused (§8.5a). */
  canvasAvailable: boolean;
}

/** Boot / attribute-change decision (see the precedence table above). */
export function resolveViewChoice(resolution: ViewResolution): RendererChoice {
  if (!resolution.canvasAvailable) return 'dom'; // §8.5a bounds everything
  if (resolution.attr === 'dom') return 'dom'; // §8.5b author pin
  if (resolution.stored !== null) return resolution.stored; // §8.5c user switch
  return 'canvas'; // §8.2 the one default
}

/**
 * The range that selects ring + primary end to end. The end column is
 * deliberately beyond any line width — `extractText` clamps rows but the
 * caller's line text slice simply runs to the line's end.
 */
export function selectAllRange(lineCount: number): SelectionRange | null {
  if (lineCount <= 0) return null;
  return {
    start: { line: 0, col: 0 },
    end: { line: lineCount - 1, col: Number.MAX_SAFE_INTEGER },
  };
}

/**
 * The view-control seam between the element that owns the `renderer`
 * attribute (sem-shell) and the element that owns the context menu
 * (sem-terminal, r2 Wave-B patch). Before a sem-shell subclass attaches,
 * the null control answers honestly about a DOM-only world: the DOM
 * transcript is the only paint, and canvas cannot be switched to.
 */
export interface DomMenuViewControl {
  current(): RendererChoice;
  switchTo(next: RendererChoice): void;
  canvasAvailable(): boolean;
}

export const nullViewControl: DomMenuViewControl = {
  current: () => 'dom',
  switchTo: () => {},
  canvasAvailable: () => false,
};
