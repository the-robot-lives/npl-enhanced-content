// @vitest-environment happy-dom
// Unit spec — the shared preview popover (src/shared/popover.ts)
//
// Feature: WCAG 2.2 SC 1.4.13 Content on Hover or Focus
//   Scenario: hover opens; the pointer can travel to the preview without it closing
//   Scenario: leaving anchor and preview closes after the bridge delay
//   Scenario: re-entering the anchor cancels a pending hide
//   Scenario: leaving the preview closes after the bridge delay
//   Scenario: focus opens; blur closes immediately
//   Scenario: Esc dismisses without moving focus and nothing reopens it
//   Scenario: clicking the anchor closes so navigation is never hidden
//   Scenario: a new anchor supersedes a pending hide and owns its own preview
//   Scenario: cloned links are untabbable and hidden from the accessibility tree

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachPreview, cloneContent, hide } from '../../src/shared/popover.js';

const HOST = `
<p>See <a id="cite-1" href="#r1">[1]</a> and <a id="cite-2" href="#r2">[2]</a>.</p>
<div id="r1"><p>Reference one about <a href="https://rfc.example/1">RFC 1</a>.</p></div>
<div id="r2"><p>Reference two.</p></div>`;

const fire = (el: Element, type: string): void => el.dispatchEvent(new MouseEvent(type));
const box = (): HTMLElement => document.getElementById('sem-popover') as HTMLElement;

describe('preview popover (SC 1.4.13)', () => {
  let a1: HTMLAnchorElement;
  let a2: HTMLAnchorElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = HOST;
    a1 = document.getElementById('cite-1') as HTMLAnchorElement;
    a2 = document.getElementById('cite-2') as HTMLAnchorElement;
    attachPreview(a1, () => cloneContent(document.getElementById('r1')!, ''));
    attachPreview(a2, () => cloneContent(document.getElementById('r2')!, ''));
  });

  afterEach(() => {
    hide();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('keeps the preview open while the pointer travels to it (hoverable)', () => {
    fire(a1, 'mouseenter');
    expect(box().hidden).toBe(false);
    fire(a1, 'mouseleave');
    expect(box().hidden).toBe(false); // inside the bridge window
    fire(box(), 'mouseenter');
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(false); // pointer parked on the preview
  });

  it('closes after the bridge delay when the pointer leaves both', () => {
    fire(a1, 'mouseenter');
    fire(a1, 'mouseleave');
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(true);
    expect(a1.hasAttribute('aria-describedby')).toBe(false);
  });

  it('cancels a pending hide when the pointer re-enters the anchor', () => {
    fire(a1, 'mouseenter');
    fire(a1, 'mouseleave');
    vi.advanceTimersByTime(100);
    fire(a1, 'mouseenter');
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(false);
  });

  it('closes after the delay when the pointer leaves the preview', () => {
    fire(a1, 'mouseenter');
    fire(box(), 'mouseenter');
    fire(box(), 'mouseleave');
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(true);
  });

  it('opens on focus and closes immediately on blur', () => {
    a1.focus();
    expect(box().hidden).toBe(false);
    expect(a1.getAttribute('aria-describedby')).toBe('sem-popover');
    a1.blur();
    expect(box().hidden).toBe(true);
    expect(a1.hasAttribute('aria-describedby')).toBe(false);
  });

  it('Esc dismisses without moving focus', () => {
    a1.focus();
    fire(a1, 'mouseleave'); // a pending hide must not matter to Esc
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(box().hidden).toBe(true);
    expect(document.activeElement).toBe(a1);
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(true); // nothing reopens it afterwards
  });

  it('closes on click so navigation is never hidden', () => {
    fire(a1, 'mouseenter');
    fire(a1, 'click');
    expect(box().hidden).toBe(true);
  });

  it('a new anchor supersedes a pending hide and owns its own preview', () => {
    fire(a1, 'mouseenter');
    fire(a1, 'mouseleave');
    fire(a2, 'mouseenter');
    expect(a1.hasAttribute('aria-describedby')).toBe(false);
    expect(a2.getAttribute('aria-describedby')).toBe('sem-popover');
    vi.advanceTimersByTime(600);
    expect(box().hidden).toBe(false);
    hide(a1);
    expect(box().hidden).toBe(false); // a1 no longer owns the preview
    hide(a2);
    expect(box().hidden).toBe(true);
  });

  it('cloned links are untabbable and hidden from the accessibility tree', () => {
    fire(a1, 'mouseenter');
    const links = box().querySelectorAll('a[href]');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((a) => {
      expect(a.getAttribute('tabindex')).toBe('-1');
      expect(a.getAttribute('aria-hidden')).toBe('true');
    });
    expect(box().querySelector('a[href]:not([tabindex="-1"])')).toBeNull();
  });

  it('cloneContent neuters interactive descendants at the source', () => {
    const frag = cloneContent(document.getElementById('r1')!, '');
    frag.querySelectorAll('a[href]').forEach((a) => {
      expect(a.getAttribute('tabindex')).toBe('-1');
      expect(a.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
