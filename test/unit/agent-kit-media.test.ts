// @vitest-environment happy-dom
// Unit spec — the media cards (agent-kit-asset / agent-kit-artifact /
// agent-kit-review) · the family C media contracts (spec/schema/
// agent-kit/{asset,artifact,review}.md)
//
// Feature: the media cards promote the sem-media-gallery /
//          sem-artifact-card / sem-review-canvas shapes to cached embeds
//   Scenario: the three tags register under the agent-kit namespace (defineAkit)
//   Scenario: authored captions, content and comments survive upgrade — the record
//   Scenario: chrome derives from attributes — mime/type/verdict chips and the version list
//   Scenario: snapshot stamps render from cached JSON only
//   Scenario: extraction reads the authored records — chips, stamps, author labels never leak

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

const ASSET_BODY = `<agent-kit-caption>The board cover.</agent-kit-caption>`;
const ARTIFACT_BODY = `
  <agent-kit-artifact-content># Extraction spec

The record is the authored body.</agent-kit-artifact-content>
  <script type="application/json">{
    "updated_at": "2026-10-17T12:00:00Z",
    "versions": [
      { "id": "v1", "label": "v1 — draft", "createdAt": "2026-10-16T09:00:00Z" },
      { "id": "v2", "label": "v2 — review", "createdAt": "2026-10-17T12:00:00Z" }
    ]
  }</script>
`;
const REVIEW_BODY = `
  <agent-kit-comment author="Ada" at="2026-10-17T10:00:00Z">Shipping it.</agent-kit-comment>
  <agent-kit-comment author="Loom" at="2026-10-17T10:05:00Z">Anchors hold.</agent-kit-comment>
`;

const notChrome = (el: HTMLElement): HTMLElement[] =>
  [...el.children].filter(
    (c) => !c.classList.contains('agent-kit-chrome') && !c.classList.contains('sem-cached-embed-chrome'),
  ) as HTMLElement[];

