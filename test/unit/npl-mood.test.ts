// @vitest-environment happy-dom
// Unit spec — npl-mood (src/lit/npl/npl-mood.ts)
//
// Feature: the affective-state chip (schema: spec/schema/npl/npl-mood.md)
//   Scenario: importing the barrel registers npl-mood
//   Scenario: mood renders as a chip — emoji plus optional qualifier
//   Scenario: a lone emoji renders no qualifier chrome
//   Scenario: the self-closing form (no children) renders chip only, no panel
//   Scenario: authored tone/context/approach children group into a detail panel
//   Scenario: the chip renders in light DOM and mood mirrors to data-mood

import { describe, it, expect, beforeEach } from 'vitest';
import { NplMood } from '../../src/lit/npl/npl-mood.js';

const chipText = (el: Element): string =>
  (el.querySelector('.npl-mood-chip')?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('npl-mood', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the barrel registers npl-mood', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-mood')).toBe(NplMood);
  });

  it('renders the mood as a chip: emoji plus optional qualifier', async () => {
    document.body.innerHTML = '<npl-mood id="m" mood="🙂 wistful"></npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('.npl-mood-emoji')?.textContent).toBe('🙂');
    expect(el.querySelector('.npl-mood-qualifier')?.textContent).toBe('wistful');
    expect(chipText(el)).toBe('🙂 wistful');
  });

  it('a lone emoji renders no qualifier chrome', async () => {
    document.body.innerHTML = '<npl-mood id="m" mood="🙂"></npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    expect(el.querySelector('.npl-mood-qualifier')).toBeNull();
    expect(chipText(el)).toBe('🙂');
  });

  it('the self-closing form is valid: chip only, no detail panel', async () => {
    // Built via createElement — HTML parsing cannot express self-closing
    // tags; the XHTML source form lands as exactly this: element, mood,
    // no children.
    const el = document.createElement('npl-mood') as NplMood;
    el.setAttribute('mood', '🔥 sharp');
    document.body.appendChild(el);
    await el.updateComplete;
    expect(chipText(el)).toBe('🔥 sharp');
    expect(el.querySelector('.npl-mood-detail')).toBeNull();
  });

  it('groups authored tone, context and approach children into a detail panel', async () => {
    document.body.innerHTML =
      '<npl-mood id="m" mood="😐 flat">' +
      '<div class="npl-mood-tone">restrained</div>' +
      '<div class="npl-mood-context">draft reply</div>' +
      '<div class="npl-mood-approach">ask one question</div>' +
      '</npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    const panel = el.querySelector('.npl-mood-detail');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.npl-mood-tone')?.textContent).toBe('restrained');
    expect(panel?.querySelector('.npl-mood-context')?.textContent).toBe('draft reply');
    expect(panel?.querySelector('.npl-mood-approach')?.textContent).toBe('ask one question');
    // light DOM throughout: content moved, never hidden or dropped
    expect(el.querySelector('.npl-mood-tone')).not.toBeNull();
    expect(el.shadowRoot).toBeNull();
  });

  it('mirrors mood to data-mood (dual-form contract)', async () => {
    document.body.innerHTML = '<npl-mood id="m" mood="😄 bright"></npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    expect(el.getAttribute('data-mood')).toBe('😄 bright');
  });

  it('preserves an authored data-mood (class-form) through the mirror', async () => {
    document.body.innerHTML = '<npl-mood id="m" data-mood="🙂 wistful"></npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    expect(chipText(el)).toBe('🙂 wistful');
    expect(el.getAttribute('data-mood')).toBe('🙂 wistful');
  });

  it('renders the chip before the generated detail panel', async () => {
    document.body.innerHTML =
      '<npl-mood id="m" mood="😐 flat">' +
      '<div class="npl-mood-tone">restrained</div>' +
      '</npl-mood>';
    const el = document.getElementById('m') as NplMood;
    await el.updateComplete;
    expect(el.firstElementChild?.classList.contains('npl-mood-chip')).toBe(true);
    expect(el.lastElementChild?.classList.contains('npl-mood-detail')).toBe(true);
  });
});
