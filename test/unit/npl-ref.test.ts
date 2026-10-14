// @vitest-environment happy-dom
// Unit spec — npl-ref (src/lit/npl/npl-ref.ts)
//
// Feature: post-hoc reflection renders display-only from authored sections
//          (contract: spec/schema/npl/npl-ref.md)
//   Scenario: importing the barrel registers npl-ref
//   Scenario: upgrades light DOM — no shadow root, authored sections survive
//   Scenario: default variant renders labelled sections and mirrors data-variant="full"
//   Scenario: explicit full renders labelled sections
//   Scenario: compact renders an emoji list and hides the authored sections
//   Scenario: compact resolves the data-* parameter spelling
//   Scenario: unknown variant falls back to full
//   Scenario: alias-form sections (.npl-*) are labelled like tag-form ones

import { describe, it, expect, beforeEach } from 'vitest';
import { NplRef } from '../../src/lit/npl/npl-ref.js';

const FULL = [
  '<assessment>solid approach, one gap in the eval loop</assessment>',
  '<improvements>add a regression harness</improvements>',
  '<validation>checked against three traces</validation>',
  '<eval>quality 0.82 vs 0.71 baseline</eval>',
  '<fine-tune>retrain on the two rejected traces</fine-tune>',
].join('');

const settle = async (el: NplRef): Promise<void> => {
  await el.updateComplete;
  await el.updateComplete;
};

const seed = (html: string, id = 'r'): NplRef => {
  document.body.innerHTML = html;
  return document.getElementById(id) as NplRef;
};

const labelled = (el: NplRef, name: string): { section: Element; label: string } | null => {
  const section = el.querySelector(`[data-section="${name}"]`);
  if (!section) return null;
  return { section, label: section.querySelector('.npl-ref-label')?.textContent ?? '' };
};

describe('npl-ref', () => {
  beforeEach(() => {
    document.body.innerHTML = `<npl-ref id="r">${FULL}</npl-ref>`;
  });

  it('the barrel registers npl-ref', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-ref')).toBe(NplRef);
  });

  it('upgrades light DOM — no shadow root, authored sections survive', async () => {
    const el = document.getElementById('r') as NplRef;
    await settle(el);
    expect(el).toBeInstanceOf(NplRef);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    // authored text survives in place behind the generated label
    const improvements = el.querySelector('improvements')!;
    expect(improvements.lastChild?.textContent).toBe('add a regression harness');
  });

  it('default variant renders labelled sections and mirrors data-variant="full"', async () => {
    const el = document.getElementById('r') as NplRef;
    await settle(el);
    expect(el.getAttribute('data-variant')).toBe('full');
    expect(el.querySelectorAll('.npl-ref-section')).toHaveLength(5);
    expect(labelled(el, 'assessment')?.label).toBe('Assessment');
    expect(labelled(el, 'fine-tune')?.label).toBe('Fine-tune');
    // authored markup is labelled in place, never moved or dropped
    const assessment = el.querySelector('assessment')!;
    expect(assessment.classList.contains('npl-ref-section')).toBe(true);
    expect(assessment.getAttribute('data-section')).toBe('assessment');
    expect(assessment.firstChild?.textContent).toBe('Assessment');
    expect(assessment.textContent).toContain('solid approach, one gap in the eval loop');
  });

  it('explicit full renders labelled sections', async () => {
    const el = seed(`<npl-ref id="r" variant="full">${FULL}</npl-ref>`);
    await settle(el);
    expect(el.getAttribute('data-variant')).toBe('full');
    expect(el.querySelectorAll('.npl-ref-section')).toHaveLength(5);
    expect(el.querySelector('.npl-ref-lines')).toBeNull();
  });

  it('compact renders an emoji list and hides the authored sections', async () => {
    const el = seed(`<npl-ref id="r" variant="compact">${FULL}</npl-ref>`);
    await settle(el);
    expect(el.getAttribute('data-variant')).toBe('compact');
    const list = el.querySelector('ul.npl-ref-lines')!;
    expect(list.querySelectorAll('li.npl-ref-line')).toHaveLength(5);
    const lines = Array.from(list.querySelectorAll('li.npl-ref-line'));
    expect(lines[0].getAttribute('data-section')).toBe('assessment');
    expect(lines[0].textContent).toBe('🧭 Assessment — solid approach, one gap in the eval loop');
    expect(lines[1].textContent).toBe('✨ Improvements — add a regression harness');
    expect(lines[4].textContent).toBe('🎯 Fine-tune — retrain on the two rejected traces');
    // authored sections are hidden (JS-off keeps them visible)
    expect(el.querySelector('assessment')?.hasAttribute('hidden')).toBe(true);
    expect(el.querySelector('fine-tune')?.hasAttribute('hidden')).toBe(true);
  });

  it('compact resolves the data-* parameter spelling', async () => {
    const el = seed(`<npl-ref id="r" data-variant="compact">${FULL}</npl-ref>`);
    await settle(el);
    expect(el.getAttribute('data-variant')).toBe('compact');
    expect(el.querySelectorAll('.npl-ref-line')).toHaveLength(5);
  });

  it('unknown variant falls back to full', async () => {
    const el = seed(`<npl-ref id="r" variant="banana">${FULL}</npl-ref>`);
    await settle(el);
    expect(el.getAttribute('data-variant')).toBe('full');
    expect(el.querySelectorAll('.npl-ref-section')).toHaveLength(5);
    expect(el.querySelector('.npl-ref-lines')).toBeNull();
  });

  it('alias-form sections (.npl-*) are labelled like tag-form ones', async () => {
    const el = seed(
      '<npl-ref id="r">' +
        '<div class="npl-assessment">held up under review</div>' +
        '<div class="npl-eval">0.9 quality</div>' +
        '</npl-ref>',
    );
    await settle(el);
    const assessment = el.querySelector('.npl-assessment')!;
    expect(assessment.getAttribute('data-section')).toBe('assessment');
    expect(assessment.querySelector('.npl-ref-label')?.textContent).toBe('Assessment');
    expect(el.querySelectorAll('.npl-ref-section')).toHaveLength(2);
  });
});
