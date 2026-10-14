// @vitest-environment happy-dom
// Unit spec — src/shared/sem-scroll.ts · the virtual scrollbar (CORE-V2 §10)
//
// Feature: sem-scroll is a Lit viewport-bound scrollbar, output-only
//   Scenario: thumb geometry is proportional, clamped to the 24px minimum
//   Scenario: geometry is zero when the content fits or the track is unmeasured
//   Scenario: clampOffset rounds and clamps to [0, total - visible]
//   Scenario: a drag keeps the grab offset and maps pointer motion to rows
//   Scenario: a drag is a no-op when there is no travel
//   Scenario: a track click pages toward the click (up above, down below)
//   Scenario: hidden entirely when the content fits — empty render + hidden attr
//   Scenario: renders track + thumb and the ARIA scrollbar contract when scrollable
//   Scenario: scrollto fires the CustomEvent and the callback with the clamped row
//   Scenario: emits nothing when the requested row equals the current offset
//   Scenario: PgUp/PgDn/Home/End page while focused; other keys pass through
//   Scenario: keys do nothing when unfocused — never intercepts the key path
//   Scenario: wheel is pure passthrough — no listener, nothing consumed
//   Scenario: reduced motion by construction — the stylesheet has no transitions
//   Scenario: the offset is never self-assigned — the screen owns the viewport

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MIN_THUMB_PX,
  SemScroll,
  clampOffset,
  fits,
  offsetFromDrag,
  offsetFromTrackClick,
  thumbGeometry,
} from '../../src/shared/sem-scroll.js';
import type { ViewportModel } from '../../src/shared/sem-scroll.js';

const vp = (total: number, visible: number, offset: number): ViewportModel => ({
  total,
  visible,
  offset,
});

describe('sem-scroll geometry', () => {
  it('sizes the thumb proportionally and clamps to the 24px minimum', () => {
    // 10 visible of 1000 over 600px: 1% → 6px, clamped up to MIN_THUMB_PX.
    const tiny = thumbGeometry(vp(1000, 10, 0), 600);
    expect(tiny.height).toBe(MIN_THUMB_PX);

    // 300 of 600 over 600px: exactly half the track.
    const half = thumbGeometry(vp(600, 300, 0), 600);
    expect(half.height).toBe(300);
  });

  it('positions the thumb so offset progress maps over the remaining travel', () => {
    // 100 rows, 10 visible, track 200: proportional 20px clamps to MIN 24,
    // travel 176. Half-way (offset 45 of 90) → top 88.
    expect(thumbGeometry(vp(100, 10, 45), 200)).toEqual({ top: 88, height: 24 });
    expect(thumbGeometry(vp(100, 10, 90), 200)).toEqual({ top: 176, height: 24 });
    expect(thumbGeometry(vp(100, 10, 0), 200)).toEqual({ top: 0, height: 24 });
    // Beyond the minimum the thumb is proportional: 50 of 100 rows, track
    // 200 → thumb 100, travel 100, offset 25 → top 50.
    expect(thumbGeometry(vp(100, 50, 25), 200)).toEqual({ top: 50, height: 100 });
  });

  it('is zero-sized when the content fits or the track is unmeasured', () => {
    expect(thumbGeometry(vp(10, 10, 0), 600)).toEqual({ top: 0, height: 0 });
    expect(thumbGeometry(vp(10, 20, 0), 600)).toEqual({ top: 0, height: 0 });
    expect(thumbGeometry(vp(0, 10, 0), 600)).toEqual({ top: 0, height: 0 });
    expect(thumbGeometry(vp(100, 10, 0), 0)).toEqual({ top: 0, height: 0 });
    expect(fits(vp(100, 100, 0))).toBe(true);
    expect(fits(vp(101, 100, 0))).toBe(false);
  });

  it('clampOffset rounds and clamps to [0, total - visible]', () => {
    expect(clampOffset(vp(100, 10, 0), 45.6)).toBe(46);
    expect(clampOffset(vp(100, 10, 0), -5)).toBe(0);
    expect(clampOffset(vp(100, 10, 0), 95)).toBe(90);
    expect(clampOffset(vp(100, 10, 0), 1e9)).toBe(90);
  });
});

