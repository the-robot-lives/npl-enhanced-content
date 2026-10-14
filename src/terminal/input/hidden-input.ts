/**
 * hidden-input — the IME + OS-paste surface (CORE-V2 §7.2).
 *
 * A real terminal needs text services the keyboard events alone cannot
 * give: IME composition and the OS paste menu. v2 keeps a visually hidden
 * <input> as the focus surface in both modes. This is deliberately not the
 * v1 input box: it renders nothing, owns no caret, and is invisible to
 * layout — the drawn cursor is the only caret. Composition events and
 * pastes are forwarded; everything else is the keydown path through
 * normalizeKey.
 */

import { normalizeKey } from './keys.js';
import type { KeyEvent } from './types.js';

export interface HiddenInputHost {
  /** A normalized key; true = consumed (the DOM default is prevented). */
  onKey(ev: KeyEvent): boolean;
  /** IME composition lifecycle; text is the in-progress/composed string. */
  onComposition(kind: 'start' | 'update' | 'end', text: string): void;
  /** OS paste (text/plain); true = consumed. */
  onPaste(text: string): boolean;
}

export interface HiddenInputHandle {
  readonly el: HTMLInputElement;
  /** Park the (invisible) input at the drawn cursor so IME windows open there. */
  moveTo(x: number, y: number): void;
  focus(): void;
  detach(): void;
}

/**
 * Create the hidden input. `doc` is injectable so tests can assert the
 * element setup without a live document (jsdom-free, like the rest of the
 * unit tier).
 */
export function createHiddenInput(host: HiddenInputHost, doc: Document): HiddenInputHandle {
  const el = doc.createElement('input');
  el.className = 'sem-shell-hidden-input';
  el.type = 'text';
  el.spellcheck = false;
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocapitalize', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('aria-label', 'Terminal input');
  // Visually absent (§7.2): nothing renders, no caret, no layout footprint.
  const s = el.style;
  s.position = 'absolute';
  s.width = '1px';
  s.height = '1px';
  s.opacity = '0';
  s.clipPath = 'inset(50%)';
  s.border = '0';
  s.padding = '0';
  s.margin = '0';
  s.caretColor = 'transparent';
  s.background = 'transparent';
  s.zIndex = '-1';

  let composing = false;

  el.addEventListener('keydown', (event) => {
    const ev = normalizeKey(event);
    if (ev === null) return; // modifiers, Process (IME), unknown — not KeyEvents
    if (host.onKey(ev)) event.preventDefault();
  });
  el.addEventListener('compositionstart', () => {
    composing = true;
    host.onComposition('start', '');
  });
  el.addEventListener('compositionupdate', (event) => {
    host.onComposition('update', (event as CompositionEvent).data ?? '');
  });
  el.addEventListener('compositionend', (event) => {
    composing = false;
    host.onComposition('end', (event as CompositionEvent).data ?? '');
    el.value = ''; // the buffer lives on the grid, never in the input
  });
  el.addEventListener('paste', (event) => {
    const text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    if (text === '') return;
    if (host.onPaste(text)) event.preventDefault();
  });
  // Safety net: OS text services that bypass keydown (virtual keyboards)
  // must not accumulate state in the input — it is never the source of truth.
  el.addEventListener('input', () => {
    if (!composing) el.value = '';
  });

  return {
    el,
    moveTo(x: number, y: number): void {
      s.left = `${x}px`;
      s.top = `${y}px`;
    },
    focus(): void {
      el.focus({ preventScroll: true });
    },
    detach(): void {
      el.remove();
    },
  };
}
