// @vitest-environment happy-dom
// Unit spec — npl-mindread (src/lit/npl/npl-mindread.ts)
//
// Feature: theory-of-mind reading of an NPL mindread block, display-only
//          (schema: spec/schema/npl/npl-mindread.md; recipe: src/lit/npl/index.ts)
//   Scenario: the barrel registers npl-mindread and exposes the class
//   Scenario: sections render with headings in canonical order (subject, signals, inferred, adaptation)
//   Scenario: an authored signal type renders a chip; an unknown type is marked, not dropped
//   Scenario: inferred fields get labels; the confidence meter appears with the parameter
//   Scenario: confidence is clamped into [0,1] and the host is marked with the authored value
//   Scenario: upgrades with light DOM — no shadow root, authored content survives

import { describe, it, expect, beforeEach } from 'vitest';
import { NplMindread } from '../../src/lit/npl/npl-mindread.js';

const FULL =
  '<npl-mindread id="mr" confidence="0.7">' +
  '<subject>User</subject>' +
  '<signals><signal type="tone">Terse fragments.</signal></signals>' +
  '<inferred>' +
  '<motive>Quick resolution.</motive>' +
  '<mood>😤 Pressured</mood>' +
  '<cognitive>Execution mode.</cognitive>' +
  '<unspoken>Reassurance.</unspoken>' +
  '</inferred>' +
  '<adaptation>Short replies.</adaptation>' +
  '</npl-mindread>';

describe('npl-mindread', () => {
  beforeEach(() => {
    document.body.innerHTML = FULL;
  });

  it('the barrel registers npl-mindread', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-mindread')).toBe(NplMindread);
    expect(typeof npl.NplMindread).toBe('function');
  });

  it('renders labelled sections in canonical order', async () => {
    const el = document.getElementById('mr') as NplMindread;
    await el.updateComplete;
    const headings = Array.from(el.querySelectorAll(':scope > .npl-mindread-heading, :scope > * > .npl-mindread-heading'));
    // every authored section carries a heading naming it
    expect(headings.map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Subject', 'Signals', 'Inferred', 'Adaptation']),
    );
    // direct section order: subject, signals, inferred, adaptation (after the meter)
    const sections = Array.from(el.children)
      .filter((c) => ['subject', 'signals', 'inferred', 'adaptation'].includes(c.tagName.toLowerCase()))
      .map((c) => c.tagName.toLowerCase());
    expect(sections).toEqual(['subject', 'signals', 'inferred', 'adaptation']);
  });

  it('an authored signal type renders a chip; an unknown type is marked, not dropped', async () => {
    document.body.innerHTML =
      '<npl-mindread id="s"><signals>' +
      '<signal type="tone">known</signal><signal type="telepathy">guess</signal>' +
      '</signals></npl-mindread>';
    const el = document.getElementById('s') as NplMindread;
    await el.updateComplete;
    const chips = Array.from(el.querySelectorAll('.npl-mindread-signal-type'));
    expect(chips.map((c) => c.textContent)).toContain('tone');
    const unknown = chips.find((c) => c.textContent === 'telepathy');
    expect(unknown).toBeDefined();
    expect(unknown!.classList.contains('npl-mindread-signal-unknown')).toBe(true);
    expect(unknown!.closest('signal')!.hasAttribute('data-unknown-signal-type')).toBe(true);
  });

  it('inferred fields get labels and the meter appears with confidence', async () => {
    const el = document.getElementById('mr') as NplMindread;
    await el.updateComplete;
    const labels = Array.from(el.querySelectorAll('.npl-mindread-field-label')).map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Motive', 'Mood', 'Cognitive', 'Unspoken']));
    const meter = el.querySelector('.npl-mindread-confidence-value');
    expect(meter?.textContent).toBe('70%');
  });

  it('clamps confidence out of range and marks the host with the authored value', async () => {
    document.body.innerHTML = '<npl-mindread id="c" confidence="1.7"><subject>U</subject></npl-mindread>';
    const el = document.getElementById('c') as NplMindread;
    await el.updateComplete;
    expect(el.getAttribute('data-confidence')).toBe('1');
    expect(el.getAttribute('data-confidence-out-of-range')).toBe('1.7');
    expect(el.querySelector('.npl-mindread-confidence-out')).not.toBeNull();

    // in-range: mirrored, no out-of-range mark
    document.body.innerHTML = '<npl-mindread id="c2" confidence="0.25"><subject>U</subject></npl-mindread>';
    const ok = document.getElementById('c2') as NplMindread;
    await ok.updateComplete;
    expect(ok.getAttribute('data-confidence')).toBe('0.25');
    expect(ok.hasAttribute('data-confidence-out-of-range')).toBe(false);
  });

  it('upgrades with light DOM — no shadow root, authored content survives', async () => {
    const el = document.getElementById('mr') as NplMindread;
    await el.updateComplete;
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    // the heading is the section's own generated first child; authored text survives after it
    const subject = el.querySelector('subject');
    expect(subject?.firstElementChild?.classList.contains('npl-mindread-heading')).toBe(true);
    expect(subject?.textContent).toContain('User');
    expect(el.querySelector('adaptation')?.textContent).toContain('Short replies.');
  });
});
