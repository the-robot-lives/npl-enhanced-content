/**
 * sem-browser — a chrome-like window that renders a SemText document live.
 *
 * The landing "The Idea" BROWSER tab: a tab strip with a favicon dot, an
 * address bar naming the document, inert back/forward/reload glyphs, and a
 * viewport that shows the deck the way the shell's `bat` would — the same
 * document, a different window. Part of the shared window-chrome standard
 * (src/shared/window-chrome.ts); the paint lives in the sem-browser block of
 * themes/_vocabulary.css.
 *
 * Light DOM per PRD §4 rule 5: authored children stay searchable and copyable,
 * and the adopted document's sem-* elements upgrade through the same bundles
 * that style the page. After adopting a document the element offers it to the
 * lazy loader (`window.SemTextLazy.hydrate(viewport)` when present); under the
 * full bundle the custom-elements upgrade happens on insertion, and hydrate
 * is simply redundant.
 *
 * Zero-JS contract: with no script the authored children ARE the viewport —
   the frame look moves to the host (`sem-browser:not([data-sem-upgraded])`)
   and the document reads as a plain framed page. No hide rule gates on
   anything the script did not stamp (D12).
 *
 * Fidelity note: scripts and inline event handlers are stripped from adopted
 * documents. A SemText document is data, not code — the "no server, no
 * build" promise covers markup, and the strip keeps a fetched document from
 * executing anything in the reading page.
 */

import { SemElement } from '../lit/base.js';
import { createWindowTitlebar, WINDOW_CHROME } from '../shared/window-chrome.js';

/** A VFS path resolver: the host maps a relative path to document text. */
export type SemBrowserResolver = (path: string) => string | null | Promise<string | null>;

/** The document failed to resolve, fetch or parse. */
export interface SemBrowserErrorDetail {
  src: string;
  message: string;
}

/** The document is in the viewport. */
export interface SemBrowserLoadDetail {
  src: string;
  title: string;
}

const NAV_GLYPHS = ['‹', '›', '↻'] as const;

export class SemBrowser extends SemElement {
  static properties = {
    /** VFS path or URL of the SemText document to render. */
    src: { type: String },
    /** Optional tab-label override (else the document title, else the src). */
    label: { type: String },
    /** Host-injected VFS resolver; consulted for scheme-less paths. */
    resolve: { attribute: false },
  };

  declare src: string;
  declare label: string;
  declare resolve: SemBrowserResolver | null;

  #wired = false;
  #loadSeq = 0;
  #loadedSrc: string | null = null;
  #docTitle = '';

  updated(changed: Map<string, unknown>): void {
    if (!this.#wired) {
      this.#wire();
      this.#wired = true;
    }
    if (this.src && (changed.has('src') || changed.has('resolve') || this.#loadedSrc === null)) {
      void this.#load();
    }
  }

  /* ---------------------------------------------------------------- *
   * wiring — chrome around authored or loaded content
   * ---------------------------------------------------------------- */

  #wire(): void {
    const doc = this.ownerDocument;
    if (doc === null) return;

    const frame = doc.createElement('div');
    frame.className = WINDOW_CHROME.frame;

    const titlebar = createWindowTitlebar({ title: this.#tabTitle() });
    frame.appendChild(titlebar);

    const viewport = doc.createElement('div');
    viewport.className = WINDOW_CHROME.viewport;
    viewport.setAttribute('role', 'region');
    viewport.tabIndex = 0;
    frame.appendChild(viewport);

    // Authored children become the zero-JS-turned-JS viewport content: the
    // JS-off document keeps its children on the host (plain framed document),
    // the upgrade re-homes them behind the chrome. One move, idempotent.
    if (!this.src) {
      for (const child of Array.from(this.childNodes)) {
        if (child.nodeType === Node.COMMENT_NODE) continue; // lit part markers
        viewport.appendChild(child);
      }
    } else {
      // Host fallback chrome (landing contract): with a src the authored
      // children are the zero-JS fallback only — hidden once the element
      // wires, restored by nothing (the fetched document supersedes them).
      for (const child of Array.from(this.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) (child as HTMLElement).hidden = true;
      }
    }
    this.appendChild(frame);
    this.#labelViewport(viewport);

    if (this.src) this.#addressBar(frame);
  }

  /** The address bar: inert nav glyphs (aria-hidden) + the declared src. */
  #addressBar(frame: HTMLElement): void {
    const doc = this.ownerDocument;
    if (doc === null) return;
    const bar = doc.createElement('div');
    bar.className = 'sem-browser-address';

    const nav = doc.createElement('span');
    nav.className = 'sem-browser-nav';
    nav.setAttribute('aria-hidden', 'true'); // inert chrome, not controls
    for (const glyph of NAV_GLYPHS) {
      const span = doc.createElement('span');
      span.textContent = glyph;
      nav.appendChild(span);
    }
    bar.appendChild(nav);

    const url = doc.createElement('span');
    url.className = 'sem-browser-url';
    url.textContent = this.src;
    bar.appendChild(url);

    const viewport = frame.querySelector(`.${WINDOW_CHROME.viewport}`);
    if (viewport) frame.insertBefore(bar, viewport);
  }

  #viewport(): HTMLElement | null {
    return this.querySelector(`.${WINDOW_CHROME.viewport}`);
  }