describe('sem-scroll input math', () => {
  it('a drag keeps the grab offset and maps pointer motion back to rows', () => {
    // 100 rows, 10 visible, track 200 → thumb clamped to 24, travel 176.
    const v = vp(100, 10, 0);
    // Grab the thumb at its top (grab 0), pointer to 88px → (88/176)*90 → 45.
    expect(offsetFromDrag(v, 200, 88, 0)).toBe(45);
    // Grab the thumb 10px below its top: pointer at 88 puts the top at 78 → 40.
    expect(offsetFromDrag(vp(100, 10, 0), 200, 88, 10)).toBe(40);
    // Past the end clamps to maxOffset; before the start clamps to 0.
    expect(offsetFromDrag(v, 200, 1e6, 0)).toBe(90);
    expect(offsetFromDrag(v, 200, -1e6, 0)).toBe(0);
  });

  it('a drag is a no-op when there is no travel', () => {
    // Track smaller than the minimum thumb → travel 0, the offset never moves.
    expect(offsetFromDrag(vp(100, 10, 40), 10, 5, 0)).toBe(40);
    // Content fits → no scrollable rows at all.
    expect(offsetFromDrag(vp(10, 10, 0), 100, 50, 0)).toBe(0);
  });

  it('a track click pages toward the click', () => {
    const v = vp(100, 10, 50);
    // Track 200, thumb 24 at top 98 → center 110: above pages up, below
    // pages down; exactly on the center pages down (>= center).
    expect(offsetFromTrackClick(v, 200, 40)).toBe(40);
    expect(offsetFromTrackClick(v, 200, 160)).toBe(60);
    expect(offsetFromTrackClick(v, 200, 110)).toBe(60);
    // Clamped at both ends.
    expect(offsetFromTrackClick(vp(100, 10, 0), 200, 160)).toBe(10);
    expect(offsetFromTrackClick(vp(100, 10, 90), 200, 40)).toBe(80);
  });
});

