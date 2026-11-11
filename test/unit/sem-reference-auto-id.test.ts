// @vitest-environment happy-dom
// Unit spec — sem-reference AUTO-ID + footnote chrome · spec/schema/sem-references.md § Auto-id
//
// Feature: an id-less sem-reference answers to <block-id>-<slug(cite)>
//   Scenario: referenceSlug lowercases, collapses non-alnum runs, trims dashes
//   Scenario: referenceId defaults the block id to "refs" and refuses an empty slug
//   Scenario: the validator's plain-JS twin derives the identical slug
//   Scenario: the component mints the id, marks it, numbers the entry, titles it, emits ready
//   Scenario: an authored id always wins
//   Scenario: the reading handler wires backlinks/popover for an auto-id'd ref and links a URL cite
//   Scenario: extraction reports the same derived id with JS off and on

import { describe, it, expect, beforeEach } from 'vitest';
import { referenceSlug, referenceId, deriveReferenceId } from '../../src/shared/reference-id.js';
import { referenceSlugJs } from '../../src/validate/validate.js';
import { SemReference } from '../../src/lit/sem-reference.js';
import '../../src/lit/sem-references.js';
import { enhanceReferencesElement } from '../../src/reading/references.js';
import { extractRecords } from '../../src/extract/records.js';

const CASES: Array<[string, string]> = [
  ['RFC 6749', 'rfc-6749'],
  ['Projects/github-tools/docs/gh-wait.md', 'projects-github-tools-docs-gh-wait-md'],
  ['https://www.rfc-editor.org/rfc/rfc6749', 'https-www-rfc-editor-org-rfc-rfc6749'],
  ['  --Hello,  World!!--  ', 'hello-world'],
  ['Ünïcode §10.4', 'n-code-10-4'],
  ['!!!', ''],
];

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(html: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  host.querySelectorAll('sem-reference, sem-references').forEach((el) => customElements.upgrade(el));
  await tick();
  await tick();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('referenceSlug / referenceId (pure)', () => {
  it.each(CASES)('slug(%j) = %j', (cite, slug) => {
    expect(referenceSlug(cite)).toBe(slug);
  });

  it('the validator twin derives the identical slug', () => {
    for (const [cite] of CASES) expect(referenceSlugJs(cite)).toBe(referenceSlug(cite));
  });

  it('defaults the block id to "refs" and refuses an empty slug', () => {
    expect(referenceId(null, 'RFC 6749')).toBe('refs-rfc-6749');
    expect(referenceId('', 'RFC 6749')).toBe('refs-rfc-6749');
    expect(referenceId('auth-refs', 'RFC 6749')).toBe('auth-refs-rfc-6749');
    expect(referenceId('refs', '!!!')).toBeNull();
  });
});

describe('SemReference component', () => {
  it('mints + marks the id, numbers by position, titles from cite, emits ready', async () => {
    const seen: Array<{ id: string; ordinal: number; minted: boolean }> = [];
    document.addEventListener('sem:reference-ready', (e) => seen.push((e as CustomEvent).detail));
    const host = await mount(`
      <sem-references id="auth">
        <sem-reference cite="RFC 6749">OAuth.</sem-reference>
        <sem-reference id="r-own" cite="RFC 7636">PKCE.</sem-reference>
        <sem-reference href="https://example.com/a">Compat href.</sem-reference>
      </sem-references>`);
    const refs = host.querySelectorAll<HTMLElement>('sem-reference');
    expect(refs[0]).toBeInstanceOf(SemReference);
    expect(refs[0].id).toBe('auth-rfc-6749');
    expect(refs[0].hasAttribute('data-sem-minted-id')).toBe(true);
    expect(refs[0].getAttribute('data-ordinal')).toBe('1');
    expect(refs[0].title).toBe('RFC 6749');
    expect(refs[0].textContent!.trim()).toBe('OAuth.'); // authored content untouched
    // authored id always wins, never marked
    expect(refs[1].id).toBe('r-own');
    expect(refs[1].hasAttribute('data-sem-minted-id')).toBe(false);
    expect(refs[1].getAttribute('data-ordinal')).toBe('2');
    // href is the compat slug source
    expect(refs[2].id).toBe('auth-https-example-com-a');
    expect(refs[2].getAttribute('data-ordinal')).toBe('3');
    expect(seen.map((d) => d.ordinal)).toEqual([1, 2, 3]);
    expect(seen[0]).toEqual({ id: 'auth-rfc-6749', ordinal: 1, minted: true });
    expect(seen[1].minted).toBe(false);
  });

  it('defaults the block id to refs when the container has none', async () => {
    const host = await mount(`<sem-references><sem-reference cite="RFC 6749">x</sem-reference></sem-references>`);
    expect(host.querySelector('sem-reference')!.id).toBe('refs-rfc-6749');
  });
});

describe('reading handler with auto-id refs', () => {
  it('wires backlinks and the external link for an id-less, cite-URL reference', () => {
    document.body.innerHTML = `
      <p><a id="c1" href="#refs-https-www-rfc-editor-org-rfc-rfc6749">[1]</a></p>
      <div class="sem-references" id="refs">
        <div class="sem-reference" data-cite="https://www.rfc-editor.org/rfc/rfc6749">OAuth.</div>
      </div>`;
    const block = document.getElementById('refs')!;
    enhanceReferencesElement(block);
    const ref = block.querySelector('.sem-reference')!;
    expect(ref.id).toBe('refs-https-www-rfc-editor-org-rfc-rfc6749');
    expect(ref.querySelector('.sem-references-link')!.getAttribute('href')).toBe(
      'https://www.rfc-editor.org/rfc/rfc6749',
    );
    expect(ref.querySelectorAll('.sem-references-backlinks a')).toHaveLength(1);
    expect(document.getElementById('c1')!.classList.contains('sem-references-ref')).toBe(true);
    // idempotent: a second pass adds nothing
    enhanceReferencesElement(block);
    expect(ref.querySelectorAll('.sem-references-backlinks a')).toHaveLength(1);
  });

  it('a prose cite gets no external link', () => {
    document.body.innerHTML = `<div class="sem-references"><div class="sem-reference" data-cite="RFC 6749">x</div></div>`;
    const block = document.querySelector('.sem-references')!;
    enhanceReferencesElement(block);
    expect(block.querySelector('.sem-references-link')).toBeNull();
    expect(block.querySelector('.sem-reference')!.id).toBe('refs-rfc-6749');
  });
});

describe('extraction invariant', () => {
  it('reports the derived id identically before and after the upgrade', async () => {
    const html = `<div class="sem-enhanced-document"><div class="sem-references" id="refs">
      <div class="sem-reference" data-cite="RFC 6749">OAuth.</div>
      <div class="sem-reference" id="r-own" data-cite="RFC 7636">PKCE.</div></div></div>`;
    document.body.innerHTML = html;
    const before = extractRecords(document);
    enhanceReferencesElement(document.getElementById('refs')!);
    const after = extractRecords(document);
    expect(after).toEqual(before);
    const ids = before.filter((r) => r.type === 'sem-reference').map((r) => r.id);
    expect(ids).toEqual(['refs-rfc-6749', 'r-own']);
    expect(deriveReferenceId(document.querySelector('.sem-reference')!)).toBe('refs-rfc-6749');
  });
});
