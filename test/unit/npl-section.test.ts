// @vitest-environment happy-dom
// Unit spec — npl-section, the generic typed NPL section
//
// Feature: typed sections render labelled chrome over untouched content
//          (recipe: src/lit/npl/index.ts header; spec: spec/schema/npl/npl-section.md)
//   Scenario: a known type renders its labelled header, derived class and data-type mirror
//   Scenario: every known type maps to its label
//   Scenario: type=note renders a plain section without sem-note behaviour
//   Scenario: an unknown type renders the warning class, content plain, and warns once
//   Scenario: a missing type renders the warning class with no mirror
//   Scenario: the class-form alias resolves, data-type wins when both spellings are authored

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NplSection } from '../../src/lit/npl/npl-section.js';

/** Fresh element per scenario — authored spellings must not meet a stale mirror. */
function section(attrs: Record<string, string> = {}, body = '<p>body <em>content</em></p>'): NplSection {
  const el = document.createElement('npl-section') as NplSection;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.innerHTML = body;
  document.body.appendChild(el);
  return el;
}

describe('npl-section', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a known type renders its labelled header, derived class and data-type mirror', async () => {
    const el = section({ type: 'example' });
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplSection);
    expect(el.shadowRoot).toBeNull();
    expect(el.classList.contains('npl-section-example')).toBe(true);
    expect(el.getAttribute('data-type')).toBe('example');
    const header = el.querySelector(':scope > .npl-section-header');
    expect(header?.textContent).toBe('Example');
    expect(header).toBe(el.firstElementChild);
    // authored content survives untouched beneath the header
    expect(el.querySelector('em')?.textContent).toBe('content');
  });

  it('every known type maps to its label', async () => {
    const cases: [string, string][] = [
      ['alg', 'Algorithm'],
      ['alg-pseudo', 'Pseudocode'],
      ['diagram', 'Diagram'],
      ['example', 'Example'],
      ['format', 'Format'],
      ['logic', 'Logic'],
      ['note', 'Note'],
      ['syntax', 'Syntax'],
      ['template', 'Template'],
    ];
    for (const [type, label] of cases) {
      const el = section({ type });
      await el.updateComplete;
      expect(el.querySelector(':scope > .npl-section-header')?.textContent, type).toBe(label);
      expect(el.classList.contains(`npl-section-${type}`), type).toBe(true);
      el.remove();
    }
  });

  it('type=note renders a plain section without sem-note behaviour', async () => {
    const el = section({ type: 'note' });
    await el.updateComplete;
    expect(el.classList.contains('npl-section-note')).toBe(true);
    const header = el.querySelector(':scope > .npl-section-header');
    expect(header?.textContent).toBe('Note');
    expect(header).toBe(el.firstElementChild);
    // sem-note behaviour stays with sem-note: no collapse chrome, no
    // role="note", no variant mirror, no body wrapper
    expect(el.querySelector('.sem-note-summary, .sem-note-body')).toBeNull();
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('data-variant')).toBe(false);
    expect(el.querySelector('em')?.textContent).toBe('content');
  });

  it('an unknown type renders the warning class, content plain, and warns once', async () => {
    const el = section({ type: 'mnemonic' });
    await el.updateComplete;
    expect(el.classList.contains('npl-section-warning')).toBe(true);
    expect(el.classList.contains('npl-section-example')).toBe(false);
    expect(el.querySelector(':scope > .npl-section-header')).toBeNull();
    expect(el.getAttribute('data-type')).toBe('mnemonic');
    // content reads as plain text — untouched, nothing generated
    expect(el.querySelector('em')?.textContent).toBe('content');
    expect(warn.mock.calls.some((call) => String(call[0]).includes('mnemonic'))).toBe(true);
    // one author-facing warning per offending value, not per update
    el.requestUpdate();
    await el.updateComplete;
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('mnemonic'))).toHaveLength(1);
  });

  it('a missing type renders the warning class with no mirror', async () => {
    const el = section();
    await el.updateComplete;
    expect(el.classList.contains('npl-section-warning')).toBe(true);
    expect(el.querySelector(':scope > .npl-section-header')).toBeNull();
    // an empty resolution removes the mirror instead of writing ""
    expect(el.hasAttribute('data-type')).toBe(false);
    expect(el.querySelector('em')?.textContent).toBe('content');
  });

  it('the class-form alias resolves; data-type wins when both spellings are authored', async () => {
    const el = section({ class: 'npl-section', 'data-type': 'syntax' });
    await el.updateComplete;
    expect(el.classList.contains('npl-section-syntax')).toBe(true);
    expect(el.querySelector(':scope > .npl-section-header')?.textContent).toBe('Syntax');

    const both = section({ type: 'template', 'data-type': 'alg' });
    await both.updateComplete;
    expect(both.querySelector(':scope > .npl-section-header')?.textContent).toBe('Algorithm');
    expect(both.classList.contains('npl-section-alg')).toBe(true);
  });
});
