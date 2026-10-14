/**
 * menu/context-menu — the terminal context menu (CORE-V2 §8.5c).
 *
 * Opens three ways the input lane already funnels into the element's
 * `openContextMenu(anchor?)` seam: right-click (Shift+right-click passes
 * through to the native menu there), Shift+F10 / the ContextMenu key, and
 * touch long-press. `anchor` is in CLIENT coordinates (the surface's
 * contextmenu handler forwards raw clientX/clientY); a keyboard invocation
 * before any pointer event arrives with no anchor and centers on the
 * terminal.
 *
 * A11y (§8.5, §9): `role="menu"` + `role="menuitem"`; roving tabindex with
 * Arrow/Home/End moving among ENABLED items; Enter/Space activate; Escape
 * closes and returns focus to the terminal; the terminal surface declares
 * `aria-haspopup="menu"`. Disabled items stay focusable (aria-disabled) but
 * never activate. The open animation is CSS-only and gates on
 * `prefers-reduced-motion` (menu/css.ts). Outside pointer-down dismisses.
 *
 * The menu is built fresh per open from `buildMenuItems(host)` so labels
 * and availability always answer for the moment of opening.
 */

import { buildMenuItems } from './actions.js';
import type { MenuHost, MenuItemSpec } from './types.js';

const MENU_CLASS = 'sem-term-menu';
const ITEM_CLASS = 'sem-term-menu-item';
const HINT_CLASS = 'sem-term-menu-hint';
const EDGE_MARGIN = 8;

/** Everything injectable for tests; production uses the host document.
 *  `items` (EDITOR.md §4.7) replaces `buildMenuItems(host)` as the row
 *  builder — the editor hosts its own verbs through it; the terminal
 *  default is untouched (byte-identical behaviour, ids included). */
export interface ContextMenuOptions {
  doc?: Document | null;
  items?: (host: MenuHost) => readonly MenuItemSpec[];
}

export class ContextMenuController {
  readonly #host: MenuHost;
  readonly #doc: Document | null;
  readonly #itemsBuilder: (host: MenuHost) => readonly MenuItemSpec[];
  #menu: HTMLElement | null = null;
  #items: MenuItemSpec[] = [];
  #buttons: HTMLButtonElement[] = [];
  #focusIndex = -1;

