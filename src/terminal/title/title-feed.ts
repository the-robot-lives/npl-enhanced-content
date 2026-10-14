/**
 * title-feed — the OSC title/status model (CORE-V2 §11.1).
 *
 * Consumes the ANSI parser's OSC tokens and maintains the two observables
 * the window chrome (title bar text + status dot) and the tab strip
 * subscribe to:
 *
 *  - `title`  — OSC 0 / OSC 2 (window/tab title). Plain text: control
 *    chars stripped, length-capped 200. OSC never writes to the screen.
 *  - `icon`   — OSC 1 (icon name), tracked separately; the strip does not
 *    display it, but tabbing-on compatibility keeps it distinct from the
 *    title the way a real terminal does (OSC 0 sets both, OSC 1 icon
 *    only, OSC 2 title only).
 *  - `status` — OSC 9, the SemText-private status line
 *    (`ESC ] 9 ; <text> ST`, or `ESC ] 9 ; <tone> ; <text> ST` with tone
 *    `idle|busy|alert` for the chrome status dot). An un-toned message
 *    keeps the current tone; the tone starts (and resets) at `idle`.
 *
 * Two consumption paths, one model:
 *
 *  - `feed(tokens)` — the CORE-V2 path: the screen pipeline owns the one
 *    AnsiStateMachine and forwards its tokens; OSC is routed here.
 *  - `consume(text)` — the v1 DOM path (until core-screen wires the
 *    screen): runs a private AnsiStateMachine over raw output text. The
 *    machine persists across calls, so an OSC split across two writes is
 *    still parsed exactly once, when its terminator arrives.
 *
 * The title stack (`push`/`pop`) lets the shell save the prompt title
 * around program output (a full-screen app or a long command) and restore
 * it afterwards; the same shape a tabbing-on plugin will drive via
 * §11.3's OSC 0/9 conventions. Depth-capped so a misbehaving guest cannot
 * grow it without bound.
 *
 * subscribers are notified at most once per mutation call — a feed batch
 * that changes three fields is one notification. `subscribe` returns the
 * unsubscribe function; notifications are synchronous (the chrome re-renders
 * from Lit state, tests assert on the getters).
 */

import { AnsiStateMachine, type AnsiToken } from '../ansi/index.js';
import type { StatusFeed, StatusTone } from '../screen/types.js';

/** §11.1 — titles are length-capped at 200 chars after sanitising. */
export const TITLE_MAX_LENGTH = 200;

/** The title stack never grows past this — a runaway guest cannot. */
export const TITLE_STACK_CAP = 32;

/** Extract a title/icon from raw OSC data: strip C0, DEL and C1 controls, cap. */
export function sanitizeTitle(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    out += ch;
    if (out.length >= TITLE_MAX_LENGTH) {
      out = out.slice(0, TITLE_MAX_LENGTH);
      break;
    }
  }
  return out;
}

/** True when `head` is one of the OSC 9 tone words (§11.1). */
function isTone(head: string): head is StatusTone {
  return head === 'idle' || head === 'busy' || head === 'alert';
}

export class TitleFeed {
  #title = '';
  #icon = '';
  #status: StatusFeed = { text: '', tone: 'idle' };
  #stack: string[] = [];
  /** Private machine for the v1 `consume` path; state persists by design. */
  #machine = new AnsiStateMachine();
  #listeners = new Set<() => void>();

  /** The current window/tab title (sanitized, ≤ 200 chars). */
  get title(): string {
    return this.#title;
  }

  /** The current icon name (OSC 1; OSC 0 sets it alongside the title). */
  get iconName(): string {
    return this.#icon;
  }

  /** The current OSC 9 status line and its chrome-dot tone. */
  get status(): StatusFeed {
    return this.#status;
  }

  /** How many saved titles are on the stack (`push`/`pop`). */
  get stackDepth(): number {
    return this.#stack.length;
  }

  /** CORE-V2 path: consume OSC tokens from the shared parser pipeline. */
  feed(tokens: readonly AnsiToken[]): void {
    let changed = false;
    for (const token of tokens) {
      if (token.type === 'osc' && this.#applyOsc(token.code, token.data)) changed = true;
    }
    if (changed) this.#notify();
  }

  /** v1 path: scan raw output text; an OSC may straddle calls safely. */
  consume(text: string): void {
    this.feed(this.#machine.write(text));
  }

  /** Set the title from the shell side (prompt titles, tab labels). */
  setTitle(title: string): void {
    const next = sanitizeTitle(title);
    if (next === this.#title) return;
    this.#title = next;
    this.#notify();
  }

  /** Set the status from the shell side; tone defaults to unchanged-idle. */
  setStatus(text: string, tone?: StatusTone): void {
    const next: StatusFeed = { text: sanitizeTitle(text), tone: tone ?? this.#status.tone };
    if (next.text === this.#status.text && next.tone === this.#status.tone) return;
    this.#status = next;
    this.#notify();
  }

  /** Save the current title (depth-capped; a full stack drops silently). */
  push(): void {
    if (this.#stack.length < TITLE_STACK_CAP) this.#stack.push(this.#title);
  }

  /** Restore the most recent saved title; false when the stack is empty. */
  pop(): boolean {
    const previous = this.#stack.pop();
    if (previous === undefined) return false;
    if (previous !== this.#title) {
      this.#title = previous;
      this.#notify();
    }
    return true;
  }

  /** Back to a fresh feed: titles, status, stack, and the v1 machine. */
  reset(): void {
    this.#machine.reset();
    const titleChanged = this.#title !== '';
    const iconChanged = this.#icon !== '';
    const statusChanged = this.#status.text !== '' || this.#status.tone !== 'idle';
    this.#title = '';
    this.#icon = '';
    this.#status = { text: '', tone: 'idle' };
    this.#stack = [];
    if (titleChanged || iconChanged || statusChanged) this.#notify();
  }

  /** Subscribe to any change → unsubscribe. Synchronous, once per mutation. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Apply one OSC; true when a tracked field changed. */
  #applyOsc(code: number, data: string): boolean {
    if (code === 0) {
      const title = sanitizeTitle(data);
      const icon = sanitizeTitle(data);
      const changed = title !== this.#title || icon !== this.#icon;
      this.#title = title;
      this.#icon = icon;
      return changed;
    }
    if (code === 1) {
      const icon = sanitizeTitle(data);
      if (icon === this.#icon) return false;
      this.#icon = icon;
      return true;
    }
    if (code === 2) {
      const title = sanitizeTitle(data);
      if (title === this.#title) return false;
      this.#title = title;
      return true;
    }
    if (code === 9) {
      let text = data;
      let tone = this.#status.tone;
      const semi = data.indexOf(';');
      if (semi !== -1) {
        const head = data.slice(0, semi);
        if (isTone(head)) {
          tone = head;
          text = data.slice(semi + 1);
        }
      }
      text = sanitizeTitle(text);
      if (text === this.#status.text && tone === this.#status.tone) return false;
      this.#status = { text, tone };
      return true;
    }
    return false; // hyperlinks (8), clipboard (52), … — not chrome feeds
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
