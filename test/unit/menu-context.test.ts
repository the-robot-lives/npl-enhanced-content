// @vitest-environment happy-dom
// Unit spec — menu/context-menu: the §8.5c menu lifecycle + a11y
//
// Feature: opening (§8.5c)
//   Scenario: right-click path opens one menu on the document
//   Scenario: the opener surface declares aria-haspopup="menu"
//   Scenario: a second open while open is a no-op
// Feature: items
//   Scenario: every row is a role="menuitem" keyed by data-menu-id
//   Scenario: disabled rows carry aria-disabled + the hint, aria-hidden
//   Scenario: the switch row's label + availability answer the host live
// Feature: roving focus
//   Scenario: opening focuses the first enabled row
//   Scenario: ArrowDown/Up move among ENABLED rows, wrapping
//   Scenario: Home/End take the first/last enabled row
// Feature: activation + dismissal
//   Scenario: Enter/Space activate the focused row and close
//   Scenario: clicking a row runs its verb and closes
//   Scenario: Escape closes and returns focus to the terminal
//   Scenario: pointer-down outside closes
//   Scenario: Browser menu… closes and arms the passthrough
// Feature: viewport clamping (§8.5)
//   Scenario: an off-screen anchor clamps inside the viewport
//   Scenario: keyboard open centers on the surface

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextMenuController } from '../../src/terminal/menu/context-menu.js';
import type { MenuHost } from '../../src/terminal/menu/types.js';

function fakeHost(surface: HTMLElement, overrides: Partial<MenuHost> = {}): MenuHost {
  return {
    copySelection: vi.fn(async () => true),
    selectAll: vi.fn(),
    pasteFromClipboard: vi.fn(),
    activateFind: vi.fn(),
    clearTerminal: vi.fn(),
    openTranscript: vi.fn(),
    currentView: () => 'canvas',
    switchView: vi.fn(),
    canvasAvailable: () => true,
    clipboardReadAvailable: () => true,
    findAvailable: () => false,
    armBrowserPassthrough: vi.fn(),
    surface: () => surface,
    ...overrides,
  };
}

const itemsOf = (): HTMLElement[] =>
  Array.from(document.querySelectorAll('.sem-term-menu .sem-term-menu-item'));
const itemById = (id: string): HTMLElement | null =>
  document.querySelector(`.sem-term-menu .sem-term-menu-item[data-menu-id="${id}"]`);

