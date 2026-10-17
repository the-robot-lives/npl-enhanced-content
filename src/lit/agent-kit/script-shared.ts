/**
 * agent-kit/script-shared — the cached script-card base shared by
 * agent-kit-cypress / agent-kit-cucumber (contracts
 * spec/schema/agent-kit/script-cards.md), promoting the runner-spec
 * shape to a cached embed: the spec source lives in an authored
 * `<script type="text/plain" data-agent-kit-script>` child (or a `file`
 * attribute pointing at the same-origin path) and DISPLAYS as authored
 * — the vocabulary stylesheet promotes the text/plain block to a
 * preformatted panel, with JavaScript on or off, so the document's own
 * escaping governs and the element never parses or executes it.
 *
 * Extraction skips script elements by design (the §8 invariant: inline
 * JSON is cached-embed DATA), so the script payload is display-only in
 * BOTH modes — the record carries the reference attributes; the
 * visible payload is identical DOM with or without JavaScript.
 *
 * RUN AFFORDANCE — DEFERRED, deliberately: there is no same-origin
 * driver endpoint discoverable from a static document, and a dead Run
 * button is worse than none. The cards show the script and its
 * reference; the driver lane arrives with the backend-proxy work.
 *
 * livePolicy 'never', like every agent-kit-* element.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome } from './chrome.js';
import { defineAkit } from './shared.js';

export type AkitScriptKind = 'cypress' | 'cucumber';

export const SCRIPT_LABELS: Record<AkitScriptKind, string> = {
  cypress: 'Cypress spec',
  cucumber: 'Cucumber feature',
};

export class AkitScriptCard extends CachedEmbedElement {
  static properties = {
    ...CachedEmbedProps,
    file: { type: String },
  };

  declare file: string;

  static scriptKind: AkitScriptKind = 'cypress';

  constructor() {
    super();
    this.file = '';
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-script-chrome', () => this.#renderAuthoredChrome());
  }

  #renderAuthoredChrome(): void {
    const ctor = this.constructor as typeof AkitScriptCard;
    akitChrome(this, 'agent-kit-script-chrome', () => {
      const kind = ctor.scriptKind;
      const file = (this.file ?? '').trim();
      const inline = this.querySelector('script[data-agent-kit-script]') !== null;
      return html`<span class="agent-kit-script-kind" data-script-kind=${kind}
          >${SCRIPT_LABELS[kind]}</span
        >
        ${file
          ? html`<span class="agent-kit-script-file">source: <code>${file}</code></span>`
          : nothing}
        ${inline ? html`<span class="agent-kit-script-inline">inline source below</span>` : nothing}`;
    });
  }

  /** Snapshot enrichment: none — the script card has no snapshot shape. */
  protected override renderChrome(_data: unknown): TemplateResult {
    return html``;
  }
}

export function defineScriptCard(tag: string, ctor: typeof AkitScriptCard): void {
  defineAkit(tag, ctor);
}
