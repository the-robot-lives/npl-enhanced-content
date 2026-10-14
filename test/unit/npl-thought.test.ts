// @vitest-environment happy-dom
// Unit spec — `npl-thought`, the typed associative thought bubble
//
// Feature: typed NPL thought blocks render as annotated light-DOM children
//          (recipe: src/lit/npl/index.ts header; BDD: spec/schema/npl/npl-thought.md)
//   Scenario: importing the barrel registers npl-thought
//   Scenario: the container upgrades with light DOM; authored children survive
//   Scenario: each of the eleven thought types applies its own class and mirrors data-type
//   Scenario: an unknown type degrades to plain text under the npl-thought-unknown warning class
//   Scenario: a child with no type is a sub-container — no class, children survive

import { describe, it, expect, beforeEach } from 'vitest';
import { NplThought, THOUGHT_TYPES } from '../../src/lit/npl/npl-thought.js';

const TYPES = [
  'observation',
  'tangent',
  'question',
  'relation',
  'concern',
  'affirmation',
  'reflection',
  'opportunity',
  'aversion',
  'interest',
  'eval',
] as const;

describe('npl-thought', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <npl-thought id="bubble">
        <npl-thought type="observation">misses cluster on Mondays</npl-thought>
        <npl-thought>plain sub-container</npl-thought>
        <npl-thought type="balloon"><b>unknown here</b></npl-thought>
      </npl-thought>`;
  });

  const byId = (id: string): NplThought => document.getElementById(id) as NplThought;

  it('the barrel registers npl-thought', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-thought')).toBe(NplThought);
  });

  it('upgrades with light DOM — no shadow root, authored children survive', async () => {
    const el = byId('bubble');
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplThought);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('npl-thought')?.textContent).toContain('misses cluster on Mondays');
  });

  it(`applies one class per type and mirrors data-type for all ${TYPES.length} types`, async () => {
    expect([...THOUGHT_TYPES]).toEqual([...TYPES]);
    for (const type of TYPES) {
      const host = document.createElement('npl-thought');
      host.innerHTML = `<npl-thought type="${type}">${type} text</npl-thought>`;
      document.body.appendChild(host);
      const child = host.firstElementChild as NplThought;
      await child.updateComplete;
      expect(child.classList.contains(`npl-thought-${type}`), type).toBe(true);
      expect(child.getAttribute('data-type')).toBe(type);
      expect(child.classList.contains('npl-thought-unknown'), type).toBe(false);
      expect(child.querySelector('*')).toBeNull();
      expect(child.textContent).toBe(`${type} text`);
    }
  });

  it('an unknown type renders as plain text under the warning class', async () => {
    const el = byId('bubble').querySelector('npl-thought[type="balloon"]') as NplThought;
    await el.updateComplete;
    expect(el.classList.contains('npl-thought-unknown')).toBe(true);
    expect(el.getAttribute('data-type')).toBe('balloon');
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('unknown here');
  });

  it('a child with no type is a sub-container — no class, children survive', async () => {
    // children in authoring order: observation (typed), plain, balloon (unknown)
    const el = byId('bubble').querySelectorAll('npl-thought')[1] as NplThought;
    await el.updateComplete;
    expect(el.classList.contains('npl-thought-unknown')).toBe(false);
    for (const type of TYPES) {
      expect(el.classList.contains(`npl-thought-${type}`)).toBe(false);
    }
    expect(el.hasAttribute('data-type')).toBe(false);
    expect(el.textContent).toBe('plain sub-container');
  });
});
