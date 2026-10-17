// @vitest-environment happy-dom
// Unit spec — src/lit/sem-question.ts (shipped 0.9.1, SEMTEX-009)
//
// Feature: the quiz block renders and picks until correct
//   Scenario: options become buttons in seeded shuffled order, one correct
//   Scenario: a wrong pick marks and disables THAT option; the question stays open
//   Scenario: the correct pick lands and locks the question
//   Scenario: retry reshuffles and resets
//   Scenario: authored options hide once upgraded (marker-gated), readable without script
//   Scenario: sem-option registers as a claim stub

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SemQuestion, SemOption } from '../../src/lit/sem-question.js';
import { mulberry32, shuffle } from '../../src/shared/rng.js';

async function mount(): Promise<SemQuestion> {
  const el = document.createElement('sem-question');
  el.setAttribute('type', 'mc');
  el.setAttribute('data-sem-seed', '7');
  el.innerHTML = `
    <p data-kind="prompt">Which header carries the OIDC token?</p>
    <sem-option>Cookie</sem-option>
    <sem-option correct>Authorization</sem-option>
    <sem-option>Referer</sem-option>`;
  document.body.appendChild(el);
  if (!(el instanceof SemQuestion)) customElements.upgrade(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

describe('sem-question', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('registers both tags', () => {
    expect(customElements.get('sem-question')).toBe(SemQuestion);
    expect(customElements.get('sem-option')).toBe(SemOption);
  });

  it('generates thin-bordered option buttons in seeded shuffled order, one correct', async () => {
    const el = await mount();
    const row = el.querySelector('.sem-question-options') as HTMLElement;
    const buttons = Array.from(row.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.classList.contains('sem-question-option'))).toBe(true);
    // same draw the component makes: one shuffle over the three options
    const order = shuffle([0, 1, 2], mulberry32(7));
    expect(buttons.map((b) => b.textContent)).toEqual(
      order.map((k) => ['Cookie', 'Authorization', 'Referer'][k].trim()),
    );
    const correct = buttons.filter((b) => b.getAttribute('data-correct') === 'true');
    expect(correct).toHaveLength(1);
    expect(correct[0].textContent).toBe('Authorization');
  });

  it('a wrong pick marks and spends THAT option; the question stays open', async () => {
    const el = await mount();
    const wrong = el.querySelector(
      '.sem-question-options button:not([data-correct="true"])',
    ) as HTMLButtonElement;
    wrong.click();
    expect(wrong.classList.contains('sem-wrong-pick')).toBe(true);
    expect(wrong.disabled).toBe(true);
    // the correct option is still live
    const correct = el.querySelector('.sem-question-options button[data-correct="true"]') as HTMLButtonElement;
    expect(correct.disabled).toBe(false);
    correct.click();
    expect(correct.classList.contains('sem-answered')).toBe(true);
    expect(el.querySelectorAll('.sem-question-options button:disabled')).toHaveLength(3);
  });

  it('retry resets and redraws (same seed, same order)', async () => {
    const AUTHORING = `
      <p data-kind="prompt">Which header carries the OIDC token?</p>
      <sem-option>Cookie</sem-option>
      <sem-option correct>Authorization</sem-option>
      <sem-option>Referer</sem-option>`;
    const el2 = document.createElement('sem-question');
    el2.setAttribute('retry', '');
    el2.setAttribute('data-sem-seed', '7');
    el2.innerHTML = AUTHORING;
    document.body.appendChild(el2);
    if (!(el2 instanceof SemQuestion)) customElements.upgrade(el2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el2.updateComplete;
    await el2.updateComplete;
    (el2.querySelector('.sem-question-options button[data-correct="true"]') as HTMLButtonElement).click();
    expect(el2.querySelectorAll('.sem-question-options button:disabled')).toHaveLength(3);
    const retry = el2.querySelector('.sem-question-retry') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.click();
    const buttons = Array.from(el2.querySelectorAll('.sem-question-options button')) as HTMLButtonElement[];
    expect(buttons.every((b) => !b.disabled && !b.classList.contains('sem-answered'))).toBe(true);
    expect(buttons).toHaveLength(3);
  });

  it('authored options hide once the component drives the question', async () => {
    const el = await mount();
    // the vocabulary rule is CSS; the marker + the generated row are the DOM contract
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('.sem-question-options')).toBeTruthy();
    // authored elements remain in the light DOM (extraction invariant)
    expect(el.querySelectorAll('sem-option')).toHaveLength(3);
  });
});
