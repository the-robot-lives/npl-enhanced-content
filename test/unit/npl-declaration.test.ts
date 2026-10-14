// @vitest-environment happy-dom
// Unit spec — the `npl-declaration` component (src/lit/npl/npl-declaration.ts)
//
// Feature: the version/extension banner renders display-only over authored rules
//          (spec: spec/schema/npl/npl-declaration.md; recipe: src/lit/npl/index.ts header)
//   Scenario: importing the component registers npl-declaration
//   Scenario: a definition renders the ⌜NPL@<version>⌝ banner above the authored body
//   Scenario: an extension renders ⌜extend:NPL@<version>⌝ with its extend-target
//   Scenario: an unknown type falls back to definition
//   Scenario: parameters mirror to their data-* spellings (dual-form contract)
//   Scenario: upgrades with light DOM — no shadow root, authored children survive
//   Scenario: a missing version warns (it is required)

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NplDeclaration } from '../../src/lit/npl/npl-declaration.js';

describe('npl-declaration', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<npl-declaration id="decl" version="0.6">rules <em>content</em></npl-declaration>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the component registers npl-declaration', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-declaration')).toBe(NplDeclaration);
  });

  it('a definition renders the ⌜NPL@<version>⌝ banner above the authored body', async () => {
    const el = document.getElementById('decl') as NplDeclaration;
    await el.updateComplete;
    const banner = el.querySelector('.npl-declaration-banner');
    expect(banner).toBe(el.firstElementChild);
    expect(el.querySelector('.npl-declaration-mark')?.textContent).toBe('⌜NPL@0.6⌝');
    expect(el.querySelector('.npl-declaration-target')).toBeNull();
    expect(el.getAttribute('data-type')).toBe('definition');
  });

  it('an extension renders ⌜extend:NPL@<version>⌝ with its extend-target', async () => {
    document.body.innerHTML =
      '<npl-declaration id="ext" version="0.6" type="extension" extend-target="npl-core">rules</npl-declaration>';
    const el = document.getElementById('ext') as NplDeclaration;
    await el.updateComplete;
    expect(el.querySelector('.npl-declaration-mark')?.textContent).toBe('⌜extend:NPL@0.6⌝');
    expect(el.querySelector('.npl-declaration-target')?.textContent).toBe('npl-core');
    expect(el.getAttribute('data-type')).toBe('extension');
    expect(el.getAttribute('data-extend-target')).toBe('npl-core');
  });

  it('an unknown type falls back to definition', async () => {
    const el = document.getElementById('decl') as NplDeclaration;
    el.setAttribute('type', 'banana');
    await el.updateComplete;
    expect(el.kind).toBe('definition');
    expect(el.getAttribute('data-type')).toBe('definition');
    expect(el.querySelector('.npl-declaration-mark')?.textContent).toBe('⌜NPL@0.6⌝');
  });

  it('mirrors parameters to their data-* spellings (dual-form contract)', async () => {
    const el = document.getElementById('decl') as NplDeclaration;
    await el.updateComplete;
    expect(el.getAttribute('data-version')).toBe('0.6');
    // absent extend-target leaves no data-extend-target behind
    expect(el.hasAttribute('data-extend-target')).toBe(false);
    el.setAttribute('extend-target', 'noizu-labs/npl');
    await el.updateComplete;
    expect(el.getAttribute('data-extend-target')).toBe('noizu-labs/npl');
  });

  it('upgrades with light DOM — no shadow root, authored children survive', async () => {
    const el = document.getElementById('decl') as NplDeclaration;
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplDeclaration);
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector('em')?.textContent).toBe('content');
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
  });

  it('a missing version warns — it is required', async () => {
    document.body.innerHTML = '<npl-declaration id="bare">rules</npl-declaration>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.getElementById('bare') as NplDeclaration;
    await el.updateComplete;
    expect(warn).toHaveBeenCalledWith('semtext: npl-declaration: version is required (⌜NPL@<version>⌝)');
    // the banner still renders, bare
    expect(el.querySelector('.npl-declaration-mark')?.textContent).toBe('⌜NPL@⌝');
  });
});
