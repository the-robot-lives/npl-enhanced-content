import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';
import { sigLink } from './sig-link.js';

/**
 * semext-sig-traces — a SigNoz trace-list snapshot + deep link (cached +
 * link; livePolicy 'never', no client credentials ever).
 *
 * The authored inner content IS the record — the trace list as authored.
 * The JSON snapshot mirrors it for the chrome; the chrome adds the
 * "Open in SigNoz" anchor built from the authored `query`/`range`/`env`
 * attributes through the plain shared builder (sig-link.ts — base URL +
 * query parameters, no invented route).
 *
 * Snapshot shape:
 *
 *   { "traces": [ { "id": "…", "root": "GET /api/v1/threads",
 *                   "service": "annotate-srv", "durationMs": 214,
 *                   "spans": 12, "error": false } ] }
 *
 * JS-off: the authored list reads as plain prose; no link, no card.
 */

interface TraceSnapshot {
  id?: string;
  root?: string;
  service?: string;
  durationMs?: number | string;
  spans?: number | string;
  error?: boolean;
}

function tracesOf(data: unknown): TraceSnapshot[] {
  const raw = (data as { traces?: unknown } | null)?.traces;
  return Array.isArray(raw) ? (raw as TraceSnapshot[]).filter((t) => !!t && typeof t === 'object') : [];
}

export class SemextSigTraces extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const traces = tracesOf(data);
    const href = sigLink({
      query: semextParam(this, 'query'),
      range: semextParam(this, 'range'),
      env: semextParam(this, 'env'),
    });
    return html`
      <div class="semext-sig-card">
        ${traces.length
          ? html`
              <ul class="semext-sig-traces">
                ${traces.map(
                  (t) => html`
                    <li class="semext-sig-trace" data-error=${t.error ? 'true' : 'false'}>
                      <code class="semext-sig-trace-id">${t.id ?? ''}</code>
                      <span class="semext-sig-trace-root">${t.root ?? ''}</span>
                      <span class="semext-sig-trace-meta">
                        ${t.service ?? ''}${t.service && t.durationMs !== undefined ? ' · ' : ''}${t.durationMs !== undefined ? `${t.durationMs} ms` : ''}${t.spans !== undefined ? ` · ${t.spans} spans` : ''}
                      </span>
                    </li>
                  `,
                )}
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

defineSemext('semext-sig-traces', SemextSigTraces);
