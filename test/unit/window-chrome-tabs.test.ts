// @vitest-environment happy-dom
// Unit spec — src/shared/window-chrome.ts · tab strip + status-dot tones
// (the osc-tabs lane's additions; the base titlebar spec lives in
// window-chrome.test.ts and stays untouched)
//
// Feature: the strip renders several shell tabs with the tablist contract
//   Scenario: role=tablist with aria-label; each tab role=tab with
//             aria-selected and a roving tab stop on the active tab
//   Scenario: tab titles are text — markup never parses
//   Scenario: close affordance renders only when closable, labelled per tab
//   Scenario: the imperative strip is structurally identical to the Lit one
//   Scenario: the dot tone classes ride the title bar (both builders), and
//             an unset tone renders the bare dot exactly as before
//   Scenario: the class-name contract stays distinct and kebab-cased

import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import {
  WINDOW_CHROME,
  createTabStrip,
  createWindowTitlebar,
  renderTabStrip,
  renderWindowTitlebar,
  type WindowStatusTone,
  type WindowTab,
} from '../../src/shared/window-chrome.js';
import type { StatusTone } from '../../src/terminal/screen/types.js';

const THREE_TABS: WindowTab[] = [
  { id: 't1', title: 'sem-shell' },
  { id: 't2', title: 'build — active', active: true },
  { id: 't3', title: 'logs' },
];

describe('window-chrome tab strip', () => {
  it('keeps the class-name contract distinct and kebab-cased with the new names', () => {
    const names = Object.values(WINDOW_CHROME);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(names).size).toBe(names.length);
    expect(WINDOW_CHROME.tabs).toContain('window');
    expect(WINDOW_CHROME.tabClose).toContain('close');
  });

  it('renders the tablist: roles, aria-selected, roving tab stop', () => {
    const host = document.createElement('div');
    render(renderTabStrip({ tabs: THREE_TABS, label: 'Shell tabs' }), host);
    const strip = host.firstElementChild as HTMLElement;
    expect(strip.className).toBe(WINDOW_CHROME.tabs);
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe('Shell tabs');

    const cells = [...strip.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('aria-selected')).toBe('false');
    expect(cells[0].getAttribute('tabindex')).toBe('-1');
    expect(cells[0].getAttribute('data-tab-id')).toBe('t1');
    expect(cells[1].classList.contains(WINDOW_CHROME.tabActive)).toBe(true);
    expect(cells[1].getAttribute('aria-selected')).toBe('true');
    expect(cells[1].getAttribute('tabindex')).toBe('0');
    expect(cells[1].querySelector(`.${WINDOW_CHROME.tabTitle}`)?.textContent).toBe('build — active');
  });

  it('treats a markup-bearing tab title as text, never HTML', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const built = createTabStrip({ tabs: [{ id: 'x', title: hostile, active: true }] });
    const label = built.querySelector(`.${WINDOW_CHROME.tabTitle}`) as HTMLElement;
    expect(label.children).toHaveLength(0);
    expect(label.textContent).toBe(hostile);
  });

  it('renders close buttons only when closable, labelled and keyed per tab', () => {
    const host = document.createElement('div');
    render(renderTabStrip({ tabs: THREE_TABS }), host);
    expect(host.querySelectorAll(`.${WINDOW_CHROME.tabClose}`)).toHaveLength(0);

    const closableHost = document.createElement('div');
    render(renderTabStrip({ tabs: THREE_TABS, closable: true }), closableHost);
    const closes = [...closableHost.querySelectorAll(`.${WINDOW_CHROME.tabClose}`)] as HTMLButtonElement[];
    expect(closes).toHaveLength(3);
    expect(closes[0].getAttribute('aria-label')).toBe('Close sem-shell');
    expect(closes[0].getAttribute('data-tab-close')).toBe('t1');
  });

  it('matches the imperative strip to the Lit template structurally', () => {
    const host = document.createElement('div');
    render(renderTabStrip({ tabs: THREE_TABS, label: 'Shell tabs', closable: true }), host);

    const built = createTabStrip({ tabs: THREE_TABS, label: 'Shell tabs', closable: true });
    expect(built.className).toBe(WINDOW_CHROME.tabs);
    expect(built.getAttribute('role')).toBe('tablist');
    expect(built.getAttribute('aria-label')).toBe('Shell tabs');

    const templateCells = [...(host.firstElementChild as HTMLElement).querySelectorAll('[role="tab"]')];
    const builtCells = [...built.querySelectorAll('[role="tab"]')];
    expect(builtCells.map((cell) => cell.className)).toEqual(templateCells.map((cell) => cell.className));
    expect(builtCells.map((cell) => cell.getAttribute('aria-selected'))).toEqual(
      templateCells.map((cell) => cell.getAttribute('aria-selected')),
    );
    expect(builtCells.map((cell) => cell.getAttribute('tabindex'))).toEqual(
      templateCells.map((cell) => cell.getAttribute('tabindex')),
    );
    expect(builtCells.map((cell) => cell.getAttribute('data-tab-id'))).toEqual(
      templateCells.map((cell) => cell.getAttribute('data-tab-id')),
    );
    expect(built.textContent).toContain('build — active');
  });

  it('rides the status-dot tones on the title bar, both builders', () => {
    const host = document.createElement('div');
    render(renderWindowTitlebar({ title: 'x', tone: 'busy' }), host);
    const litDot = host.querySelector(`.${WINDOW_CHROME.dot}`) as HTMLElement;
    expect(litDot.classList.contains(WINDOW_CHROME.dotBusy)).toBe(true);
    expect(litDot.classList.contains(WINDOW_CHROME.dotAlert)).toBe(false);

    const alertBuilt = createWindowTitlebar({ title: 'x', tone: 'alert' });
    const alertDot = alertBuilt.querySelector(`.${WINDOW_CHROME.dot}`) as HTMLElement;
    expect(alertDot.classList.contains(WINDOW_CHROME.dotAlert)).toBe(true);
    expect(alertDot.classList.contains(WINDOW_CHROME.dotBusy)).toBe(false);

    // No tone / idle: the bare dot, byte-for-byte the pre-tone rendering.
    for (const tone of [undefined, 'idle' as WindowStatusTone]) {
      const bareLit = document.createElement('div');
      render(renderWindowTitlebar({ title: 'x', tone }), bareLit);
      expect((bareLit.querySelector(`.${WINDOW_CHROME.dot}`) as HTMLElement).className).toBe(WINDOW_CHROME.dot);
      const bareBuilt = createWindowTitlebar({ title: 'x', tone });
      expect((bareBuilt.querySelector(`.${WINDOW_CHROME.dot}`) as HTMLElement).className).toBe(WINDOW_CHROME.dot);
    }
  });

  it('keeps the tone unions assignable in both directions (chrome ↔ screen model)', () => {
    const screen: StatusTone = 'busy';
    const chrome: WindowStatusTone = screen;
    const back: StatusTone = chrome;
    expect(back).toBe('busy');
  });
});
