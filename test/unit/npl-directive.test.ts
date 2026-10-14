// @vitest-environment happy-dom
// Unit spec — npl-directive (src/lit/npl/npl-directive.ts)
// BDD source of truth: spec/schema/npl/npl-directive.md
//
//   Scenario: the barrel registers npl-directive
//   Scenario: upgrades with light DOM — no shadow root, authored instruction survives
//   Scenario: the default kind is directive: glyph chip, no arrow, mirrored data-kind
//   Scenario: kind="directive" authored explicitly renders like the default
//   Scenario: kind="prefix" renders the ➤ arrow and mirrors data-kind
//   Scenario: a | separator in the children becomes the title tooltip, text intact
//   Scenario: the qualifier renders beside the instruction, missing stays unrendered
//   Scenario: without a glyph the authored instruction still renders
//   Scenario: a class-form authored data-* form is read, never overwritten
//   Scenario: re-update keeps exactly one body wrapper and one glyph

import { describe, it, expect } from 'vitest';
import { NplDirective } from '../../src/lit/npl/npl-directive.js';

async function mount(markup: string): Promise<NplDirective> {
  document.body.innerHTML = markup;
  const el = document.querySelector('npl-directive') as NplDirective;
  await el.updateComplete;
  return el;
}

describe('npl-directive', () => {
  it('the barrel registers npl-directive', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-directive')).toBe(NplDirective);
    expect(typeof npl.NplDirective).toBe('function');
  });

  it('upgrades with light DOM — no shadow root, authored instruction survives', async () => {
    const el = await mount(
      '<npl-directive glyph="🔮">be terse <em>now</em></npl-directive>',
    );
    expect(el).toBeInstanceOf(NplDirective);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    const body = el.querySelector('.npl-directive-body');
    expect(body?.querySelector('em')?.textContent).toBe('now');
    expect(body?.textContent).toContain('be terse');
  });

  it('the default kind is directive: glyph chip without an arrow, mirrored data-kind', async () => {
    const el = await mount('<npl-directive glyph="🔮">be terse</npl-directive>');
    const glyph = el.querySelector('.npl-directive-glyph');
    expect(glyph?.textContent).toBe('🔮');
    expect(el.firstElementChild?.classList.contains('npl-directive-glyph')).toBe(true);
    expect(el.getAttribute('data-kind')).toBe('directive');
    expect(el.getAttribute('data-glyph')).toBe('🔮');
  });

  it('kind="directive" authored explicitly renders like the default', async () => {
    const el = await mount(
      '<npl-directive glyph="🔮" kind="directive">be terse</npl-directive>',
    );
    expect(el.querySelector('.npl-directive-glyph')?.textContent).toBe('🔮');
    expect(el.getAttribute('data-kind')).toBe('directive');
  });

  it('kind="prefix" renders the ➤ arrow and mirrors data-kind', async () => {
    const el = await mount(
      '<npl-directive glyph="⚡" kind="prefix">cite sources</npl-directive>',
    );
    expect(el.querySelector('.npl-directive-glyph')?.textContent).toBe('⚡➤');
    expect(el.getAttribute('data-kind')).toBe('prefix');
    expect(el.hasAttribute('data-glyph')).toBe(true);
  });

  it('a | separator in the children becomes the title tooltip, text intact', async () => {
    const el = await mount(
      '<npl-directive glyph="🔮">be terse | because the reader is skimming</npl-directive>',
    );
    expect(el.title).toBe('because the reader is skimming');
    expect(el.querySelector('.npl-directive-body')?.textContent).toContain(
      'be terse | because the reader is skimming',
    );
  });

  it('the qualifier renders beside the instruction; missing stays unrendered', async () => {
    const withQ = await mount(
      '<npl-directive glyph="🔮" qualifier="style">be terse</npl-directive>',
    );
    expect(withQ.querySelector('.npl-directive-qualifier')?.textContent).toBe('style');
    expect(withQ.getAttribute('data-qualifier')).toBe('style');
    const withoutQ = await mount(
      '<npl-directive glyph="🔮">be terse</npl-directive>',
    );
    expect(withoutQ.querySelector('.npl-directive-qualifier')).toBeNull();
    expect(withoutQ.hasAttribute('data-qualifier')).toBe(false);
  });

  it('without a glyph the authored instruction still renders', async () => {
    const el = await mount('<npl-directive>just prose</npl-directive>');
    expect(el.querySelector('.npl-directive-glyph')).toBeNull();
    expect(el.querySelector('.npl-directive-body')?.textContent).toBe('just prose');
    expect(el.hasAttribute('data-glyph')).toBe(false);
  });

  it('a class-form authored data-* form is read and never overwritten by the mirror', async () => {
    const el = await mount(
      '<npl-directive class="npl-directive" data-glyph="🌟" data-kind="prefix">cite sources</npl-directive>',
    );
    expect(el.getAttribute('data-glyph')).toBe('🌟');
    expect(el.getAttribute('data-kind')).toBe('prefix');
    expect(el.querySelector('.npl-directive-glyph')?.textContent).toBe('🌟➤');
  });

  it('re-update keeps exactly one body wrapper and one glyph', async () => {
    const el = await mount('<npl-directive glyph="🔮">be terse</npl-directive>');
    el.setAttribute('glyph', '⚡');
    el.requestUpdate();
    await el.updateComplete;
    expect(el.querySelectorAll('.npl-directive-body')).toHaveLength(1);
    expect(el.querySelectorAll('.npl-directive-glyph')).toHaveLength(1);
    expect(el.querySelector('.npl-directive-glyph')?.textContent).toBe('⚡');
    expect(el.getAttribute('data-glyph')).toBe('⚡');
  });
});
