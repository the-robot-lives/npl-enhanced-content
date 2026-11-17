// @vitest-environment happy-dom
// Unit spec — THEROB-187: the js-shell screen seeds 80×24 and two mount
// paths never refit to the real pane width.
//
// Feature: unconditional width refit
//   Scenario: mirror-only path measures + refits at mount (no renderer metrics)
//   Scenario: deferred surface mount re-checks through the Lit lifecycle
//   Scenario: zero-geometry surface does not clobber the seed with garbage
//   Scenario: the bounded re-check exhausts and gives up (no poll loop)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../src/terminal/sem-terminal.js';
import { SemTerminal } from '../../src/terminal/sem-terminal.js';
import { fitCounts, measureCellMetrics } from '../../src/terminal/render/metrics.js';
import type { MeasuringContext } from '../../src/terminal/render/metrics.js';

/**
 * In happy-dom the surface never has layout, so the refit can only see the
 * real geometry through stubs. Both getters live on HTMLElement.prototype
 * (configurable) — stubbed together, restored in afterEach.
 */
function stubSurfaceBox(width: number, height: number): void {
  for (const prop of ['clientWidth', 'clientHeight'] as const) {
    const value = prop === 'clientWidth' ? width : height;
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList?.contains('sem-term-surface') ? value : 0;
    });
  }
}

/** Expected refit outcome for a 800×400 surface under the fallback cell box. */
const expectedFit = (): { cols: number; rows: number } => {
  const probe = document.createElement('canvas');
  const ctx = probe.getContext('2d') as MeasuringContext | null;
  const cell =
    ctx !== null
      ? measureCellMetrics(ctx)
      : { cellWidth: 14 * 0.6, cellHeight: Math.round(14 * 1.27) };
  return fitCounts(800, 400, cell.cellWidth, cell.cellHeight);
};

/** Let Lit lifecycle + the bounded retry microtasks fully settle. */
async function settle(el: SemTerminal): Promise<void> {
  await el.updateComplete;
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function attach(tag = 'sem-terminal'): Promise<SemTerminal> {
  const el = document.createElement(tag) as SemTerminal;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('THEROB-187 width refit', () => {
  it('mirror-only path measures the surface and refits the 80×24 seed away', async () => {
    stubSurfaceBox(800, 400);
    const el = await attach();
    // happy-dom has no 2d context → the mirror-only path mounted.
    expect(el.querySelector('.sem-term-surface')).not.toBeNull();
    expect(el.screen.cols).not.toBe(80);
    const fit = expectedFit();
    expect(el.screen.cols).toBe(fit.cols);
    expect(el.screen.rows).toBe(fit.rows);
  });

  it('refit survives a disconnect/reconnect cycle (idempotent, seed never returns)', async () => {
    stubSurfaceBox(800, 400);
    const el = await attach();
    const first = el.screen.cols;
    expect(first).not.toBe(80);
    el.remove();
    document.body.appendChild(el);
    await settle(el);
    expect(el.screen.cols).toBe(first);
  });

  it('deferred surface mount: refit lands once the surface appears', async () => {
    stubSurfaceBox(800, 400);
    const el = document.createElement('sem-terminal') as SemTerminal;
    // The surface "mounts late": the first two #ensureRenderer lookups miss
    // (firstUpdated + the connectedCallback updateComplete tick), the third
    // (the bounded re-check) finds it.
    let surfaceLookups = 0;
    const realQuery = el.querySelector.bind(el);
    vi.spyOn(el, 'querySelector').mockImplementation(((selector: string) => {
      if (selector === '.sem-term-surface') {
        surfaceLookups += 1;
        if (surfaceLookups <= 2) return null;
      }
      return realQuery(selector as string);
    }) as typeof el.querySelector);
    document.body.appendChild(el);
    await settle(el);
    expect(el.screen.cols).not.toBe(80);
    expect(el.screen.cols).toBe(expectedFit().cols);
  });

  it('deferred mount with a surface that never appears gives up bounded (no poll loop)', async () => {
    stubSurfaceBox(800, 400);
    const el = document.createElement('sem-terminal') as SemTerminal;
    const realQuery = HTMLElement.prototype.querySelector;
    vi.spyOn(el, 'querySelector').mockImplementation(function (this: SemTerminal, selector: string) {
      if (selector === '.sem-term-surface') return null;
      return realQuery.call(this, selector);
    } as typeof el.querySelector);
    document.body.appendChild(el);
    await settle(el);
    // Bounded: budget spent, the seed geometry survives untouched rather
    // than entering a poll loop — and no throw.
    expect(el.screen.cols).toBe(80);
  });

  it('a zero-geometry surface does not clobber the seed with a garbage fit', async () => {
    const el = await attach();
    // No box stubs: happy-dom reports clientWidth 0 — refit must leave the
    // seed alone rather than fit a 0px pane (which would clamp to COLS_MIN).
    expect(el.screen.cols).toBe(80);
  });
});
