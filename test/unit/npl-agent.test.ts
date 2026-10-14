// @vitest-environment happy-dom
// Unit spec — npl-agent, the agent definition card (src/lit/npl/npl-agent.ts)
//
// Feature: npl-agent renders an NPL agent definition as a display-only card
//          (contract: spec/schema/npl/npl-agent.md)
//   Scenario: importing the barrel registers npl-agent
//   Scenario: the card upgrades with light DOM — no shadow root, authored prose survives
//   Scenario: the header renders name, type and version, before the body prose
//   Scenario: an authored extends parent appears in the header; absent renders none
//   Scenario: attributes mirror to the data-* spelling after upgrade
//   Scenario: data-* authored spellings win in the rendered header

import { describe, it, expect, beforeEach } from 'vitest';
import { NplAgent } from '../../src/lit/npl/npl-agent.js';
import '../../src/lit/npl/index.js';

describe('npl-agent', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<npl-agent id="a" name="scout" type="scout" version="0.3" extends="base-agent">' +
      'Description <em>prose</em> and behavioural spec.</npl-agent>';
  });

  it('the barrel registers npl-agent', async () => {
    const npl = await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-agent')).toBe(NplAgent);
    expect(typeof npl.defineNpl).toBe('function');
  });

  it('upgrades with light DOM — no shadow root, authored prose survives', async () => {
    const el = document.getElementById('a') as NplAgent;
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplAgent);
    expect(el.shadowRoot).toBeNull();
    expect(el.getAttribute('data-sem-upgraded')).toBe('');
    // the body is never wrapped or moved — authored children stay as they are
    expect(el.querySelector(':scope > em')?.textContent).toBe('prose');
  });

  it('renders the header — name, type, version — before the body prose', async () => {
    const el = document.getElementById('a') as NplAgent;
    await el.updateComplete;
    const header = el.querySelector(':scope > .npl-agent-header');
    expect(header).not.toBeNull();
    expect(el.querySelector('.npl-agent-name')?.textContent).toBe('scout');
    expect(el.querySelector('.npl-agent-type')?.textContent).toBe('scout');
    expect(el.querySelector('.npl-agent-version')?.textContent).toBe('0.3');
    // generated chrome precedes the authored body (header, then prose)
    expect(el.firstElementChild).toBe(header);
    expect(header!.compareDocumentPosition(el.querySelector('em')!) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an authored extends parent; absent renders no extends part', async () => {
    const el = document.getElementById('a') as NplAgent;
    await el.updateComplete;
    expect(el.querySelector('.npl-agent-extends')?.textContent).toBe('base-agent');

    document.body.innerHTML =
      '<npl-agent id="b" name="coder" type="coder" version="1.0">prose</npl-agent>';
    const bare = document.getElementById('b') as NplAgent;
    await bare.updateComplete;
    expect(bare.querySelector('.npl-agent-extends')).toBeNull();
  });

  it('mirrors the attributes to the data-* spelling after upgrade', async () => {
    const el = document.getElementById('a') as NplAgent;
    await el.updateComplete;
    expect(el.getAttribute('data-name')).toBe('scout');
    expect(el.getAttribute('data-type')).toBe('scout');
    expect(el.getAttribute('data-version')).toBe('0.3');
    expect(el.getAttribute('data-extends')).toBe('base-agent');
  });

  it('data-* authored spellings win in the rendered header — and are never clobbered', async () => {
    document.body.innerHTML =
      '<npl-agent id="c" name="scout" data-name="renamed" version="0.3" type="scout">' +
      'prose</npl-agent>';
    const el = document.getElementById('c') as NplAgent;
    await el.updateComplete;
    expect(el.querySelector('.npl-agent-name')?.textContent).toBe('renamed');
    // the mirror writes the resolved value — the authored data-* spelling
    // survives (conventions §2: data-* wins when both spellings are present)
    expect(el.getAttribute('data-name')).toBe('renamed');

    // a data-* spelling authored WITHOUT its bare twin must not be
    // overwritten by the empty default either
    document.body.innerHTML =
      '<npl-agent id="d" data-name="renamed" data-type="coder" data-version="1.0">' +
      'prose</npl-agent>';
    const dualOnly = document.getElementById('d') as NplAgent;
    await dualOnly.updateComplete;
    expect(dualOnly.querySelector('.npl-agent-name')?.textContent).toBe('renamed');
    expect(dualOnly.getAttribute('data-name')).toBe('renamed');
    expect(dualOnly.getAttribute('data-type')).toBe('coder');
    expect(dualOnly.getAttribute('data-version')).toBe('1.0');
  });
});
