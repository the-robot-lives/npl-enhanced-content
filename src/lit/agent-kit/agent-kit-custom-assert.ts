/**
 * agent-kit/agent-kit-custom-assert — the structured expr/expect list
 * renderer (contract spec/schema/agent-kit/custom-assert.md).
 *
 * Authored record: pairs of `<agent-kit-assert-expr>` (the expression)
 * and `<agent-kit-assert-expect>` (the expectation). Rows are styled by
 * the agent-kit section of `themes/_vocabulary.css`; this component is
 * display-only (the brief allows a display stub for the
 * structured-list pair), its one piece of logic being the chrome header
 * chip, which counts the authored asserts. livePolicy 'never'.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitCustomAssert extends CachedEmbedElement {
  static properties = { ...CachedEmbedProps };

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-assert-chrome', () => {
      akitChrome(this, 'agent-kit-assert-chrome', () => {
        const count = this.querySelectorAll('agent-kit-assert-expr').length;
        return html`<span class="agent-kit-assert-chip" data-assert-count=${String(count)}>
          Custom asserts · ${count}</span>`;
      });
    });
  }

  protected override renderChrome(_data: unknown): TemplateResult {
    return html``;
  }
}

defineAkit('agent-kit-custom-assert', AkitCustomAssert);
