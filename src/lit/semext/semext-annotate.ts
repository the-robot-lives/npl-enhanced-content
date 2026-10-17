import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { CachedEmbedElement, type LivePolicy } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';

/**
 * semext-annotate — visitor comment threads, service-backed (the ONE
 * element of the family allowed a client live read:
 * `livePolicy: 'anonymous-read'`).
 *
 * Two modes, one element (sem-chat's endpoint-vs-fixture contract through
 * the cached-embed base):
 *
 *  - **Snapshot mode.** The authored inner content IS the record — an
 *    authored thread rendering plus an inline JSON snapshot (or a
 *    `fixtures` source). JS-off the authored threads read as plain prose;
 *    JS-on the snapshot renders as card chrome beside them. A fixture
 *    source vetoes the endpoint (cached-embed hard rule 1).
 *
 *  - **Live mode.** With an `endpoint` and no fixture source, ONE
 *    anonymous GET of `<endpoint>/threads?site=<site>&page=<page>` is
 *    made — no credentials (`credentials: 'omit'` in the base), the URL
 *    still has to pass the shared source policy. The reply renders as
 *    chrome; a failure falls back to the authored view (status 'error').
 *    The `/threads` collection path + `site`/`page` query parameters are
 *    the contract THIS file defines; the annotate service owns the
 *    canonical shape (list-threads: site + page filters).
 *
 * HARD RULE — live bodies are UNTRUSTED. Every comment body, author name,
 * title and quoted anchor renders as TEXT ONLY: Lit text interpolation is
 * used exclusively, `unsafeHTML` never appears in this module, and the
 * unit tier pins that a `<script>` inside a comment body stays escaped
 * text. No link from thread data is ever rendered as an anchor.
 *
 * Attributes:
 *   site      the annotate site slug (query parameter)
 *   page      the page path the threads belong to (query parameter)
 *   endpoint  the annotate API base (cachedEmbed preset attribute; e.g.
 *             `https://annotate-srv.therobotlives.com/api/v1`)
 *
 * Snapshot / live-body shape (one canonical shape, both modes):
 *
 *   { "site": "…", "page": "…", "threads": [ {
 *       "id": "t-001", "status": "open", "title": "…",
 *       "author": "…", "createdAt": "2026-10-17T09:14:00Z",
 *       "anchor": { "text": "…" },
 *       "comments": [ { "id": "c-1", "author": "…",
 *                       "body": "…", "createdAt": "…" } ] } ] }
 */

interface AnnotateComment {
  author?: string;
  body?: string;
  createdAt?: string;
}

interface AnnotateThread {
  id?: string;
  status?: string;
  title?: string;
  author?: string;
  createdAt?: string;
  anchor?: { text?: string };
  comments?: AnnotateComment[];
}

function threadsOf(data: unknown): { site?: string; page?: string; threads: AnnotateThread[] } {
  const wrap = (data && typeof data === 'object' ? data : {}) as {
    site?: string;
    page?: string;
    threads?: unknown;
  };
  const raw = wrap.threads ?? (Array.isArray(data) ? data : []);
  const threads = Array.isArray(raw) ? (raw as AnnotateThread[]).filter((t) => !!t && typeof t === 'object') : [];
  return { site: wrap.site, page: wrap.page, threads };
}

/** The threads URL this contract defines. Exposed for the test tier. */
export function annotateThreadsUrl(endpoint: string, site: string, page: string): string {
  const base = endpoint.replace(/\/+$/, '');
  const qs = new URLSearchParams();
  if (site.trim()) qs.set('site', site.trim());
  if (page.trim()) qs.set('page', page.trim());
  const q = qs.toString();
  return `${base}/threads${q ? `?${q}` : ''}`;
}

export class SemextAnnotate extends CachedEmbedElement {
  static override livePolicy: LivePolicy = 'anonymous-read';

  connectedCallback(): void {
    // Resolve BEFORE the base's connect chain: the one-shot load reads
    // `endpoint` and may run during super.connectedCallback()'s parse —
    // a rewrite that waited for Lit's first updated() would be too late.
    this.#resolveEndpoint();
    super.connectedCallback();
  }

  updated(changed: PropertyValues): void {
    super.updated(changed);
    // Belt and braces for late-arriving site/page attributes.
    this.#resolveEndpoint();
  }

  #resolveEndpoint(): void {
    // The base fetches `endpoint` verbatim; this contract's endpoint is the
    // API BASE, so resolve the threads URL into the property. The guard
    // keeps the rewrite a one-step fixpoint: an already-resolved URL is
    // left alone, and re-setting the same string triggers no further Lit
    // update. The authored attribute is never written back.
    const endpoint = (this.endpoint ?? '').trim();
    if (endpoint && !/\/threads(?:[?#]|$)/.test(endpoint)) {
      this.endpoint = annotateThreadsUrl(
        endpoint,
        semextParam(this, 'site') ?? '',
        semextParam(this, 'page') ?? '',
      );
    }
  }

  protected override renderChrome(data: unknown): TemplateResult {
    const { site, page, threads } = threadsOf(data);
    const siteName = site ?? (semextParam(this, 'site') ?? '').trim();
    return html`
      <div class="semext-annotate-chrome">
        <p class="semext-annotate-head">
          Visitor threads — ${threads.length}${siteName ? html` on ${siteName}` : nothing}
        </p>
        ${threads.length === 0 ? html`<p class="semext-annotate-empty">No comments on this page yet.</p>` : nothing}
        ${threads.map((t) => this.thread(t))}
      </div>
    `;
  }

  private thread(t: AnnotateThread): TemplateResult {
    const comments = Array.isArray(t.comments) ? t.comments : [];
    return html`
      <article class="semext-annotate-thread" data-status=${t.status ?? ''}>
        <header class="semext-annotate-thread-head">
          <span class="semext-annotate-status">${t.status ?? 'open'}</span>
          <strong class="semext-annotate-title">${t.title || t.id || 'Thread'}</strong>
          ${t.author || t.createdAt
            ? html`<span class="semext-annotate-meta"> — ${t.author ?? ''}${t.author && t.createdAt ? ', ' : ''}${t.createdAt ?? ''}</span>`
            : nothing}
        </header>
        ${t.anchor?.text ? html`<blockquote class="semext-annotate-anchor">${t.anchor.text}</blockquote>` : nothing}
        ${comments.map(
          (c) => html`
            <p class="semext-annotate-comment">
              <span class="semext-annotate-author">${c.author ?? 'visitor'}</span>
              ${c.createdAt ? html`<span class="semext-annotate-when"> ${c.createdAt}</span>` : nothing}
              ${c.body ? html`<span class="semext-annotate-body"> — ${c.body}</span>` : nothing}
            </p>
          `,
        )}
      </article>
    `;
  }
}

defineSemext('semext-annotate', SemextAnnotate);
