// @vitest-environment happy-dom
// Unit spec — the class-form alias upgrade (src/shared/npl-alias.ts)
//
// Feature: the documented `.npl-*` class form (conventions Appendix A;
//          spec/schema/npl/TEMPLATE.md) renders like the tag form
//   Scenario: div.npl-example[data-label] becomes <npl-example> and renders its chrome
//   Scenario: npl-mood, npl-flags and npl-agent aliases resolve their data-* parameters
//   Scenario: authored children, id and extra classes survive the rewrite
//   Scenario: the first npl-* class token wins; the rewrite is idempotent
//   Scenario: a name no component backs stays authored prose (degradation contract)
//   Scenario: nested aliases upgrade outermost-first and stay nested

import { describe, it, expect, beforeEach } from 'vitest';
import { upgradeNplAliases, aliasTag, NPL_ALIAS_MARKER } from '../../src/shared/npl-alias.js';
import { NplExample } from '../../src/lit/npl/npl-example.js';
import { NplMood } from '../../src/lit/npl/npl-mood.js';
import { NplFlags } from '../../src/lit/npl/npl-flags.js';
import { NplAgent } from '../../src/lit/npl/npl-agent.js';

/** The full bundle's predicate: "this build ships a component for it". */
const defined = (tag: string): boolean => customElements.get(tag) !== undefined;

describe('npl class-form alias upgrade', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('upgrades div.npl-example[data-label] to a rendering <npl-example>', async () => {
    document.body.innerHTML =
      '<div class="npl-example" id="ex" data-label="Worked">authored <em>child</em></div>';
    upgradeNplAliases(document.body, defined);

    const el = document.body.firstElementChild!;
    expect(el.localName).toBe('npl-example');
    expect(el).toBeInstanceOf(NplExample);
    expect(el.hasAttribute(NPL_ALIAS_MARKER)).toBe(true);
    // attributes cross the rewrite verbatim
    expect(el.getAttribute('id')).toBe('ex');
    expect(el.getAttribute('data-label')).toBe('Worked');
    // the component owns the rest: claim, chrome, resolved parameter
    await (el as NplExample).updateComplete;
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(el.querySelector('.npl-example-label')?.textContent).toBe('Worked');
    // authored children survive beside the generated chrome
    expect(el.querySelector('em')?.textContent).toBe('child');
  });

  it('upgrades div.npl-mood[data-mood] and resolves the parameter', async () => {
    document.body.innerHTML = '<div class="npl-mood" data-mood="🙂 calm">detail</div>';
    upgradeNplAliases(document.body, defined);
    const el = document.querySelector('npl-mood') as NplMood;
    expect(el).toBeInstanceOf(NplMood);
    await el.updateComplete;
    expect(el.querySelector('.npl-mood-emoji')?.textContent).toBe('🙂');
    expect(el.querySelector('.npl-mood-qualifier')?.textContent).toBe('calm');
    expect(el.textContent).toContain('detail');
  });

  it('upgrades div.npl-flags[data-preset] with its authored flag children', async () => {
    document.body.innerHTML =
      '<div class="npl-flags" data-preset="production"><div class="npl-flag">mind the gap</div></div>';
    upgradeNplAliases(document.body, defined);
    const el = document.querySelector('npl-flags') as NplFlags;
    expect(el).toBeInstanceOf(NplFlags);
    await el.updateComplete;
    expect(el.querySelector('.npl-flags-preset')?.textContent).toBe('preset:production');
    expect(el.querySelector('.npl-flag')?.textContent).toBe('mind the gap');
    // dual-form mirror wrote the resolved value back
    expect(el.getAttribute('data-preset')).toBe('production');
  });

  it('upgrades div.npl-agent[data-name…] and renders the header', async () => {
    document.body.innerHTML =
      '<div class="npl-agent" data-name="Loom" data-type="orchestrator" data-version="1.0">body</div>';
    upgradeNplAliases(document.body, defined);
    const el = document.querySelector('npl-agent') as NplAgent;
    expect(el).toBeInstanceOf(NplAgent);
    await el.updateComplete;
    expect(el.querySelector('.npl-agent-name')?.textContent).toBe('Loom');
    expect(el.querySelector('.npl-agent-type')?.textContent).toBe('orchestrator');
    expect(el.querySelector('.npl-agent-version')?.textContent).toBe('1.0');
    expect(el.getAttribute('data-name')).toBe('Loom');
  });

  it('aliasTag reads the first npl-* class token; look-alikes are not aliases', () => {
    document.body.innerHTML =
      '<div class="layout npl-mood extra">a</div><div class="semantic">b</div><div class="npl-">c</div>';
    const [mood, semantic, stub] = Array.from(document.body.children);
    expect(aliasTag(mood)).toBe('npl-mood');
    expect(aliasTag(semantic)).toBeNull();
    expect(aliasTag(stub)).toBeNull();
  });

  it('keeps extra classes and returns the replacement when the root was the alias', async () => {
    document.body.innerHTML = '<div class="layout npl-mood" data-mood="🙂 ok">x</div>';
    const div = document.body.firstElementChild!;
    const effective = upgradeNplAliases(div, defined);
    expect(effective.localName).toBe('npl-mood');
    expect(effective.getAttribute('class')).toBe('layout npl-mood');
    expect(div.isConnected).toBe(false);
    await (effective as NplMood).updateComplete;
    expect(effective.querySelector('.npl-mood-chip')).toBeTruthy();
  });

  it('is idempotent — tag-form elements (even alias-classed) are never rewritten', async () => {
    document.body.innerHTML =
      '<npl-example class="npl-example" data-label="tag">t</npl-example><div class="npl-mood" data-mood="🙂 x">m</div>';
    const before = document.querySelector('npl-example')!;
    upgradeNplAliases(document.body, defined);
    const after = document.querySelector('npl-example')!;
    expect(after).toBe(before); // untouched: no replacement, no marker
    expect(after.hasAttribute(NPL_ALIAS_MARKER)).toBe(false);
    // second pass over the already-upgraded tree changes nothing
    const mood = document.querySelector('npl-mood')!;
    upgradeNplAliases(document.body, defined);
    expect(document.querySelector('npl-mood')).toBe(mood);
    expect(document.querySelectorAll('npl-mood')).toHaveLength(1);
  });

  it('leaves a name no component backs as authored prose (JS-off parity)', () => {
    document.body.innerHTML = '<div class="npl-notshipped" data-x="1">stays prose</div>';
    upgradeNplAliases(document.body, defined);
    const el = document.body.firstElementChild!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute(NPL_ALIAS_MARKER)).toBe(false);
    expect(el.textContent).toBe('stays prose');
  });

  it('upgrades nested aliases outermost-first and keeps them nested', async () => {
    document.body.innerHTML =
      '<div class="npl-agent" data-name="Outer"><div class="npl-mood" data-mood="🙂 inner">deep</div></div>';
    upgradeNplAliases(document.body, defined);
    const agent = document.querySelector('npl-agent')!;
    const mood = agent.querySelector('npl-mood');
    expect(agent.hasAttribute(NPL_ALIAS_MARKER)).toBe(true);
    expect(mood).toBeTruthy();
    expect(mood!.hasAttribute(NPL_ALIAS_MARKER)).toBe(true);
    await (mood as unknown as NplMood).updateComplete;
    expect(mood!.querySelector('.npl-mood-emoji')?.textContent).toBe('🙂');
  });
});
