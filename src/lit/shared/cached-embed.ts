import {
  html,
  render,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { SemElement } from '../base.js';
import { resolveSource } from '../../data/load.js';

/**
 * lit/shared/cached-embed — the cached-embed base for service-backed
 * SemText elements.
 *
 * Generalizes the contract sem-chat proved out (endpoint-vs-fixture mode)
 * for the embed family (agent-kit et al): an element whose authored inner
 * content IS the record — extraction reads it, never the network — that
 * may additionally resolve a JSON snapshot and/or one anonymous live read
 * to render runtime chrome beside the authored record.
 *
 * Contract (attributes, per the schema's `cachedEmbed` defPreset):
 *   org, project, key, id   the service reference quartet (which record
 *                           this embed mirrors); the element never builds
 *                           URLs from them — `refs()` hands them to
 *                           subclasses, later lanes decide the shapes
 *   endpoint                optional live-read URL; only ever fetched when
 *                           `livePolicy` allows AND the URL passes the
 *                           shared source policy (src/data/load.ts)
 *   fixtures                optional fixture source: an inline JSON string,
 *                           a same-origin path, or an inline
 *                           `<script type="application/json">` child
 *   last-refreshed          ISO-8601 stamp of the last sync (set by the
 *                           authoring CLI); feeds the staleness window
 *   status                  reflected runtime state: cached | stale |
 *                           error | live (written by this class; see below)
 *
 * Snapshot precedence: inline JSON child > `fixtures` source (inline JSON,
 * then same-origin path) > none (authored-only).
 *
 * HARD RULES (each unit-tested in test/unit/lit-cached-embed.test.ts):
 *   1. A fixture source, in any form, vetoes the endpoint — zero fetches.
 *   2. The JS-off view is the authored children exactly; nothing is
 *      fabricated from JSON, and runtime chrome renders only under the
 *      `data-sem-upgraded` claim inside a `data-sem-chrome` container.
 *   3. Live fetches only when `livePolicy` allows AND `endpoint` is set
 *      AND the URL passes `resolveSource` (refuses file:// documents,
 *      non-http(s) and javascript:/data:/blob: schemes).
 *   4. Status: 'cached' starts when a snapshot is present; 'live' after a
 *      successful live fetch; 'stale' when `last-refreshed` is older than
 *      the `stalenessMs` window (null — the default — means never stale);
 *      'error' on any failure. Failure never destroys the view: an error
 *      during the live read falls back to the snapshot, and an error with
 *      no snapshot leaves the authored children standing. Nothing throws.
 *   5. Snapshot JSON parse failures set 'error', render the authored
 *      children, and never throw.
 *
 * Subclass contract: extend, add own reactive properties (the cachedEmbed
 * properties are inherited — Lit merges static properties up the chain),
 * override `static livePolicy` to 'anonymous-read' to opt into live
 * reads, optionally set `static stalenessMs`, and implement
 * `renderChrome(data)` — it receives the resolved JSON value (snapshot or
 * live body) and renders ONLY when the element is upgraded; its output
 * must be accessory chrome, never a replacement for the authored record.
 */
export type CachedEmbedStatus = 'cached' | 'stale' | 'error' | 'live';

/** Whether (and how) the element may fetch `endpoint` at runtime. */
export type LivePolicy = 'never' | 'anonymous-read';

/**
 * The `cachedEmbed` defPreset (spec/schema/semtext.schema.json) as a Lit
 * static properties declaration. Spread it when a subclass declares its
 * own `static properties`; declaring none inherits it as-is.
 */
export const CachedEmbedProps: PropertyDeclarations = {
  org: { type: String },
  project: { type: String },
  key: { type: String },
  id: { type: String },
  endpoint: { type: String },
  fixtures: { type: String },
  lastRefreshed: { type: String, attribute: 'last-refreshed' },
  status: { type: String, reflect: true },
};

const PARSE_FAILED = Symbol('cached-embed: JSON parse failed');

function parseJson(text: string | null | undefined): unknown {
  if (!text || !text.trim()) return PARSE_FAILED;
  try {
    return JSON.parse(text);
  } catch {
    return PARSE_FAILED;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The element's fetch implementation; overridable per instance. */
function defaultFetch(): typeof fetch {
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  return ((..._args: Parameters<typeof fetch>) =>
    Promise.reject(new Error('no fetch implementation available in this environment'))) as typeof fetch;
}

export abstract class CachedEmbedElement extends SemElement {
  static properties = CachedEmbedProps;

  /**
   * The live-read policy. 'never' (the default) means the element renders
   * snapshots only. 'anonymous-read' allows one GET of `endpoint` with no
   * credentials, URL permitting.
   */
  static livePolicy: LivePolicy = 'never';

  /**
   * How old a snapshot may be (vs `last-refreshed`) before it reports
   * 'stale'. null — the default — installs no window: never stale.
   */
  static stalenessMs: number | null = null;

  declare org: string;
  declare project: string;
  declare key: string;
  declare id: string;
  declare endpoint: string;
  declare fixtures: string;
  declare lastRefreshed: string;
  declare status: CachedEmbedStatus | '';

  /**
   * Test seam for the unit tier (the element must never touch the network
   * in tests). Same spirit as sem-chat's exported `consumeReply`.
   */
  fetchImpl: typeof fetch = defaultFetch();

  #loaded = false;
  #data: unknown = null;
  #chrome: HTMLElement | null = null;

  constructor() {
    super();
    this.org = '';
    this.project = '';
    this.key = '';
    this.id = '';
    this.endpoint = '';
    this.fixtures = '';
    this.lastRefreshed = '';
    // `status` is deliberately left undefined: it is runtime-owned and
    // reflected, so initializing it here would stamp an empty `status`
    // attribute onto every instance before any state exists.
  }

  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!this.#loaded) {
      this.#loaded = true;
      // One-shot load, sem-chat precedent. Document-authored elements
      // upgrade before their children are parsed; afterParse defers the
      // load to DOMContentLoaded in that case (so the inline JSON child
      // is actually there) and runs it immediately otherwise.
      this.afterParse('cached-embed-load', () => {
        void this.#load();
      });
    }
  }

  /**
   * The service reference quartet, for subclasses that talk to a service
   * (agent-kit et al). The base itself never builds URLs from these.
   */
  protected refs(): { org: string; project: string; key: string; id: string } {
    return {
      org: this.org ?? '',
      project: this.project ?? '',
      key: this.key ?? '',
      id: this.id ?? '',
    };
  }

  /**
   * The authored snapshot, resolved synchronously: an inline
   * `<script type="application/json">` child first, then an inline JSON
   * `fixtures` value, else null (authored-only). A same-origin path in
   * `fixtures` resolves asynchronously in the loader. A source that is
   * present but unparseable reports 'error' (fail soft — the authored
   * children stand) and returns null; a fixture source present at all
   * still vetoes the endpoint.
   */
  protected snapshot(): unknown | null {
    const children = this.querySelectorAll('script[type="application/json"]');
    if (children.length > 0) {
      for (const child of Array.from(children)) {
        const parsed = parseJson(child.textContent);
        if (parsed !== PARSE_FAILED) return parsed;
      }
      this.#snapshotFailed('the inline JSON child is not valid JSON');
      return null;
    }
    const value = (this.fixtures ?? '').trim();
    if (value.startsWith('{') || value.startsWith('[')) {
      const parsed = parseJson(value);
      if (parsed === PARSE_FAILED) {
        this.#snapshotFailed('the fixtures attribute is not valid JSON');
        return null;
      }
      return parsed;
    }
    return null;
  }

  /**
   * Render the resolved data as runtime chrome. Called ONLY under the
   * `data-sem-upgraded` claim, with the resolved JSON value (snapshot or
   * live body). The authored children are the record — chrome is accessory
   * and must never replace or reorder them.
   */
  protected abstract renderChrome(data: unknown): TemplateResult;

  // ── Loader (one-shot, afterParse) ──────────────────────────────

  async #load(): Promise<void> {
    const snapshot = this.snapshot(); // sync sources; may report 'error' itself
    if (this.#hasFixtureSource()) {
      if (snapshot !== null) {
        this.#applySnapshot(snapshot);
      } else if (this.status !== 'error') {
        // The only remaining fixture source is a same-origin path in the
        // `fixtures` attribute; resolve it (fail soft).
        await this.#loadFixturesPath();
      }
      // HARD RULE: a fixture source, in any form, vetoes the endpoint —
      // even when the snapshot failed to parse.
      return;
    }
    // No fixture source: the authored children are the whole view unless
    // the live policy allows a read.
    await this.#loadLive();
  }

  #hasFixtureSource(): boolean {
    if (this.querySelector('script[type="application/json"]')) return true;
    return (this.fixtures ?? '').trim() !== '';
  }

  #applySnapshot(data: unknown): void {
    this.#data = data;
    this.status = this.#initialStatus();
    this.#renderChrome();
  }

  #initialStatus(): CachedEmbedStatus {
    return this.#stale() ? 'stale' : 'cached';
  }

  #stale(): boolean {
    const windowMs = (this.constructor as typeof CachedEmbedElement).stalenessMs;
    if (windowMs == null) return false; // no window ⇒ never stale
    const stamp = (this.lastRefreshed ?? '').trim();
    if (!stamp) return false; // unstamped snapshots are not judged stale
    const ts = Date.parse(stamp);
    if (Number.isNaN(ts)) {
      this.warn(
        `cached-embed: last-refreshed "${stamp}" is not a parseable ISO-8601 stamp — treating the snapshot as fresh`,
      );
      return false;
    }
    return Date.now() - ts > windowMs;
  }

  /** Resolve a same-origin fixtures path. Fail soft on refusal or error. */
  async #loadFixturesPath(): Promise<boolean> {
    const policy = resolveSource((this.fixtures ?? '').trim(), this.#docURL());
    if (policy.kind === 'refused') {
      this.#snapshotFailed(`fixtures source refused — ${policy.reason}`);
      return false;
    }
    try {
      const res = await this.fetchImpl(policy.url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`fixtures request failed (${res.status})`);
      this.#applySnapshot(await res.json()); // a non-JSON body throws → fail soft below
      return true;
    } catch (err) {
      this.#snapshotFailed(messageOf(err));
      return false;
    }
  }

  /** The anonymous live read. Fail soft: an error keeps the cached view. */
  async #loadLive(): Promise<void> {
    const url = this.#liveTarget();
    if (url === null) return;
    try {
      const res = await this.fetchImpl(url, {
        credentials: 'omit', // anonymous-read sends no ambient credentials
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      this.#data = await res.json(); // a non-JSON body throws → fail soft below
      this.status = 'live';
      this.#renderChrome();
    } catch (err) {
      this.warn(`cached-embed: live fetch failed (${messageOf(err)}) — keeping the cached view`);
      this.status = 'error';
      // Fail soft: #data is untouched, so a previously applied snapshot
      // keeps rendering; with none, the authored children stand.
      this.#renderChrome();
    }
  }

  /** Resolve the live-read target, or null when the policy says don't. */
  #liveTarget(): string | null {
    const ctor = this.constructor as typeof CachedEmbedElement;
    if (ctor.livePolicy === 'never') return null;
    const endpoint = (this.endpoint ?? '').trim();
    if (!endpoint) return null;
    const policy = resolveSource(endpoint, this.#docURL());
    if (policy.kind === 'refused') {
      this.warn(`cached-embed: endpoint not fetched — ${policy.reason}`);
      return null;
    }
    return policy.url;
  }

  // ── Failure + chrome plumbing ──────────────────────────────────

  /** Report a broken snapshot source: 'error', authored children, no throw. */
  #snapshotFailed(why: string): void {
    this.warn(`cached-embed: ${why}`);
    this.#data = null;
    this.status = 'error';
    this.#renderChrome(); // null data ⇒ any chrome is removed; authored children stand
  }

  #docURL(): string {
    return this.ownerDocument?.URL || 'about:blank';
  }

  /**
   * Render (or retire) the chrome container. Everything the element
   * fabricates lives inside it, marked `data-sem-chrome` (§2.4: positional
   * mapping must skip it) — the authored children keep their document
   * order and content, untouched, whatever the data does.
   */
  #renderChrome(): void {
    // Runtime chrome renders ONLY under the upgrade claim: with JavaScript
    // off nothing here runs and the view is exactly what was authored.
    if (!this.hasAttribute('data-sem-upgraded')) return;
    if (this.#data === null || this.#data === undefined) {
      this.#chrome?.remove();
      this.#chrome = null;
      return;
    }
    if (!this.#chrome) {
      const chrome = document.createElement('div');
      chrome.className = 'sem-cached-embed-chrome';
      chrome.setAttribute('data-sem-chrome', '');
      this.#chrome = chrome;
      this.append(chrome);
    }
    try {
      render(this.renderChrome(this.#data), this.#chrome);
    } catch (err) {
      // A subclass render bug must never destroy the authored record.
      this.warn(
        `cached-embed: renderChrome failed (${messageOf(err)}) — the authored children remain`,
      );
      this.#chrome.remove();
      this.#chrome = null;
    }
  }
}

/**
 * Concrete double for the unit tier (happy-dom). Opts into anonymous live
 * reads so tests can exercise the fetch path with an injected fetcher, and
 * renders the resolved JSON as its chrome. Registers a throwaway tag —
 * never shipped in a bundle (no barrel references this module).
 */
export class TestCachedEmbed extends CachedEmbedElement {
  static override livePolicy: LivePolicy = 'anonymous-read';

  protected override renderChrome(data: unknown): TemplateResult {
    return html`<div class="test-cached-embed-chrome">${JSON.stringify(data)}</div>`;
  }
}

SemElement.register('sem-test-cached-embed', TestCachedEmbed);
