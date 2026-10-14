// @vitest-environment happy-dom
// Unit spec — the npl.js full-bundle entry's alias pass (src/npl.ts)
//
// Feature: an alias-form document renders under the full npl bundle
//   Scenario: importing the entry rewrites `.npl-*` divs at boot and the
//             components upgrade them (chrome + resolved data-* parameters)
//   Scenario: a `.npl-*` class the bundle does not define stays prose

import { describe, it, expect, beforeAll } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 4));

describe('npl.js entry — class-form alias boot', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="npl-example" data-label="Boot">b</div>' +
      '<div class="npl-mood" data-mood="🙂 calm"></div>' +
      '<div class="npl-notshipped">stays prose</div>';
    await import('../../src/npl.js');
    await tick();
  });

  it('rewrote the known alias divs to tag form and upgraded them', async () => {
    const ex = document.querySelector('npl-example') as HTMLElement & { updateComplete: Promise<unknown> };
    const mood = document.querySelector('npl-mood') as HTMLElement & { updateComplete: Promise<unknown> };
    expect(ex).toBeTruthy();
    expect(mood).toBeTruthy();
    expect(ex.hasAttribute('data-npl-alias')).toBe(true);
    await ex.updateComplete;
    await mood.updateComplete;
    expect(ex.querySelector('.npl-example-label')?.textContent).toBe('Boot');
    expect(mood.querySelector('.npl-mood-emoji')?.textContent).toBe('🙂');
  });

  it('left the name it ships no component for as authored prose', () => {
    const el = document.querySelector('.npl-notshipped')!;
    expect(el.localName).toBe('div');
    expect(el.textContent).toBe('stays prose');
  });
});
