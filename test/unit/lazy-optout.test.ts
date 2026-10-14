// @vitest-environment happy-dom
// Unit spec — the window.__semLazyOff opt-out (src/lazy/index.ts)
//
// The plain entry spec (lazy-entry.test.ts) proves the document-wide boot.
// This one proves the opt-out: with the flag set before the entry loads,
// NO boot scan runs (existing sem-* elements stay untouched, later
// insertions are ignored), the loader is still exposed on
// window.SemTextLazy, and a targeted hydrate(root) processes exactly the
// subtree it was given — the "load only the chunk this element maps to"
// surface host pages drive hydration with.
//
// As in lazy-entry.test.ts, the manifest comes from the vitest alias and
// the chunk URL deliberately does not exist under the test runner, so a
// targeted hydrate takes the deterministic failure path (the role="alert"
// note) on the element it was pointed at — and nothing else.

import { describe, it, expect, beforeAll } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 4));

describe('lazy entry — __semLazyOff opt-out', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<sem-note id="already-there">n</sem-note><div id="host"><sem-note id="target">n</sem-note></div>';
    (window as { __semLazyOff?: boolean }).__semLazyOff = true;
    await import('../../src/lazy/index.js');
    await tick();
  });

  it('does not boot document-wide: elements already on the page are untouched', () => {
    expect(document.getElementById('already-there')!.hasAttribute('data-sem-lazy-error')).toBe(false);
    expect(document.getElementById('target')!.hasAttribute('data-sem-lazy-error')).toBe(false);
  });

  it('does not watch the document: insertions after boot are ignored', async () => {
    document.body.insertAdjacentHTML('beforeend', '<sem-note id="late">n</sem-note>');
    await tick();
    expect(document.getElementById('late')!.hasAttribute('data-sem-lazy-error')).toBe(false);
  });

  it('exposes the loader on window.SemTextLazy for targeted hydration', () => {
    expect(typeof window.SemTextLazy?.hydrate).toBe('function');
  });

  it('hydrate(root) processes exactly the subtree it was given', async () => {
    const host = document.getElementById('host')!;
    await window.SemTextLazy!.hydrate(host);
    await tick();
    expect(document.getElementById('target')!.getAttribute('data-sem-lazy-error')).toBe('sem-note');
    expect(document.getElementById('already-there')!.hasAttribute('data-sem-lazy-error')).toBe(false);
  });
});
