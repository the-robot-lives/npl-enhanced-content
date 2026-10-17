// @vitest-environment happy-dom
// Unit spec — the structured-list pair (agent-kit-acceptance-criteria +
// agent-kit-custom-assert) · the family C acceptance/assert contracts
// (spec/schema/agent-kit/acceptance-criteria.md, custom-assert.md)
//
// Feature: the structured-list tags render authored rows, chrome counted
//   Scenario: both tags register under the agent-kit namespace (defineAkit)
//   Scenario: the authored rows ARE the record — criteria and assert pairs survive upgrade
//   Scenario: the chrome chip counts authored rows and lives inside the chrome container
//   Scenario: extraction reads the rows — the count chip never leaks

import { describe, it, expect } from 'vitest';
import '../../src/lit/agent-kit/index.js';
import { CachedEmbedElement } from '../../src/lit/shared/cached-embed.js';
import { extractRecords } from '../../src/extract/records.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(el: HTMLElement): Promise<void> {
  await tick();
  if ('updateComplete' in el) await (el as { updateComplete: Promise<boolean> }).updateComplete;
  await tick();
  if ('updateComplete' in el) await (el as { updateComplete: Promise<boolean> }).updateComplete;
}

async function mount(tag: string, attrs: Record<string, string>, html?: string): Promise<HTMLElement> {
  const el = document.createElement(tag) as HTMLElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (html) el.innerHTML = html;
  document.body.appendChild(el);
  customElements.upgrade(el);
  await settle(el);
  return el;
}

const CRITERIA_BODY = `
  <agent-kit-criterion>
    <agent-kit-given>a hand-authored document</agent-kit-given>
    <agent-kit-when>the extractor runs</agent-kit-when>
    <agent-kit-then>records deep-equal</agent-kit-then>
  </agent-kit-criterion>
  <agent-kit-criterion>
    <agent-kit-given>fabricated chrome</agent-kit-given>
    <agent-kit-when>text is collected</agent-kit-when>
    <agent-kit-then>no chrome leaks</agent-kit-then>
  </agent-kit-criterion>
`;

const ASSERT_BODY = `
  <agent-kit-assert-expr>extractRecords(doc)</agent-kit-assert-expr>
  <agent-kit-assert-expect>deep-equals the JS-off set</agent-kit-assert-expect>
  <agent-kit-assert-expr>norm(text)</agent-kit-assert-expr>
  <agent-kit-assert-expect>collapses whitespace only</agent-kit-assert-expect>
`;

describe('agent-kit structured lists (sub-batch 3)', () => {
  it('both tags register and extend CachedEmbedElement', () => {
    for (const tag of ['agent-kit-acceptance-criteria', 'agent-kit-custom-assert']) {
      const Ctor = customElements.get(tag);
      expect(Ctor, `customElements.get(${tag})`).to.exist;
      const el = document.createElement(tag) as HTMLElement;
      expect(el).to.be.instanceOf(CachedEmbedElement);
      el.remove();
    }
  });

  it('the authored rows ARE the record — criteria and pairs survive upgrade', async () => {
    const ac = await mount('agent-kit-acceptance-criteria', { org: 'acme', key: 'crit' }, CRITERIA_BODY);
    const parts = [...ac.children]
      .filter((c) => !c.classList.contains('agent-kit-chrome'))
      .map((c) => c.tagName.toLowerCase());
    expect(parts).to.deep.equal(['agent-kit-criterion', 'agent-kit-criterion']);
    expect(ac.querySelectorAll('agent-kit-given').length).to.equal(2);
    expect(ac.querySelector('agent-kit-then')?.textContent?.trim()).to.equal('records deep-equal');

    const ca = await mount('agent-kit-custom-assert', { org: 'acme', key: 'asserts' }, ASSERT_BODY);
    const pairs = [...ca.children]
      .filter((c) => !c.classList.contains('agent-kit-chrome'))
      .map((c) => c.tagName.toLowerCase());
    expect(pairs).to.deep.equal([
      'agent-kit-assert-expr',
      'agent-kit-assert-expect',
      'agent-kit-assert-expr',
      'agent-kit-assert-expect',
    ]);
  });

  it('the chrome chip counts authored rows and lives inside the chrome container', async () => {
    const ac = await mount('agent-kit-acceptance-criteria', { org: 'acme', key: 'crit' }, CRITERIA_BODY);
    const chip = ac.querySelector('.agent-kit-acceptance-chip');
    expect(chip).to.exist;
    expect(chip?.getAttribute('data-criteria-count')).to.equal('2');
    expect(chip?.textContent).to.contain('Acceptance criteria · 2');
    expect(chip?.closest('.agent-kit-chrome')).to.exist;

    const ca = await mount('agent-kit-custom-assert', { org: 'acme', key: 'asserts' }, ASSERT_BODY);
    const chipA = ca.querySelector('.agent-kit-assert-chip');
    expect(chipA).to.exist;
    expect(chipA?.getAttribute('data-assert-count')).to.equal('2');
    expect(chipA?.textContent).to.contain('Custom asserts · 2');
  });

  it('extraction reads the rows — the count chip never leaks', async () => {
    await mount('agent-kit-acceptance-criteria', { org: 'acme', key: 'crit', kind: 'criteria' }, CRITERIA_BODY);
    await mount('agent-kit-custom-assert', { org: 'acme', key: 'asserts', kind: 'asserts' }, ASSERT_BODY);
    const records = extractRecords(document);
    const criteria = records.filter((r) => r.type === 'agent-kit-acceptance-criteria');
    const asserts = records.filter((r) => r.type === 'agent-kit-custom-assert');
    expect(criteria.length).to.equal(1);
    expect(asserts.length).to.equal(1);
    expect(criteria[0].text).to.contain('a hand-authored document');
    expect(criteria[0].text).not.to.contain('Acceptance criteria');
    expect(criteria[0].text).not.to.contain('· 2');
    expect(asserts[0].text).to.contain('extractRecords(doc)');
    expect(asserts[0].text).not.to.contain('Custom asserts');
  });
});
