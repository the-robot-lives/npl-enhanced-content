// @vitest-environment happy-dom
// Unit spec — renderer lane: the canvas driver (src/terminal/render/canvas.ts).
//
// Feature: availability probes (§8.5a)
//   Scenario: forced-colors → the factory returns ok:false
//   Scenario: a failed 2d context fires onUnavailable and the mirror still mounts
// Feature: painting
//   Scenario: attach repaints every row
//   Scenario: drain paints only the damaged rows
//   Scenario: scroll damage repaints everything
//   Scenario: paint() with no damage is a full repaint
// Feature: cursor (§8.3)
//   Scenario: block fills the cell and redraws the glyph
//   Scenario: beam is a thin bar; underline hugs the cell floor
//   Scenario: blink runs on the 530ms cycle and stops at detach
//   Scenario: reduced motion keeps the cursor steady with no timer
// Feature: DPR + metrics (§8.3)
//   Scenario: the backing store scales by the clamped DPR (1..3)
//   Scenario: a mid-session zoom change resizes on the next drain
//   Scenario: onMetricsChange reports the fitted grid
// Feature: teardown
//   Scenario: detach removes the canvas and the mirror

import { describe, it, expect, vi } from 'vitest';
import { createCanvasRenderer, type CanvasRendererOptions, type CreateRendererResult, type ViewEnvironment, type CanvasRenderer } from '../../src/terminal/render/canvas.js';
import { buildPaintScreen, type PaintScreen } from '../../src/terminal/render/screen-shape.js';
import type { AtlasCanvas, AtlasSourceContext } from '../../src/terminal/render/atlas.js';
import type { DamageSet } from '../../src/terminal/screen/types.js';

/* ---------------------------------------------------------------- *
 * fakes
 * ---------------------------------------------------------------- */

interface Op { op: string; args: number[]; fillStyle: string }

class RecCtx implements AtlasSourceContext {
  readonly ops: Op[] = [];
  font = '';
  fillStyle = '';
  textBaseline = '';
  globalAlpha = 1;
  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: 'fillRect', args: [x, y, w, h], fillStyle: this.fillStyle });
  }
  fillText(text: string, x: number, y: number): void {
    void text; void x; void y;
  }
  measureText(text: string): { width: number } {
    return { width: 8 * text.length };
  }
  setTransform(...args: number[]): void {
    this.ops.push({ op: 'setTransform', args, fillStyle: this.fillStyle });
  }
  drawImage(...args: unknown[]): void {
    this.ops.push({ op: 'drawImage', args: args.slice(1) as number[], fillStyle: this.fillStyle });
  }
  clearRect(...args: number[]): void {
    this.ops.push({ op: 'clearRect', args, fillStyle: this.fillStyle });
  }
}

class RecCanvas implements AtlasCanvas {
  width = 0;
  height = 0;
  constructor(readonly ctx: RecCtx) {}
  getContext(kind: '2d'): AtlasSourceContext | null {
    return kind === '2d' ? this.ctx : null;
  }
}

class FakeView implements ViewEnvironment {
  dpr = 1;
  reduced = false;
  forced = false;
  now = 0;
  private seq = 1;
  readonly timers: { id: number; fn: () => void; at: number; ms: number }[] = [];
  get devicePixelRatio(): number {
    return this.dpr;
  }
  matchMedia(query: string): { matches: boolean; addEventListener(t: string, fn: () => void): void; removeEventListener(t: string, fn: () => void): void } {
    const view = this;
    return {
      get matches(): boolean {
        if (query.includes('forced-colors')) return view.forced;
        if (query.includes('reduced-motion')) return view.reduced;
        return false;
      },
      addEventListener() {},
      removeEventListener() {},
    };
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.seq++;
    this.timers.push({ id, fn, at: this.now + ms, ms });
    return id;
  }
  clearTimeout(id: number): void {
    const i = this.timers.findIndex((t) => t.id === id);
    if (i >= 0) this.timers.splice(i, 1);
  }
  advance(ms: number): void {
    const horizon = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= horizon).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.now = Math.max(this.now, due.at);
      this.clearTimeout(due.id);
      due.fn();
    }
    this.now = horizon;
  }
}

interface Rig {
  view: FakeView;
  targets: RecCtx[];
  onUnavailable: ReturnType<typeof vi.fn>;
  onMetrics: ReturnType<typeof vi.fn>;
  options: CanvasRendererOptions;
}

