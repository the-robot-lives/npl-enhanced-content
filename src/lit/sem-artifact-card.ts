import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { SemElement } from './base.js';
import { copyText, canCopy } from '../shared/clipboard.js';
import fixtureData from './fixtures/agent-kit/artifacts.json';

/**
 * sem-artifact-card — agent-kit upsell stub (plan §2, artifacts row).
 *
 * Typed artifact rendering (markdown / json / diff / code) over a version
 * list, with a timeline slider that scrubs through versions, a Copy button
 * (current content to the clipboard) and a Fork-revision button (appends a
 * local copy of the current version as a new version). Interaction-only:
 * every byte on screen comes from src/lit/fixtures/agent-kit/artifacts.json
 * — no fetch, no socket, no storage. Fork/copy mutate local state only and
 * emit `sem-artifact-fork` (detail: {version}) — the hook point the phase-2
 * transport will replace with POST /artifacts/:id/revisions.
 *
 * Attributes: `type` (markdown|json|diff|code), `versions` (JSON list of
 * {id, label, createdAt, content}), `active-version` (initial version id),
 * and an optional `language` chip for the code type. Without attributes the
 * first fixture artifact renders.
 *
 * Safety: markdown goes through a small escaped renderer (src/lit/sem-artifact-card.ts
 * `renderMarkdown`) — content is HTML-escaped BEFORE any tags are added and
 * the only tags the renderer emits are its own, so `<script>` and inline
 * HTML in fixture content render inert, as text. The same guarantee covers
 * the zero-JS fallback, which shares the renderers.
 *
 * Zero-JS contract (PRD degradation rule): the authored children ARE the
 * no-JS view — the active version's content with no controls. Inline
 * `artifactFallbackHtml()` from this module to author it; on upgrade the
 * interactive card replaces it.
 */
export type ArtifactType = 'markdown' | 'json' | 'diff' | 'code';

export interface ArtifactVersion {
  id: string;
  label: string;
  createdAt: string;
  content: string;
}

export interface ArtifactFixture {
  id: string;
  title: string;
  type: ArtifactType;
  'active-version'?: string;
  language?: string;
  versions: ArtifactVersion[];
}

/** The fixture index (plan §4: GET /artifacts) — one artifact per type. */
export const ARTIFACT_FIXTURES = fixtureData.artifacts as unknown as ArtifactFixture[];

