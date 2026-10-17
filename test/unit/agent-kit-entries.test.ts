// @vitest-environment happy-dom
// Unit spec — the agent-kit namespace entries' wiring (src/agent-kit.ts +
// src/lazy/agent-kit.ts), mirroring the semext entry specs.
//
// Feature: an empty namespace still boots honestly
//   Scenario: the full-bundle entry's alias pass runs at boot; a class the
//             (empty) bundle defines nothing for stays authored prose
//   Scenario: the lazy entry's boot pattern sweeps only `agent-kit-*` and
//             the stub manifest's chunk 404s land the report-don't-throw path

import { describe, it, expect, beforeAll } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
const tickUntil = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 250 && !cond(); i++) await tick();
};

describe('agent-kit.js entry — class-form alias boot', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="agent-kit-notshipped" data-label="Boot">stays prose</div>' +
      '<div class="semext-example">another family, untouched</div>';
    await import('../../src/agent-kit.js');
    await tick();
  });

  it('runs the alias pass; unknown agent-kit names stay authored prose', () => {
    const el = document.querySelector('.agent-kit-notshipped')!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute('data-agent-kit-alias')).toBe(false);
    // namespace isolation: the agent-kit pass never rewrites semext classes
    const foreign = document.querySelector('.semext-example')!;
    expect(foreign.localName).toBe('div');
    expect(foreign.hasAttribute('data-semext-alias')).toBe(false);
  });
});

describe('agent-kit-lazy — boot sweep with a stub manifest', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="agent-kit-issue" data-kind="ticket">aliased issue</div>' +
      '<div class="npl-flag">other family</div>';
    await import('../../src/lazy/agent-kit.js');
    await tickUntil(
      () => document.querySelector('agent-kit-issue')?.hasAttribute('data-sem-lazy-error') === true,
    );
  });

  it('rewrote the manifest-known alias to tag form at boot', () => {
    const el = document.querySelector('agent-kit-issue')!;
    expect(el).toBeTruthy();
    expect(el.hasAttribute('data-agent-kit-alias')).toBe(true);
    expect(el.getAttribute('data-kind')).toBe('ticket');
  });

  it('the chunk-404 failure degrades to authored prose + alert, not a throw', async () => {
    const el = document.querySelector('agent-kit-issue')!;
    expect(el.getAttribute('data-sem-lazy-error')).toBe('agent-kit-issue');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('agent-kit-issue');
    expect(el.textContent).toContain('aliased issue');
  });

  it('the sweep pattern only matches agent-kit-* — other families untouched', () => {
    const el = document.querySelector('.npl-flag')!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute('data-npl-alias')).toBe(false);
  });
});
