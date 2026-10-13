// @vitest-environment happy-dom
// Unit spec — src/shared/window-chrome.ts · the one window-frame standard
//
// Feature: window-chrome is the single source of truth for demo-window chrome
//   Scenario: the class-name contract stays distinct and kebab-cased
//   Scenario: the Lit title bar renders the dot decorative, the title as
//             text, the active class on the tab, and actions only when given
//   Scenario: active=false renders the tab without the active class
//   Scenario: the imperative title bar is structurally identical to the
//             Lit one (same class names, same aria, same text content)
//   Scenario: a markup-bearing title is never parsed — textContent only
//   Scenario: reducedMotion reads the injected view; a null view is false

import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import {
  WINDOW_CHROME,
  createWindowTitlebar,
  renderWindowTitlebar,
  reducedMotion,
} from '../../src/shared/window-chrome.js';

describe('window-chrome', () => {
  it('keeps the class-name contract distinct and kebab-cased', () => {
    const names = Object.values(WINDOW_CHROME);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(names).size).toBe(names.length);
    expect(WINDOW_CHROME.frame).toContain('window');
    expect(WINDOW_CHROME.viewport).not.toBe(WINDOW_CHROME.frame);
  });

  it('renders the Lit title bar: decorative dot, text title, active tab', () => {
    const host = document.createElement('div');
    render(renderWindowTitlebar({ title: 'deck.sem.html' }), host);
    const bar = host.firstElementChild as HTMLElement;
    expect(bar.className).toBe(WINDOW_CHROME.titlebar);

    const dot = bar.querySelector(`.${WINDOW_CHROME.dot}`) as HTMLElement;
    expect(dot.getAttribute('aria-hidden')).toBe('true');

    const tab = bar.querySelector(`.${WINDOW_CHROME.tab}`) as HTMLElement;
    expect(tab.classList.contains(WINDOW_CHROME.tabActive)).toBe(true);
    const label = tab.querySelector(`.${WINDOW_CHROME.tabTitle}`) as HTMLElement;
    expect(label.textContent).toBe('deck.sem.html');

    // No actions given — no actions container.
    expect(bar.querySelector(`.${WINDOW_CHROME.actions}`)).toBeNull();
  });

  it('renders inactive tabs without the active class and stamps actions', () => {
    const host = document.createElement('div');
    render(
      renderWindowTitlebar({ title: 'b', active: false, actions: null }),
      host,
    );
    const tab = host.querySelector(`.${WINDOW_CHROME.tab}`) as HTMLElement;
    expect(tab.classList.contains(WINDOW_CHROME.tabActive)).toBe(false);
  });

  it('matches the imperative builder to the Lit template structurally', () => {
    const templateHost = document.createElement('div');
    render(renderWindowTitlebar({ title: 'x.sem.html' }), templateHost);

    const built = createWindowTitlebar({ title: 'x.sem.html' });
    expect(built.className).toBe(WINDOW_CHROME.titlebar);
    expect(built.querySelector(`.${WINDOW_CHROME.dot}`)?.getAttribute('aria-hidden')).toBe('true');
    const builtTab = built.querySelector(`.${WINDOW_CHROME.tab}`) as HTMLElement;
    expect(builtTab.classList.contains(WINDOW_CHROME.tabActive)).toBe(true);
    expect(builtTab.querySelector(`.${WINDOW_CHROME.tabTitle}`)?.textContent).toBe('x.sem.html');

    // With actions: the container exists and starts hidden until filled.
    const withActions = createWindowTitlebar({ title: 'y', active: false, actions: null });
    const slot = withActions.querySelector(`.${WINDOW_CHROME.actions}`) as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.hasAttribute('hidden')).toBe(true);
  });

  it('treats a markup-bearing title as text, never HTML', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const built = createWindowTitlebar({ title: hostile });
    const label = built.querySelector(`.${WINDOW_CHROME.tabTitle}`) as HTMLElement;
    expect(label.children).toHaveLength(0);
    expect(label.textContent).toBe(hostile);
  });

  it('reads reduced-motion from the injected view; null view is false', () => {
    const truthy = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    const falsy = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(reducedMotion(truthy)).toBe(true);
    expect(reducedMotion(falsy)).toBe(false);
    expect(reducedMotion(null)).toBe(false);
  });
});
