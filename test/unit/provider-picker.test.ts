// @vitest-environment happy-dom
// Unit spec — <sem-provider-picker>
//
// Feature: a light-DOM radiogroup of AI providers (ids + labels only)
//   Scenario: default selection is zai with roving tabindex on the checked option
//   Scenario: attribute `value` selects the provider
//   Scenario: selecting dispatches sem-provider-change {provider, label}, bubbles, composed
//   Scenario: Space and Enter select the focused option; arrows do not
//   Scenario: arrow keys move focus with roving tabindex, wrapping at the ends
//   Scenario: an unknown `value` falls back to the default without throwing

import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/lit/sem-provider-picker.js';
import { PROVIDERS, DEFAULT_PROVIDER_ID } from '../../src/lit/sem-provider-picker.js';

const key = (el: HTMLElement, k: string): void =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

const inputs = (el: Element): HTMLInputElement[] =>
  Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

async function picker(value?: string): Promise<HTMLElement & { updateComplete: Promise<boolean>; value: string }> {
  const el = document.createElement('sem-provider-picker') as HTMLElement & {
    updateComplete: Promise<boolean>;
    value: string;
  };
  if (value !== undefined) el.setAttribute('value', value);
  document.body.appendChild(el);
  await el.updateComplete;
  // an unknown value corrects itself via a second update cycle
  await el.updateComplete;
  return el;
}

describe('sem-provider-picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to zai: checked option, role, aria-label, roving tabindex on the checked input', async () => {
    const el = await picker();
    expect(DEFAULT_PROVIDER_ID).toBe('zai');
    expect(el.getAttribute('value')).toBe('zai');
    expect(el.getAttribute('role')).toBe('radiogroup');
    expect(el.getAttribute('aria-label')).toBeTruthy();
    const [zai] = inputs(el);
    expect(zai.checked).toBe(true);
    expect(inputs(el).map((i) => i.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    // every provider in the table renders a labelled option
    expect(inputs(el).map((i) => i.value)).toEqual(PROVIDERS.map((p) => p.id));
    // every option is a native radio inside a label with a note
    expect(
      inputs(el).every((i) => {
        const opt = i.closest('label')!;
        return !!opt.querySelector('.sem-provider-label') && !!opt.querySelector('.sem-provider-note');
      }),
    ).toBe(true);
  });

  it('attribute `value` selects that provider', async () => {
    const el = await picker('deepseek');
    const checked = inputs(el).find((i) => i.checked)!;
    expect(checked.value).toBe('deepseek');
    expect(checked.closest('label')!.textContent).toContain('DeepSeek');
  });

  it('selecting dispatches sem-provider-change with {provider, label}, bubbles + composed, attribute set first', async () => {
    const el = await picker();
    const target = inputs(el)[4]; // deepseek
    const seen: Array<{ provider: string; label: string; bubbles: boolean; composed: boolean; attrAtEvent: string | null }> = [];
    el.addEventListener('sem-provider-change', (e) => {
      const ev = e as CustomEvent<{ provider: string; label: string }>;
      seen.push({
        ...ev.detail,
        bubbles: ev.bubbles,
        composed: ev.composed,
        attrAtEvent: el.getAttribute('value'),
      });
    });
    target.checked = true;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(seen).toEqual([
      { provider: 'deepseek', label: 'DeepSeek', bubbles: true, composed: true, attrAtEvent: 'deepseek' },
    ]);
    expect(el.getAttribute('value')).toBe('deepseek');
    expect(inputs(el).map((i) => i.checked && i.value)).toContain('deepseek');
    // single selection
    expect(inputs(el).filter((i) => i.checked)).toHaveLength(1);
  });

  it('Space selects the focused option; arrows move focus without selecting', async () => {
    const el = await picker('anthropic');
    const list = inputs(el);
    expect(list.findIndex((i) => i.checked)).toBe(3);

    key(list[3], 'ArrowDown');
    expect(document.activeElement).toBe(list[4]);
    expect(inputs(el).find((i) => i.checked)!.value).toBe('anthropic'); // arrow did not commit
    expect(el.getAttribute('value')).toBe('anthropic');
    expect(list.map((i) => i.tabIndex)).toEqual([-1, -1, -1, -1, 0, -1, -1]);

    key(list[4], ' ');
    await el.updateComplete;
    expect(el.getAttribute('value')).toBe('deepseek');
    expect(inputs(el).find((i) => i.checked)!.value).toBe('deepseek');

    key(list[4], 'ArrowDown'); // move again before Enter, so the select target differs
    key(list[5], 'Enter');
    await el.updateComplete;
    expect(el.getAttribute('value')).toBe('qwen-flash');
  });

  it('arrow keys move focus with roving tabindex and wrap at both ends', async () => {
    const el = await picker();
    const list = inputs(el);

    key(list[0], 'ArrowDown');
    expect(document.activeElement).toBe(list[1]);
    expect(list[1].tabIndex).toBe(0);
    expect(list[0].tabIndex).toBe(-1);

    key(list[1], 'ArrowUp');
    expect(document.activeElement).toBe(list[0]);

    key(list[0], 'ArrowLeft'); // wraps to the last option
    expect(document.activeElement).toBe(list[6]);
    expect(list[6].tabIndex).toBe(0);
    expect(list[0].tabIndex).toBe(-1);

    key(list[6], 'ArrowRight'); // wraps back to the first
    expect(document.activeElement).toBe(list[0]);
    expect(list[0].tabIndex).toBe(0);
    expect(el.getAttribute('value')).toBe('zai'); // movement alone never commits
  });

  it('an unknown value falls back to the default without throwing', async () => {
    const el = await picker('not-a-provider');
    expect(el.value).toBe('zai');
    expect(el.getAttribute('value')).toBe('zai');
    expect(inputs(el).find((i) => i.checked)!.value).toBe('zai');
    expect(() => inputs(el)).not.toThrow();

    // and setting it directly as a property behaves the same way
    const el2 = await picker();
    el2.value = 'bogus';
    await el2.updateComplete;
    await el2.updateComplete;
    expect(el2.value).toBe('zai');
    expect(inputs(el2).find((i) => i.checked)!.value).toBe('zai');
  });
});
