import { SemElement } from './base.js';
import { parseMediaPrompt, type MediaPromptFields } from '../shared/media-prompt.js';
import { box, wrapLine, meter, type TextRenderOptions } from '../shared/text-render/index.js';

/**
 * sem-media-prompt — the ACTIVE media-generation prompt record
 * (spec/schema/sem-media-prompt.md), sem-tier sibling of the passive
 * cached embed semext-media-prompt.
 *
 * The authored children ARE the record: a `.media.prompt` YAML code
 * block (media-tools v0.4 — parsed with the SAME validator the refresh
 * CLI uses, src/shared/media-prompt.js), generations in a nested
 * sem-media-gallery, evals in nested sem-eval / sem-rubric containers,
 * and an optional inline JSON snapshot. No authored node is ever moved,
 * rewritten or re-serialized.
 *
 * Two live lanes, both author-gated:
 *  - endpoint mode: a Generate button (only when `endpoint` is set and
 *    no fixtures source is active) POSTs {model?, prompt, negative?,
 *    aspect?, seed?} to the author-controlled proxy and renders the
 *    returned {output:{assets, evals}}. No API keys, no auth headers —
 *    the browser's ambient credentials are all it sends.
 *  - fixtures mode: an inline JSON / same-origin fixture source applies
 *    at upgrade and makes the element local-only — it NEVER fetches the
 *    endpoint (the sem-chat demo-stub contract).
 * With neither, the element is authored-only: no button, no request,
 * no fabricated generation.
 *
 * Every returned asset also emits the window-level `sem-media-added`
 * event ({src, caption, mime}) so any other gallery on the page appends
 * it. The element's own gallery never double-appends: events go out
 * FIRST, and a gallery that did not exist (or had not upgraded) at
 * emission time receives the cumulative items directly instead.
 *
 * Edit mode (`edit-mode`, or an ancestor sem-editor[edit-mode]) adds a
 * textarea seeded with the authored YAML; each valid edit emits
 * `sem-media-prompt-change` with the parsed fields. Persisting the edit
 * is the host's job — the authored block stays byte-identical.
 *
 * All runtime chrome lives in one data-sem-chrome container (class
 * sem-media-prompt-chrome, extraction-skipped) appended AFTER the
 * authored children; JS-off reads exactly the authored record.
 *
 * Errors surface through warn() plus an inline role="alert" (sem-chat
 * pattern); `status` reflects the lifecycle (idle → generating →
 * generated | error).
 */

export type { MediaPromptFields };

/** One gallery item — the sem-media-gallery / sem-media-added shape. */
export interface MediaGalleryItem {
  src: string;
  caption: string;
  mime: string;
}

export interface MediaEvalResult {
  rubric: string;
  score: number;
  max: number;
}

export class SemMediaPrompt extends SemElement {
  static properties = {
    status: { type: String, reflect: true },
  };

  declare status: string;

  #wired = false;
  #busy = false;
  #chrome: HTMLDivElement | null = null;
  #params: HTMLParagraphElement | null = null;
  #error: HTMLDivElement | null = null;
  #editor: HTMLTextAreaElement | null = null;
  #generateBtn: HTMLButtonElement | null = null;
  #evalsBox: HTMLDivElement | null = null;
  /** The nested gallery in use — authored when present, else created. */
  #gallery: HTMLElement | null = null;
  /** Authored items of the gallery in use (created galleries start []). */
  #galleryBase: unknown[] = [];
  /** Cumulative runtime assets + the latest run's evals (renderText). */
  #assets: MediaGalleryItem[] = [];
  #evals: MediaEvalResult[] = [];

  constructor() {
    super();
    this.status = 'idle';
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
  }

  updated(_changed: Map<string, unknown>): void {
    if (!this.#wired) {
      this.#wired = true;
      // Defer past the streaming parse: chrome must land AFTER every
      // authored child, and the record must be read complete.
      this.afterParse('wire', () => {
        this.#buildChrome();
        this.#loadSource();
      });
    }
    this.#syncParams();
  }

