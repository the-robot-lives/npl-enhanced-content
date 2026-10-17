// @vitest-environment happy-dom
// Unit spec — npl-lazy's alias route (src/lazy/npl.ts + shared/npl-alias.ts)
//
// Feature: a class-form alias triggers its chunk under the lazy loader
//   Scenario: a boot-time `.npl-flag` div is rewritten to tag form and its
//             chunk download is attempted (the stub manifest's chunk 404s
//             under the runner, so the failure note proves BOTH the trigger
//             and the degradation contract: authored prose survives)
//   Scenario: an alias inserted after boot upgrades through the observer path
//   Scenario: a `.npl-*` class outside the manifest is never rewritten

import { describe, it, expect, beforeAll } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
// the chunk-failure path is async on both ends (import rejection lands a
// macrotask late) — poll for the marker instead of trusting a fixed tick,
// which misfires on loaded CI workers. Two pollers coexist (the 0.8 line
// landed the same fix as `tickUntil`); both poll, neither trusts a tick.
const until = async (fn: () => boolean, ms = 1000): Promise<void> => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 8));
};
/** The chunk-404 degradation lands a few macrotasks after boot; a single
 *  tick races under a loaded runner (153-file suite) — poll instead. */
const tickUntil = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 250 && !cond(); i++) await tick();
};

describe('npl-lazy — class-form alias route', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="npl-flag" data-kind="concept">aliased flag</div>' +
      '<div class="npl-notshipped">stays prose</div>';
    await import('../../src/lazy/npl.js');
    await tickUntil(() => document.querySelector('npl-flag')?.hasAttribute('data-sem-lazy-error') === true);
  });

  it('rewrote the manifest-known alias to tag form at boot', () => {
    const el = document.querySelector('npl-flag')!;
    expect(el).toBeTruthy();
    expect(el.hasAttribute('data-npl-alias')).toBe(true);
    expect(el.getAttribute('data-kind')).toBe('concept');
  });

  it('the rewritten alias triggered the chunk load — failure degrades to prose + alert', async () => {
    const el = document.querySelector('npl-flag')!;
    await until(() => el.getAttribute('data-sem-lazy-error') !== null);
    expect(el.getAttribute('data-sem-lazy-error')).toBe('npl-flag');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('npl-flag');
    // degradation contract: the authored text is still there, readable
    expect(el.textContent).toContain('aliased flag');
  });

  it('leaves a class outside the manifest as authored prose', () => {
    const el = document.querySelector('.npl-notshipped')!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute('data-npl-alias')).toBe(false);
  });

  it('upgrades an alias inserted after boot through the observer path', async () => {
    const wrap = document.createElement('section');
    wrap.innerHTML = '<div class="npl-flag" data-kind="caveat">late flag</div>';
    document.body.appendChild(wrap);
    await tick();
    const late = wrap.querySelector('npl-flag');
    expect(late).toBeTruthy();
    expect(late!.hasAttribute('data-npl-alias')).toBe(true);
    expect(wrap.querySelector('div.npl-flag')).toBeNull();
    // the late element failed fast against the cached-failed chunk
    await until(() => late!.getAttribute('data-sem-lazy-error') !== null);
    expect(late!.getAttribute('data-sem-lazy-error')).toBe('npl-flag');
    expect(late!.textContent).toContain('late flag');
  });
});
