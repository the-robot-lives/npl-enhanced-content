// @vitest-environment happy-dom
// Unit spec — `npl-poa`, the NPL plan-of-action block (src/lit/npl/npl-poa.ts)
//
// Feature: a decision tree with weighted reasoning, display-only
//          (recipe: src/lit/npl/index.ts header; source: NPL poa blocks)
//   Scenario: the barrel registers npl-poa and it upgrades in light DOM
//   Scenario: direction defaults to lr and mirrors to data-direction
//   Scenario: an authored direction wins; an invalid one falls back to lr
//   Scenario: the mermaid fence degrades to a data-tagged code block, source intact
//   Scenario: the selected option is featured prominently as .npl-poa-choice
//   Scenario: a missing fence or selected option warns and degrades gracefully

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NplPoa } from '../../src/lit/npl/npl-poa.js';

const FENCE =
  'graph LR\n  A{Decision} -->|"90%"| B[Path B]\n  A -->|"40%"| C[Path C]';
const REASONING =
  'A --[90%]--> B: cheapest path\nA --[40%]--> C: fallback only';
const SELECTED = 'Path B — 90% weight';
// happy-dom's tokenizer mangles a raw `-->` in text content; the fixture
// authors the fence the XHTML way (escaped arrows), which parses to FENCE.
const FENCE_HTML = FENCE.replaceAll('-->', '--&gt;');

const poa = (attrs = ''): string =>
  `<npl-poa${attrs}>` +
  `<pre><code class="language-mermaid">${FENCE_HTML}</code></pre>` +
  `<reasoning>${REASONING}</reasoning>` +
  `<selected>${SELECTED}</selected>` +
  `</npl-poa>`;

// children-ready enhancement lands a microtask+timer after updateComplete
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('npl-poa', () => {
  beforeEach(() => {
    document.body.innerHTML = poa(' id="poa"');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the barrel registers npl-poa and it upgrades in light DOM', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-poa')).toBe(NplPoa);
    const el = document.getElementById('poa') as NplPoa;
    await el.updateComplete;
    await settle();
    expect(el).toBeInstanceOf(NplPoa);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    // authored children survive untouched (light DOM)
    expect(el.querySelector('reasoning')?.textContent).toContain('cheapest path');
    expect(el.querySelector('em')).toBeNull(); // no unexpected chrome beyond the contract
  });

  it('direction defaults to lr and mirrors to data-direction', async () => {
    const el = document.getElementById('poa') as NplPoa;
    await el.updateComplete;
    expect(el.direction).toBe('lr');
    expect(el.getAttribute('data-direction')).toBe('lr');
  });

  it('an authored direction wins; an invalid one falls back to lr', async () => {
    document.body.innerHTML = poa(' id="td" direction="td"') + poa(' id="bad" direction="diagonal"');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const td = document.getElementById('td') as NplPoa;
    const bad = document.getElementById('bad') as NplPoa;
    await Promise.all([td.updateComplete, bad.updateComplete]);
    await settle();
    expect(td.getAttribute('data-direction')).toBe('td');
    expect(bad.getAttribute('data-direction')).toBe('lr');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('direction must be "lr" or "td"'));
  });

  it('the mermaid fence degrades to a data-tagged code block, source intact', async () => {
    const el = document.getElementById('poa') as NplPoa;
    await el.updateComplete;
    await settle();
    const code = el.querySelector('pre > code.language-mermaid')!;
    const block = code.closest('pre')!;
    expect(block.hasAttribute('data-npl-poa-tree')).toBe(true);
    expect(block.getAttribute('data-direction')).toBe('lr');
    // the no-renderer contract: the source still READS as a code block
    expect(code.textContent).toBe(FENCE);
    // and nothing pulled in a runtime to render it
    expect(el.querySelectorAll('script').length).toBe(0);
    expect(document.querySelectorAll('script[src]').length).toBe(0);
  });

  it('the selected option is featured prominently as .npl-poa-choice', async () => {
    const el = document.getElementById('poa') as NplPoa;
    await el.updateComplete;
    await settle();
    const selected = el.querySelector('selected')!;
    expect(selected.hasAttribute('data-npl-poa-selected')).toBe(true);
    const choice = el.querySelector('.npl-poa-choice')!;
    expect(choice).not.toBeNull();
    expect(choice.previousElementSibling).toBe(selected);
    expect(choice.querySelector('.npl-poa-choice-label')?.textContent).toBe('selected');
    expect(choice.querySelector('.npl-poa-choice-text')?.textContent).toBe(SELECTED);
  });

  it('a missing fence or selected option warns and degrades gracefully', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML =
      '<npl-poa id="bare"><reasoning>weighed the options</reasoning></npl-poa>';
    const el = document.getElementById('bare') as NplPoa;
    await el.updateComplete;
    await settle();
    expect(el.querySelector('.npl-poa-choice')).toBeNull();
    expect(el.querySelector('[data-npl-poa-tree]')).toBeNull();
    expect(el.getAttribute('data-direction')).toBe('lr');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no mermaid fence'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no <selected>'));
    // the authored reasoning still survives
    expect(el.querySelector('reasoning')?.textContent).toContain('weighed');
  });
});
