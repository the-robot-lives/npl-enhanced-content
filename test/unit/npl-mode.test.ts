// @vitest-environment happy-dom
// Unit spec — npl-mode (src/lit/npl/npl-mode.ts)
//
// Feature: the cognitive lens declaration renders its mode children as chips
//          (recipe: src/lit/npl/index.ts header; contract: spec/schema/npl/npl-mode.md)
//   Scenario: importing the barrel registers npl-mode
//   Scenario: one chip per typed mode child, labelled by its type
//   Scenario: primary marks the chips and mirrors to data-primary
//   Scenario: without primary the chips stay unmarked
//   Scenario: a mode child without the required type attribute is skipped
//   Scenario: an authored data-primary marks the chips and survives the mirror
//   Scenario: generated chips lead the element, authored children follow
//   Scenario: upgrades light DOM — no shadow root, authored children survive

import { describe, it, expect, beforeEach } from 'vitest';
import { NplMode } from '../../src/lit/npl/npl-mode.js';

describe('npl-mode', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<npl-mode id="lens" primary><mode type="reasoning"></mode><mode type="critic"></mode></npl-mode>';
  });

  it('the barrel registers npl-mode', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-mode')).toBe(NplMode);
  });

  it('renders one chip per typed mode child, labelled by its type', async () => {
    const el = document.getElementById('lens') as NplMode;
    await el.updateComplete;
    const chips = el.querySelectorAll('.npl-mode-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('reasoning');
    expect(chips[0].getAttribute('data-type')).toBe('reasoning');
    expect(chips[1].textContent).toBe('critic');
    expect(chips[1].getAttribute('data-type')).toBe('critic');
  });

  it('primary marks the chips and mirrors to data-primary', async () => {
    const el = document.getElementById('lens') as NplMode;
    await el.updateComplete;
    expect(el.querySelectorAll('.npl-mode-chip-primary')).toHaveLength(2);
    expect(el.hasAttribute('data-primary')).toBe(true);
  });

  it('without primary the chips stay unmarked', async () => {
    document.body.innerHTML = '<npl-mode id="plain"><mode type="planner"></mode></npl-mode>';
    const el = document.getElementById('plain') as NplMode;
    await el.updateComplete;
    expect(el.querySelectorAll('.npl-mode-chip')).toHaveLength(1);
    expect(el.querySelectorAll('.npl-mode-chip-primary')).toHaveLength(0);
    expect(el.hasAttribute('data-primary')).toBe(false);
  });

  it('a mode child without the required type attribute is skipped', async () => {
    document.body.innerHTML =
      '<npl-mode id="lax"><mode></mode><mode type="analyst"></mode></npl-mode>';
    const el = document.getElementById('lax') as NplMode;
    await el.updateComplete;
    const chips = el.querySelectorAll('.npl-mode-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('analyst');
  });

  it('an authored data-primary marks the chips and survives the mirror', async () => {
    // class-form authoring: data-primary alone must resolve (data-* wins,
    // conventions §2) and must not be stripped by the default's mirror.
    document.body.innerHTML =
      '<npl-mode id="dataform" data-primary><mode type="planner"></mode></npl-mode>';
    const el = document.getElementById('dataform') as NplMode;
    await el.updateComplete;
    expect(el.querySelectorAll('.npl-mode-chip-primary')).toHaveLength(1);
    expect(el.hasAttribute('data-primary')).toBe(true);
  });

  it('generated chips lead the element, authored children follow', async () => {
    const el = document.getElementById('lens') as NplMode;
    await el.updateComplete;
    const first = el.firstElementChild as HTMLElement | null;
    const last = el.lastElementChild as HTMLElement | null;
    expect(first?.classList.contains('npl-mode-chip')).toBe(true);
    expect(last?.tagName.toLowerCase()).toBe('mode');
  });

  it('upgrades with light DOM — no shadow root, authored children survive', async () => {
    const el = document.getElementById('lens') as NplMode;
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplMode);
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector('mode[type="reasoning"]')).not.toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
  });
});
