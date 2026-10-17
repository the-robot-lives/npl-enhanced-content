import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';
import { sigLink } from './sig-link.js';

/**
 * semext-sig-logs — a SigNoz log-line snapshot + deep link (cached +
 * link; livePolicy 'never', no client credentials ever).
 *
 * The authored inner content IS the record — the log lines as authored.
 * The JSON snapshot mirrors them for the chrome; the chrome adds the
 * "Open in SigNoz" anchor built from the authored `query`/`range`/`env`
 * attributes through the plain shared builder (sig-link.ts — base URL +
 * query parameters, no invented route).
 *
 * Snapshot shape:
 *
 *   { "lines": [ { "ts": "2026-10-17T09:14:02Z", "severity": "INFO",
 *                  "body": "…" } ] }
 *
 * Severity renders as a chip (`data-severity` lowercased for the CSS:
 * error | warn | info | debug). JS-off: the authored lines read as plain
 * prose; no link, no card.
 */

interface LogLine {
  ts?: string;
  severity?: string;
  body?: string;
}

function linesOf(data: unknown): LogLine[] {
  const raw = (data as { lines?: unknown } | null)?.lines;
  return Array.isArray(raw) ? (raw as LogLine[]).filter((l) => !!l && typeof l === 'object') : [];
}

export class SemextSigLogs extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const lines = linesOf(data);
    const href = sigLink({
      query: semextParam(this, 'query'),
      range: semextParam(this, 'range'),
      env: semextParam(this, 'env'),
    });
    return html`
      <div class="semext-sig-card">
        ${lines.length
          ? html`
              <ol class="semext-sig-loglines">
                ${lines.map(
                  (l) => html`
                    <li class="semext-sig-logline" data-severity=${(l.severity ?? 'info').toLowerCase()}>
                      <span class="semext-sig-log-ts">${l.ts ?? ''}</span>
                      <span class="semext-sig-log-sev">${l.severity ?? ''}</span>
                      <span class="semext-sig-log-body">${l.body ?? ''}</span>
                    </li>
                  `,
                )}
              </ol>
            `
          : nothing}
        <p class="semext-sig-linkline">
          <a class="semext-sig-link" href=${href} target="_blank" rel="noopener">Open in SigNoz</a>
        </p>
      </div>
    `;
  }
}

defineSemext('semext-sig-logs', SemextSigLogs);
