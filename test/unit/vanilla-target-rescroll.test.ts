// @vitest-environment happy-dom
// Regression: the deep-link target resolves ONCE, not on every mutation
// re-scan. A page with live content (autoplaying sem-shell demos, carousels)
// triggers the 50ms re-scan perpetually; settleTarget() used to re-run the
// scroll each time, yanking the reader to the hash target constantly.
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshTarget() {
  vi.resetModules();
  return await import('../../src/vanilla/target.js');
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// set the hash WITHOUT firing hashchange (happy-dom fires it async otherwise,
// which would reset the latch and double-scroll — a test artifact, not the bug)
const setHash = (h: string) => history.replaceState(null, '', h || window.location.pathname);

describe('vanilla target — resolve once, not on every re-scan', () => {
  let scrolls: number;
  beforeEach(() => {
    document.body.innerHTML = '';
    setHash('');
    scrolls = 0;
    Element.prototype.scrollIntoView = function () { scrolls += 1; };
  });

  it('settleTarget after resolution does not re-scroll (the autoplay re-scan loop)', async () => {
    const t = await freshTarget();
    const el = document.createElement('section'); el.id = 'addons'; document.body.appendChild(el);
    setHash('#addons');
    t.enhanceTarget(document);
    await vi.waitFor(() => expect(scrolls).toBe(1), { timeout: 1000 });
    for (let i = 0; i < 6; i++) { t.settleTarget(); await wait(80); } // perpetual re-scans
    expect(scrolls).toBe(1); // still exactly one scroll
  });

  it('hashchange still resolves a new target', async () => {
    const t = await freshTarget();
    const a = document.createElement('section'); a.id = 'one'; document.body.appendChild(a);
    const b = document.createElement('section'); b.id = 'two'; document.body.appendChild(b);
    location.hash = '#one'; // before wiring — the initial settle resolves it
    t.enhanceTarget(document);
    await vi.waitFor(() => expect(scrolls).toBeGreaterThanOrEqual(1), { timeout: 1000 });
    const before = scrolls;
    location.hash = '#two'; // navigation fires hashchange → latch resets → re-resolve
    await vi.waitFor(() => expect(scrolls).toBeGreaterThan(before), { timeout: 1000 });
  });

  it('no hash never scrolls, even across re-scans', async () => {
    const t = await freshTarget();
    const el = document.createElement('section'); el.id = 'x'; document.body.appendChild(el);
    setHash('');
    t.enhanceTarget(document);
    await wait(150);
    t.settleTarget(); await wait(80);
    expect(scrolls).toBe(0);
  });
});
