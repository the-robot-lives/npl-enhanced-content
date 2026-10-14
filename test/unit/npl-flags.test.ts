// @vitest-environment happy-dom
// Unit spec — the `npl-flags` container (src/lit/npl/npl-flags.ts)
//
// Feature: a runtime flag configuration block — preset badge + flag children
//          (BDD source: spec/schema/npl/npl-flags.md)
//   Scenario: the barrel registers both tags and the container upgrades light DOM
//   Scenario: the preset renders as a preset:<name> badge
//   Scenario: the preset:<name> source spelling is accepted and normalized
//   Scenario: an unknown preset gets the warning class, not a throw
//   Scenario: npl-flag children and note text survive in light DOM
//   Scenario: no preset authored — no badge
//   Scenario: the generated badge leads the authored children (chrome order)
//   Scenario: a note-only body keeps the badge ahead of the note text
//
//happy-dom never completes a Lit re-render cycle for these light-DOM
//elements (attribute/property mutations post-upgrade patch nothing), so
//each preset scenario authors a FRESH element at parse time — the real
//authoring path — instead of mutating a live one.

import { describe, it, expect, beforeEach } from 'vitest';
import { NplFlag } from '../../src/lit/npl/npl-flag.js';
import { NplFlags } from '../../src/lit/npl/npl-flags.js';

describe('npl-flags', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<npl-flags id="fs" preset="production">' +
      '<npl-flag name="calm_factor" value="0.5"></npl-flag>tuning notes</npl-flags>';
  });

  const author = (html: string): NplFlags => {
    document.body.innerHTML = html;
    return document.body.querySelector('npl-flags') as NplFlags;
  };
  const container = (): NplFlags => document.getElementById('fs') as NplFlags;

  it('the barrel registers both tags; the container upgrades with light DOM', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-flags')).toBe(NplFlags);
    expect(customElements.get('npl-flag')).toBe(NplFlag);
    const el = container();
    await el.updateComplete;
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
  });

  it('renders the preset as a preset:<name> badge', async () => {
    const el = container();
    await el.updateComplete;
    const badge = el.querySelector('.npl-flags-preset');
    expect(badge?.textContent).toBe('preset:production');
    expect(badge?.classList.contains('npl-flags-preset-invalid')).toBe(false);
    expect(el.getAttribute('data-preset')).toBe('production');
  });

  it('accepts the preset:<name> source spelling and normalizes it', async () => {
    const el = author('<npl-flags preset="preset:minimal"></npl-flags>');
    await el.updateComplete;
    expect(el.querySelector('.npl-flags-preset')?.textContent).toBe('preset:minimal');
    expect(el.getAttribute('data-preset')).toBe('minimal');
  });

  it('an unknown preset gets the warning class, not a throw', async () => {
    const el = author('<npl-flags preset="turbo"></npl-flags>');
    await el.updateComplete;
    const badge = el.querySelector('.npl-flags-preset');
    expect(badge?.textContent).toBe('preset:turbo');
    expect(badge?.classList.contains('npl-flags-preset-invalid')).toBe(true);
  });

  it('hosts npl-flag children and note text in light DOM', async () => {
    const el = container();
    await el.updateComplete;
    const flag = el.querySelector('npl-flag');
    expect(flag).toBeInstanceOf(NplFlag);
    expect(el.textContent).toContain('tuning notes');
  });

  it('the generated badge leads the authored children (chrome order)', async () => {
    const el = container();
    await el.updateComplete;
    const badge = el.querySelector(':scope > .npl-flags-preset');
    expect(badge).not.toBeNull();
    expect(el.firstChild).toBe(badge);
    expect((badge as Element).nextSibling).toBeInstanceOf(NplFlag);
  });

  it('a note-only body keeps the badge ahead of the note text', async () => {
    const el = author('<npl-flags preset="full">verbose</npl-flags>');
    await el.updateComplete;
    expect(el.firstChild).toBe(el.querySelector('.npl-flags-preset'));
  });

  it('no preset authored — no badge', async () => {
    const el = author('<npl-flags><npl-flag name="pump_switch" value="on"></npl-flag></npl-flags>');
    await el.updateComplete;
    expect(el.querySelector('.npl-flags-preset')).toBeNull();
  });
});
