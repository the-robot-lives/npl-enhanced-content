import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';
import { sigLink } from './sig-link.js';

/**
 * semext-sig-synthetic-monitor — a SigNoz synthetic-monitor DEFINITION
 * card + link chrome (definition + link; livePolicy 'never').
 *
 * Synthetic monitor EXECUTION is an enterprise-tier service surface this
 * repo does not touch: there is deliberately NO endpoint discovery, no
 * run trigger, and no client credential here. The authored inner content
 * IS the record — the monitor's expected definition as authored; the
 * snapshot mirrors it and the chrome adds the "Open in SigNoz" anchor
 * (plain builder, sig-link.ts) plus the authored cadence/assertions.
 * Live execution is a DEFERRED LANE — see the contract's Live-fetch
 * policy section.
 *
 * Attributes:
 *   monitor   the monitor's identity (deep-link query parameter)
 *   env       the environment the monitor runs against
 *
 * Snapshot shape:
 *
 *   { "monitor": { "name": "annotate-srv threads",
 *                  "interval": "5m",
 *                  "assertions": [ "GET /api/v1/threads → 200",
 *                                  "latency p95 < 2s" ] } }
 *
 * JS-off: the authored definition reads as plain prose; no link, no card.
 */

interface MonitorSnapshot {
  name?: string;
  interval?: string;
  assertions?: string[];
}

function monitorOf(data: unknown): MonitorSnapshot | null {
  const m = (data as { monitor?: unknown } | null)?.monitor;
  return m && typeof m === 'object' ? (m as MonitorSnapshot) : null;
}

export class SemextSigSyntheticMonitor extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const m = monitorOf(data);
    const href = sigLink({
      monitor: semextParam(this, 'monitor'),
      env: semextParam(this, 'env'),
    });
    const assertions = m && Array.isArray(m.assertions) ? m.assertions : [];
    return html`
      <div class="semext-sig-card">
        ${m?.name ? html`<h3 class="semext-sig-title">${m.name}</h3>` : nothing}
        ${m?.interval ? html`<p class="semext-sig-monitor-interval">Runs every ${m.interval}</p>` : nothing}
        ${assertions.length
          ? html`
              <ul class="semext-sig-monitor-asserts">
                ${assertions.map((a) => html`<li>${a}</li>`)}
              </ul>
            `
          : nothing}
        <p class="semext-sig-linkline">
          <a class="semext-sig-link" href=${href} target="_blank" rel="noopener">Open in SigNoz</a>
        </p>
      </div>
    `;
  }
}

defineSemext('semext-sig-synthetic-monitor', SemextSigSyntheticMonitor);
