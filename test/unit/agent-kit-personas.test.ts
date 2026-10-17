// @vitest-environment happy-dom
// Unit spec — src/lit/agent-kit/persona-shared.ts + the two persona tags ·
// the family C persona contract (spec/schema/agent-kit/personas.md)
//
// Feature: the agent-kit persona tags render cached persona records
//   Scenario: both persona tags register under the agent-kit namespace (defineAkit)
//   Scenario: the authored body IS the record — name/role/bio/metadata parts survive upgrade in document order
//   Scenario: chrome renders the avatar from the CACHED url attribute and the kind chip per tag
//   Scenario: no avatar attribute — no img element, kind chip only
//   Scenario: snapshot metadata renders as chrome chips; without it the strip is absent
//   Scenario: extraction reads the authored record — chrome text (kind chip) never leaks

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

const ADA_BODY = `
  <agent-kit-persona-name>Ada Lovelace</agent-kit-persona-name>
  <agent-kit-persona-role>Product manager</agent-kit-persona-role>
  <agent-kit-persona-bio>Owns the SemText roadmap.</agent-kit-persona-bio>
  <agent-kit-persona-metadata>team: authoring</agent-kit-persona-metadata>
`;

describe('agent-kit personas (sub-batch 2)', () => {
  it('both persona tags register and extend CachedEmbedElement', () => {
    for (const tag of ['agent-kit-user-persona', 'agent-kit-agent-persona']) {
      const Ctor = customElements.get(tag);
      expect(Ctor, `customElements.get(${tag})`).to.exist;
      const el = document.createElement(tag) as HTMLElement;
      expect(el).to.be.instanceOf(CachedEmbedElement);
      el.remove();
    }
  });

  it('the authored body IS the record — parts survive upgrade in document order', async () => {
    const el = await mount('agent-kit-user-persona', { org: 'acme', key: 'persona-ada' }, ADA_BODY);
    const parts = [...el.children]
      .filter((c) => !c.classList.contains('agent-kit-chrome'))
      .map((c) => c.tagName.toLowerCase());
    expect(parts).to.deep.equal([
      'agent-kit-persona-name',
      'agent-kit-persona-role',
      'agent-kit-persona-bio',
      'agent-kit-persona-metadata',
    ]);
    expect(el.querySelector('agent-kit-persona-name')?.textContent?.trim()).to.equal('Ada Lovelace');
    expect(el.querySelector('agent-kit-persona-metadata')?.textContent?.trim()).to.equal('team: authoring');
  });

  it('chrome renders the avatar from the cached URL and the kind chip per tag', async () => {
    const ada = await mount(
      'agent-kit-user-persona',
      { org: 'acme', key: 'persona-ada', avatar: 'https://example.test/ada.png' },
      ADA_BODY,
    );
    const img = ada.querySelector('img.agent-kit-persona-avatar');
    expect(img).to.exist;
    expect(img?.getAttribute('src')).to.equal('https://example.test/ada.png');
    expect(img?.getAttribute('alt')).to.equal('Ada Lovelace avatar');
    expect(ada.querySelector('.agent-kit-persona-kind')?.textContent?.trim()).to.equal('User persona');
    expect(ada.querySelector('.agent-kit-persona-kind')?.getAttribute('data-persona-kind')).to.equal('user');

    const loom = await mount(
      'agent-kit-agent-persona',
      { org: 'acme', key: 'persona-loom', avatar: 'https://example.test/loom.png' },
      '<agent-kit-persona-name>Loom</agent-kit-persona-name>',
    );
    expect(loom.querySelector('.agent-kit-persona-kind')?.textContent?.trim()).to.equal('Agent persona');
    expect(loom.querySelector('.agent-kit-persona-kind')?.getAttribute('data-persona-kind')).to.equal('agent');
    // every fabricated node lives inside the one chrome container
    expect(loom.querySelectorAll('.agent-kit-chrome').length).to.be.greaterThan(0);
    expect(loom.querySelector('img.agent-kit-persona-avatar')?.closest('.agent-kit-chrome')).to.exist;
  });

  it('no avatar attribute — no img element, kind chip only', async () => {
    const scribe = await mount(
      'agent-kit-agent-persona',
      { org: 'acme', key: 'persona-scribe' },
      '<agent-kit-persona-name>Scribe</agent-kit-persona-name>',
    );
    expect(scribe.querySelector('img')).to.not.exist;
    expect(scribe.querySelector('.agent-kit-persona-kind')?.textContent?.trim()).to.equal('Agent persona');
  });

  it('snapshot metadata renders as chrome chips; without it the strip is absent', async () => {
    const loom = await mount(
      'agent-kit-agent-persona',
      { org: 'acme', key: 'persona-loom', status: 'cached' },
      `<agent-kit-persona-name>Loom</agent-kit-persona-name>
       <script type="application/json">
         { "metadata": { "kind": "orchestrator", "call_sign": "loom" } }
       </script>`,
    );
    const items = [...loom.querySelectorAll('.agent-kit-persona-meta-item')];
    expect(items.map((i) => i.textContent?.replace(/\s+/g, ' ').trim())).to.deep.equal([
      'kind orchestrator',
      'call_sign loom',
    ]);

    const bare = await mount(
      'agent-kit-agent-persona',
      { org: 'acme', key: 'persona-scribe' },
      '<agent-kit-persona-name>Scribe</agent-kit-persona-name>',
    );
    expect(bare.querySelector('.agent-kit-persona-meta')).to.not.exist;
  });

  it('extraction reads the authored record — chrome text (kind chip) never leaks', async () => {
    await mount(
      'agent-kit-user-persona',
      { org: 'acme', key: 'persona-ada', kind: 'persona', avatar: 'https://example.test/ada.png' },
      ADA_BODY,
    );
    const records = extractRecords(document);
    const personas = records.filter((r) => r.type === 'agent-kit-user-persona');
    expect(personas.length).to.equal(1);
    const text = personas[0].text ?? '';
    expect(text).to.contain('Ada Lovelace');
    expect(text).to.contain('Product manager');
    expect(text).to.contain('team: authoring');
    expect(text).not.to.contain('User persona');
    expect(text).not.to.contain('ada.png');
  });
});
