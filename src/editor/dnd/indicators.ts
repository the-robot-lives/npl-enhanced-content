/**
 * dnd/indicators — the drop indicator chrome. One fixed-position line per
 * document, appended to `document.body` (outside any binding host, so
 * per-host chrome cleanup never needs to know about it), marked
 * `data-sem-chrome` per the §0 naming contract. Opacity/border only —
 * motion is gated in dnd-css.ts per prefers-reduced-motion (§7).
 */

import { INDICATOR_CLASS } from './types.js';
import type { RectLike } from './geometry.js';

interface IndicatorHandle {
  el: HTMLElement;
}

let active: IndicatorHandle | null = null;

/** Show (or move) the document's single drop indicator at `rect`
 *  (viewport coordinates). */
export function showDropIndicator(doc: Document, rect: RectLike): void {
  if (active === null || !active.el.isConnected) {
    if (active !== null) active.el.remove();
    const el = doc.createElement('div');
    el.className = INDICATOR_CLASS;
    el.setAttribute('data-sem-chrome', '');
    doc.body.appendChild(el);
    active = { el };
  }
  const { el } = active;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${Math.max(0, rect.right - rect.left)}px`;
  el.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;
  el.setAttribute('aria-hidden', 'true');
}

/** Remove the indicator (dragend, Esc cancel, detach). Idempotent. */
export function hideDropIndicator(): void {
  if (active !== null) {
    active.el.remove();
    active = null;
  }
}

/** Test seam: is an indicator visible right now? */
export function dropIndicatorVisible(): boolean {
  return active !== null && active.el.isConnected;
}
