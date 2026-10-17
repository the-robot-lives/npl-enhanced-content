/**
 * agent-kit/agent-kit-test-suite — the cached test-suite card
 * (contract spec/schema/agent-kit/test-suite.md): authored
 * `<agent-kit-branch passed failed>` rows are the record — one per
 * branch, the branch name as text, the stats as attributes. The chrome
 * header chip totals the rows (branch count, passed/failed sums — real
 * arithmetic over the authored attributes); a dated snapshot renders a
 * snapshot stamp. livePolicy 'never', like every agent-kit-* element.
 */

import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement, CachedEmbedProps } from '../shared/cached-embed.js';
import { akitChrome, akitParts } from './chrome.js';
import { defineAkit } from './shared.js';

export class AkitTestSuite extends CachedEmbedElement {
  static properties = CachedEmbedProps;

  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    this.afterParse('akit-suite-chrome', () => this.#renderAuthoredChrome());
  }

  #renderAuthoredChrome(): void {
    akitChrome(this, 'agent-kit-suite-chrome', () => {
      const rows = akitParts(this, 'agent-kit-branch');
      const num = (el: Element, name: string) => {
        const v = Number.parseInt(el.getAttribute(name) ?? '', 10);
        return Number.isFinite(v) && v >= 0 ? v : 0;
      };
      const passed = rows.reduce((sum, row) => sum + num(row, 'passed'), 0);
      const failed = rows.reduce((sum, row) => sum + num(row, 'failed'), 0);
      return html`<span class="agent-kit-suite-totals"
        data-branch-count=${rows.length}
        data-passed-total=${passed}
        data-failed-total=${failed}
        >${rows.length} branch${rows.length === 1 ? '' : 'es'} · ${passed} passed · ${failed} failed</span
      >`;
    });
  }

  /** Snapshot enrichment: a stamp when the cached snapshot is dated. */
  protected override renderChrome(data: unknown): TemplateResult {
    const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const at = typeof rec['updated_at'] === 'string' ? rec['updated_at'] : '';
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return html``;
    return html`<span class="agent-kit-suite-snapshot"
      >snapshot · <time datetime=${at}>${d.toISOString().slice(0, 10)}</time></span
    >`;
  }
}

defineAkit('agent-kit-test-suite', AkitTestSuite);
