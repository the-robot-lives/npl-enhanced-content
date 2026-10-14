/**
 * input-model — the single input path (CORE-V2 §7): physical keys, the
 * hidden input's IME/paste events, mouse, wheel, and sendKeys all converge
 * here and leave through exactly three doors — dispatchKey (the
 * discipline), dispatchMouse + paste routing (apps), and the viewport
 * scroll request (chrome).
 *
 * The element integrates this with a thin host; nothing in this module
 * knows about sem-terminal or the screen — mode, metrics and line mapping
 * arrive through the InputHost interface, which is also what makes the
 * model unit-testable against a fake host with no DOM at all.
 */

import { parseKeyToken, parseSendKeys } from './keys.js';
import { cellFromPoint, SelectionState, sgrSequence } from './mouse.js';
import { copyText, pasteForCooked, type CopyTargets } from './paste.js';
import { createHiddenInput, type HiddenInputHandle } from './hidden-input.js';
import { flatMods, modsOf, type CellMetrics, type KeyEvent, type Mods, type MouseEventInfo } from './types.js';

/** What the integrating element supplies. All sync. */
export interface InputHost {
  /** Route a normalized key: raw → app.key(ev), cooked → discipline.key(ev). */
  dispatchKey(ev: KeyEvent): void;
  /** True while a raw-mode app owns the screen. */
  isRawMode(): boolean;
  /** True while the alternate screen is active (wheel reaches the app even without reporting). */
  isAltScreen(): boolean;
  /** Cooked-mode paste: insert at the cursor (bracketed for multiline). */
  insertCooked(text: string): void;
  /** Raw-mode paste: deliver verbatim to the focused app. */
  pasteRaw(text: string): void;
  /** Deliver a mouse event to the app that requested reporting. */
  dispatchMouse(info: MouseEventInfo): void;
  /** Primary-screen wheel: scroll the viewport over the scrollback. True when consumed. */
  onWheelScroll(dy: number, mods: Mods): boolean;
  /** Viewport row → absolute line (the scroll offset, folded in here). */
  rowToAbsoluteLine(row: number): number;
  /** Cell metrics from the active renderer (the mouse takes them as a parameter). */
  metrics(): CellMetrics;
  /** Logical line text for copy — the same source the DOM mirror renders. */
  getLineText(line: number): string;
  /** Open the terminal context menu (chrome owns it; §8.5). Client-coordinate
   * anchor, or none for a keyboard invocation before any pointer event. */
  openContextMenu(anchor?: { x: number; y: number }): void;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/** The DOM pointer event — the screen contract imports `MouseEvent`, which shadows lib.dom here. */
type DOMMouseEvent = globalThis.MouseEvent;

export class InputModel {
  /** The live selection — shared data the renderer and mirror read. */
  readonly selection = new SelectionState();

  #host: InputHost;
  #reporting = false;
  #hidden: HiddenInputHandle | null = null;
  #surface: HTMLElement | null = null;
  #dragging = false;
  #lastMouse: { x: number; y: number } | null = null;
  #touchTimer: number | null = null;
  #touchStart: { x: number; y: number } | null = null;

  constructor(host: InputHost) {
    this.#host = host;
  }

  /** Apps opt in via requestMouse(true) — the runner calls through to here. */
  get mouseReporting(): boolean {
    return this.#reporting;
  }

  setMouseReporting(on: boolean): void {
    this.#reporting = on;
    if (!on) this.#dragging = false;
  }

  /* ------------------------------------------------------------------ *
   * keys — the one path for physical, scripted and programmatic input
   * ------------------------------------------------------------------ */

  /**
   * One normalized KeyEvent. Chrome keys are intercepted before any app or
   * the discipline can see them (§7.3: the context menu wins even while
   * app mouse-reporting is active); everything else dispatches.
   */
  handleKey(ev: KeyEvent): void {
    if ((ev.key === 'F10' && ev.shift) || ev.key === 'ContextMenu') {
      this.#openMenuAtAnchor();
      return;
    }
    this.#host.dispatchKey(ev);
  }

  /** One bare key token — the v1 playback `pressKey` vocabulary plus the full grammar. */
  handleSingleKey(token: string): void {
    this.handleKey(parseKeyToken(token));
  }

  /**
   * THE programmatic input path (§7.5): parse the grammar, inject each
   * normalized event through handleKey — the exact pipeline physical keys
   * take, so scripts, e2e and user typing cannot diverge.
   */
  sendKeys(spec: string): void {
    for (const ev of parseSendKeys(spec)) this.handleKey(ev);
  }

  /* ------------------------------------------------------------------ *
   * paste
   * ------------------------------------------------------------------ */

  /** The one paste path (§7.4): cooked inserts bracketed, raw delivers verbatim. */
  handlePaste(text: string): void {
    if (this.#host.isRawMode()) {
      this.#host.pasteRaw(text);
      return;
    }
    this.#host.insertCooked(pasteForCooked(text).text);
  }

