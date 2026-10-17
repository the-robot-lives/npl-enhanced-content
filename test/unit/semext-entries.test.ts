// @vitest-environment happy-dom
// Unit spec — the semext namespace entries' wiring (src/semext.ts +
// src/lazy/semext.ts), mirroring the npl entry specs.
//
// Feature: an empty namespace still boots honestly
//   Scenario: the full-bundle entry's alias pass runs at boot; a class the
//             (empty) bundle defines nothing for stays authored prose
//   Scenario: the lazy entry's boot pattern sweeps only `semext-*` and the
//             stub manifest's chunk 404s land the report-don't-throw path

import { describe, it, expect, beforeAll } from 'vitest';

const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
const tickUntil = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 250 && !cond(); i++) await tick();
};

describe('semext.js entry — class-form alias boot', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="semext-notshipped" data-label="Boot">stays prose</div>' +
      '<div class="npl-example">another family, untouched</div>';
    await import('../../src/semext.js');
    await tick();
  });

  it('runs the alias pass; unknown semext names stay authored prose', () => {
    const el = document.querySelector('.semext-notshipped')!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute('data-semext-alias')).toBe(false);
    // namespace isolation: the semext pass never rewrites npl classes
    const foreign = document.querySelector('.npl-example')!;
    expect(foreign.localName).toBe('div');
    expect(foreign.hasAttribute('data-npl-alias')).toBe(false);
  });
});

describe('semext-lazy — boot sweep with a stub manifest', () => {
  beforeAll(async () => {
    document.body.innerHTML =
      '<div class="semext-flag" data-kind="concept">aliased flag</div>' +
      '<div class="agent-kit-issue">other family</div>';
    await import('../../src/lazy/semext.js');
    await tickUntil(
      () => document.querySelector('semext-flag')?.hasAttribute('data-sem-lazy-error') === true,
    );
  });

  it('rewrote the manifest-known alias to tag form at boot', () => {
    const el = document.querySelector('semext-flag')!;
    expect(el).toBeTruthy();
    expect(el.hasAttribute('data-semext-alias')).toBe(true);
    expect(el.getAttribute('data-kind')).toBe('concept');
  });

  it('the chunk-404 failure degrades to authored prose + alert, not a throw', async () => {
    const el = document.querySelector('semext-flag')!;
    expect(el.getAttribute('data-sem-lazy-error')).toBe('semext-flag');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('semext-flag');
    expect(el.textContent).toContain('aliased flag');
  });

  it('the sweep pattern only matches semext-* — other families untouched', () => {
    const el = document.querySelector('.agent-kit-issue')!;
    expect(el.localName).toBe('div');
    expect(el.hasAttribute('data-agent-kit-alias')).toBe(false);
  });
});
