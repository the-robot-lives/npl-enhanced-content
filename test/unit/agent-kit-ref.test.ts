// @vitest-environment happy-dom
// Unit spec — agent-kit-ref (src/lit/agent-kit/), contract: spec/schema/agent-kit/ref.md
//
// Feature: an inline doc/artifact reference
//   Scenario: the tag registers under the agent-kit namespace
//   Scenario: a valid reference becomes a keyboard-reachable link with a descriptive name
//   Scenario: click and Enter/Space emit agent-kit:ref-follow with {kind, id}, id lowercased
//   Scenario: an invalid kind or a non-UUID id stays inert: no role, no tabindex, no event
//   Scenario: the authored label is kept as plain text (the JS-off view)

import { describe, it, expect } from 'vitest';
import { AkitRef, REF_ID_RE } from '../../src/lit/agent-kit/agent-kit-ref.js';
import '../../src/lit/agent-kit/index.js';

const ID = '0B5D6F0E-2C4A-4D57-9D2A-5A9F3C1E7B11';

async function mount(attrs: string, label = 'Release runbook'): Promise<AkitRef> {
  const el = document.createElement('agent-kit-ref') as AkitRef;
  for (const [k, v] of attrs.matchAll(/(\w+)="([^"]*)"/g).map((m) => [m[1], m[2]] as const)) el.setAttribute(k, v);
  el.textContent = label;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('agent-kit-ref', () => {
  it('registers the tag and validates UUIDs', () => {
    expect(customElements.get('agent-kit-ref')).toBe(AkitRef);
    expect(REF_ID_RE.test(ID)).toBe(true);
    expect(REF_ID_RE.test('not-a-uuid')).toBe(false);
  });

  it('valid reference: role link, focusable, named', async () => {
    const el = await mount(`kind="doc" id="${ID}"`);
    expect(el.getAttribute('role')).toBe('link');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Open doc: Release runbook');
    expect(el.textContent).toBe('Release runbook');
  });

  it('empty label: the name falls back to the first 8 of the id', async () => {
    const el = await mount(`kind="artifact" id="${ID}"`, '');
    expect(el.getAttribute('aria-label')).toBe('Open artifact 0b5d6f0e');
  });

  it('click and keys emit ref-follow with a lowercased id', async () => {
    const el = await mount(`kind="doc" id="${ID}"`);
    const seen: unknown[] = [];
    el.addEventListener('agent-kit:ref-follow', (e) => seen.push((e as CustomEvent).detail));
    el.click();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(seen).toEqual([
      { kind: 'doc', id: ID.toLowerCase() },
      { kind: 'doc', id: ID.toLowerCase() },
    ]);
  });

  it('invalid kind or id stays inert', async () => {
    for (const attrs of [`kind="wiki" id="${ID}"`, 'kind="doc" id="nope"', `id="${ID}"`]) {
      const el = await mount(attrs);
      expect(el.hasAttribute('role')).toBe(false);
      expect(el.hasAttribute('tabindex')).toBe(false);
      let fired = false;
      el.addEventListener('agent-kit:ref-follow', () => (fired = true));
      el.click();
      expect(fired).toBe(false);
    }
  });
});
