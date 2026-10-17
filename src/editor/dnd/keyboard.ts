/**
 * dnd/keyboard — keyboard parity for drag moves (EDITOR.md §5.6):
 *   Alt+↑/↓ (no Shift)          — move within parent (the CONTROLLER owns
 *                                 this chord; not duplicated here)
 *   Alt+Shift+←/↑               — promote: out one level (to the grandparent)
 *   Alt+Shift+→/↓               — demote: into the previous sibling
 *
 * The capture-phase document listener claims ONLY the Alt+Shift+Arrow
 * chord. The controller's element-level handler currently swallows it as a
 * plain move (its `mod` check ignores shiftKey) — capture-first is what
 * keeps this working; the cross-lane patch (`if (!mod || e.shiftKey)
 * return false;`) is requested so the source is fixed too. After that
 * patch this listener remains the sole handler of the chord.
 *
 * Invalid moves are no-ops WITH an aria-live announcement (§5.6/§7).
 */

import { attachKeyboardMovesListener } from './wire-key.js';

export interface KeyboardMovesOptions {
  /** Document to listen on (default `document`). */
  doc?: Document;
  /** Binding resolution override (tests); default walks
   *  `[data-sem-editing]` ancestors via the controller registry. */
  resolve?: (target: EventTarget | null) => { ctx: import('../controller/types.js').EditorContext; rootId: import('../model/types.js').NodeId; label: string } | null;
}

/**
 * Wire keyboard promote/demote. Returns the detach fn.
 */
export function attachKeyboardMoves(options: KeyboardMovesOptions = {}): () => void {
  return attachKeyboardMovesListener(options.doc ?? document, options.resolve);
}