function makeRig(over: Partial<CanvasRendererOptions> = {}): Rig {
  const view = new FakeView();
  const targets: RecCtx[] = [];
  const onUnavailable = vi.fn();
  const onMetrics = vi.fn();
  const options: CanvasRendererOptions = {
    view,
    createCanvas: (w, h) => {
      // A real happy-dom canvas element: the renderer prepends it to the
      // host, so queries like .sem-term-canvas and 'canvas' must find it.
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      const ctx = new RecCtx();
      targets.push(ctx);
      el.getContext = () => ctx as unknown as CanvasRenderingContext2D;
      return el as unknown as AtlasCanvas;
    },
    onUnavailable,
    onMetricsChange: onMetrics,
    ...over,
  };
  return { view, targets, onUnavailable, onMetrics, options };
}

function fixedHost(): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 80, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: 36, configurable: true });
  return host;
}

function damage(lines: object[] = [], over: Partial<DamageSet> = {}): DamageSet {
  return { lines: new Set(lines), cursor: false, scroll: false, full: false, ...over } as DamageSet;
}

/** Attach the standard two-row screen; returns the rig plus paint surface. */
function attach(rig: Rig, screenOver: Parameters<typeof buildPaintScreen>[1] = {}): { res: CreateRendererResult; renderer: CanvasRenderer; host: HTMLElement; screen: PaintScreen; main: RecCtx } {
  const host = fixedHost();
  const screen = buildPaintScreen(['hello', 'world'], { cols: 10, ...screenOver });
  const res = createCanvasRenderer(rig.options);
  expect(res.ok).toBe(true);
  const renderer = (res as { ok: true; renderer: CanvasRenderer }).renderer;
  renderer.attach(screen, host);
  return { res, renderer, host, screen, main: rig.targets[0] };
}

const rowsPainted = (main: RecCtx): number[] =>
  [...new Set(main.ops.filter((o) => o.op === 'fillRect').map((o) => Math.floor(o.args[1] / 18)))].sort((a, b) => a - b);

/* ---------------------------------------------------------------- *
 * availability probes
 * ---------------------------------------------------------------- */

describe('availability probes', () => {
  it('forced-colors → the factory returns ok:false', () => {
    const rig = makeRig();
    rig.view.forced = true;
    const res = createCanvasRenderer(rig.options);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('forced-colors');
    expect(rig.targets).toHaveLength(0);
  });

  it('a failed 2d context fires onUnavailable and the mirror still mounts', () => {
    const rig = makeRig({
      createCanvas: () => ({ width: 1, height: 1, getContext: () => null }),
    });
    const host = document.createElement('div');
    const res = createCanvasRenderer(rig.options);
    expect(res.ok).toBe(true);
    const renderer = (res as { ok: true; renderer: CanvasRenderer }).renderer;
    renderer.attach(buildPaintScreen(['hi']), host);
    expect(rig.onUnavailable).toHaveBeenCalledWith('no-2d-context');
    expect(host.querySelector('.sem-term-canvas')).toBeNull();
    expect(host.querySelector('.sem-term-mirror')).not.toBeNull();
    renderer.detach();
  });
});

/* ---------------------------------------------------------------- *
 * painting
 * ---------------------------------------------------------------- */

describe('painting', () => {
  it('attach repaints every row', () => {
    const { renderer, main } = attach(makeRig());
    expect(rowsPainted(main)).toEqual([0, 1]);
    renderer.detach();
  });

  it('drain paints only the damaged rows', () => {
    const { renderer, screen, main } = attach(makeRig());
    main.ops.length = 0;
    renderer.drain(damage([screen.lineAt(1)!]));
    expect(rowsPainted(main)).toEqual([1]);
    renderer.detach();
  });

  it('scroll damage repaints everything', () => {
    const { renderer, main } = attach(makeRig());
    main.ops.length = 0;
    renderer.drain(damage([], { scroll: true }));
    expect(rowsPainted(main)).toEqual([0, 1]);
    renderer.detach();
  });

  it('paint() with no damage is a full repaint', () => {
    const { renderer, main } = attach(makeRig());
    main.ops.length = 0;
    renderer.paint();
    expect(rowsPainted(main)).toEqual([0, 1]);
    renderer.detach();
  });
});

/* ---------------------------------------------------------------- *
 * cursor
 * ---------------------------------------------------------------- */

