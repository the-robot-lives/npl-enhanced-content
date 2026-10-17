/**
 * agent-kit/agent-kit-test-case — the cached test-case card (contract
 * spec/schema/agent-kit/test-case.md): authored `<agent-kit-step>`
 * entries and the `<agent-kit-expected>` part are the record — steps in
 * document order, the expectation stated once. The chrome header chip
 * counts the steps; step ordinals ride CSS ::before (visible JS-off,
 * never extracted). livePolicy 'never', like every agent-kit-* element.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitParts } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitTestCase extends CachedEmbedElement {
  static properties = CachedEmbedProps;

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-case-chrome', () => {
      akitChrome(this, 'agent-kit-case-chrome', () => {
        const steps = akitParts(this, 'agent-kit-step').length;
        return html`<span class="agent-kit-case-count" data-step-count=${steps}
          >Test case · ${steps} step${steps === 1 ? '' : 's'}</span
        >`;
      });
    });
  }

  /** Snapshot enrichment: none — the authored steps are the whole view. */
  protected override renderChrome(_data: unknown): TemplateResult {
    return html``;
  }
}

defineAkit('agent-kit-test-case', AkitTestCase);
