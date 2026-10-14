// Unit spec — menu/actions: the one §8.5 action list
//
// Feature: the items, in spec order
//   Scenario: copy · select all · paste · find · view switch · clear ·
//             transcript · browser menu, keyed by stable ids
// Feature: availability is read from the host at build time
//   Scenario: paste disabled + hint when clipboard read is unavailable
//   Scenario: find disabled + hint when no app declares a find verb
//   Scenario: switch to canvas disabled + hint once canvas was refused
//   Scenario: the switch label answers the CURRENT view
// Feature: activation delegates
//   Scenario: every enabled item calls its host verb
//   Scenario: a disabled item still carries its verb (the menu gates, not the data)

import { describe, it, expect, vi } from 'vitest';
import { buildMenuItems } from '../../src/terminal/menu/actions.js';
import type { MenuHost } from '../../src/terminal/menu/types.js';

function fakeHost(overrides: Partial<MenuHost> = {}): MenuHost {
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
    findAvailable: () => false, // cooked shell: no app, no find verb
    armBrowserPassthrough: vi.fn(),
    surface: () => ({ focus: vi.fn() }) as unknown as HTMLElement,
    ...overrides,
  };
}

describe('the items, in spec order', () => {
  it('eight items keyed by stable ids', () => {
    const items = buildMenuItems(fakeHost());
    expect(items.map((item) => item.id)).toEqual([
      'copy',
      'select-all',
      'paste',
      'find',
      'switch-view',
      'clear',
      'transcript',
      'browser-menu',
    ]);
  });

  it('labels are the §8.5 verbs', () => {
    const labels = buildMenuItems(fakeHost()).map((item) => item.label);
    expect(labels).toEqual([
      'Copy',
      'Select all',
      'Paste',
      'Find…',
      'Switch to text view',
      'Clear',
      'Open plain transcript',
      'Browser menu…',
    ]);
  });
});

describe('availability is read from the host at build time', () => {
  it('paste is disabled with a hint when clipboard read is unavailable', () => {
    const item = buildMenuItems(fakeHost({ clipboardReadAvailable: () => false }))[2];
    expect(item.disabled).toBe(true);
    expect(item.hint).toBe('clipboard unavailable');
  });

  it('find is disabled with a hint when the app declares no find verb', () => {
    const item = buildMenuItems(fakeHost({ findAvailable: () => false }))[3];
    expect(item.disabled).toBe(true);
    expect(item.hint).toBe('no find here');
    const live = buildMenuItems(fakeHost({ findAvailable: () => true }))[3];
    expect(live.disabled).toBe(false);
    expect(live.hint).toBeUndefined();
  });

  it('switch to canvas is disabled + hinted once canvas was refused (§8.5a)', () => {
    const refused = buildMenuItems(fakeHost({ currentView: () => 'dom', canvasAvailable: () => false }))[4];
    expect(refused.disabled).toBe(true);
    expect(refused.hint).toBe('canvas unavailable');
    const available = buildMenuItems(fakeHost({ currentView: () => 'dom', canvasAvailable: () => true }))[4];
    expect(available.disabled).toBe(false);
    expect(available.hint).toBeUndefined();
  });

  it('the switch label answers the current view', () => {
    expect(buildMenuItems(fakeHost({ currentView: () => 'canvas' }))[4].label).toBe('Switch to text view');
    expect(buildMenuItems(fakeHost({ currentView: () => 'dom' }))[4].label).toBe('Switch to canvas view');
  });
});

describe('activation delegates', () => {
  it('every enabled item calls its host verb', async () => {
    const host = fakeHost();
    const items = buildMenuItems(host);
    const byId = new Map(items.map((item) => [item.id, item]));

    byId.get('copy')!.activate(host);
    await vi.waitFor(() => expect(host.copySelection).toHaveBeenCalled());

    byId.get('select-all')!.activate(host);
    expect(host.selectAll).toHaveBeenCalled();

    byId.get('paste')!.activate(host);
    expect(host.pasteFromClipboard).toHaveBeenCalled();

    byId.get('find')!.activate(host); // the verb runs even though the item is disabled — the MENU gates
    expect(host.activateFind).toHaveBeenCalled();

    byId.get('switch-view')!.activate(host);
    expect(host.switchView).toHaveBeenCalledWith('dom');

    byId.get('clear')!.activate(host);
    expect(host.clearTerminal).toHaveBeenCalled();

    byId.get('transcript')!.activate(host);
    expect(host.openTranscript).toHaveBeenCalled();

    byId.get('browser-menu')!.activate(host);
    expect(host.armBrowserPassthrough).toHaveBeenCalled();
  });
});
