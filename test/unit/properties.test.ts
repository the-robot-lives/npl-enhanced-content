// @vitest-environment happy-dom
// Unit spec — fallback/properties duplicate-key diagnostic
//
// Feature: a sem-properties container warns on duplicate keys
//   Scenario: duplicate data-key attributes warn, non-fatally
//   Scenario: duplicate bare key attributes warn the same way (the alias
//             the reading bundle and the conventions examples use)
//   Scenario: distinct keys stay silent
//   Scenario: keyless properties are ignored
//   Scenario: duplicates across both spellings count as one key space
//   Scenario: nested containers warn once per duplicate, not per container
//
// The message text is asserted /duplicate/i by test/e2e/sem-properties.cy.js;
// these unit specs pin the same contract without a browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enhanceProperties } from '../../src/vanilla/properties.js';

let warnings: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

const doc = document;

function container(html: string): HTMLElement {
  const div = doc.createElement('div');
  div.innerHTML = html;
  doc.body.appendChild(div);
  return div;
}

beforeEach(() => {
  warnings = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  doc.body.innerHTML = '';
});

describe('vanilla properties duplicate-key diagnostic', () => {
  it('warns once per duplicated data-key, rendering everything', () => {
    const el = container(
      '<sem-properties>' +
        '<sem-property data-key="scope">durable</sem-property>' +
        '<sem-property data-key="scope">control</sem-property>' +
        '<sem-property data-key="ttl">short</sem-property>' +
        '</sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/duplicate/i);
    expect(warnings[0]).toContain('"scope"');
    // non-fatal: all three properties remain in the DOM
    expect(el.querySelectorAll('sem-property')).toHaveLength(3);
  });

  it('warns for the bare key alias too, naming the same contract', () => {
    const el = container(
      '<sem-properties>' +
        '<sem-property key="issuer">auth server</sem-property>' +
        '<sem-property key="issuer">token endpoint</sem-property>' +
        '</sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/duplicate/i);
    expect(warnings[0]).toContain('"issuer"');
  });

  it('stays silent when every key is distinct', () => {
    const el = container(
      '<sem-properties>' +
        '<sem-property data-key="a">1</sem-property>' +
        '<sem-property key="b">2</sem-property>' +
        '</sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(0);
  });

  it('ignores properties with no key at all', () => {
    const el = container(
      '<sem-properties><sem-property>prose only</sem-property></sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(0);
  });

  it('treats both spellings as one key space', () => {
    const el = container(
      '<sem-properties>' +
        '<sem-property data-key="aud">who reads it</sem-property>' +
        '<sem-property key="aud">same key, aliased</sem-property>' +
        '</sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/duplicate/i);
  });

  it('reports each duplicate across separate containers', () => {
    const el = container(
      '<sem-properties>' +
        '<sem-property data-key="k">v</sem-property>' +
        '<sem-property data-key="k">v2</sem-property>' +
        '</sem-properties>' +
        '<sem-properties>' +
        '<sem-property data-key="j">v</sem-property>' +
        '<sem-property data-key="j">v2</sem-property>' +
        '</sem-properties>',
    );
    enhanceProperties(el);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"k"');
    expect(warnings[1]).toContain('"j"');
  });
});
