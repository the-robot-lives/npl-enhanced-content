/**
 * tabs — the shell tab model (CORE-V2 §11.2; Epoch 2 lands the model, the
 * `<sem-shell tabs>` build-out is Epoch 3).
 *
 * The POSIX mental model, enforced at this seam: **each tab owns one
 * session** — a `TerminalCore` (state, env, history, discipline, screen)
 * the HOST provides — while the **VFS is shared per element** and never
 * lives here. Per-tab titles come from the owning session's TitleFeed
 * (OSC 0 is scoped to that tab's output stream); the host forwards
 * `setTitle` calls here, the model just keeps the strip's truth.
 *
 * Switching (§11.2):
 *  - `Ctrl+PgUp` / `Ctrl+PgDn` cycle previous/next (wrapping) in cooked
 *    mode — `keyToTarget` maps the KeyboardEvent-shaped flags to a target
 *    id; the HOST performs the switch (this module owns no focus).
 *  - `Alt+1..9` jump to the tab at that position (a no-op when absent).
 *  - The strip itself is an accessible tablist: `stripKeyToTarget` maps
 *    ArrowLeft/ArrowRight/Home/End to targets for the host's roving-focus
 *    handler; rendering lives in `src/shared/window-chrome.ts`.
 *
 * Close semantics follow browser convention: the tab to the right of the
 * closed one activates, else the last tab. The final tab never closes —
 * a terminal always has exactly one current session.
 *
 * Capacity is 9 (Alt+1..9 must reach every tab); a 10th `add` is refused
 * with null rather than silently truncating the strip.
 */

export const MAX_TABS = 9;

export interface ShellTab {
  readonly id: number;
  title: string;
}

/** The KeyboardEvent flags `keyToTarget` reads; everything else is ignored. */
export interface TabKeyFlags {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export class TabModel {
  #nextId = 1;
  #tabs: ShellTab[] = [];
  #activeId: number | null = null;
  #listeners = new Set<() => void>();

  /** Starts with one tab — a shell always has a current session. */
  constructor(label = 'shell') {
    this.add(label);
  }

  /** The tabs in strip order (oldest first). Entries are live objects — treat as read-only. */
  get tabs(): readonly ShellTab[] {
    return this.#tabs;
  }

  /** The active tab id, or null before the first tab exists (never, in practice). */
  get activeId(): number | null {
    return this.#activeId;
  }

  get active(): ShellTab | null {
    return this.#tabs.find((tab) => tab.id === this.#activeId) ?? null;
  }

  get count(): number {
    return this.#tabs.length;
  }

  /** New tab, activated; null when the 9-tab capacity is reached. */
  add(label = 'shell'): ShellTab | null {
    if (this.#tabs.length >= MAX_TABS) return null;
    const tab: ShellTab = { id: this.#nextId++, title: label };
    this.#tabs.push(tab);
    this.#activeId = tab.id;
    this.#notify();
    return tab;
  }

  /**
   * Close by id. The last tab never closes (a terminal keeps one session);
   * closing the active tab activates its right neighbour, else the last tab.
   */
  close(id: number): boolean {
    if (this.#tabs.length <= 1) return false;
    const index = this.#tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return false;
    this.#tabs.splice(index, 1);
    if (this.#activeId === id) {
      const next = this.#tabs[Math.min(index, this.#tabs.length - 1)];
      this.#activeId = next.id;
    }
    this.#notify();
    return true;
  }

  /** Make `id` the active tab; false when unknown. */
  activate(id: number): boolean {
    if (!this.#tabs.some((tab) => tab.id === id)) return false;
    if (this.#activeId === id) return false;
    this.#activeId = id;
    this.#notify();
    return true;
  }

  /** Cycle the active tab by `delta` (wrapping); false with a single tab. */
  cycle(delta: number): boolean {
    if (this.#tabs.length <= 1 || delta === 0) return false;
    const index = this.#tabs.findIndex((tab) => tab.id === this.#activeId);
    const next = this.#tabs[(((index + delta) % this.#tabs.length) + this.#tabs.length) % this.#tabs.length];
    return this.activate(next.id);
  }

  /** Set one tab's label (from its session's TitleFeed); false when unknown. */
  setTitle(id: number, title: string): boolean {
    const tab = this.#tabs.find((entry) => entry.id === id);
    if (!tab || tab.title === title) return false;
    tab.title = title;
    this.#notify();
    return true;
  }

  /** Strip position of `id`, oldest first; -1 when unknown. */
  indexOf(id: number): number {
    return this.#tabs.findIndex((tab) => tab.id === id);
  }

  /**
   * Cooked-mode switch keys (§11.2): `Ctrl+PageUp`/`Ctrl+PageDown` cycle;
   * `Alt+1..9` jump by position. Returns the target id, or null when the
   * event is not a tab key (the terminal keeps handling it) or the
   * position is empty. Modifiers must be exact — Ctrl+Shift+PgUp and
   * Meta+digit are left alone.
   */
  keyToTarget(ev: TabKeyFlags): number | null {
    if (ev.shiftKey || ev.metaKey) return null;
    if (ev.ctrlKey && !ev.altKey) {
      if (ev.key === 'PageUp') return this.#neighbour(-1);
      if (ev.key === 'PageDown') return this.#neighbour(1);
      return null;
    }
    if (ev.altKey && !ev.ctrlKey && ev.key >= '1' && ev.key <= '9') {
      const position = Number(ev.key) - 1;
      return this.#tabs[position]?.id ?? null;
    }
    return null;
  }

  /** Strip keys (tablist focus): ArrowLeft/Right cycle, Home/End jump. */
  stripKeyToTarget(key: string): number | null {
    if (this.#tabs.length <= 1) return null;
    switch (key) {
      case 'ArrowLeft':
        return this.#neighbour(-1);
      case 'ArrowRight':
        return this.#neighbour(1);
      case 'Home':
        return this.#tabs[0].id;
      case 'End':
        return this.#tabs[this.#tabs.length - 1].id;
      default:
        return null;
    }
  }

  /** Subscribe to any strip change → unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The id `delta` tabs from the active one (wrapping); null when singleton. */
  #neighbour(delta: number): number | null {
    if (this.#tabs.length <= 1) return null;
    const index = this.#tabs.findIndex((tab) => tab.id === this.#activeId);
    const next = this.#tabs[(((index + delta) % this.#tabs.length) + this.#tabs.length) % this.#tabs.length];
    return next.id;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
