// Unit spec — src/terminal/tabs/tabs-model.ts · the shell tab model (CORE-V2 §11.2)
//
// Feature: the tabs model keeps the strip's truth — one session per tab,
//   new/close/switch, per-tab titles — while the host owns the wiring.
//   Scenario: a fresh model starts with one active tab
//   Scenario: add activates the new tab; the 9th slot is the last
//   Scenario: closing the active tab activates right-neighbour, else last
//   Scenario: the last tab never closes
//   Scenario: cycle wraps in both directions
//   Scenario: Ctrl+PgUp/PgDn cycle; Alt+1..9 jump; other keys pass through
//   Scenario: strip keys move among tabs (arrows, Home, End)
//   Scenario: setTitle updates one tab; subscribers see every mutation

import { describe, it, expect } from 'vitest';
import { TabModel, MAX_TABS } from '../../src/terminal/tabs/tabs-model.js';

describe('tabs-model', () => {
  it('starts with exactly one active tab', () => {
    const tabs = new TabModel();
    expect(tabs.count).toBe(1);
    expect(tabs.activeId).toBe(tabs.tabs[0].id);
    expect(tabs.active?.title).toBe('shell');
  });

  it('activates each new tab and refuses a tenth', () => {
    const tabs = new TabModel();
    for (let i = 2; i <= MAX_TABS; i++) {
      const tab = tabs.add(`tab ${i}`);
      expect(tab).not.toBeNull();
      expect(tabs.activeId).toBe(tab!.id);
    }
    expect(tabs.count).toBe(MAX_TABS);
    expect(tabs.add('one too many')).toBeNull();
    expect(tabs.count).toBe(MAX_TABS);
  });

  it('close: right neighbour activates; the last-positioned falls back left', () => {
    const tabs = new TabModel();
    const a = tabs.tabs[0];
    const b = tabs.add('b')!;
    const c = tabs.add('c')!;
    // Active is c (last added). Close c → b (left fallback).
    expect(tabs.close(c.id)).toBe(true);
    expect(tabs.activeId).toBe(b.id);
    // Close b (not active — a is? no: b is active) → a.
    expect(tabs.close(b.id)).toBe(true);
    expect(tabs.activeId).toBe(a.id);
    // New tabs append after a: add d, close a while d is active → d stays.
    const d = tabs.add('d')!;
    expect(tabs.close(a.id)).toBe(true);
    expect(tabs.activeId).toBe(d.id);
    expect(tabs.close(d.id)).toBe(false); // the final tab never closes
  });

  it('cycle wraps in both directions and refuses a single tab', () => {
    const tabs = new TabModel();
    const first = tabs.tabs[0];
    const second = tabs.add('second')!;
    expect(tabs.cycle(1)).toBe(true);
    expect(tabs.activeId).toBe(first.id); // wrapped from second back to first
    expect(tabs.cycle(-1)).toBe(true);
    expect(tabs.activeId).toBe(second.id);
    // Down to one: cycle is a no-op.
    tabs.close(second.id);
    expect(tabs.cycle(1)).toBe(false);
    expect(tabs.activeId).toBe(first.id);
  });

  it('maps Ctrl+PgUp/PgDn and Alt+1..9 to targets; other keys pass through', () => {
    const tabs = new TabModel();
    const first = tabs.tabs[0];
    const second = tabs.add('second')!;
    const third = tabs.add('third')!;

    expect(tabs.keyToTarget({ key: 'PageDown', ctrlKey: true })).toBe(first.id); // wrap from third
    expect(tabs.keyToTarget({ key: 'PageUp', ctrlKey: true })).toBe(second.id);
    expect(tabs.keyToTarget({ key: '1', altKey: true })).toBe(first.id);
    expect(tabs.keyToTarget({ key: '3', altKey: true })).toBe(third.id);
    expect(tabs.keyToTarget({ key: '9', altKey: true })).toBeNull(); // no ninth tab
    // Not tab keys (or wrong modifier sets) — the terminal keeps them.
    expect(tabs.keyToTarget({ key: 'PageUp' })).toBeNull();
    expect(tabs.keyToTarget({ key: 'PageUp', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(tabs.keyToTarget({ key: '1', altKey: true, metaKey: true })).toBeNull();
    expect(tabs.keyToTarget({ key: 'x', altKey: true })).toBeNull();
    expect(tabs.keyToTarget({ key: '2', ctrlKey: true })).toBeNull();
  });

  it('maps strip keys (arrows, Home, End) for the tablist handler', () => {
    const tabs = new TabModel();
    const first = tabs.tabs[0];
    const second = tabs.add('second')!;
    tabs.activate(first.id);
    expect(tabs.stripKeyToTarget('ArrowRight')).toBe(second.id);
    tabs.activate(second.id);
    expect(tabs.stripKeyToTarget('ArrowLeft')).toBe(first.id);
    tabs.add('third');
    expect(tabs.stripKeyToTarget('End')).toBe(tabs.tabs[2].id);
    expect(tabs.stripKeyToTarget('Home')).toBe(first.id);
    expect(tabs.stripKeyToTarget('ArrowDown')).toBeNull();
    // Single tab: the strip has nothing to move within.
    tabs.close(second.id);
    tabs.close(tabs.tabs[1].id);
    expect(tabs.count).toBe(1);
    expect(tabs.stripKeyToTarget('ArrowRight')).toBeNull();
  });

  it('setTitle updates one tab; subscribers see every strip mutation', () => {
    const tabs = new TabModel();
    const first = tabs.tabs[0];
    let count = 0;
    const off = tabs.subscribe(() => count++);

    expect(tabs.setTitle(first.id, 'sem-shell — ~/notes')).toBe(true);
    expect(first.title).toBe('sem-shell — ~/notes');
    expect(count).toBe(1);

    expect(tabs.setTitle(first.id, 'sem-shell — ~/notes')).toBe(false); // no change
    expect(tabs.setTitle(999, 'ghost')).toBe(false);
    expect(tabs.add('another')).not.toBeNull();
    expect(count).toBe(2);

    off();
    tabs.close(tabs.tabs[1].id);
    expect(count).toBe(2); // unsubscribed — but the close still happened
    expect(tabs.count).toBe(1);
  });
});
