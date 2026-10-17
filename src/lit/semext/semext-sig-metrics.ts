import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';
import { sigLink } from './sig-link.js';

/**
 * semext-sig-metrics — a SigNoz metrics snapshot + deep link (cached +
 * link; livePolicy 'never', no client credentials ever).
 *
 * The authored inner content IS the record — the metrics table as the
 * author wrote it (typically a markdown-table rendering). The JSON
 * snapshot mirrors it for the chrome card; the chrome adds the "Open in
 * SigNoz" anchor built from the authored `query`/`range`/`env`
 * attributes through the plain shared builder (src/lit/semext/sig-link.ts
 * — base URL + query parameters, no invented route).
 *
 * Snapshot shape:
 *
 *   { "title": "Latency by service (1h)",
 *     "columns": ["service", "p50", "p95", "errors"],
 *     "rows": [ ["annotate-srv", "12 ms", "40 ms", "0.0%"] ] }
 *
 * JS-off: the authored table reads as plain prose; no link, no card.
 */

interface MetricsSnapshot {
  title?: string;
  columns?: string[];
  rows?: unknown[][];
}

function metricsOf(data: unknown): MetricsSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as MetricsSnapshot;
  if (!Array.isArray(m.columns) && !Array.isArray(m.rows)) return null;
  return m;
}

export class SemextSigMetrics extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const m = metricsOf(data);
    const href = sigLink({
      query: semextParam(this, 'query'),
      range: semextParam(this, 'range'),
      env: semextParam(this, 'env'),
    });
    return html`
      <div class="semext-sig-card">
        ${m?.title ? html`<h3 class="semext-sig-title">${m.title}</h3>` : nothing}
        ${m && Array.isArray(m.columns) && Array.isArray(m.rows) && m.rows.length
          ? html`
              <table class="semext-sig-table">
                <thead>
                  <tr>${m.columns.map((c) => html`<th>${c}</th>`)}</tr>
                </thead>
                <tbody>
                  ${m.rows.map(
                    (row) => html`<tr>${row.map((cell) => html`<td>${String(cell)}</td>`)}</tr>`,
                  )}
                </tbody>
              </table>
            `
          : nothing}
        <p class="semext-sig-linkline">
          <a class="semext-sig-link" href=${href} target="_blank" rel="noopener">Open in SigNoz</a>
        </p>
      </div>
    `;
  }
}

defineSemext('semext-sig-metrics', SemextSigMetrics);