describe('agent-kit media cards (sub-batch 6)', () => {
  it('the three tags register and extend CachedEmbedElement', () => {
    for (const tag of ['agent-kit-asset', 'agent-kit-artifact', 'agent-kit-review']) {
      const Ctor = customElements.get(tag);
      expect(Ctor, `customElements.get(${tag})`).to.exist;
      const el = document.createElement(tag) as HTMLElement;
      expect(el).to.be.instanceOf(CachedEmbedElement);
      el.remove();
    }
  });

  it('authored captions, content and comments survive upgrade — the record', async () => {
    const asset = await mount('agent-kit-asset', { src: 'data:image/svg+xml,x', mime: 'image/svg+xml' }, ASSET_BODY);
    expect(notChrome(asset).map((c) => c.tagName.toLowerCase())).to.deep.equal(['agent-kit-caption']);

    const artifact = await mount('agent-kit-artifact', { type: 'markdown' }, ARTIFACT_BODY);
    expect(notChrome(artifact).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-artifact-content',
      'script',
    ]);
    expect(artifact.querySelector('agent-kit-artifact-content')?.textContent).to.contain('authored body');

    const review = await mount('agent-kit-review', { verdict: 'approve' }, REVIEW_BODY);
    expect(notChrome(review).map((c) => c.tagName.toLowerCase())).to.deep.equal([
      'agent-kit-comment',
      'agent-kit-comment',
    ]);
  });

  it('chrome derives from attributes — mime/type/verdict chips and the version list', async () => {
    const asset = await mount('agent-kit-asset', { src: 'data:image/svg+xml,x', mime: 'image/svg+xml' }, ASSET_BODY);
    expect(asset.querySelector('img.agent-kit-asset-image')?.getAttribute('src')).to.equal('data:image/svg+xml,x');
    expect(asset.querySelector('.agent-kit-asset-mime')?.textContent?.trim()).to.equal('image/svg+xml');
    // no src — no image element, ever
    const bare = await mount('agent-kit-asset', {}, ASSET_BODY);
    expect(bare.querySelector('img')).to.not.exist;
    expect(bare.querySelector('.agent-kit-asset-mime')).to.not.exist;

    const artifact = await mount('agent-kit-artifact', { type: 'markdown' }, ARTIFACT_BODY);
    expect(artifact.querySelector('.agent-kit-artifact-type')?.textContent?.trim()).to.equal('markdown');
    expect([...artifact.querySelectorAll('.agent-kit-artifact-version')].map((v) => v.textContent?.trim())).to.deep.equal([
      'v1 — draft · 2026-10-16',
      'v2 — review · 2026-10-17',
    ]);

    const review = await mount('agent-kit-review', { verdict: 'approve' }, REVIEW_BODY);
    expect(review.querySelector('.agent-kit-review-verdict')?.getAttribute('data-verdict')).to.equal('approve');
    expect(review.querySelector('.agent-kit-review-verdict')?.textContent?.trim()).to.equal('Approved');
    expect(review.querySelector('.agent-kit-review-count')?.textContent?.trim()).to.equal('2 comments');
    const pending = await mount('agent-kit-review', {}, '<agent-kit-comment author="Ada">hi</agent-kit-comment>');
    expect(pending.querySelector('.agent-kit-review-verdict')?.getAttribute('data-verdict')).to.equal('pending');
    expect(pending.querySelector('.agent-kit-review-verdict')?.textContent?.trim()).to.equal('Pending review');
    expect(pending.querySelector('.agent-kit-review-count')?.textContent?.trim()).to.equal('1 comment');
  });

  it('snapshot stamps render from cached JSON only', async () => {
    const artifact = await mount('agent-kit-artifact', { type: 'markdown' }, ARTIFACT_BODY);
    const stamp = artifact.querySelector('time');
    expect(stamp?.getAttribute('datetime')).to.equal('2026-10-17T12:00:00Z');

    const review = await mount(
      'agent-kit-review',
      { verdict: 'approve' },
      `${REVIEW_BODY}<script type="application/json">{ "updated_at": "2026-10-17T11:00:00Z" }</script>`,
    );
    expect(review.querySelector('.agent-kit-review-snapshot time')?.getAttribute('datetime')).to.equal(
      '2026-10-17T11:00:00Z',
    );

    // no snapshot — no stamp (asset has none at all)
    const bareAsset = await mount('agent-kit-asset', { src: 'data:image/svg+xml,x' }, ASSET_BODY);
    expect(bareAsset.querySelector('time')).to.not.exist;
  });

  it('extraction reads the authored records — chips, stamps, author labels never leak', async () => {
    await mount('agent-kit-asset', { src: 'data:image/svg+xml,x', mime: 'image/svg+xml', kind: 'asset' }, ASSET_BODY);
    await mount('agent-kit-artifact', { type: 'markdown', kind: 'artifact' }, ARTIFACT_BODY);
    await mount('agent-kit-review', { verdict: 'approve', kind: 'review' }, REVIEW_BODY);
    const records = extractRecords(document);
    const by = (t: string) => records.filter((r) => r.type === t);
    expect(by('agent-kit-asset').length).to.equal(1);
    expect(by('agent-kit-artifact').length).to.equal(1);
    expect(by('agent-kit-review').length).to.equal(1);

    const assetText = by('agent-kit-asset')[0].text ?? '';
    expect(assetText).to.contain('The board cover.');
    expect(assetText).not.to.contain('image/svg+xml');

    const artifactText = by('agent-kit-artifact')[0].text ?? '';
    expect(artifactText).to.contain('authored body');
    expect(artifactText).not.to.contain('v1 — draft');
    expect(artifactText).not.to.contain('updated_at');

    const reviewText = by('agent-kit-review')[0].text ?? '';
    expect(reviewText).to.contain('Shipping it.');
    expect(reviewText).not.to.contain('Ada:');
    expect(reviewText).not.to.contain('Approved');
    expect(reviewText).not.to.contain('2 comments');
  });
});
