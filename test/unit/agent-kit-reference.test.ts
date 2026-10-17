// @vitest-environment happy-dom
// Unit spec — the reference cards (agent-kit-organization /
// agent-kit-project) + agent-kit-chatroom · the family C reference
// contracts (spec/schema/agent-kit/reference-cards.md, chatroom.md)
//
// Feature: reference cards and the cached chatroom render authored
//          records with slug/label chrome
//   Scenario: the three tags register under the agent-kit namespace (defineAkit)
//   Scenario: the authored body IS the record — name/description and messages survive upgrade
//   Scenario: chrome derives from the tag — kind chips and the slug footer links
//   Scenario: chatroom chrome counts messages; snapshot stamps render from cached JSON
//   Scenario: extraction reads the authored records — chips, footers, author labels never leak

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

const ORG_BODY = `
  <agent-kit-name>Acme Corporation</agent-kit-name>
  <agent-kit-description>The umbrella org.</agent-kit-description>
`;

const PROJECT_BODY = `
  <agent-kit-name>SemText</agent-kit-name>
  <agent-kit-description>The XHTML-first spec kit.</agent-kit-description>
`;

const ROOM_BODY = `
  <agent-kit-chatroom-name>Authoring stand-up</agent-kit-chatroom-name>
  <agent-kit-chat-msg author="Ada" role="user" at="2026-10-17T09:00:00Z">Board's wired.</agent-kit-chat-msg>
  <agent-kit-chat-msg author="Loom" role="assistant" at="2026-10-17T09:01:00Z">Watched.</agent-kit-chat-msg>
  <script type="application/json">{ "updated_at": "2026-10-17T09:05:00Z" }</script>
`;

const notChrome = (el: HTMLElement): HTMLElement[] =>
  [...el.children].filter(
    (c) => !c.classList.contains('agent-kit-chrome') && !c.classList.contains('sem-cached-embed-chrome'),
  ) as HTMLElement[];

describe('agent-kit reference cards + chatroom (sub-batch 5)', () => {
  it('the three tags register and extend CachedEmbedElement', () => {
    for (const tag of ['agent-kit-organization', 'agent-kit-project', 'agent-kit-chatroom']) {
      const Ctor = customElements.get(tag);
      expect(Ctor, `customElements.get(${tag})`).to.exist;
      const el = document.createElement(tag) as HTMLElement;
      expect(el).to.be.instanceOf(CachedEmbedElement);
      el.remove();
    }
  });

  it('the authored body IS the record — cards and messages survive upgrade', async () => {
    const org = await mount('agent-kit-organization', { org: 'acme' }, ORG_BODY);
    expect(notChrome(org).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-name',
      'agent-kit-description',
    ]);
    const room = await mount('agent-kit-chatroom', { org: 'acme', key: 'room' }, ROOM_BODY);
    expect(notChrome(room).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-chatroom-name',
      'agent-kit-chat-msg',
      'agent-kit-chat-msg',
      'script',
    ]);
    expect(room.querySelectorAll('agent-kit-chat-msg').length).to.equal(2);
  });

  it('chrome derives from the tag — kind chips and the slug footer links', async () => {
    const org = await mount('agent-kit-organization', { org: 'acme' }, ORG_BODY);
    expect(org.querySelector('.agent-kit-reference-kind')?.textContent?.trim()).to.equal('Organization');
    expect(org.querySelector('a.agent-kit-reference-open')?.getAttribute('href')).to.equal('/app/acme');

    const project = await mount('agent-kit-project', { org: 'acme', key: 'semtext' }, PROJECT_BODY);
    expect(project.querySelector('.agent-kit-reference-kind')?.textContent?.trim()).to.equal('Project');
    expect(project.querySelector('a.agent-kit-reference-open')?.getAttribute('href')).to.equal(
      '/app/acme/projects/semtext',
    );

    // no org — no footer, chip only
    const bare = await mount('agent-kit-project', { key: 'orphan' }, PROJECT_BODY);
    expect(bare.querySelector('a.agent-kit-reference-open')).to.not.exist;
    expect(bare.querySelector('.agent-kit-reference-kind')?.textContent?.trim()).to.equal('Project');
  });

  it('chatroom chrome counts messages; snapshot stamps render from cached JSON', async () => {
    const room = await mount('agent-kit-chatroom', { org: 'acme', key: 'room', status: 'cached' }, ROOM_BODY);
    const chip = room.querySelector('.agent-kit-chatroom-chip');
    expect(chip).to.exist;
    expect(chip?.getAttribute('data-message-count')).to.equal('2');
    expect(chip?.textContent).to.contain('Chatroom · 2 messages');
    const stamp = room.querySelector('.agent-kit-chatroom-snapshot time');
    expect(stamp?.getAttribute('datetime')).to.equal('2026-10-17T09:05:00Z');

    const bare = await mount(
      'agent-kit-chatroom',
      { org: 'acme', key: 'room' },
      '<agent-kit-chat-msg author="Ada" role="user">hi</agent-kit-chat-msg>',
    );
    expect(bare.querySelector('.agent-kit-chatroom-snapshot')).to.not.exist;
    expect(bare.querySelector('.agent-kit-chatroom-chip')?.textContent).to.contain('1 message');
  });

  it('extraction reads the authored records — chips, footers, author labels never leak', async () => {
    await mount('agent-kit-organization', { org: 'acme', kind: 'reference' }, ORG_BODY);
    await mount('agent-kit-project', { org: 'acme', key: 'semtext', kind: 'reference' }, PROJECT_BODY);
    await mount('agent-kit-chatroom', { org: 'acme', key: 'room', kind: 'chatroom' }, ROOM_BODY);
    const records = extractRecords(document);
    const by = (t: string) => records.filter((r) => r.type === t);
    expect(by('agent-kit-organization').length).to.equal(1);
    expect(by('agent-kit-project').length).to.equal(1);
    expect(by('agent-kit-chatroom').length).to.equal(1);

    const orgText = by('agent-kit-organization')[0].text ?? '';
    expect(orgText).to.contain('Acme Corporation');
    expect(orgText).not.to.contain('Organization');
    expect(orgText).not.to.contain('Open in agent-kit');

    const roomText = by('agent-kit-chatroom')[0].text ?? '';
    expect(roomText).to.contain("Board's wired");
    expect(roomText).to.contain('Watched');
    // author labels + chrome never leak
    expect(roomText).not.to.contain('Ada:');
    expect(roomText).not.to.contain('Chatroom ·');
    expect(roomText).not.to.contain('snapshot ·');
  });
});
