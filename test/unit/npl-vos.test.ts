// @vitest-environment happy-dom
// Unit spec — npl-vos, the vector-of-self bracket (src/lit/npl/npl-vos.ts)
//
// Feature: an NPL vos block renders as a display-only bracket
//          (recipe: src/lit/npl/index.ts header)
//   Scenario: importing the barrel registers npl-vos
//   Scenario: npl-vos upgrades in light DOM; authored children survive inside row bodies
//   Scenario: the phase attribute renders as the bracket label and mirrors to data-phase
//   Scenario: parts render as labelled rows in canonical order regardless of authored order
//   Scenario: without a phase attribute no phase label is rendered
//   Scenario: parts authored with the bare vos spelling render like data-vos
//   Scenario: parts streamed in after upgrade are still picked up

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NplVos } from '../../src/lit/npl/npl-vos.js';

describe('npl-vos', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <npl-vos id="vos" phase="entry">
        <p data-vos="collective">fleet-level view of the task</p>
        <p data-vos="id">dive into the optimization</p>
        <p data-vos="ego">profile first, then targeted fixes</p>
        <p data-vos="mood">🔥 — energized</p>
        <p data-vos="super-ego">measure before optimizing</p>
      </npl-vos>
      <npl-vos id="bare" >
        <span vos="ego">bare-spelling part</span>
      </npl-vos>
      <npl-vos id="data" data-phase="exit">
        <p data-vos="id">data-spelling phase</p>
      </npl-vos>
      <npl-vos id="late"></npl-vos>`;
  });

  it('the barrel registers npl-vos', async () => {
    await import('../../src/lit/npl/index.js');
    expect(customElements.get('npl-vos')).toBe(NplVos);
  });

  it('upgrades in light DOM; authored children survive inside row bodies', async () => {
    const el = document.getElementById('vos') as NplVos;
    await el.updateComplete;
    expect(el).toBeInstanceOf(NplVos);
    expect(el.shadowRoot).toBeNull();
    expect(el.hasAttribute('data-sem-upgraded')).toBe(true);
    const authored = el.querySelector('p[data-vos="ego"]');
    expect(authored?.textContent).toBe('profile first, then targeted fixes');
    expect(authored?.closest('.npl-vos-row-body')).not.toBeNull();
  });

  it('renders the phase attribute as the bracket label and mirrors it to data-phase', async () => {
    const el = document.getElementById('vos') as NplVos;
    await el.updateComplete;
    expect(el.querySelector(':scope > .npl-vos-phase')?.textContent).toBe('entry');
    expect(el.getAttribute('data-phase')).toBe('entry');
  });

  it('renders parts as labelled rows in canonical order regardless of authored order', async () => {
    const el = document.getElementById('vos') as NplVos;
    await el.updateComplete;
    const rows = el.querySelectorAll(':scope > .npl-vos-row');
    expect([...rows].map((r) => r.getAttribute('data-vos-row'))).toEqual([
      'id',
      'ego',
      'mood',
      'super-ego',
      'collective',
    ]);
    const first = rows[0];
    expect(first.querySelector('.npl-vos-row-label')?.textContent).toBe('id');
    expect(first.querySelector('.npl-vos-row-body')?.textContent).toBe(
      'dive into the optimization',
    );
    // phase label still leads the bracket
    expect(el.firstElementChild?.classList.contains('npl-vos-phase')).toBe(true);
  });

  it('without a phase attribute no phase label is rendered', async () => {
    const el = document.getElementById('bare') as NplVos;
    await el.updateComplete;
    expect(el.querySelector(':scope > .npl-vos-phase')).toBeNull();
  });

  it('reads the bare vos spelling like data-vos', async () => {
    const el = document.getElementById('bare') as NplVos;
    await el.updateComplete;
    const rows = el.querySelectorAll(':scope > .npl-vos-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-vos-row')).toBe('ego');
    expect(rows[0].querySelector('.npl-vos-row-label')?.textContent).toBe('ego');
  });

  it('picks up parts streamed in after upgrade', async () => {
    const el = document.getElementById('late') as NplVos;
    await el.updateComplete;
    expect(el.querySelectorAll(':scope > .npl-vos-row')).toHaveLength(0);
    const part = document.createElement('p');
    part.setAttribute('data-vos', 'id');
    part.textContent = 'late impulse';
    el.appendChild(part);
    // observer → requestUpdate is asynchronous; wait for the assemble pass
    await vi.waitFor(() => {
      expect(el.querySelectorAll(':scope > .npl-vos-row')).toHaveLength(1);
    });
    const rows = el.querySelectorAll(':scope > .npl-vos-row');
    expect(rows[0].querySelector('.npl-vos-row-body')?.textContent).toBe('late impulse');
  });

  it('carries no data-phase when no phase is authored — the class-form alias must not false-match', async () => {
    const el = document.getElementById('bare') as NplVos;
    await el.updateComplete;
    // the old mirror wrote data-phase="" for every phase-less vos, which
    // matched `.npl-vos[data-phase]`; absent means absent now
    expect(el.hasAttribute('data-phase')).toBe(false);
    expect(el.querySelector(':scope > .npl-vos-phase')).toBeNull();
  });

  it('reads the authored data-phase spelling and never clobbers it', async () => {
    const el = document.getElementById('data') as NplVos;
    await el.updateComplete;
    expect(el.getAttribute('data-phase')).toBe('exit');
    expect(el.querySelector(':scope > .npl-vos-phase')?.textContent).toBe('exit');
  });

  it('keeps the phase label and mirror live after assembly', async () => {
    const el = document.getElementById('vos') as NplVos;
    await el.updateComplete;
    expect(el.querySelector(':scope > .npl-vos-phase')?.textContent).toBe('entry');
    el.setAttribute('phase', 'exit');
    await el.updateComplete;
    // assembly never re-runs once parts are wrapped; the label sync does
    expect(el.querySelector(':scope > .npl-vos-phase')?.textContent).toBe('exit');
    expect(el.getAttribute('data-phase')).toBe('exit');
    // the data- spelling still wins (dual-form contract), so dropping the
    // losing spelling alone cannot clear the phase
    el.removeAttribute('phase');
    await el.updateComplete;
    expect(el.getAttribute('data-phase')).toBe('exit');
    expect(el.querySelector(':scope > .npl-vos-phase')?.textContent).toBe('exit');
    // the observed path: an empty authored phase clears label and mirror
    // together — never an empty phase mark. (A hand-removed data-phase is
    // picked up on the element's next update; it observes `phase` only,
    // like the npl-section mirror.)
    el.setAttribute('phase', '');
    await el.updateComplete;
    expect(el.querySelector(':scope > .npl-vos-phase')).toBeNull();
    expect(el.hasAttribute('data-phase')).toBe(false);
  });
});
