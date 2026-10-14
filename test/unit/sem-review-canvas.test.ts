// @vitest-environment happy-dom
// Unit spec — <sem-review-canvas>, the agent-kit reviews upsell stub
//
// Feature: pixel-anchored review comments on a fixture screenshot, zero network
//   Scenario: pins render from the fixture module and open their comment
//   Scenario: clicking empty stage drafts a pin; typing commits a comment
//   Scenario: the verdict control flips label + data-verdict through its states
//   Scenario: the authored zero-JS fallback shows screenshot, pins, comment list
//   Scenario: a comments JSON attribute overrides the fixture

import { describe, it, expect, beforeEach } from 'vitest';
import { SemReviewCanvas } from '../../src/lit/sem-review-canvas.js';
import '../../src/lit/sem-review-canvas.js';
import {
  REVIEW_COMMENTS,
  reviewFallbackHtml,
} from '../../src/lit/fixtures/agent-kit/reviews.js';

type Canvas = SemReviewCanvas & { updateComplete: Promise<boolean> };

const RECT = {
  left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

/** Mount a canvas and wait for its first Lit render. */
async function mount(attr = ''): Promise<Canvas> {
  const el = document.createElement('sem-review-canvas') as Canvas;
  if (attr) el.setAttribute('comments', attr);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Full-width/height stage so percent math is exact in happy-dom. */
function pinStage(el: Canvas): void {
  const stage = el.querySelector('.sem-review-stage')!;
  stage.getBoundingClientRect = () => RECT;
}

describe('sem-review-canvas (interactive tier)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the fixture pins as labelled buttons', async () => {
    const el = await mount();
    const pins = el.querySelectorAll<HTMLButtonElement>('button.sem-review-pin');
    expect(pins.length).toBe(REVIEW_COMMENTS.length);
    for (const pin of pins) {
      expect(pin.getAttribute('aria-label')).toMatch(/^Comment by /);
    }
    expect(el.querySelector('.sem-review-shot-img')).toBeTruthy();
  });

  it('opens a pin\'s comment and marks the pin expanded', async () => {
    const el = await mount();
    const pin = el.querySelector<HTMLButtonElement>('button[data-pin-id="c2"]')!;
    pin.click();
    await el.updateComplete;

    const pop = el.querySelector<HTMLElement>('.sem-review-pop[data-comment-id="c2"]')!;
    expect(pop).toBeTruthy();
    expect(pin.getAttribute('aria-expanded')).toBe('true');
    expect(pop.querySelector('.sem-review-pop-body')!.textContent).toContain(
      'artifact link back to /runs/412',
    );
  });

  it('second click on a pin closes its comment', async () => {
    const el = await mount();
    const pin = el.querySelector<HTMLButtonElement>('button[data-pin-id="c1"]')!;
    pin.click();
    await el.updateComplete;
    expect(el.querySelector('.sem-review-pop[data-comment-id="c1"]')).toBeTruthy();
    pin.click();
    await el.updateComplete;
    expect(el.querySelector('.sem-review-pop')).toBeNull();
  });

  it('adds a comment from a stage click + typed draft', async () => {
    const el = await mount();
    pinStage(el);
    const shot = el.querySelector('.sem-review-shot-img')!;
    shot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 200 }));
    await el.updateComplete;

    const draft = el.querySelector<HTMLInputElement>('.sem-review-draft-input')!;
    expect(draft).toBeTruthy();
    draft.value = 'Wrap the header text';
    el.querySelector<HTMLButtonElement>('.sem-review-draft-add')!.click();
    await el.updateComplete;

    const pin = el.querySelector<HTMLButtonElement>('button[data-pin-id="local-1"]')!;
    expect(pin.getAttribute('aria-label')).toContain('Wrap the header text');
    expect(pin.style.getPropertyValue('--sem-review-x')).toBe('50%');
    expect(pin.style.getPropertyValue('--sem-review-y')).toBe('50%');
    expect(el.querySelector('.sem-review-pop[data-comment-id="local-1"]')).toBeTruthy();
  });

  it('flips the verdict label through approve / request changes / comment', async () => {
    const el = await mount();
    const label = el.querySelector('.sem-review-verdict-label')!;
    expect(label.textContent).toContain('Pending review');
    expect(el.getAttribute('data-verdict')).toBe('pending');

    const fire = (value: string): void => {
      const radio = el.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
      expect(radio.type).toBe('radio');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const events: Array<{ verdict: string }> = [];
    el.addEventListener('sem-review-complete', (e) => {
      events.push((e as CustomEvent).detail);
    });

    fire('approve');
    await el.updateComplete;
    expect(label.textContent).toContain('Approved');
    expect(el.getAttribute('data-verdict')).toBe('approve');
    expect(events.at(-1)?.verdict).toBe('approve');

    fire('changes');
    await el.updateComplete;
    expect(label.textContent).toContain('Changes requested');
    expect(el.getAttribute('data-verdict')).toBe('changes');

    fire('comment');
    await el.updateComplete;
    expect(label.textContent).toContain('Commented');
    expect(el.getAttribute('data-verdict')).toBe('comment');
    expect(events.length).toBe(3);
  });

  it('a comments JSON attribute overrides the fixture', async () => {
    const el = await mount(
      '[{"id":"x9","x":10,"y":20,"author":"Ann","body":"Only one","resolved":false}]',
    );
    const pins = el.querySelectorAll('button.sem-review-pin');
    expect(pins.length).toBe(1);
    expect(pins[0].getAttribute('data-pin-id')).toBe('x9');
  });
});

describe('sem-review-canvas zero-JS tier', () => {
  it('fallback markup shows screenshot, inert pins, and the comment list', () => {
    const host = document.createElement('div');
    host.innerHTML = `<sem-review-canvas>${reviewFallbackHtml()}</sem-review-canvas>`;
    const fallback = host.querySelector('.sem-review-fallback')!;
    expect(fallback.querySelector('.sem-review-shot-img')).toBeTruthy();
    // pins exist as inert markers with anchors, not buttons — no JS to drive
    expect(fallback.querySelector('button')).toBeNull();
    expect(fallback.querySelectorAll('.sem-review-pin').length).toBe(REVIEW_COMMENTS.length);
    const listed = Array.from(fallback.querySelectorAll('.sem-review-comment-body')).map(
      (n) => n.textContent,
    );
    for (const c of REVIEW_COMMENTS) {
      expect(listed.some((t) => t!.includes(c.body))).toBe(true);
    }
    expect(fallback.querySelectorAll('.sem-review-comment-resolved').length).toBe(
      REVIEW_COMMENTS.filter((c) => c.resolved).length,
    );
  });

  it('upgrading replaces the authored fallback with the interactive canvas', async () => {
    const el = document.createElement('sem-review-canvas') as Canvas;
    el.innerHTML = reviewFallbackHtml();
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.querySelector('.sem-review-fallback')).toBeNull();
    expect(el.querySelectorAll('button.sem-review-pin').length).toBe(REVIEW_COMMENTS.length);
  });
});
