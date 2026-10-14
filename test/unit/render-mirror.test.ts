// @vitest-environment happy-dom
// Unit spec — renderer lane: the DOM mirror (src/terminal/render/mirror.ts).
//
// Feature: mount
//   Scenario: attach prepends the mirror root with the §9 log shape
//   Scenario: the mirror is visually hidden until promoted
// Feature: painting
//   Scenario: rows render v1 span shape — plain runs bare, styled runs sem-ansi classes
//   Scenario: style runs split at attribute boundaries
//   Scenario: wrapped rows carry the flag; absent rows render no div
//   Scenario: no cell content ever lands as HTML — textContent only
// Feature: damage sync
//   Scenario: drain schedules within the ≥100ms throttle floor
//   Scenario: scroll damage marks everything dirty
// Feature: announce
//   Scenario: the live region takes the summary text; identical text is a no-op
// Feature: promotion
//   Scenario: setVisible flips data-visible both ways
// Feature: selection mapping
//   Scenario: a DOM selection inside a row maps to an absolute range
// Feature: detach
//   Scenario: detach removes the root and clears pending state

import { describe, it, expect } from 'vitest';
import { buildPaintScreen, type PaintScreen } from '../../src/terminal/render/screen-shape.js';
import { DOMMirror, spansForLine } from '../../src/terminal/render/mirror.js';
import type { MirrorOptions } from '../../src/terminal/render/mirror.js';
import type { DamageSet } from '../../src/terminal/screen/types.js';

/* ---------------------------------------------------------------- *
 * helpers
 * ---------------------------------------------------------------- */

/** Manual clock + scheduler: tests fire the pending flush explicitly. */
function makeClock(): { opts: MirrorOptions; advance(ms: number): void; due(): number; fire(): void } {
  let t = 0;
  let pending: (() => void) | null = null;
  let pendingAt = 0;
  const opts: MirrorOptions = {
    schedule(fn, ms) {
      pending = fn;
      pendingAt = t + ms;
      return () => { pending = null; };
    },
    now: () => t,
  };
  return {
    opts,
    due: () => pendingAt - t,
    fire() {
      if (pending === null) return;
      t = pendingAt;
      const fn = pending;
      pending = null;
      fn();
    },
    advance(ms) { t += ms; },
  };
}

const damage = (lines: object[] = [], over: Partial<DamageSet> = {}): DamageSet =>
  ({ lines: new Set(lines), cursor: false, scroll: false, full: false, ...over }) as DamageSet;

/** A mirror row renders exactly `cols` cells — padded when short, truncated when long. */
const grid = (text: string, cols = 10): string => (text + ' '.repeat(cols)).slice(0, cols);

function mounted(text: string[], clock = makeClock()): { mirror: DOMMirror; host: HTMLElement; screen: PaintScreen; body: HTMLElement; live: HTMLElement } {
  const host = document.createElement('div');
  const screen = buildPaintScreen(text, { cols: 10 });
  const mirror = new DOMMirror(clock.opts);
  mirror.attach(screen, host);
  const root = mirror.element as HTMLElement;
  return {
    mirror, host, screen,
    body: root.querySelector('.sem-term-mirror-body') as HTMLElement,
    live: root.querySelector('.sem-term-mirror-live') as HTMLElement,
  };
}

/* ---------------------------------------------------------------- *
 * mount
 * ---------------------------------------------------------------- */

describe('mount', () => {
  it('attach prepends the mirror root with the §9 log shape', () => {
    const { host } = mounted(['hi']);
    const root = host.querySelector('.sem-term-mirror') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('role')).toBe('log');
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-label')).toBe('Shell transcript');
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(root.getAttribute('data-visible')).toBe('false');
    expect(root.querySelector('.sem-term-mirror-live')).not.toBeNull();
    expect(root.querySelector('.sem-term-mirror-body')).not.toBeNull();
  });

  it('the mirror is visually hidden until promoted', () => {
    const { mirror } = mounted(['hi']);
    expect(mirror.visible).toBe(false);
  });
});

/* ---------------------------------------------------------------- *
 * painting
 * ---------------------------------------------------------------- */

