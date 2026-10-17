// @vitest-environment happy-dom
// Unit spec — src/lit/sem-tag-def.ts + src/lit/sem-api-call.ts · the
// reference-definition cards, and their extraction records
// (spec/schema/sem-tag-def.md, spec/schema/sem-api-call.md).
//
// Feature: a markup-tag / API-call definition renders as a card and
//          extracts as one structured record
//   Scenario: sem-tag-def renders head, description, an attribute table row per sem-tag-attr, children chips
//   Scenario: the authored attr rows retire once the table carries them
//   Scenario: class-form documents keep the authored markup (no claim, no card)
//   Scenario: sem-api-call renders the METHOD endpoint head and per-in group tables
//   Scenario: extraction — sem-tag-def mints one record with tag/name/group/children/attributes
//   Scenario: extraction — sem-api-call mints one record with method uppercased and ordered params

import { describe, it, expect } from 'vitest';
import { SemTagDef } from '../../src/lit/sem-tag-def.js';
import { SemApiCall } from '../../src/lit/sem-api-call.js';
import { extractRecords } from '../../src/extract/records.js';

async function mount<T extends Element>(ctor: abstract new (...args: never[]) => Element, tag: string, html: string, attrs: Record<string, string> = {}): Promise<T> {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = html;
  document.body.appendChild(el);
  // happy-dom races its custom-element pipeline (see sem-facts.test.ts):
  // the instanceof read flushes the prototype swap; the macrotask then
  // delivers connectedCallback and the update settles.
  if (!(el instanceof ctor)) customElements.upgrade(el);
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as unknown as T;
}

describe('sem-tag-def card', () => {
  it('renders head, description, one table row per attr, children chips', async () => {
    const el = await mount<SemTagDef>(SemTagDef, 'sem-tag-def', `
      An inline annotation with an optional variant.
      <sem-tag-attr name="variant" type="string" allowed="tip,warning,danger" default="tip">Display variant.</sem-tag-attr>
      <sem-tag-attr name="collapsed" type="boolean" required>Starts hidden.</sem-tag-attr>`,
      { tag: 'sem-note', name: 'Note', group: 'annotation', children: 'sem-note-summary sem-note-body' });
    const head = el.querySelector('.sem-tagdef-head')!;
    expect(head.querySelector('.sem-tagdef-tag')!.textContent).toBe('sem-note');
    expect(head.querySelector('.sem-tagdef-name')!.textContent).toBe('Note');
    expect(head.querySelector('.sem-tagdef-group')!.textContent).toBe('annotation');
    expect(el.querySelector('.sem-tagdef-desc')!.textContent).toContain('inline annotation');
    const rows = Array.from(el.querySelectorAll('.sem-tagdef-table tbody tr'));
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector('.sem-tagdef-cell-name')!.textContent).toBe('variant');
    expect(rows[0]!.querySelector('.sem-tagdef-cell-type')!.textContent).toBe('string');
    expect(rows[0]!.querySelector('.sem-tagdef-cell-required')!.textContent).toBe('optional');
    expect(rows[0]!.querySelector('.sem-tagdef-cell-default')!.textContent).toBe('tip');
    expect(rows[0]!.querySelector('.sem-tagdef-cell-allowed')!.textContent).toBe('tip, warning, danger');
    expect(rows[1]!.querySelector('.sem-tagdef-cell-required')!.textContent).toBe('required');
    expect(el.querySelector('.sem-tagdef-child')!.textContent).toBe('sem-note-summary');
    expect(el.querySelectorAll('.sem-tagdef-child').length).toBe(2);
    expect(el.shadowRoot).toBeNull(); // light DOM
  });

  it('hides the authored attr rows once the table carries them (extraction parity)', async () => {
    const el = await mount<SemTagDef>(SemTagDef, 'sem-tag-def',
      'Body text. <sem-tag-attr name="variant">Display variant.</sem-tag-attr>',
      { tag: 'sem-note' });
    const row = el.querySelector('sem-tag-attr')!;
    expect(row.hasAttribute('hidden')).toBe(true); // display retired…
    expect(row.classList.contains('sem-tagdef-source')).toBe(true); // …as chrome…
    expect(row.getAttribute('name')).toBe('variant'); // …markup intact
    expect(el.querySelectorAll('.sem-tagdef-table tbody tr').length).toBe(1);
  });

  it('class-form documents keep the authored markup', () => {
    const el = document.createElement('div');
    el.className = 'sem-tag-def';
    el.setAttribute('data-tag', 'sem-note');
    el.innerHTML = '<div class="sem-tag-attr" data-name="variant">Display variant.</div>';
    document.body.appendChild(el);
    expect(el.hasAttribute('data-sem-upgraded')).toBe(false);
    expect(el.querySelector('.sem-tag-attr')).not.toBeNull();
    el.remove();
  });
});