  /** Resolve the `<name>` / `data-<name>` dual form: `data-<name>` wins. */
  #param(name: string): string {
    const value = this.getAttribute(`data-${name}`) ?? this.getAttribute(name);
    return (value ?? '').trim();
  }

  // ── Chrome ─────────────────────────────────────────────────────

  #buildChrome(): void {
    const chrome = document.createElement('div');
    chrome.className = 'sem-media-prompt-chrome';
    // Runtime chrome (§2.4): extraction and positional mapping skip it.
    chrome.setAttribute('data-sem-chrome', '');
    this.#chrome = chrome;

    const params = document.createElement('p');
    params.className = 'sem-media-prompt-params';
    this.#params = params;
    chrome.append(params);

    if (this.hasAttribute('edit-mode') || this.closest('sem-editor[edit-mode]')) {
      const editor = document.createElement('textarea');
      editor.className = 'sem-media-prompt-input';
      editor.setAttribute('rows', '5');
      editor.setAttribute('aria-label', 'Media prompt (.media.prompt YAML)');
      editor.value = this.#yamlText();
      editor.addEventListener('input', this.#onPromptInput);
      this.#editor = editor;
      chrome.append(editor);
    }

    const error = document.createElement('div');
    error.className = 'sem-media-prompt-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    this.#error = error;
    chrome.append(error);

    if (this.#param('endpoint') && !this.#param('fixtures')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sem-media-prompt-generate';
      button.textContent = 'Generate';
      button.addEventListener('click', this.#onGenerate);
      this.#generateBtn = button;
      chrome.append(button);
    }

    this.#syncParams();
    this.append(chrome);
  }

  #syncParams(): void {
    const params = this.#params;
    if (!params) return;
    const fields = this.#fields();
    const bits = [this.#param('model'), fields?.aspect ?? this.#param('aspect'), fields?.seed ? `seed ${fields.seed}` : ''].filter(Boolean);
    params.textContent = bits.join(' · ');
    params.hidden = bits.length === 0;
  }

  // ── Record reading ─────────────────────────────────────────────

  #yamlText(): string {
    return this.querySelector('pre code.language-yaml, code.language-yaml')?.textContent ?? '';
  }

  /** The parsed authored record, or null when absent/invalid. */
  #fields(): MediaPromptFields | null {
    const text = this.#yamlText();
    if (!text.trim()) return null;
    return parseMediaPrompt(text).fields ?? null;
  }

  #childSnapshot(): Record<string, unknown> | null {
    for (const script of Array.from(this.querySelectorAll('script[type="application/json"]'))) {
      const record = asRecord(parseJson(script.textContent));
      if (record) return record;
    }
    return null;
  }

  // ── Sources ────────────────────────────────────────────────────

  #loadSource(): void {
    const fixtures = this.#param('fixtures');
    if (fixtures) {
      if (fixtures.startsWith('{') || fixtures.startsWith('[')) {
        const parsed = parseJson(fixtures);
        if (parsed) this.#applyFixturePayload(parsed);
        else this.#fail('invalid inline fixtures JSON');
        return;
      }
      void this.#fetchFixtures(fixtures);
      return;
    }

    const output = asRecord(this.#childSnapshot()?.output);
    if (output?.generated === true) this.#applyOutput(output, false);
  }

  async #fetchFixtures(path: string): Promise<void> {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Fixture request failed (${res.status})`);
      this.#applyFixturePayload(await res.json());
    } catch (err) {
      this.#fail(`could not load fixtures from ${path}: ${messageOf(err)}`);
    }
  }

  /** Fixtures accept the endpoint reply shape OR a bare gallery-item array. */
  #applyFixturePayload(data: unknown): void {
    if (Array.isArray(data)) {
      this.#applyOutput({ assets: data, evals: [] }, false);
      return;
    }
    const output = asRecord(asRecord(data)?.output);
    if (!output) {
      this.#fail('fixtures payload has no output');
      return;
    }
    this.#applyOutput(output, false);
  }

  // ── Generation ─────────────────────────────────────────────────

  #onGenerate = (): void => {
    void this.#generate();
  };

  async #generate(): Promise<void> {
    if (this.#busy) return;
    // A fixtures source added after wiring keeps the element local-only.
    if (this.#param('fixtures')) return;

    const endpoint = this.#param('endpoint');
    if (!endpoint) {
      this.#fail('no endpoint attribute set — nothing was generated.');
      return;
    }

    const text = this.#yamlText();
    if (!text.trim()) {
      this.#fail('no .media.prompt YAML block authored');
      return;
    }
    const parsed = parseMediaPrompt(text);
    if (!parsed.fields) {
      this.#fail(parsed.error);
      return;
    }
    const fields = parsed.fields;

    const body: Record<string, unknown> = { prompt: fields.prompt };
    if (fields.negative !== undefined) body.negative = fields.negative;
    const aspect = fields.aspect ?? this.#param('aspect');
    if (aspect) body.aspect = aspect;
    if (fields.seed !== undefined) body.seed = Number(fields.seed);
    const model = this.#param('model');
    if (model) body.model = model;

    this.#busy = true;
    this.status = 'generating';
    this.#setError(null);
    this.#setDisabled(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const output = asRecord(asRecord(await res.json())?.output);
      if (!output) throw new Error('reply has no output');
      this.#applyOutput(output, true);
    } catch (err) {
      this.#fail(messageOf(err));
    } finally {
      this.#busy = false;
      this.#setDisabled(false);
    }
  }

  // ── Output rendering ───────────────────────────────────────────

  /**
   * Render one output payload. `emit` is true for endpoint runs (their
   * assets fan out to the page's other galleries); snapshot/fixture
   * loads render the authored record without re-announcing it.
   */
  #applyOutput(output: Record<string, unknown>, emit: boolean): void {
    const dir = this.#param('assets-dir');
    const items = asArray(output.assets)
      .map(asRecord)
      .filter((a): a is Record<string, unknown> => a !== null)
      .map((a) => {
        const path = str(a.path ?? a.src);
        const src = resolveAssetSrc(path, dir);
        return { src, caption: str(a.caption) || path || src, mime: str(a.mime) };
      })
      .filter((item) => item.src !== '');
    const evals = asArray(output.evals)
      .map(asRecord)
      .filter((e): e is Record<string, unknown> => e !== null)
      .map((e) => ({ rubric: str(e.rubric), score: Number(e.score) || 0, max: Number(e.max) || 0 }))
      .filter((e) => e.rubric !== '');

    // Discover the gallery in use: the authored nested one when present.
    if (!this.#gallery) {
      const authored = this.querySelector('sem-media-gallery');
      if (authored) {
        this.#gallery = authored;
        this.#galleryBase = parseItems(authored.getAttribute('items'));
      }
    }

    // Events FIRST: every already-upgraded gallery on the page (this
    // element's included) appends through its own window listener.
    if (emit) {
      for (const item of items) this.emit<MediaGalleryItem>('sem-media-added', item);
    }

    this.#assets = [...this.#assets, ...items];
    this.#evals = evals;

    const gallery = this.#gallery;
    if (!gallery) {
      // Created AFTER the emissions, so it never hears its own events:
      // the cumulative items are its source of truth.
      const created = document.createElement('sem-media-gallery');
      created.setAttribute('items', JSON.stringify(this.#assets));
      this.#gallery = created;
      this.#chrome?.append(created);
    } else if (!emit || gallery.shadowRoot == null) {
      // Not upgraded at emission time (or a silent snapshot/fixture
      // load): the listener cannot have appended — set items directly.
      gallery.setAttribute('items', JSON.stringify([...this.#galleryBase, ...this.#assets]));
    }

    this.#renderEvals(evals);
    this.status = 'generated';
  }

  #renderEvals(evals: MediaEvalResult[]): void {
    if (evals.length === 0) {
      this.#evalsBox?.remove();
      this.#evalsBox = null;
      return;
    }
    if (!this.#evalsBox) {
      const wrap = document.createElement('div');
      wrap.className = 'sem-media-prompt-evals';
      this.#evalsBox = wrap;
      this.#chrome?.append(wrap);
    }
    this.#evalsBox.replaceChildren(
      ...evals.map((e) => {
        // sem-eval is the vocabulary's display container; undefined (a
        // lazy-only page without the core) it still reads as prose.
        const el = document.createElement('sem-eval');
        el.setAttribute('kind', 'media');
        el.setAttribute('status', 'scored');
        const p = document.createElement('p');
        const name = document.createElement('strong');
        name.textContent = e.rubric;
        p.append(name, document.createTextNode(` — ${e.score} / ${e.max}`));
        el.append(p);
        return el;
      }),
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────

  #onPromptInput = (): void => {
    const editor = this.#editor;
    if (!editor) return;
    const parsed = parseMediaPrompt(editor.value);
    if (!parsed.fields) {
      this.#setError(`sem-media-prompt: ${parsed.error}`);
      return;
    }
    this.#setError(null);
    this.emit<MediaPromptFields>('sem-media-prompt-change', parsed.fields);
  };

  // ── Errors / state ─────────────────────────────────────────────

  #fail(message: string): void {
    const full = `sem-media-prompt: ${message}`;
    this.#setError(full);
    this.warn(full);
    this.status = 'error';
  }

  #setError(message: string | null): void {
    if (!this.#error) return;
    this.#error.textContent = message ?? '';
    this.#error.hidden = message === null;
  }

  #setDisabled(disabled: boolean): void {
    if (this.#generateBtn) this.#generateBtn.disabled = disabled;
    if (this.#editor) this.#editor.disabled = disabled;
  }

  // ── Terminal text view (the <sem-tui> protocol) ────────────────

  /**
   * Pure text projection of the record + last output. The shared
   * render-mode driver mounts it; this method never writes.
   */
  renderText(opts: TextRenderOptions = {}): string {
    const cols = opts.cols && opts.cols > 8 ? Math.floor(opts.cols) : 80;
    const fields = this.#fields();
    const title = ['MEDIA PROMPT', this.#param('model'), fields?.aspect ?? this.#param('aspect')].filter(Boolean).join(' · ');

    const lines: string[] = [];
    if (fields) {
      lines.push(...wrapLine(`prompt: ${fields.prompt}`, cols - 4));
      if (fields.negative !== undefined) lines.push(...wrapLine(`negative: ${fields.negative}`, cols - 4));
      if (fields.aspect !== undefined) lines.push(`aspect: ${fields.aspect}`);
      if (fields.seed !== undefined) lines.push(`seed: ${fields.seed}`);
    } else {
      lines.push('no valid .media.prompt record authored');
    }
    if (this.#assets.length > 0 || this.#evals.length > 0) {
      lines.push(`output: ${this.#assets.length} assets · ${this.#evals.length} eval${this.#evals.length === 1 ? '' : 's'}`);
      for (const e of this.#evals) {
        lines.push(`  ${e.rubric} ${meter(e.max > 0 ? e.score / e.max : 0, 10)} ${e.score}/${e.max}`);
      }
    } else {
      lines.push('output: not generated yet');
    }
    return box(title, lines, cols).join('\n');
  }
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

function parseJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Absolute URLs pass through; relative paths join onto assets-dir. */
export function resolveAssetSrc(path: string, dir: string): string {
  if (!path) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.startsWith('/')) return path;
  if (!dir) return path;
  return `${dir.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The authored gallery's items, verbatim (base for cumulative sets). */
function parseItems(json: string | null): unknown[] {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed : [];
}

SemElement.register('sem-media-prompt', SemMediaPrompt);