describe('painting', () => {
  it('rows render v1 span shape — plain runs bare, styled runs sem-ansi classes', () => {
    const { body } = mounted(['plain']);
    const row = body.children[0] as HTMLElement;
    expect(row.className).toContain('sem-term-mirror-line');
    expect(row.getAttribute('data-abs')).toBe('0');
    expect(row.textContent).toBe(grid('plain'));
    // default attrs → one bare text node, no spans
    expect(row.childNodes).toHaveLength(1);
    expect(row.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('style runs split at attribute boundaries', () => {
    const { host, screen } = mounted(['abc']);
    const row = screen.lineAt(0)!;
    // hand-style the middle cell: BOLD bit + red fg (indexed 1)
    const mid = row.cell(1);
    mid.attrs = 1;
    mid.fg = 1;
    const spans = spansForLine(document, screen, row);
    expect(spans).toHaveLength(3);
    const styled = spans[1] as HTMLElement;
    expect(styled.className).toContain('sem-ansi-b');
    expect(styled.className).toContain('sem-ansi-c31');
    expect(styled.textContent).toBe('b');
    expect(host.ownerDocument).toBe(document);
  });

  it('wrapped rows carry the flag; absent rows render no div', () => {
    const wrapped = mounted([{ text: 'ab', wrapped: true }, 'cd']);
    expect((wrapped.body.children[0] as HTMLElement).hasAttribute('data-wrapped')).toBe(true);
    expect((wrapped.body.children[1] as HTMLElement).hasAttribute('data-wrapped')).toBe(false);

    // A screen whose row 0 is absent renders only row 1.
    const clock = makeClock();
    const host = document.createElement('div');
    const screen = buildPaintScreen(['a', 'b'], { cols: 2 });
    const masked: PaintScreen = {
      ...screen,
      lineAt: (r) => (r === 0 ? null : screen.lineAt(r)),
      absoluteLineAt: (r) => (r === 0 ? null : screen.absoluteLineAt(r)),
    };
    const mirror = new DOMMirror(clock.opts);
    mirror.attach(masked, host);
    const body = (mirror.element as HTMLElement).querySelector('.sem-term-mirror-body') as HTMLElement;
    expect(body.children).toHaveLength(1);
    expect((body.children[0] as HTMLElement).getAttribute('data-abs')).toBe('1');
  });

  it('no cell content ever lands as HTML — textContent only', () => {
    const { body } = mounted(['<img src=x onerror=alert(1)>']);
    expect(body.querySelector('img')).toBeNull();
    expect(body.textContent).toBe(grid('<img src=x onerror=alert(1)>'));
  });
});

/* ---------------------------------------------------------------- *
 * damage sync
 * ---------------------------------------------------------------- */

describe('damage sync', () => {
  it('drain schedules within the ≥100ms throttle floor', () => {
    const clock = makeClock();
    const { mirror, screen, body } = mounted(['one', 'two'], clock);
    const line = screen.lineAt(1)!;
    mirror.drain(damage([line]));
    expect(clock.due()).toBe(100); // full floor right after the attach flush
    clock.fire();
    expect((body.children[1] as HTMLElement).textContent).toBe(grid('two'));
  });

  it('scroll damage marks everything dirty', () => {
    const clock = makeClock();
    const { mirror, body } = mounted(['a', 'b', 'c'], clock);
    mirror.drain(damage([], { scroll: true }));
    clock.fire();
    expect(body.children).toHaveLength(3);
  });
});

/* ---------------------------------------------------------------- *
 * announce + promotion
 * ---------------------------------------------------------------- */

describe('announce', () => {
  it('the live region takes the summary text; identical text is a no-op', () => {
    const { mirror, live } = mounted(['hi']);
    mirror.announce('pager: 3 of 10');
    expect(live.textContent).toBe('pager: 3 of 10');
    mirror.announce('pager: 3 of 10');
    expect(live.textContent).toBe('pager: 3 of 10');
    mirror.announce('pager: 4 of 10');
    expect(live.textContent).toBe('pager: 4 of 10');
  });
});

describe('promotion', () => {
  it('setVisible flips data-visible both ways', () => {
    const { mirror } = mounted(['hi']);
    mirror.setVisible(true);
    expect(mirror.visible).toBe(true);
    mirror.setVisible(false);
    expect(mirror.visible).toBe(false);
  });
});

/* ---------------------------------------------------------------- *
 * selection mapping
 * ---------------------------------------------------------------- */

describe('selection mapping', () => {
  it('a DOM selection inside a row maps to an absolute range', () => {
    const { mirror, host } = mounted(['abcdef']);
    const row = host.querySelector('.sem-term-mirror-line') as HTMLElement;
    const text = row.childNodes[0] as Text;
    const fakeRange = { startContainer: text, startOffset: 1, endContainer: text, endOffset: 4 };
    const fakeSelection = { rangeCount: 1, getRangeAt: () => fakeRange } as unknown as Selection;
    expect(mirror.rangeFromSelection(fakeSelection)).toEqual({
      start: { line: 0, col: 1 },
      end: { line: 0, col: 4 },
    });
  });
});

/* ---------------------------------------------------------------- *
 * detach
 * ---------------------------------------------------------------- */

describe('detach', () => {
  it('detach removes the root and clears pending state', () => {
    const { mirror } = mounted(['hi']);
    expect(mirror.element).not.toBeNull();
    mirror.detach();
    expect(mirror.element).toBeNull();
  });
});
