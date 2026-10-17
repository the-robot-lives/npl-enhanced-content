// @vitest-environment happy-dom
// Unit spec — agent-kit-board · the family C board contract
// (spec/schema/agent-kit/board.md)
//
// Feature: the board lays out authored columns of self-wiring refs
//   Scenario: the board registers under the agent-kit namespace (defineAkit)
//   Scenario: the authored board IS the record — columns and refs survive upgrade
//   Scenario: the chrome chip counts columns and refs; the snapshot stamp renders from cached JSON
//   Scenario: extraction reads the board — heading attrs and the count chip never leak

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

const BOARD_BODY = `
  <agent-kit-column heading="In progress">
    <agent-kit-ticket-ref key="AKIT-001">the extractor issue</agent-kit-ticket-ref>
  </agent-kit-column>
  <agent-kit-column heading="Review">
    <agent-kit-ticket-ref key="AKIT-003">the vocabulary collision</agent-kit-ticket-ref>
  </agent-kit-column>
  <agent-kit-column heading="Done"></agent-kit-column>
  <script type="application/json">{ "updated_at": "2026-10-17T12:00:00Z" }</script>
`;

describe('agent-kit board (sub-batch 4)', () => {
  it('the board registers and extends CachedEmbedElement', () => {
    const Ctor = customElements.get('agent-kit-board');
    expect(Ctor).to.exist;
    const el = document.createElement('agent-kit-board') as HTMLElement;
    expect(el).to.be.instanceOf(CachedEmbedElement);
    el.remove();
  });

  it('the authored board IS the record — columns and refs survive upgrade', async () => {
    const el = await mount('agent-kit-board', { org: 'acme', key: 'board' }, BOARD_BODY);
    const parts = [...el.children]
      .filter((c) => !c.classList.contains('agent-kit-chrome') && !c.classList.contains('sem-cached-embed-chrome'))
      .map((c) => c.tagName.toLowerCase());
    expect(parts).to.deep.equal([
      'agent-kit-column',
      'agent-kit-column',
      'agent-kit-column',
      'script',
    ]);
    const cols = [...el.querySelectorAll('agent-kit-column')];
    expect(cols.map((c) => c.getAttribute('heading'))).to.deep.equal([
      'In progress',
      'Review',
      'Done',
    ]);
    expect(el.querySelectorAll('agent-kit-ticket-ref').length).to.equal(2);
  });

  it('the chrome chip counts columns and refs; the snapshot stamp renders from cached JSON', async () => {
    const el = await mount('agent-kit-board', { org: 'acme', key: 'board', status: 'cached' }, BOARD_BODY);
    const chip = el.querySelector('.agent-kit-board-chip');
    expect(chip).to.exist;
    expect(chip?.getAttribute('data-column-count')).to.equal('3');
    expect(chip?.textContent).to.contain('Board · 3 columns · 2 refs');
    expect(chip?.closest('.agent-kit-chrome')).to.exist;
    const stamp = el.querySelector('.agent-kit-board-snapshot time');
    expect(stamp).to.exist;
    expect(stamp?.getAttribute('datetime')).to.equal('2026-10-17T12:00:00Z');
    expect(stamp?.textContent).to.equal('2026-10-17');

    const bare = await mount(
      'agent-kit-board',
      { org: 'acme', key: 'board' },
      '<agent-kit-column heading="Open"></agent-kit-column>',
    );
    expect(bare.querySelector('.agent-kit-board-snapshot')).to.not.exist;
  });

  it('extraction reads the board — heading attrs and the count chip never leak', async () => {
    await mount('agent-kit-board', { org: 'acme', key: 'board', kind: 'board' }, BOARD_BODY);
    const records = extractRecords(document);
    const boards = records.filter((r) => r.type === 'agent-kit-board');
    expect(boards.length).to.equal(1);
    const text = boards[0].text ?? '';
    // authored ref prose is in the record
    expect(text).to.contain('the extractor issue');
    expect(text).to.contain('the vocabulary collision');
    // chrome and attribute labels never leak
    expect(text).not.to.contain('In progress');
    expect(text).not.to.contain('Board ·');
    expect(text).not.to.contain('snapshot ·');
  });
});