describe('cursor', () => {
  const at = { row: 1, col: 3, visible: true, style: 'block' as const };

  it('block fills the cell and redraws the glyph', () => {
    const { renderer, main } = attach(makeRig(), { cursor: at });
    main.ops.length = 0;
    renderer.drain(damage([], { cursor: true }));
    // the cursor cell got a cell-sized fill at (col*cw, row*ch)
    const cell = main.ops.find((o) => o.op === 'fillRect' && o.args[0] === 24 && o.args[1] === 18 && o.args[2] === 8 && o.args[3] === 18);
    expect(cell).toBeDefined();
    renderer.detach();
  });

  it('beam is a thin bar; underline hugs the cell floor', () => {
    const beam = attach(makeRig(), { cursor: { ...at, style: 'beam' } });
    const bar = beam.main.ops.find((o) => o.op === 'fillRect' && o.args[0] === 24 && o.args[1] === 18 && o.args[2] === 2 && o.args[3] === 18);
    expect(bar).toBeDefined();
    beam.renderer.detach();

    const under = attach(makeRig(), { cursor: { ...at, style: 'underline' } });
    const strip = under.main.ops.find((o) => o.op === 'fillRect' && o.args[0] === 24 && o.args[1] === 34 && o.args[2] === 8 && o.args[3] === 2);
    expect(strip).toBeDefined();
    under.renderer.detach();
  });

  it('blink runs on the 530ms cycle and stops at detach', () => {
    const rig = makeRig();
    const { renderer, main } = attach(rig, { cursor: at });
    expect(rig.view.timers).toHaveLength(1);
    expect(rig.view.timers[0].ms).toBe(530);
    main.ops.length = 0;
    rig.view.advance(530); // phase flip → cursor row repaints
    expect(rowsPainted(main)).toEqual([1]);
    renderer.detach();
    expect(rig.view.timers).toHaveLength(0);
  });

  it('reduced motion keeps the cursor steady with no timer', () => {
    const rig = makeRig();
    rig.view.reduced = true;
    const { renderer, main } = attach(rig, { cursor: at });
    expect(rig.view.timers).toHaveLength(0);
    main.ops.length = 0;
    renderer.drain(damage([], { cursor: true })); // steady: always paints
    const cell = main.ops.find((o) => o.op === 'fillRect' && o.args[0] === 24 && o.args[1] === 18 && o.args[2] === 8 && o.args[3] === 18);
    expect(cell).toBeDefined();
    renderer.detach();
  });
});

/* ---------------------------------------------------------------- *
 * DPR + metrics
 * ---------------------------------------------------------------- */

describe('DPR + metrics', () => {
  it('the backing store scales by the clamped DPR (1..3)', () => {
    const rig = makeRig();
    rig.view.dpr = 9;
    const { renderer, host } = attach(rig);
    const el = host.querySelector('canvas') as HTMLCanvasElement;
    expect(el.width).toBe(80 * 3);
    expect(el.height).toBe(36 * 3);
    expect(renderer.metrics().dpr).toBe(3);
    renderer.detach();
  });

  it('a mid-session zoom change resizes on the next drain', () => {
    const rig = makeRig();
    const { renderer, main } = attach(rig);
    rig.view.dpr = 2;
    main.ops.length = 0;
    renderer.drain(damage());
    expect(renderer.metrics().dpr).toBe(2);
    expect(rowsPainted(main)).toEqual([0, 1]);
    renderer.detach();
  });

  it('onMetricsChange reports the fitted grid', () => {
    const rig = makeRig();
    const { renderer } = attach(rig);
    expect(rig.onMetrics).toHaveBeenCalled();
    const m = rig.onMetrics.mock.calls.at(-1)![0] as { cols: number; rows: number; cellWidth: number; cellHeight: number; dpr: number };
    expect(m).toEqual({ cols: 10, rows: 2, cellWidth: 8, cellHeight: 18, dpr: 1 });
    renderer.detach();
  });
});

/* ---------------------------------------------------------------- *
 * teardown
 * ---------------------------------------------------------------- */

describe('teardown', () => {
  it('detach removes the canvas and the mirror', () => {
    const { renderer, host } = attach(makeRig());
    expect(host.querySelector('.sem-term-canvas')).not.toBeNull();
    expect(host.querySelector('.sem-term-mirror')).not.toBeNull();
    renderer.detach();
    expect(host.querySelector('.sem-term-canvas')).toBeNull();
    expect(host.querySelector('.sem-term-mirror')).toBeNull();
  });
});