describe('sem-scroll element', () => {
  let el: SemScroll;
  const rows = (total: number, visible: number, offset = 0): void => {
    el.total = total;
    el.visible = visible;
    el.offset = offset;
  };

  beforeEach(async () => {
    el = new SemScroll();
    document.body.appendChild(el);
    await el.updateComplete;
  });

  const track = (): HTMLElement => el.renderRoot.querySelector('.track') as HTMLElement;
  const thumb = (): HTMLElement => el.renderRoot.querySelector('.thumb') as HTMLElement;

  /** Fake a real track box so geometry + pointer math run on pixels. */
  const fakeTrackBox = async (height: number): Promise<void> => {
    await el.updateComplete; // the track must exist before it is stubbed
    track().getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 12, bottom: height, width: 12, height } as DOMRect);
    // Force the component to re-measure through an update cycle.
    el.trackLen = 0;
    el.requestUpdate();
    await el.updateComplete;
  };

  const fire = (type: string, target: EventTarget, init: MouseEventInit = {}): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, ...init }));
  };

  it('hides entirely when the content fits', async () => {
    rows(10, 10);
    await el.updateComplete;
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(track()).toBeNull();
    // A tiny scrollback shows it again.
    rows(40, 10);
    await el.updateComplete;
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(track()).not.toBeNull();
  });

  it('carries the ARIA scrollbar contract when scrollable', async () => {
    rows(100, 10, 30);
    await el.updateComplete;
    expect(el.getAttribute('role')).toBe('scrollbar');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-valuemin')).toBe('0');
    expect(el.getAttribute('aria-valuemax')).toBe('90');
    expect(el.getAttribute('aria-valuenow')).toBe('30');
    expect(el.getAttribute('aria-label')).toBe('Terminal scrollback');
  });

  it('fires scrollto — event and callback — with the clamped row', async () => {
    rows(100, 10, 0);
    await el.updateComplete;
    const seen: number[] = [];
    let callbackRow = -1;
    el.addEventListener('sem-scrollto', (e) => seen.push((e as CustomEvent).detail.row));
    el.onscrollto = (row) => {
      callbackRow = row;
    };
    // Drive through the public path: a keydown.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(seen).toEqual([10]);
    expect(callbackRow).toBe(10);
    expect(el.offset).toBe(0); // output-only: the screen feeds the offset back
  });

  it('is silent when the requested row equals the current offset', async () => {
    rows(100, 10, 10);
    await el.updateComplete;
    let calls = 0;
    el.onscrollto = () => {
      calls += 1;
    };
    // PageUp from offset 10 → row 0; again → already at 0 → silent.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    el.offset = 0; // the screen feeds back
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    expect(calls).toBe(1);
  });

  it('pages with PgUp/PgDn/Home/End while focused; other keys pass through', async () => {
    rows(100, 10, 50);
    await el.updateComplete;
    const keys: Array<[string, number]> = [
      ['PageDown', 60],
      ['PageUp', 40],
      ['Home', 0],
      ['End', 90],
    ];
    for (const [key, row] of keys) {
      const seen: number[] = [];
      el.addEventListener('sem-scrollto', (e) => seen.push((e as CustomEvent).detail.row), {
        once: true,
      });
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(seen).toEqual([row]);
    }
    // An unrelated key is neither prevented nor consumed.
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    el.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('never touches keys when unfocused', async () => {
    rows(100, 10, 50);
    await el.updateComplete;
    let calls = 0;
    el.onscrollto = () => {
      calls += 1;
    };
    // Dispatch on a PARENT — as if the key path never entered the scrollbar.
    const ev = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(calls).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('wheel is pure passthrough — nothing is consumed', async () => {
    rows(100, 10, 0);
    await el.updateComplete;
    let calls = 0;
    el.onscrollto = () => {
      calls += 1;
    };
    const ev = new Event('wheel', { bubbles: true, cancelable: true });
    track().dispatchEvent(ev);
    expect(calls).toBe(0);
  });

  it('drags the thumb and stops at pointerup', async () => {
    rows(100, 10, 0);
    await fakeTrackBox(200);
    const seen: number[] = [];
    el.addEventListener('sem-scrollto', (e) => seen.push((e as CustomEvent).detail.row));
    // Grab the thumb at its top (thumb top is 0 at offset 0). Track 200,
    // thumb clamped to 24 → travel 176.
    fire('pointerdown', thumb(), { clientY: 0 });
    fire('pointermove', track(), { clientY: 88 }); // (88/176)*90 → row 45
    fire('pointermove', track(), { clientY: 176 }); // (176/176)*90 → row 90
    expect(seen).toEqual([45, 90]);
    fire('pointerup', track(), { clientY: 176 });
    fire('pointermove', track(), { clientY: 88 });
    expect(seen).toEqual([45, 90]); // released — motion no longer drags
  });

  it('pages on a track click below the thumb', async () => {
    rows(100, 10, 0);
    await fakeTrackBox(200);
    const seen: number[] = [];
    el.addEventListener('sem-scrollto', (e) => seen.push((e as CustomEvent).detail.row));
    fire('pointerdown', track(), { clientY: 160 });
    expect(seen).toEqual([10]);
  });

  it('styles without transitions — reduced motion by construction', () => {
    // `styles` stays the authored CSSResult — read its text.
    const cssText = (SemScroll.styles as unknown as { cssText: string }).cssText;
    expect(cssText).not.toMatch(/transition/);
    expect(cssText).not.toMatch(/animation/);
    // Colors come from theme tokens, not hard-coded paints.
    expect(cssText).toMatch(/--sem-shell-scroll-thumb/);
  });
});
