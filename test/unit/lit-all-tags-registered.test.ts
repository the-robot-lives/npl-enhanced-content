// @vitest-environment happy-dom
// Unit spec — the round-2 registration contract: every vocabulary tag in
// elements.json answers customElements.get() once the core bundle is loaded.
//
// Feature: no CSS-only tags
//   Scenario: every sem tag in the schema index is a defined custom element
//   Scenario: every npl tag in the schema index is a defined custom element
//   Scenario: the stubs claim their marker at connect without touching children

import { describe, it, expect } from 'vitest';
// importing the bundles evaluates the modules, which registers every element
import '../../src/index.js';
import '../../src/npl.js';
import { loadSchema } from '../../src/editor/schema/load-schema.js';

const index = loadSchema();

const defined = (tag: string): boolean => Boolean(customElements.get(tag));

describe('every vocabulary tag has a component', () => {
  it('every sem tag in the schema index is a defined custom element', () => {
    const missing = index.tags
      .map((t) => t.name)
      .filter((name) => name.startsWith('sem-'))
      .filter((name) => !defined(name));
    // sem-browser landed after the committed index was generated; it is
    // registered with the core bundle all the same.
    expect(defined('sem-browser')).toBe(true);
    expect(missing).toEqual([]);
  });

  it('every npl tag in the schema index is a defined custom element', () => {
    const missing = index.tags
      .map((t) => t.name)
      .filter((name) => name.startsWith('npl-'))
      .filter((name) => !defined(name));
    expect(missing).toEqual([]);
  });

  it('a claim stub marks its element and leaves the children alone', () => {
    const el = document.createElement('sem-step');
    el.innerHTML = '<span>carry the bolt</span>';
    document.body.appendChild(el);
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('span')?.textContent).toBe('carry the bolt');
    expect(el.shadowRoot).toBeNull(); // light DOM, no behaviour
  });
});
