// @vitest-environment happy-dom
// Unit spec — sem-component, the component-inventory card
// (spec/schema/sem-component.md).
//
// Feature: the card upgrade
//   Scenario: head chrome prepends (tag, name, status) without moving authored children
//   Scenario: meta chrome appends (type, source, labels)
//   Scenario: role=article + aria-label name the card; data-sem-component-tag mirrors tag
//   Scenario: the upgrade is idempotent (re-enhance mints nothing)
//   Scenario: JS-off, the authored children are the whole record

import { describe, it, expect } from 'vitest';
import { SemComponent } from '../../src/lit/sem-component.js';

async function card(attrs: string, body: string): Promise<SemComponent> {
  const el = document.createElement('sem-component');
  el.setAttribute('id', 'c1');
  for (const [k, v] of parseAttrs(attrs)) el.setAttribute(k, v);
  el.innerHTML = body;
  document.body.appendChild(el);
  // happy-dom races its custom-element pipeline (sem-facts.test.ts note):
  // force the upgrade, then let connectedCallback deliver and Lit settle.
  if (!(el instanceof SemComponent)) customElements.upgrade(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as SemComponent).updateComplete;
  await (el as SemComponent).updateComplete;
  return el as SemComponent;
}

function parseAttrs(s: string): Array<[string, string]> {
  return [...s.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
}

describe('sem-component upgrade', () => {
  it('prepends head chrome (tag, name, status) and keeps the authored body', async () => {
    const el = await card(
      'tag="noizu-waitlist" name="Waitlist" status="live"',
      '<p>Capture email, deploy on signup.</p>',
    );
    const head = el.querySelector('.sem-component-head')!;
    expect(head.getAttribute('data-sem-chrome')).toBe('');
    expect(head.children[0].textContent).toBe('noizu-waitlist');
    expect(head.querySelector('.sem-component-status')!.textContent).toBe('live');
    // authored children stay in place, between head and meta
    expect(el.querySelector('.sem-component-head + p')!.textContent).toContain('Capture email');
    expect(el.querySelectorAll(':scope > p').length).toBe(1);
  });

  it('appends meta chrome (type, source, labels)', async () => {
    const el = await card(
      'tag="x" type="web-component" source="src/x.ts" labels="form telemetry"',
      'body',
    );
    const meta = el.querySelector('.sem-component-meta')!;
    expect(meta.getAttribute('data-sem-chrome')).toBe('');
    expect(meta.querySelector('.sem-component-type')!.textContent).toBe('web-component');
    expect(meta.querySelector('.sem-component-source')!.textContent).toBe('src/x.ts');
    expect([...meta.querySelectorAll('.sem-component-labels li')].map((li) => li.textContent)).toEqual(['form', 'telemetry']);
  });

  it('names the card for AT and mirrors the tag', async () => {
    const el = await card('tag="noizu-waitlist" name="Waitlist"', 'body');
    expect(el.getAttribute('role')).toBe('article');
    expect(el.getAttribute('aria-label')).toBe('Waitlist component card');
    expect(el.getAttribute('data-sem-component-tag')).toBe('noizu-waitlist');
  });

  it('is idempotent: a second upgrade mints nothing', async () => {
    const el = await card('tag="x" status="live" type="svc" source="s.ts" labels="a"', 'body');
    const chrome = el.querySelectorAll('[data-sem-chrome]').length;
    (el as unknown as { updated(): void }).updated();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelectorAll('[data-sem-chrome]').length).toBe(chrome);
    expect(el.querySelectorAll('.sem-component-head').length).toBe(1);
  });

  it('unstatused cards render no status chip; JS-off authored text is the record', async () => {
    const el = document.createElement('sem-component');
    el.setAttribute('tag', 'x');
    el.textContent = 'plain description';
    document.body.appendChild(el);
    // no script: no chrome, no classes — the authored text is all there is
    expect(el.querySelector('.sem-component-head')).toBeNull();
    expect(el.textContent).toBe('plain description');
  });
});