describe('sem-api-call card', () => {
  it('renders the METHOD endpoint head and per-in group tables in order', async () => {
    const el = await mount<SemApiCall>(SemApiCall, 'sem-api-call', `
      Exchanges a grant for a token pair.
      <sem-api-param name="grant_type" in="body" type="string" required>The grant.</sem-api-param>
      <sem-api-param name="ttl" in="response" type="integer">Lifetime seconds.</sem-api-param>
      <sem-api-param name="ver" in="header" type="string">API version.</sem-api-param>
      <sem-api-param name="expand" in="query" allowed="items,owner">Relationship to expand.</sem-api-param>`,
      { name: 'Create token', method: 'post', endpoint: '/oauth/token', status: '200' });
    const head = el.querySelector('.sem-apicall-head')!;
    expect(head.querySelector('.sem-apicall-method')!.textContent).toBe('POST'); // authored lowercase, rendered uppercased
    expect(head.querySelector('.sem-apicall-endpoint')!.textContent).toBe('/oauth/token');
    expect(head.querySelector('.sem-apicall-name')!.textContent).toBe('Create token');
    expect(head.querySelector('.sem-apicall-status')!.textContent).toBe('200');
    const labels = Array.from(el.querySelectorAll('.sem-apicall-group-label')).map((l) => l.textContent);
    expect(labels).toEqual(['query', 'header', 'body', 'response']);
    const sourceRow = el.querySelector('sem-api-param')!;
    expect(sourceRow.hasAttribute('hidden')).toBe(true);
    expect(sourceRow.classList.contains('sem-apicall-source')).toBe(true);
    const firstRow = el.querySelector('.sem-apicall-group-query tbody tr')!;
    expect(firstRow.querySelector('.sem-apicall-cell-name')!.textContent).toBe('expand');
    expect(firstRow.querySelector('.sem-apicall-cell-allowed')!.textContent).toBe('items, owner');
  });

  it('defaults the method chip to GET', async () => {
    const el = await mount<SemApiCall>(SemApiCall, 'sem-api-call', 'List tokens.',
      { name: 'List tokens', endpoint: '/tokens' });
    expect(el.querySelector('.sem-apicall-method')!.textContent).toBe('GET');
  });
});

describe('reference-definition extraction', () => {
  it('sem-tag-def mints one record with tag/name/group/children/attributes', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <sem-tag-def id="d1" tag="sem-note" name="Note" group="annotation" children="sem-note-summary">
        An inline annotation.
        <sem-tag-attr name="variant" type="string" allowed="tip,warning" default="tip">Display variant.</sem-tag-attr>
        <sem-tag-attr name="collapsed" required>Starts hidden.</sem-tag-attr>
      </sem-tag-def>`;
    const records = extractRecords(host).filter((r) => r.type === 'sem-tag-def');
    expect(records.length).toBe(1);
    const r = records[0]!;
    expect(r.fields.tag).toBe('sem-note');
    expect(r.fields.name).toBe('Note');
    expect(r.fields.group).toBe('annotation');
    expect(r.fields.children).toEqual(['sem-note-summary']);
    const attrs = r.fields.attributes as Array<Record<string, unknown>>;
    expect(attrs.length).toBe(2);
    expect(attrs[0]).toMatchObject({
      name: 'variant', type: 'string', required: false, default: 'tip',
      allowed: ['tip', 'warning'], description: 'Display variant.',
    });
    expect(attrs[1]).toMatchObject({ name: 'collapsed', required: true });
    expect(r.text).toBe('sem-note (Note) — An inline annotation.');
    expect(host.textContent).toContain('An inline annotation'); // extraction is DOM-pure
  });

  it('sem-api-call mints one record with the method uppercased and ordered params', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <sem-api-call id="a1" name="Create token" method="post" endpoint="/oauth/token" status="200">
        Exchanges a grant for a token pair.
        <sem-api-param name="grant_type" in="body" type="string" required allowed="authorization_code,refresh_token">The grant to exchange.</sem-api-param>
        <sem-api-param name="ttl" in="response" type="integer">Access-token lifetime in seconds.</sem-api-param>
      </sem-api-call>`;
    const records = extractRecords(host).filter((r) => r.type === 'sem-api-call');
    expect(records.length).toBe(1);
    const r = records[0]!;
    expect(r.fields).toMatchObject({ name: 'Create token', method: 'POST', endpoint: '/oauth/token', status: '200' });
    const params = r.fields.params as Array<Record<string, unknown>>;
    expect(params.length).toBe(2);
    expect(params[0]).toMatchObject({
      name: 'grant_type', in: 'body', type: 'string', required: true,
      allowed: ['authorization_code', 'refresh_token'], description: 'The grant to exchange.',
    });
    expect(params[1]).toMatchObject({ name: 'ttl', in: 'response', type: 'integer', required: false });
    expect(r.text).toBe('Create token — POST /oauth/token — Exchanges a grant for a token pair.');
  });
});