/** Default render target — the first fixture artifact. */
export const DEFAULT_ARTIFACT: ArtifactFixture = ARTIFACT_FIXTURES[0];

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  diff: 'Diff',
  code: 'Code',
};

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape untrusted content. Every renderer escapes BEFORE adding tags. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Inline markdown on already-escaped text — emits only our own tags. */
function inlineMd(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Small escaped markdown renderer: headings, lists, paragraphs, inline code/bold/italic. */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const line of src.split('\n')) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length + 1; // # → h2 … ### → h4
      out.push(`<h${level}>${inlineMd(esc(h[2]))}</h${level}>`);
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inlineMd(esc(ul[1]))}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inlineMd(esc(ol[1]))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineMd(esc(line))}</p>`);
  }
  closeList();
  return out.join('');
}

/** Pretty-printed JSON; unparseable content renders as-is. */
function renderJson(src: string): string {
  let text = src;
  try {
    text = JSON.stringify(JSON.parse(src), null, 2);
  } catch {
    /* raw */
  }
  return `<pre class="sem-artifact-pre">${esc(text)}</pre>`;
}

/** Diff lines classed add/del/hunk/context. */
function renderDiff(src: string): string {
  const cls = (line: string): string => {
    if (line.startsWith('+++') || line.startsWith('---')) return 'hunk-meta';
    if (line.startsWith('+')) return 'add';
    if (line.startsWith('-')) return 'del';
    if (line.startsWith('@@')) return 'hunk';
    return 'ctx';
  };
  return src
    .split('\n')
    .map((line) => `<span class="sem-artifact-diff-${cls(line)}">${esc(line)}</span>`)
    .join('\n');
}

/**
 * Typed body HTML shared by both tiers. Content is always escaped inside
 * these builders, so rendering it with unsafeHTML is safe and the zero-JS
 * fallback gets the identical guarantee.
 */
export function renderArtifactBody(type: string, content: string): string {
  switch (type) {
    case 'json':
      return renderJson(content);
    case 'diff':
      return `<pre class="sem-artifact-pre sem-artifact-diff">${renderDiff(content)}</pre>`;
    case 'code':
      return `<pre class="sem-artifact-pre"><code>${esc(content)}</code></pre>`;
    default:
      return renderMarkdown(content);
  }
}

/**
 * The zero-JS view, as authored markup (spec rule: with the script absent the
 * document reads as plain content). Demo pages inline this string; the Lit
 * element replaces it with the interactive card once upgraded. The active
 * version renders; the timeline and buttons do not.
 */
export function artifactFallbackHtml(a: ArtifactFixture = DEFAULT_ARTIFACT): string {
  const active =
    a.versions.find((v) => v.id === a['active-version']) ?? a.versions[a.versions.length - 1];
  if (!active) return `<div class="sem-artifact-fallback"></div>`;
  const lang = a.language ? `<span class="sem-artifact-lang">${esc(a.language)}</span>` : '';
  return (
    `<div class="sem-artifact-fallback">` +
    `<header class="sem-artifact-head">` +
    `<span class="sem-artifact-type">${esc(a.title)}</span>${lang}` +
    `<span class="sem-artifact-version">${esc(active.label)} · ${esc(active.createdAt.slice(0, 10))}</span>` +
    `</header>` +
    `<div class="sem-artifact-body">${renderArtifactBody(a.type, active.content)}</div>` +
    `</div>`
  );
}

export class SemArtifactCard extends SemElement {
  static properties = {
    type: { type: String },
    versions: {
      type: Array,
      converter: {
        fromAttribute: (value: string | null): ArtifactVersion[] | undefined => {
          if (value === null) return undefined;
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : undefined;
          } catch {
            return undefined;
          }
        },
      },
    },
    activeVersion: { type: String, attribute: 'active-version' },
    language: { type: String },
    index: { type: Number, state: true },
  };

  declare type: string;
  declare versions: ArtifactVersion[];
  declare activeVersion: string | undefined;
  declare language: string;
  declare index: number;

  #localSeq = 0;

  constructor() {
    super();
    this.type = DEFAULT_ARTIFACT.type;
    this.versions = DEFAULT_ARTIFACT.versions;
    this.activeVersion = DEFAULT_ARTIFACT['active-version'];
    this.language = DEFAULT_ARTIFACT.language ?? '';
    this.index = Math.max(0, this.versions.length - 1);
  }

  updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    // The authored children are the zero-JS view; once the interactive card
    // has rendered, they are a duplicate — take them down.
    this.querySelector(':scope > .sem-artifact-fallback')?.remove();
    if (changed.has('versions') || changed.has('activeVersion')) {
      this.#resolveIndex();
    }
  }

  /** Re-resolve the slider position from `active-version`, clamped to range. */
  #resolveIndex(): void {
    const n = this.versions.length;
    if (n === 0) {
      this.index = 0;
      return;
    }
    const byAttr = this.activeVersion
      ? this.versions.findIndex((v) => v.id === this.activeVersion)
      : -1;
    this.index = byAttr >= 0 ? byAttr : Math.min(Math.max(this.index, 0), n - 1);
  }

  /** The version the slider points at. */
  #active(): ArtifactVersion | undefined {
    return this.versions[this.index] ?? this.versions[this.versions.length - 1];
  }

  #onScrub(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.index = Number(input.value);
  }

  /** Copy the current version's content — clipboard only, nothing is sent. */
  #onCopy(): void {
    const v = this.#active();
    const status = this.querySelector<HTMLElement>('.sem-artifact-status');
    if (v && status) copyText(v.content, status);
  }

  /** Fork the current version into a local copy — list state only, nothing is sent. */
  #fork(): void {
    const v = this.#active();
    if (!v) return;
    const forked: ArtifactVersion = {
      id: `local-${++this.#localSeq}`,
      label: `Fork of ${v.label}`,
      createdAt: new Date().toISOString(),
      content: v.content,
    };
    this.versions = [...this.versions, forked];
    this.activeVersion = forked.id;
    this.index = this.versions.length - 1;
    this.emit('sem-artifact-fork', { version: forked });
  }

  render(): TemplateResult {
    const v = this.#active();
    if (!v) {
      return html`<div class="sem-artifact-ui"><p class="sem-artifact-empty">No versions.</p></div>`;
    }
    const n = this.versions.length;
    const timeline =
      n > 1
        ? html`<div class="sem-artifact-timeline">
            <label class="sem-artifact-timeline-label" for="sem-artifact-scrub">
              Version timeline
            </label>
            <input
              id="sem-artifact-scrub"
              class="sem-artifact-scrub"
              type="range"
              min="0"
              max=${String(n - 1)}
              .value=${String(this.index)}
              aria-valuetext="${v.label} (${this.index + 1} of ${n})"
              @input=${this.#onScrub}
            />
            <output class="sem-artifact-count">${this.index + 1} / ${n}</output>
          </div>`
        : nothing;
    return html`<div class="sem-artifact-ui" data-type=${this.type}>
      <header class="sem-artifact-head">
        <span class="sem-artifact-type">${TYPE_LABELS[this.type] ?? 'Artifact'}</span>
        ${this.language ? html`<span class="sem-artifact-lang">${this.language}</span>` : nothing}
        <span class="sem-artifact-version">${v.label} · ${v.createdAt.slice(0, 10)}</span>
      </header>
      <div class="sem-artifact-body">${unsafeHTML(renderArtifactBody(this.type, v.content))}</div>
      ${timeline}
      <div class="sem-artifact-actions">
        ${canCopy()
          ? html`<button type="button" class="sem-artifact-copy" @click=${this.#onCopy}>
              Copy
            </button>`
          : nothing}
        <button type="button" class="sem-artifact-fork" @click=${this.#fork}>
          Fork revision
        </button>
        <span class="sem-artifact-status" role="status"></span>
      </div>
    </div>`;
  }
}

SemElement.register('sem-artifact-card', SemArtifactCard);