  /**
   * Copy the current selection through the transport ladder: clipboard
   * API, then the hidden input's select+execCommand (file://). Same
   * extractText the mirror uses, so both surfaces copy identical text.
   */
  async copySelection(targets?: Omit<CopyTargets, 'execCommandCopy'>): Promise<boolean> {
    const text = this.selection.extractText((line) => String(this.#host.getLineText(line) ?? ''));
    if (text === '') return false;
    const exec = this.#hidden
      ? (): boolean => {
          const el = this.#hidden!.el;
          el.value = text;
          el.select();
          const ok = document.execCommand('copy');
          el.value = '';
          return ok;
        }
      : undefined;
    return copyText(text, { ...targets, execCommandCopy: exec });
  }

  /* ------------------------------------------------------------------ *
   * surface wiring — DOM events land on the pure handlers below
   * ------------------------------------------------------------------ */

  /** Attach to the paint surface: hidden input, mouse, wheel, long-press. */
  attach(surface: HTMLElement): void {
    this.#surface = surface;
    const doc = surface.ownerDocument;
    this.#hidden = createHiddenInput(
      {
        onKey: (ev) => {
          this.handleKey(ev);
          return true; // the terminal surface consumes every key it sees
        },
        onComposition: (kind, text) => this.handleComposition(kind, text),
        onPaste: (text) => {
          this.handlePaste(text);
          return true;
        },
      },
      doc,
    );
    surface.appendChild(this.#hidden.el);
    surface.addEventListener('mousedown', this.#onMouseDown);
    surface.addEventListener('mousemove', this.#onMouseMove);
    doc.addEventListener('mouseup', this.#onMouseUp);
    surface.addEventListener('wheel', this.#onWheel, { passive: false });
    surface.addEventListener('contextmenu', this.#onContextMenu);
    surface.addEventListener('touchstart', this.#onTouchStart, { passive: true });
    surface.addEventListener('touchmove', this.#onTouchMove, { passive: true });
    surface.addEventListener('touchend', this.#onTouchEnd, { passive: true });
  }

  detach(): void {
    if (this.#surface !== null) {
      const doc = this.#surface.ownerDocument;
      this.#surface.removeEventListener('mousedown', this.#onMouseDown);
      this.#surface.removeEventListener('mousemove', this.#onMouseMove);
      doc.removeEventListener('mouseup', this.#onMouseUp);
      this.#surface.removeEventListener('wheel', this.#onWheel);
      this.#surface.removeEventListener('contextmenu', this.#onContextMenu);
      this.#surface.removeEventListener('touchstart', this.#onTouchStart);
      this.#surface.removeEventListener('touchmove', this.#onTouchMove);
      this.#surface.removeEventListener('touchend', this.#onTouchEnd);
    }
    this.#surface = null;
    this.#hidden?.detach();
    this.#hidden = null;
    this.#clearLongPress();
  }

  /** Park the hidden input at the drawn cursor (host calls on cursor moves). */
  moveCursorHint(x: number, y: number): void {
    this.#hidden?.moveTo(x, y);
  }

  focus(): void {
    this.#hidden?.focus();
  }

  /** IME lifecycle — the discipline shows the draft inline; raw mode gets it as paste. */
  handleComposition(kind: 'start' | 'update' | 'end', text: string): void {
    if (this.#host.isRawMode()) {
      if (kind === 'end' && text !== '') this.#host.pasteRaw(text);
      return;
    }
    if (kind === 'end' && text !== '') this.#host.insertCooked(text);
    // start/update render through the cooked editor's composition state —
    // the host reads the draft via its own composition hook (M4 e2e).
  }

  /* ------------------------------------------------------------------ *
   * mouse — the DOM-adjacent half (pure logic in mouse.ts)
   * ------------------------------------------------------------------ */

  /** A mousedown on the surface: clientX/Y plus the DOM flags. */
  handleMouseDown(x: number, y: number, button: 0 | 1 | 2, mods: Mods): void {
    this.#lastMouse = { x, y };
    const metrics = this.#host.metrics();
    const { col, row } = cellFromPoint(x, y, metrics);
    if (this.#reporting) {
      this.#host.dispatchMouse({ kind: 'press', col, row, button, dx: 0, dy: 0, ...flatMods(mods) });
      return;
    }
    if (button === 0) {
      // Selection addresses absolute lines: the host folds the scroll offset in.
      this.selection.begin(this.#host.rowToAbsoluteLine(row), col, mods.alt);
      this.#dragging = true;
    }
  }

  handleMouseMove(x: number, y: number, mods: Mods): void {
    this.#lastMouse = { x, y };
    const metrics = this.#host.metrics();
    const { col, row } = cellFromPoint(x, y, metrics);
    if (this.#reporting) {
      this.#host.dispatchMouse({ kind: 'drag', col, row, button: 0, dx: 0, dy: 0, ...flatMods(mods) });
      return;
    }
    if (this.#dragging) this.selection.extend(this.#host.rowToAbsoluteLine(row), col);
  }

  handleMouseUp(x: number, y: number, button: 0 | 1 | 2, mods: Mods): void {
    this.#lastMouse = { x, y };
    if (this.#reporting) {
      const metrics = this.#host.metrics();
      const { col, row } = cellFromPoint(x, y, metrics);
      this.#host.dispatchMouse({ kind: 'release', col, row, button, dx: 0, dy: 0, ...flatMods(mods) });
    }
    this.#dragging = false;
    this.selection.end();
  }

  /** Wheel: app surface (reporting or alternate screen) → deltas; else viewport scroll. */
  handleWheel(dx: number, dy: number, mods: Mods): void {
    if (this.#reporting || this.#host.isAltScreen()) {
      // The report carries the cell under the pointer when one is known.
      const last = this.#lastMouse;
      const { col, row } = last !== null ? cellFromPoint(last.x, last.y, this.#host.metrics()) : { col: 0, row: 0 };
      this.#host.dispatchMouse({ kind: 'wheel', button: 0, col, row, dx, dy, ...flatMods(mods) });
      return;
    }
    this.#host.onWheelScroll(dy, mods);
  }

  /** Right-click / ContextMenu surface event. Shift passes through to the native menu. */
  handleContextMenu(x: number, y: number, shiftKey: boolean): boolean {
    if (shiftKey) return false; // native browser menu stays reachable (§7.3)
    this.#lastMouse = { x, y };
    this.#host.openContextMenu({ x, y });
    return true; // consumed — preventDefault
  }

  /** The SGR-1006 report string for the last app-directed mouse event (tests + apps). */
  reportFor(ev: MouseEventInfo): string {
    return sgrSequence(ev);
  }

  /* ------------------------------------------------------------------ *
   * internals
   * ------------------------------------------------------------------ */

  #onMouseDown = (event: DOMMouseEvent): void => {
    const rect = this.#surface!.getBoundingClientRect();
    this.handleMouseDown(event.clientX - rect.left, event.clientY - rect.top, event.button as 0 | 1 | 2, modsOf(event));
    if (event.button === 0) event.preventDefault(); // don't blur the hidden input / start a native drag-select
  };

  #onMouseMove = (event: DOMMouseEvent): void => {
    const rect = this.#surface!.getBoundingClientRect();
    this.handleMouseMove(event.clientX - rect.left, event.clientY - rect.top, modsOf(event));
  };

  #onMouseUp = (event: DOMMouseEvent): void => {
    const rect = this.#surface !== null ? this.#surface.getBoundingClientRect() : null;
    this.handleMouseUp(
      rect !== null ? event.clientX - rect.left : 0,
      rect !== null ? event.clientY - rect.top : 0,
      event.button as 0 | 1 | 2,
      modsOf(event),
    );
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault(); // the terminal is the scroll surface over its output
    this.handleWheel(event.deltaX, event.deltaY, modsOf(event));
  };

  #onContextMenu = (event: DOMMouseEvent): void => {
    if (this.handleContextMenu(event.clientX, event.clientY, event.shiftKey)) event.preventDefault();
  };

  #onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      this.#clearLongPress();
      return;
    }
    const touch = event.touches[0];
    this.#touchStart = { x: touch.clientX, y: touch.clientY };
    const doc = this.#surface!.ownerDocument;
    this.#touchTimer = doc.defaultView!.setTimeout(() => {
      this.#touchTimer = null;
      // A long-press held without dragging opens the menu; a drag keeps selecting.
      this.#openMenuAt(this.#touchStart!.x, this.#touchStart!.y);
    }, LONG_PRESS_MS);
  };

  #onTouchMove = (event: TouchEvent): void => {
    if (this.#touchTimer === null || this.#touchStart === null || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - this.#touchStart.x;
    const dy = touch.clientY - this.#touchStart.y;
    if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) {
      this.#clearLongPress(); // it became a drag, not a press-and-hold
    }
  };

  #onTouchEnd = (): void => {
    this.#clearLongPress();
  };

  #clearLongPress(): void {
    if (this.#touchTimer !== null && this.#surface !== null) {
      this.#surface.ownerDocument.defaultView?.clearTimeout(this.#touchTimer);
    }
    this.#touchTimer = null;
    this.#touchStart = null;
  }

  #openMenuAt(x: number, y: number): void {
    this.#host.openContextMenu({ x, y });
  }

  /** Keyboard invocation (Shift+F10 / ContextMenu key): last pointer spot, else chrome decides. */
  #openMenuAtAnchor(): void {
    if (this.#lastMouse !== null) {
      this.#openMenuAt(this.#lastMouse.x, this.#lastMouse.y);
      return;
    }
    this.#host.openContextMenu(); // no anchor yet — the menu centers on the terminal
  }
}
