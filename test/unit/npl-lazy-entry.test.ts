// @vitest-environment happy-dom
// Unit spec — the real npl-lazy entry (src/lazy/npl.ts) end to end
//
// The semtext-lazy entry spec (lazy-entry.test.ts) proves the shared boot
// wiring; this one proves the npl instantiation of it: the /^npl-/ prefix
// (a sem-* element is NOT this loader's business) and the npl manifest
// alias route.
//
// The manifest comes from the vitest alias (vite.config.ts →
// test/unit/fixtures/npl-manifest.stub.ts); the chunk URL deliberately
// does not exist under the test runner, so every attempt takes the
// failure path deterministically.

import { describe, it, expect, beforeAll, vi } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 4));

describe('npl-lazy entry wiring', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<npl-flag kind="concept">f</npl-flag><sem-note>s</sem-note>';
    await import('../../src/lazy/npl.js');
    await tick();
  });

  it('boots document-wide for npl-* elements — no wrapper required', () => {
    // The chunk rejection is async and its timing varies with machine load;
    // poll for it instead of assuming one 4ms tick suffices.
    vi.waitFor(
      () => {
        const el = document.querySelector('npl-flag')!;
        expect(el.getAttribute('data-sem-lazy-error')).toBe('npl-flag');
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('npl-flag');
      },
      { timeout: 2000, interval: 20 },
    );
  });

  it('owns only the npl namespace: a sem-* element is left to semtext-lazy', () => {
    expect(document.querySelector('sem-note')!.hasAttribute('data-sem-lazy-error')).toBe(false);
  });
});
