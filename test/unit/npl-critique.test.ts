// @vitest-environment happy-dom
// Unit spec — npl-critique (src/lit/npl/npl-critique.ts)
//
// Feature: structured critique — display-only, light DOM
//          (schema: spec/schema/npl/npl-critique.md; recipe: src/lit/npl/index.ts)
//   Scenario: importing the barrel registers npl-critique
//   Scenario: upgrades with light DOM — no shadow root, authored children survive
//   Scenario: subject, perspective and verdict gain their part classes; verdict stays authored
//   Scenario: strengths and weaknesses render as two lists with item content verbatim
//   Scenario: class-form parts (.npl-strengths / .npl-item) structure the same way
//   Scenario: a class-form part on a native ul upgrades in place (never a nested list)
//   Scenario: a prose list part is classed, never rewritten
//   Scenario: a list part mixing items with loose prose is never rewritten (nothing dropped)
//   Scenario: an empty critique generates nothing

import { describe, it, expect, beforeEach } from 'vitest';
import { NplCritique } from '../../src/lit/npl/npl-critique.js';

const CRITIQUE =
  '<npl-critique id="c1">' +
  '<subject>the launch prompt</subject>' +
  '<perspective>security reviewer</perspective>' +
  '<strengths><item>explicit <em>failure modes</em></item><item>bounded output</item></strengths>' +
  '<weaknesses><item>no examples</item></weaknesses>' +
  '<verdict>ship after one revision</verdict>' +
  '</npl-critique>';

const mount = async (html: string): Promise<NplCritique> => {
  document.body.innerHTML = html;
  const el = document.querySelector('npl-critique') as NplCritique;
  await el.updateComplete;
  return el;
};

describe('npl-critique', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the barrel registers npl-critique', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-critique')).toBe(NplCritique);
  });

  it('upgrades with light DOM — no shadow root, authored children survive', async () => {
    const el = await mount(CRITIQUE);
    expect(el).toBeInstanceOf(NplCritique);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('.npl-critique-subject')?.textContent).toBe('the launch prompt');
  });

  it('parts gain classes; subject/perspective/verdict keep their authored blocks', async () => {
    const el = await mount(CRITIQUE);
    const verdict = el.querySelector('.npl-critique-verdict');
    expect(verdict).not.toBeNull();
    expect(verdict?.tagName).toBe('VERDICT'); // same authored element, classed — not regenerated
    expect(verdict?.textContent).toBe('ship after one revision');
    expect(el.querySelector('perspective.npl-critique-perspective')?.textContent).toBe(
      'security reviewer',
    );
  });

  it('strengths and weaknesses render as two lists, item content verbatim', async () => {
    const el = await mount(CRITIQUE);
    const lists = el.querySelectorAll('.npl-critique-list');
    expect(lists).toHaveLength(2);
    const strengths = el.querySelector('.npl-critique-strengths');
    expect(strengths?.tagName).toBe('STRENGTHS');
    const items = strengths?.querySelectorAll('.npl-critique-item');
    expect(items).toHaveLength(2);
    expect(items?.[0].tagName).toBe('LI');
    // inner markup survives the move into the generated <li>
    expect(items?.[0].innerHTML).toContain('<em>failure modes</em>');
    expect(
      el.querySelector('.npl-critique-weaknesses')?.querySelector('.npl-critique-item')?.textContent,
    ).toBe('no examples');
  });

  it('class-form alias parts structure the same way', async () => {
    const el = await mount(
      '<npl-critique>' +
        '<div class="npl-strengths"><span class="npl-item">clear contract</span></div>' +
        '<p class="npl-verdict">approved</p>' +
        '</npl-critique>',
    );
    expect(el.querySelector('.npl-strengths.npl-critique-strengths ul.npl-critique-list li')).toBeTruthy();
    expect(el.querySelector('.npl-critique-item')?.textContent).toBe('clear contract');
    expect(el.querySelector('p.npl-verdict.npl-critique-verdict')?.textContent).toBe('approved');
  });

  it('a class-form part authored as a native ul upgrades in place — no nested list', async () => {
    const el = await mount(
      '<npl-critique>' +
        '<ul class="npl-strengths"><span class="npl-item">bounded scope</span></ul>' +
        '</npl-critique>',
    );
    const strengths = el.querySelector('ul.npl-strengths');
    expect(strengths?.classList.contains('npl-critique-list')).toBe(true);
    expect(strengths?.querySelectorAll('ul')).toHaveLength(0); // never double-nested
    const li = strengths?.querySelector('li.npl-critique-item');
    expect(li?.textContent).toBe('bounded scope');
    expect(strengths?.querySelector('.npl-item')).toBeNull();
  });

  it('a prose list part is classed, never rewritten', async () => {
    const el = await mount(
      '<npl-critique><strengths>reads well end to end</strengths></npl-critique>',
    );
    const strengths = el.querySelector('strengths.npl-critique-strengths');
    expect(strengths).not.toBeNull();
    expect(strengths?.querySelector('ul')).toBeNull();
    expect(strengths?.textContent).toBe('reads well end to end');
  });

  it('a list part mixing items with loose prose is left as authored — no content dropped', async () => {
    const el = await mount(
      '<npl-critique>' +
        '<strengths>overall: <item>clear contract</item> (see the spec)</strengths>' +
        '</npl-critique>',
    );
    const strengths = el.querySelector('strengths.npl-critique-strengths');
    expect(strengths).not.toBeNull();
    expect(strengths?.querySelector('ul')).toBeNull();
    // every authored node survives
    expect(strengths?.textContent).toBe('overall: clear contract (see the spec)');
  });

  it('an empty critique generates nothing', async () => {
    const el = await mount('<npl-critique id="empty"></npl-critique>');
    expect(el.querySelector('ul')).toBeNull();
    expect(el.children).toHaveLength(0);
  });
});
