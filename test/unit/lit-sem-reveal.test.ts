// @vitest-environment happy-dom
// Unit spec — src/lit/sem-reveal.ts · the disclosure hides until acted on
//
// Feature: the sem-reveal upgrade hides the body behind a labelled
//          control; the reveal is one-way and leaves nothing hidden
//   Scenario: the body is wrapped and hidden by default (inert + aria-hidden, control aria-expanded=false)
//   Scenario: the label comes from data-summary, then summary, then the derived first line
//   Scenario: clicking the control reveals the body and retires the control (one-way)
//   Scenario: open starts revealed — no control, nothing hidden
//   Scenario: collapsed is a no-op — the reveal still starts hidden
//   Scenario: the vanilla handler skips an element the component claimed

import { describe, it, expect, beforeEach } from 'vitest';
import { SemReveal } from '../../src/lit/sem-reveal.js';
import { enhanceReveal } from '../../src/vanilla/reveal.js';
import { deriveSummary, normalize } from '../../src/shared/summary.js';

const LABEL = 'Why not localStorage?';

async function mount(html: string, attrs: Record<string, string> = {}): Promise<SemReveal> {
  const el = document.createElement('sem-reveal');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.innerHTML = html;
  document.body.appendChild(el);
  // happy-dom races its custom-element pipeline (see sem-facts.test.ts):
  // force the upgrade and let the macrotask deliver connectedCallback.
  if (!(el instanceof SemReveal)) customElements.upgrade(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('sem-reveal component', () => {
  it('hides the body by default behind a labelled control', async () => {
    const el = await mount(
      `<p>Tokens in localStorage are readable by any script.</p>`,
      { 'data-summary': LABEL },
    );

    const body = el.querySelector('.sem-reveal-body') as HTMLElement;
    const control = el.querySelector('button.sem-reveal-control') as HTMLButtonElement;
    expect(body).toBeTruthy();
    expect(control).toBeTruthy();
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-controls')).toBe(body.id);
    expect(body.getAttribute('inert')).not.toBeNull();
    expect(body.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('data-revealed')).toBe(false);
    expect(control.querySelector('.sem-reveal-label')?.textContent).toBe(LABEL);
    expect(control.querySelector('.sem-reveal-hint')?.textContent).toBe('Reveal');
  });

  it('derives the label from the first body line when no summary is authored', async () => {
    const body = 'Refresh tokens rotate per use — each exchange retires the presented token.';
    const el = await mount(body);
    // the shared rule extraction uses — at most 60 chars, word-boundary cut
    const expected = deriveSummary(normalize(body));
    expect(expected.startsWith('Refresh tokens rotate per use')).toBe(true);
    expect(el.querySelector('.sem-reveal-label')?.textContent).toBe(expected);
    expect(el.getAttribute('data-summary')).toBe(expected);
  });

  it('clicking the control reveals the body and retires the control', async () => {
    const el = await mount(
      `<p>Tokens in localStorage are readable by any script.</p>`,
      { 'data-summary': LABEL },
    );
    const control = el.querySelector('button.sem-reveal-control') as HTMLButtonElement;
    control.click();
    await el.updateComplete;

    const body = el.querySelector('.sem-reveal-body') as HTMLElement;
    expect(el.hasAttribute('data-revealed')).toBe(true);
    expect(body.hasAttribute('inert')).toBe(false);
    expect(body.hasAttribute('aria-hidden')).toBe(false);
    expect(body.textContent).toContain('readable by any script');
    // one-way: the control is gone, a heading carries the label
    expect(el.querySelector('button.sem-reveal-control')).toBeNull();
    expect(el.querySelector('.sem-reveal-head')?.textContent).toBe(LABEL);
  });

  it('open starts revealed — no control, nothing hidden', async () => {
    const el = await mount(`<p>Already public.</p>`, { open: '' });
    expect(el.hasAttribute('data-revealed')).toBe(true);
    expect(el.querySelector('button.sem-reveal-control')).toBeNull();
    const body = el.querySelector('.sem-reveal-body') as HTMLElement;
    expect(body?.hasAttribute('inert')).toBe(false);
    expect(el.querySelector('.sem-reveal-head')).toBeTruthy();
  });

  it('collapsed is a no-op — the reveal still starts hidden', async () => {
    const el = await mount(`<p>Hidden either way.</p>`, { collapsed: '' });
    expect(el.querySelector('button.sem-reveal-control')).toBeTruthy();
    expect(el.hasAttribute('data-revealed')).toBe(false);
  });
});

describe('sem-reveal vanilla handoff', () => {
  it('enhanceReveal skips an element the component claimed', async () => {
    const el = await mount(`<p>Component-wired.</p>`);
    expect(el.querySelectorAll('details').length).toBe(0);
    enhanceReveal(document.body);
    // the component owns the subtree — no native <details> was injected
    expect(el.querySelectorAll('details').length).toBe(0);
    expect(el.querySelector('.sem-reveal-body')).toBeTruthy();
  });

  it('enhanceReveal still wires an unclaimed class-form element, closed by default', () => {
    const div = document.createElement('div');
    div.className = 'sem-reveal';
    div.setAttribute('data-summary', LABEL);
    div.textContent = 'Because tokens leak.';
    document.body.appendChild(div);
    enhanceReveal(document.body);
    const details = div.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(LABEL);
    // open opts into starting revealed on the class form too
    const div2 = document.createElement('div');
    div2.className = 'sem-reveal';
    div2.setAttribute('open', '');
    div2.textContent = 'Shown.';
    document.body.appendChild(div2);
    enhanceReveal(document.body);
    expect(div2.querySelector('details')?.hasAttribute('open')).toBe(true);
  });
});
