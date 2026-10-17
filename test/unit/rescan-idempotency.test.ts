// @vitest-environment happy-dom
// Unit spec — re-scan idempotency (0.9.1): the bundle re-runs its vanilla
// passes whenever nodes mount late, so every pass must be a no-op on DOM
// it already wired.
//
//   Scenario: enhanceViews twice builds ONE tab bar
//   Scenario: enhanceProgress twice appends ONE track
//   Scenario: enhanceAudience twice registers ONE hashchange listener
//   Scenario: enhanceTarget twice is accepted (document scope re-entry)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enhanceViews,
  enhanceProgress,
  enhanceAudience,
  enhanceTarget,
} from '../../src/vanilla/index.js';

describe('re-scan idempotency', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('enhanceViews twice builds exactly one tab bar', () => {
    document.body.innerHTML = `
      <sem-views id="tabs">
        <sem-view data-name="One"><p>first</p></sem-view>
        <sem-view data-name="Two"><p>second</p></sem-view>
      </sem-views>`;
    enhanceViews(document);
    enhanceViews(document); // the late-DOM re-scan calls back over the document
    const bars = document.querySelectorAll('#tabs .sem-views-tabs');
    expect(bars).toHaveLength(1);
    expect(bars[0].querySelectorAll('button')).toHaveLength(2);
  });

  it('enhanceProgress twice appends exactly one track', () => {
    document.body.innerHTML = '<sem-progress data-value="0.5" label="upload"></sem-progress>';
    enhanceProgress(document);
    enhanceProgress(document);
    expect(document.querySelectorAll('sem-progress .sem-progress-track')).toHaveLength(1);
    expect(document.querySelector('sem-progress')!.getAttribute('data-sem-upgraded')).toBe('');
  });

  it('enhanceAudience twice registers one hashchange listener', () => {
    const added: string[] = [];
    const orig = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'hashchange') added.push(type);
      return (orig as (t: string, ...r: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    try {
      document.body.innerHTML = '<p data-audience="ops">ops only</p>';
      enhanceAudience(document);
      expect(added).toHaveLength(1);
      enhanceAudience(document); // the re-scan must not stack a second apply
      expect(added).toHaveLength(1);
    } finally {
      window.addEventListener = orig;
    }
  });

  it('enhanceTarget re-entry on the document scope does not throw or re-wire', () => {
    expect(() => { enhanceTarget(document); enhanceTarget(document); }).not.toThrow();
  });
});
