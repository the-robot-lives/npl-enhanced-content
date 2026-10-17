// @vitest-environment happy-dom
// Unit spec — the namespace machinery: registration guards
// (src/lit/shared/namespace.ts + the semext/agent-kit wrappers) and the
// generalized class-alias pass (src/shared/npl-alias.ts).
//
// Feature: every namespace shares one idempotent registration + alias engine
//   Scenario: defineInNamespace enforces its prefix and defines once
//   Scenario: defineSemext / defineAkit are the wrappers, same contract
//   Scenario: upgradeClassAliases is prefix-parameterized — semext/agent-kit
//             rewrites carry attrs, children and the data-<prefix>-alias marker
//   Scenario: namespaces are isolated — one pass never touches another family
//   Scenario: the npl wrappers keep their historical spelling and behaviour
//   Scenario: sem-tldr registers through the core barrel and claims its marker

import { describe, it, expect, beforeEach } from 'vitest';
import {
  aliasNameFor,
  aliasMarkerFor,
  aliasTag,
  aliasTagIn,
  upgradeClassAliases,
  upgradeNplAliases,
  NPL_ALIAS_MARKER,
} from '../../src/shared/npl-alias.js';
import { defineInNamespace } from '../../src/lit/shared/namespace.js';
import { defineSemext, semextParam } from '../../src/lit/semext/shared.js';
import { defineAkit } from '../../src/lit/agent-kit/shared.js';
import { SemTldr } from '../../src/lit/sem-tldr.js';

const defined = (tag: string): boolean => customElements.get(tag) !== undefined;

describe('defineInNamespace — the shared guard', () => {
  class SemextCard extends HTMLElement {}

  it('defines a tag in its own namespace, exactly once', () => {
    defineInNamespace('semext', 'semext-card', SemextCard);
    expect(customElements.get('semext-card')).toBe(SemextCard);
    // idempotent: a second define is a silent no-op, not a throw
    expect(() => defineInNamespace('semext', 'semext-card', SemextCard)).not.toThrow();
  });

  it('refuses a tag outside its prefix', () => {
    expect(() => defineInNamespace('semext', 'sem-note', SemextCard)).toThrow(TypeError);
    expect(() => defineInNamespace('agent-kit', 'semext-card', SemextCard)).toThrow(TypeError);
  });
});

describe('defineSemext / defineAkit — wrappers, same contract', () => {
  class SemextFlag extends HTMLElement {}
  class AkitIssue extends HTMLElement {}

  it('registers semext-* and agent-kit-* tags through the shared engine', () => {
    defineSemext('semext-flag', SemextFlag);
    defineAkit('agent-kit-issue', AkitIssue);
    expect(customElements.get('semext-flag')).toBe(SemextFlag);
    expect(customElements.get('agent-kit-issue')).toBe(AkitIssue);
    expect(() => defineSemext('npl-x', SemextFlag)).toThrow(TypeError);
    expect(() => defineAkit('sem-x', AkitIssue)).toThrow(TypeError);
  });

  it('semextParam resolves the dual form — data-* wins', () => {
    const el = document.createElement('semext-x');
    el.setAttribute('mood', 'bare');
    el.setAttribute('data-mood', 'mirror');
    expect(semextParam(el, 'mood')).toBe('mirror');
    el.removeAttribute('data-mood');
    expect(semextParam(el, 'mood')).toBe('bare');
  });
});

describe('upgradeClassAliases — the prefix-parameterized pass', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('rewrites a known semext alias div, carrying attrs and children', async () => {
    document.body.innerHTML =
      '<div class="semext-card" id="c1" data-label="Worked">authored <em>child</em></div>';
    const effective = upgradeClassAliases(document.body, 'semext', defined);
    expect(effective).toBe(document.body);

    const el = document.body.querySelector('semext-card')!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('id')).toBe('c1');
    expect(el.getAttribute('data-label')).toBe('Worked');
    expect(el.hasAttribute(aliasMarkerFor('semext'))).toBe(true);
    expect(el.hasAttribute('data-semext-alias')).toBe(true);
    expect(el.querySelector('em')?.textContent).toBe('child');
  });

  it('leaves unknown names, tag-form elements and other families alone', () => {
    document.body.innerHTML =
      '<div class="semext-ghost">unknown</div>' +
      '<semext-card class="semext-card">already tag form</semext-card>' +
      '<div class="npl-example" id="keep">another family</div>';
    upgradeClassAliases(document.body, 'semext', defined);
    upgradeClassAliases(document.body, 'agent-kit', defined);

    expect(document.querySelector('.semext-ghost')?.localName).toBe('div');
    expect(document.querySelector('semext-card')?.childNodes[0]?.textContent).toContain('already tag form');
    const foreign = document.querySelector('#keep')!;
    expect(foreign.localName).toBe('div');
    expect(foreign.hasAttribute(NPL_ALIAS_MARKER)).toBe(false);
  });

  it('rewrites agent-kit aliases with the hyphenated prefix', () => {
    document.body.innerHTML = '<span class="agent-kit-issue" data-label="Open">x</span>';
    upgradeClassAliases(document.body, 'agent-kit', defined);
    const el = document.body.querySelector('agent-kit-issue')!;
    expect(el).toBeTruthy();
    expect(el.hasAttribute('data-agent-kit-alias')).toBe(true);
  });

  it('aliasTagIn / aliasNameFor / aliasTag read one namespace each', () => {
    const el = document.createElement('div');
    el.className = 'layout semext-card npl-example';
    expect(aliasTagIn(el, 'semext')).toBe('semext-card');
    expect(aliasTagIn(el, 'agent-kit')).toBe(null);
    expect(aliasTag(el)).toBe('npl-example'); // the npl wrapper
    expect(aliasNameFor('agent-kit').test('agent-kit-issue')).toBe(true);
    expect(aliasNameFor('agent-kit').test('agentkit-issue')).toBe(false);
  });

  it('the npl wrapper matches the generalized engine', () => {
    document.body.innerHTML = '<div class="npl-example" data-label="Same">x</div>';
    // no npl component ships in this spec file, so the gate is open
    // (predicate = "rewrite anything the pass recognizes")
    const viaWrapper = upgradeNplAliases(document.body, () => true);
    expect(document.querySelector('npl-example')?.hasAttribute('data-npl-alias')).toBe(true);
    expect(viaWrapper).toBe(document.body);
  });
});

describe('sem-tldr — the walking-skeleton element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers through the core mechanism and claims its marker', async () => {
    expect(customElements.get('sem-tldr')).toBe(SemTldr);
    const el = document.createElement('sem-tldr');
    el.textContent = 'the whole summary';
    document.body.appendChild(el);
    await (el as SemTldr).updateComplete;
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    // no-logic stub: children pass through untouched
    expect(el.textContent).toBe('the whole summary');
    expect(el.children).toHaveLength(0);
  });
});
