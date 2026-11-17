// @vitest-environment happy-dom
// Unit spec — sem-badge (src/lit/sem-badge.ts), contract: spec/schema/sem-badge.md
//
// Feature: inline status chip
//   Scenario: the tag registers
//   Scenario: a known variant is mirrored to data-variant; authored text is kept
//   Scenario: an unknown or missing variant falls back to neutral

import { describe, it, expect } from 'vitest';
import { SemBadge } from '../../src/lit/sem-badge.js';

async function mount(attrs: string, text: string): Promise<SemBadge> {
  const el = document.createElement('sem-badge') as SemBadge;
  if (attrs) el.setAttribute('variant', attrs);
  el.textContent = text;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('sem-badge', () => {
  it('registers the tag', () => {
    expect(customElements.get('sem-badge')).toBe(SemBadge);
  });

  it('mirrors a known variant and keeps the authored text', async () => {
    const el = await mount('success', 'train 6 live');
    expect(el.getAttribute('data-variant')).toBe('success');
    expect(el.textContent).toBe('train 6 live');
  });

  it('falls back to neutral for an unknown or missing variant', async () => {
    expect((await mount('rainbow', 'x')).getAttribute('data-variant')).toBe('neutral');
    expect((await mount('', 'y')).getAttribute('data-variant')).toBe('neutral');
  });
});