  readonly #onDocPointerDown = (event: Event): void => {
    const menu = this.#menu;
    if (menu !== null && event.target instanceof Node && !menu.contains(event.target)) this.close();
  };

  readonly #onMenuKeydown = (event: KeyboardEvent): void => {
    // Keyboard follows the row the event lands on (the focused row in real
    // use; programmatic dispatch in tests) — never a stale roving index.
    const row = event.target instanceof Element ? event.target.closest(`.${ITEM_CLASS}`) : null;
    const index = row === null ? -1 : this.#buttons.indexOf(row as HTMLButtonElement);
    if (index >= 0) this.#focusIndex = index;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#stepFocus(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.#stepFocus(-1);
        return;
      case 'Home':
        event.preventDefault();
        this.#focusEdge(1);
        return;
      case 'End':
        event.preventDefault();
        this.#focusEdge(-1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.#activateFocused();
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // the terminal's own Escape ladder must not fire
        this.close();
        return;
      case 'Tab':
        event.preventDefault(); // APG: menus are not tab sequences
        this.close();
        return;
      default:
        return;
    }
  };

  constructor(host: MenuHost, options: ContextMenuOptions = {}) {
    this.#host = host;
    this.#doc = options.doc ?? (typeof document !== 'undefined' ? document : null);
    this.#itemsBuilder = options.items ?? buildMenuItems;
  }

  get isOpen(): boolean {
    return this.#menu !== null;
  }

  /** Declare the surface as the menu's opener (§8.5: `aria-haspopup="menu"`). */
  attach(): void {
    const surface = this.#host.surface();
    if (!surface.hasAttribute('aria-haspopup')) surface.setAttribute('aria-haspopup', 'menu');
  }

  detach(): void {
    this.close(false);
  }

  /**
   * Open the menu. `anchor` is the pointer position in CLIENT coordinates,
   * or undefined for the keyboard path (centers on the terminal surface).
   * A second open while open is a no-op — one menu per element.
   */
  open(anchor?: { x: number; y: number }): void {
    const doc = this.#doc;
    if (doc === null || this.#menu !== null) return;
    const surface = this.#host.surface();

    this.#items = [...this.#itemsBuilder(this.#host)];
    const menu = doc.createElement('div');
    menu.className = MENU_CLASS;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Terminal menu');
    for (const item of this.#items) {
      menu.appendChild(this.#renderItem(doc, item));
    }
    doc.body.appendChild(menu);
    this.#menu = menu;
    this.#buttons = Array.from(menu.children) as HTMLButtonElement[];

    doc.addEventListener('pointerdown', this.#onDocPointerDown, true);
    menu.addEventListener('keydown', this.#onMenuKeydown);
    menu.addEventListener('contextmenu', (event) => event.preventDefault());

    this.#position(menu, surface, anchor);
    // First enabled row, scanning from BEFORE the list (`from = -1`) —
    // `from = 0` would skip index 0, the copy item.
    const first = this.#firstEnabled(1, -1);
    if (first >= 0) this.#focusItem(first);
    else this.#focusIndex = -1;
  }

  /** Close the menu; refocuses the terminal surface unless told not to. */
  close(refocus = true): void {
    const menu = this.#menu;
    if (menu === null) return;
    const doc = this.#doc;
    if (doc !== null) doc.removeEventListener('pointerdown', this.#onDocPointerDown, true);
    menu.remove();
    this.#menu = null;
    this.#items = [];
    this.#buttons = [];
    this.#focusIndex = -1;
    if (refocus) this.#host.surface().focus();
  }

  /* ------------------------------------------------------------------ *
   * internals
   * ------------------------------------------------------------------ */

  #renderItem(doc: Document, item: MenuItemSpec): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = ITEM_CLASS;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('tabindex', '-1');
    button.setAttribute('data-menu-id', item.id);
    if (item.disabled) button.setAttribute('aria-disabled', 'true');
    const label = doc.createElement('span');
    label.textContent = item.label; // textContent — labels are data, never HTML
    button.appendChild(label);
    if (item.hint !== undefined) {
      button.title = item.disabled ? item.hint : '';
      const hint = doc.createElement('span');
      hint.className = HINT_CLASS;
      hint.setAttribute('aria-hidden', 'true'); // the accessible name stays the label
      hint.textContent = item.hint;
      button.appendChild(hint);
    }
    button.addEventListener('click', () => {
      if (!item.disabled) this.#run(item);
    });
    return button;
  }

  #activateFocused(): void {
    const item = this.#items[this.#focusIndex];
    if (item === undefined || item.disabled) return;
    this.#run(item);
  }

  /** Close first, then act — focus returns to the terminal before async verbs. */
  #run(item: MenuItemSpec): void {
    const host = this.#host;
    this.close();
    item.activate(host);
  }

  #focusItem(index: number): void {
    this.#focusIndex = index;
    this.#buttons.forEach((button, i) => button.setAttribute('tabindex', i === index ? '0' : '-1'));
    this.#buttons[index]?.focus();
  }

  /** Next enabled item in `direction`, wrapping (APG roving focus). */
  #stepFocus(direction: 1 | -1): void {
    const next = this.#firstEnabled(direction, this.#focusIndex);
    if (next >= 0) this.#focusItem(next);
  }

  /** First/last enabled item (Home/End). `direction` 1 = Home, -1 = End. */
  #focusEdge(direction: 1 | -1): void {
    const count = this.#buttons.length;
    for (let i = 0; i < count; i++) {
      const index = direction === 1 ? i : count - 1 - i;
      if (this.#enabled(index)) {
        this.#focusItem(index);
        return;
      }
    }
  }

  #firstEnabled(direction: 1 | -1, from: number): number {
    const count = this.#buttons.length;
    for (let step = 1; step <= count; step++) {
      const index = (((from + direction * step) % count) + count) % count;
      if (this.#enabled(index)) return index;
    }
    return -1;
  }

  #enabled(index: number): boolean {
    return this.#buttons[index]?.getAttribute('aria-disabled') !== 'true';
  }

  /** Fixed positioning clamped to the viewport (§8.5: the menu never leaves it). */
  #position(menu: HTMLElement, surface: HTMLElement, anchor?: { x: number; y: number }): void {
    const view = this.#doc?.defaultView;
    const vw = view?.innerWidth ?? EDGE_MARGIN * 2;
    const vh = view?.innerHeight ?? EDGE_MARGIN * 2;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let x: number;
    let y: number;
    if (anchor === undefined) {
      const rect = surface.getBoundingClientRect();
      x = rect.left + (rect.width - width) / 2;
      y = rect.top + (rect.height - height) / 2;
    } else {
      x = anchor.x;
      y = anchor.y;
    }
    menu.style.left = `${Math.max(EDGE_MARGIN, Math.min(x, vw - width - EDGE_MARGIN))}px`;
    menu.style.top = `${Math.max(EDGE_MARGIN, Math.min(y, vh - height - EDGE_MARGIN))}px`;
  }
}