  /** Tab label: explicit `label`, then the document's title, then the src. */
  #tabTitle(): string {
    if (this.label) return this.label;
    if (this.#docTitle) return this.#docTitle;
    if (this.src) {
      const base = this.src.split('/').pop() ?? this.src;
      return base === '' ? this.src : base;
    }
    return 'untitled';
  }

  #setTitle(): void {
    const title = this.#tabTitle();
    const label = this.querySelector(`.${WINDOW_CHROME.tabTitle}`);
    if (label) label.textContent = title;
    this.#labelViewport(this.#viewport());
  }

  #labelViewport(viewport: HTMLElement | null): void {
    if (viewport === null) return;
    viewport.setAttribute('aria-label', `${this.#tabTitle()} — browser viewport`);
  }

  /* ---------------------------------------------------------------- *
   * loading
   * ---------------------------------------------------------------- */

  async #load(): Promise<void> {
    const src = this.src;
    if (!src) return;
    const seq = ++this.#loadSeq;
    this.#loadedSrc = src;
    const viewport = this.#viewport();
    if (viewport === null) return;

    viewport.setAttribute('aria-busy', 'true');
    viewport.classList.add('sem-browser-loading');
    let text: string | null = null;
    let failure: string | null = null;

    const schemeless = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) && !src.startsWith('/');
    if (schemeless && this.resolve) {
      try {
        const resolved = await this.resolve(src);
        if (typeof resolved === 'string') text = resolved;
        else failure = `resolve: no document at ${src}`;
      } catch (error) {
        failure = `resolve: ${(error as Error).message}`;
      }
    }

    if (text === null && failure === null) {
      const view = this.ownerDocument?.defaultView ?? null;
      try {
        if (view === null || typeof view.fetch !== 'function') {
          throw new Error('fetch is unavailable in this view');
        }
        const response = await view.fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch (error) {
        failure = `${src}: ${(error as Error).message}`;
      }
    }

    if (seq !== this.#loadSeq) return; // a newer load superseded this one
    viewport.classList.remove('sem-browser-loading');
    if (failure !== null || text === null) {
      this.#showError(viewport, failure ?? 'no document text');
      return;
    }
    this.#adopt(viewport, text);
    viewport.removeAttribute('aria-busy');
  }

  /**
   * Parse the fetched document and move its body into the viewport. Scripts
   * and `on*` handlers are stripped before adoption (see the fidelity note);
   * parsing happens in an inert DOMParser document, so nothing runs on parse.
   */
  #adopt(viewport: HTMLElement, text: string): void {
    const doc = this.ownerDocument;
    if (doc === null) return;
    let parsed: Document;
    try {
      parsed = new DOMParser().parseFromString(text, 'text/html');
    } catch (error) {
      this.#showError(viewport, `parse failed: ${(error as Error).message}`);
      return;
    }
    if (parsed.querySelector('parsererror') !== null) {
      this.#showError(viewport, 'parse failed: malformed document');
      return;
    }

    const title = parsed.querySelector('title')?.textContent?.trim() ?? '';
    this.#docTitle = title;
    for (const script of Array.from(parsed.querySelectorAll('script'))) script.remove();
    for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
      for (const attr of Array.from(element.attributes)) {
        if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      }
    }

    viewport.replaceChildren();
    for (const node of Array.from(parsed.body.childNodes)) {
      if (node.nodeType === 1 || node.nodeType === 3 || node.nodeType === 8) {
        viewport.appendChild(doc.importNode(node, true));
      }
    }
    this.#setTitle();
    this.#hydrate(viewport);
    this.emit<SemBrowserLoadDetail>('sem-browser-load', { src: this.#loadedSrc ?? this.src, title: this.#tabTitle() });
  }

  /**
   * Offer the viewport to the lazy loader so adopted sem-* elements upgrade
   * without a page reload. Under the full bundle the elements upgrade on
   * insertion and this is a no-op for them.
   */
  #hydrate(viewport: HTMLElement): void {
    const view = this.ownerDocument?.defaultView as (Window & { SemTextLazy?: { hydrate?: (root: Element) => void } }) | null;
    const lazy = view?.SemTextLazy;
    if (typeof lazy?.hydrate === 'function') {
      try {
        lazy.hydrate(viewport);
      } catch {
        // A hydrate failure must not break the document that is already
        // displayed; the loader prints its own role=alert on the elements.
      }
    }
  }

  #showError(viewport: HTMLElement, message: string): void {
    const doc = this.ownerDocument;
    viewport.removeAttribute('aria-busy');
    viewport.replaceChildren();
    if (doc === null) return;
    const line = doc.createElement('p');
    line.setAttribute('role', 'alert');
    line.className = 'sem-browser-error-line';
    line.textContent = message; // textContent — never HTML from a failure
    viewport.appendChild(line);
    this.emit<SemBrowserErrorDetail>('sem-browser-error', { src: this.#loadedSrc ?? this.src, message });
  }
}
