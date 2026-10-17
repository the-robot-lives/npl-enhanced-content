import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';

/**
 * semext-docptr — a doc-pointer card rendered from a cached snapshot
 * (static snapshot; `livePolicy` stays 'never' — refresh is the CLI's
 * job, a later lane; this element only renders + declares the contract).
 *
 * A doc pointer is one entry of `.meta/pointers.yaml` (the doc-pointers
 * system): a durable, code-stable cross-document reference — hieroglyphic
 * 4-glyph token, uuid, marker, and the source location it names. The
 * authored inner content IS the record (the pointer's human-readable
 * statement); the JSON snapshot mirrors one or more pointer entries and
 * the component renders the locator card beside it under
 * `data-sem-chrome`.
 *
 * Snapshot shape (mirrors .meta/pointers.yaml — a map, or an array of the
 * same entries):
 *
 *   { "pointers": {
 *       "<uuid>": {
 *         "marker": "𐌀𐌖𐌋𐌄",           // the 4-glyph token (or the full
 *         "file_path": "lib/x.ts",      // 〚emoji:token〛 marker string)
 *         "line": 42,
 *         "kind": "function",
 *         "class": "MyApp.Auth",
 *         "function_name": "issue_token",
 *         "description": "…"
 *       } } }
 *
 * Attributes (identity knobs, all optional):
 *   uuid    select the entry keyed by this uuid
 *   token   select the entry whose `marker` carries this 4-glyph token
 *   marker  select the entry whose full marker string matches
 *   file    when set, only entries with exactly this `file_path` qualify
 *
 * With no identifier authored, a single-entry snapshot renders that entry.
 * Multiple candidates render as a list. No match renders a "pointer not
 * in snapshot" note — never an invented card.
 *
 * JS-off: the authored children read as plain prose; the snapshot script
 * child is invisible; the vocabulary box applies. Nothing is generated.
 */

/** One .meta/pointers.yaml-shaped entry (only the fields the card reads). */
interface PointerEntry {
  uuid?: string;
  marker?: string;
  file_path?: string;
  line?: number | string;
  kind?: string;
  class?: string;
  function_name?: string;
  description?: string;
  snippet?: string;
}

function entriesOf(data: unknown): PointerEntry[] {
  if (!data || typeof data !== 'object') return [];
  const raw = (data as { pointers?: unknown }).pointers ?? data;
  if (Array.isArray(raw)) return raw.filter((e): e is PointerEntry => !!e && typeof e === 'object');
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([uuid, entry]) =>
      entry && typeof entry === 'object' ? { uuid, ...(entry as PointerEntry) } : null,
    ).filter((e): e is PointerEntry => e !== null);
  }
  return [];
}

/** The 4-glyph token of a marker string, or the string itself. */
function tokenOf(marker: string | undefined): string {
  if (!marker) return '';
  const m = marker.match(/[〚[][^:亭\]]*[:：]([^\]〛]+)[\]〛]/);
  return m ? m[1] : marker;
}

export class SemextDocptr extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const uuid = (semextParam(this, 'uuid') ?? '').trim();
    const token = (semextParam(this, 'token') ?? '').trim();
    const marker = (semextParam(this, 'marker') ?? '').trim();
    const file = (semextParam(this, 'file') ?? '').trim();

    let list = entriesOf(data);
    if (file) list = list.filter((e) => (e.file_path ?? '') === file);
    const picked =
      (uuid && list.filter((e) => (e.uuid ?? '') === uuid)) ||
      (marker && list.filter((e) => (e.marker ?? '') === marker)) ||
      (token && list.filter((e) => tokenOf(e.marker) === token)) ||
      list;
    const entries = picked.length > 0 ? picked : uuid || marker || token ? [] : list;

    if (entries.length === 0) {
      return html`<p class="semext-docptr-missing">Pointer not in the cached snapshot.</p>`;
    }
    return html`${entries.map((e) => this.card(e))}`;
  }

  private card(e: PointerEntry): TemplateResult {
    const locator = [e.file_path ?? '', e.line !== undefined ? String(e.line) : '']
      .filter(Boolean)
      .join(':');
    return html`
      <div class="semext-docptr-card">
        <p class="semext-docptr-locator">${locator || 'unlocated'}</p>
        <div class="semext-docptr-meta">
          ${e.kind ? html`<span class="semext-docptr-kind">${e.kind}</span>` : nothing}
          ${e.class ? html`<span class="semext-docptr-class">${e.class}</span>` : nothing}
          ${e.function_name ? html`<code class="semext-docptr-fn">${e.function_name}</code>` : nothing}
          ${e.marker ? html`<span class="semext-docptr-marker">${e.marker}</span>` : nothing}
        </div>
        ${e.description ? html`<p class="semext-docptr-desc">${e.description}</p>` : nothing}
        ${e.snippet ? html`<pre class="semext-docptr-snippet"><code>${e.snippet}</code></pre>` : nothing}
      </div>
    `;
  }
}

defineSemext('semext-docptr', SemextDocptr);
