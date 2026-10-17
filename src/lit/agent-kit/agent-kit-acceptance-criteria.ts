/**
 * agent-kit/agent-kit-acceptance-criteria — the structured
 * given/when/then list renderer (contract
 * spec/schema/agent-kit/acceptance-criteria.md).
 *
 * Authored record: one or more `<agent-kit-criterion>` parts, each
 * carrying `<agent-kit-given>`, `<agent-kit-when>`, `<agent-kit-then>`.
 * The rows themselves are styled by the agent-kit section of
 * `themes/_vocabulary.css` — this component is display-only (the brief
 * allows a display stub for the structured-list pair); its one piece of
 * logic is the chrome header chip, which counts the authored criteria.
 * livePolicy 'never', like every agent-kit-* element.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitAcceptanceCriteria extends CachedEmbedElement {
  static properties = { ...CachedEmbedProps };

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-acceptance-chrome', () => {
      akitChrome(this, 'agent-kit-acceptance-chrome', () => {
        const count = this.querySelectorAll('agent-kit-criterion').length;
        return html`<span class="agent-kit-acceptance-chip" data-criteria-count=${String(count)}>
          Acceptance criteria · ${count}</span>`;
      });
    });
  }

  protected override renderChrome(_data: unknown): TemplateResult {
    return html``;
  }
}

defineAkit('agent-kit-acceptance-criteria', AkitAcceptanceCriteria);
