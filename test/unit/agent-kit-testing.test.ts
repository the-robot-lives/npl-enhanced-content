// @vitest-environment happy-dom
// Unit spec — the testing quartet (agent-kit-test-suite /
// agent-kit-test-case / agent-kit-cypress / agent-kit-cucumber) · the
// family C testing contracts (spec/schema/agent-kit/{test-suite,
// test-case,script-cards}.md)
//
// Feature: suite rows, case steps and runner-script sources are the
//          records; totals chips and the script panel are chrome
//   Scenario: the four tags register under the agent-kit namespace (defineAkit)
//   Scenario: authored rows, steps and scripts survive upgrade
//   Scenario: chrome totals the suite rows (real arithmetic) and counts case steps
//   Scenario: the script panel displays the authored source; file renders as a chip, never fetched
//   Scenario: extraction reads the authored records — chips, totals, stats never leak

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

const SUITE_BODY = `
  <agent-kit-branch passed="18" failed="0">main</agent-kit-branch>
  <agent-kit-branch passed="17" failed="1">develop</agent-kit-branch>
  <script type="application/json">{ "updated_at": "2026-10-17T14:00:00Z" }</script>
`;
const CASE_BODY = `
  <agent-kit-step>Open the demo.</agent-kit-step>
  <agent-kit-step>Extract.</agent-kit-step>
  <agent-kit-expected>Both passes agree.</agent-kit-expected>
`;
const CYPRESS_BODY = `
  <script type="text/plain" data-agent-kit-script>describe('board', () => { it('mints', () => {}) });</script>
`;
const CUCUMBER_BODY = `
  <script type="text/plain" data-agent-kit-script>Feature: extraction
  Scenario: parity
    Given an authored board</script>
`;

const notChrome = (el: HTMLElement): HTMLElement[] =>
  [...el.children].filter(
    (c) => !c.classList.contains('agent-kit-chrome') && !c.classList.contains('sem-cached-embed-chrome'),
  ) as HTMLElement[];

describe('agent-kit testing quartet (sub-batch 7)', () => {
  it('the four tags register and extend CachedEmbedElement', () => {
    for (const tag of ['agent-kit-test-suite', 'agent-kit-test-case', 'agent-kit-cypress', 'agent-kit-cucumber']) {
      const Ctor = customElements.get(tag);
      expect(Ctor, `customElements.get(${tag})`).to.exist;
      const el = document.createElement(tag) as HTMLElement;
      expect(el).to.be.instanceOf(CachedEmbedElement);
      el.remove();
    }
  });

  it('authored rows, steps and scripts survive upgrade', async () => {
    const suite = await mount('agent-kit-test-suite', {}, SUITE_BODY);
    expect(notChrome(suite).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-branch',
      'agent-kit-branch',
      'script',
    ]);
    expect(suite.querySelectorAll('agent-kit-branch').length).to.equal(2);

    const testCase = await mount('agent-kit-test-case', {}, CASE_BODY);
    expect(notChrome(testCase).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-step',
      'agent-kit-step',
      'agent-kit-expected',
    ]);

    for (const [tag, body] of [
      ['agent-kit-cypress', CYPRESS_BODY],
      ['agent-kit-cucumber', CUCUMBER_BODY],
    ] as const) {
      const card = await mount(tag, {}, body);
      expect(notChrome(card).map((c) => c.tagName.toLowerCase())).to.deep.equal(['script']);
    }
  });

  it('chrome totals the suite rows and counts case steps', async () => {
    const suite = await mount('agent-kit-test-suite', {}, SUITE_BODY);
    const totals = suite.querySelector('.agent-kit-suite-totals');
    expect(totals?.getAttribute('data-branch-count')).to.equal('2');
    expect(totals?.getAttribute('data-passed-total')).to.equal('35');
    expect(totals?.getAttribute('data-failed-total')).to.equal('1');
    expect(totals?.textContent).to.contain('2 branches · 35 passed · 1 failed');
    // non-numeric stats total as 0
    const odd = await mount(
      'agent-kit-test-suite',
      {},
      '<agent-kit-branch passed="x" failed="">edge</agent-kit-branch>',
    );
    expect(odd.querySelector('.agent-kit-suite-totals')?.getAttribute('data-passed-total')).to.equal('0');
    expect(odd.querySelector('.agent-kit-suite-totals')?.textContent).to.contain('1 branch · 0 passed · 0 failed');

    const testCase = await mount('agent-kit-test-case', {}, CASE_BODY);
    expect(testCase.querySelector('.agent-kit-case-count')?.getAttribute('data-step-count')).to.equal('2');
    expect(testCase.querySelector('.agent-kit-case-count')?.textContent).to.contain('Test case · 2 steps');
  });

  it('the script panel displays the authored source; file renders as a chip, never fetched', async () => {
    const cypress = await mount('agent-kit-cypress', { file: 'test/e2e/board.cy.js' }, CYPRESS_BODY);
    expect(cypress.querySelector('.agent-kit-script-kind')?.textContent?.trim()).to.equal('Cypress spec');
    expect(cypress.querySelector('.agent-kit-script-file')?.textContent).to.contain('test/e2e/board.cy.js');
    expect(cypress.querySelector('a[href]')).to.not.exist; // a path chip, never a link, never a fetch
    expect(cypress.querySelector('script[data-agent-kit-script]')?.textContent).to.contain("describe('board'");

    const cucumber = await mount('agent-kit-cucumber', {}, CUCUMBER_BODY);
    expect(cucumber.querySelector('.agent-kit-script-kind')?.textContent?.trim()).to.equal('Cucumber feature');
    expect(cucumber.querySelector('.agent-kit-script-file')).to.not.exist;
    expect(cucumber.querySelector('.agent-kit-script-inline')?.textContent).to.contain('inline source below');
  });

  it('extraction reads the authored records — chips, totals, stats never leak', async () => {
    await mount('agent-kit-test-suite', { kind: 'suite' }, SUITE_BODY);
    await mount('agent-kit-test-case', { kind: 'case' }, CASE_BODY);
    await mount('agent-kit-cypress', { kind: 'script', file: 'test/e2e/board.cy.js' }, CYPRESS_BODY);
    await mount('agent-kit-cucumber', { kind: 'script' }, CUCUMBER_BODY);
    const records = extractRecords(document);
    const by = (t: string) => records.filter((r) => r.type === t);
    expect(by('agent-kit-test-suite').length).to.equal(1);
    expect(by('agent-kit-test-case').length).to.equal(1);
    expect(by('agent-kit-cypress').length).to.equal(1);
    expect(by('agent-kit-cucumber').length).to.equal(1);

    const suiteText = by('agent-kit-test-suite')[0].text ?? '';
    expect(suiteText).to.contain('main');
    expect(suiteText).to.contain('develop');
    expect(suiteText).not.to.contain('35 passed');
    expect(suiteText).not.to.contain('passed,');
    expect(suiteText).not.to.contain('snapshot ·');

    const caseText = by('agent-kit-test-case')[0].text ?? '';
    expect(caseText).to.contain('Open the demo.');
    expect(caseText).to.contain('Both passes agree.');
    expect(caseText).not.to.contain('Test case ·');

    // the script payload is display-only in BOTH modes — never a record
    expect(by('agent-kit-cypress')[0].text ?? '').not.to.contain('describe(');
    expect(by('agent-kit-cucumber')[0].text ?? '').not.to.contain('Feature:');
  });
});