describe('menu lifecycle + a11y', () => {
  let surface: HTMLElement;
  let controller: ContextMenuController;
  let host: MenuHost;

  beforeEach(() => {
    surface = document.createElement('div');
    surface.tabIndex = 0; // the focus-return target must be focusable
    document.body.appendChild(surface);
    host = fakeHost(surface);
    controller = new ContextMenuController(host, { doc: document });
    controller.attach();
  });

  afterEach(() => {
    controller.detach();
    document.body.innerHTML = '';
  });

  it('the opener surface declares aria-haspopup="menu"', () => {
    expect(surface.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opening mounts one menu with role=menu and the §8.5 rows', () => {
    controller.open({ x: 20, y: 20 });
    const menu = document.querySelector('.sem-term-menu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('Terminal menu');
    expect(itemsOf().map((row) => row.getAttribute('data-menu-id'))).toEqual([
      'copy',
      'select-all',
      'paste',
      'find',
      'switch-view',
      'clear',
      'transcript',
      'browser-menu',
    ]);
    expect(itemsOf().every((row) => row.getAttribute('role') === 'menuitem')).toBe(true);
    expect(controller.isOpen).toBe(true);
  });

  it('a second open while open is a no-op', () => {
    controller.open({ x: 10, y: 10 });
    controller.open({ x: 99, y: 99 });
    expect(document.querySelectorAll('.sem-term-menu')).toHaveLength(1);
  });

  it('disabled rows carry aria-disabled + an aria-hidden hint', () => {
    controller.open({ x: 10, y: 10 });
    const findRow = itemById('find')!;
    expect(findRow.getAttribute('aria-disabled')).toBe('true');
    expect(findRow.title).toBe('no find here');
    const hint = findRow.querySelector('.sem-term-menu-hint')!;
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    expect(hint.textContent).toBe('no find here');
    const copyRow = itemById('copy')!;
    expect(copyRow.hasAttribute('aria-disabled')).toBe(false);
    expect(copyRow.querySelector('.sem-term-menu-hint')).toBeNull();
  });

  it('the switch row answers the host live', () => {
    controller.open({ x: 10, y: 10 });
    const row = itemById('switch-view')!;
    expect(row.textContent).toContain('Switch to text view');
    controller.close(false);
    host = fakeHost(surface, { currentView: () => 'dom', canvasAvailable: () => false });
    controller = new ContextMenuController(host, { doc: document });
    controller.open({ x: 10, y: 10 });
    const next = itemById('switch-view')!;
    expect(next.textContent).toContain('Switch to canvas view');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.title).toBe('canvas unavailable');
  });

  it('opening focuses the first enabled row (roving tabindex)', () => {
    controller.open({ x: 10, y: 10 });
    expect(document.activeElement).toBe(itemById('copy'));
    expect(itemById('copy')!.getAttribute('tabindex')).toBe('0');
    expect(itemById('select-all')!.getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowDown moves to the next ENABLED row, skipping find', () => {
    controller.open({ x: 10, y: 10 });
    itemById('copy')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(itemById('select-all'));
    itemById('select-all')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(itemById('paste'));
    itemById('paste')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(itemById('switch-view')); // find skipped
  });

  it('ArrowUp wraps to the last enabled row', () => {
    controller.open({ x: 10, y: 10 });
    itemById('copy')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(itemById('browser-menu'));
  });

  it('Home takes the first enabled row; End takes the last', () => {
    controller.open({ x: 10, y: 10 });
    itemById('copy')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(itemById('browser-menu'));
    itemById('browser-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(itemById('copy'));
  });

  it('Enter activates the focused row and closes', () => {
    controller.open({ x: 10, y: 10 });
    itemById('select-all')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.selectAll).toHaveBeenCalledTimes(1);
    expect(controller.isOpen).toBe(false);
    expect(document.querySelector('.sem-term-menu')).toBeNull();
  });

  it('Space activates too', () => {
    controller.open({ x: 10, y: 10 });
    itemById('clear')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(host.clearTerminal).toHaveBeenCalledTimes(1);
  });

  it('a disabled row never activates — click or key', () => {
    controller.open({ x: 10, y: 10 });
    (itemById('find') as HTMLElement).click();
    itemById('find')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.activateFind).not.toHaveBeenCalled();
    expect(controller.isOpen).toBe(true); // the menu stays up
  });

  it('clicking a row runs its verb and closes', () => {
    controller.open({ x: 10, y: 10 });
    (itemById('transcript') as HTMLElement).click();
    expect(host.openTranscript).toHaveBeenCalledTimes(1);
    expect(controller.isOpen).toBe(false);
  });

  it('Escape closes and returns focus to the terminal surface', () => {
    surface.focus();
    controller.open({ x: 10, y: 10 });
    expect(document.activeElement).toBe(itemById('copy'));
    itemById('copy')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(controller.isOpen).toBe(false);
    expect(document.activeElement).toBe(surface);
  });

  it('Tab dismisses without activating', () => {
    controller.open({ x: 10, y: 10 });
    itemById('copy')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(controller.isOpen).toBe(false);
    expect(host.selectAll).not.toHaveBeenCalled();
  });

  it('pointer-down outside closes; inside does not', () => {
    controller.open({ x: 10, y: 10 });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(controller.isOpen).toBe(false);

    controller.open({ x: 10, y: 10 });
    itemById('copy')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(controller.isOpen).toBe(true);
  });

  it('Browser menu… closes and arms the one-shot passthrough', () => {
    controller.open({ x: 10, y: 10 });
    (itemById('browser-menu') as HTMLElement).click();
    expect(host.armBrowserPassthrough).toHaveBeenCalledTimes(1);
    expect(controller.isOpen).toBe(false);
  });

  it('close() drops the document listener — no stale dismissal', () => {
    controller.open({ x: 10, y: 10 });
    controller.close(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector('.sem-term-menu')).toBeNull();
  });

  it('an off-screen anchor clamps inside the viewport', () => {
    controller.open({ x: 5000, y: 5000 });
    const menu = document.querySelector('.sem-term-menu') as HTMLElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    expect(parseFloat(menu.style.left)).toBe(vw - 8); // zero-width in happy-dom: right edge - margin
    expect(parseFloat(menu.style.top)).toBe(vh - 8);
  });

  it('a keyboard open centers on the surface', () => {
    controller.open();
    const menu = document.querySelector('.sem-term-menu') as HTMLElement;
    expect(menu.style.left).toBeTruthy();
    expect(menu.style.top).toBeTruthy();
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
  });
});
