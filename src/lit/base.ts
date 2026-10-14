import { LitElement } from 'lit';
import { parseTokens } from '../shared/tokens.js';
import { closureFor, matches, warn as semWarn, type AudienceClosure } from '../shared/audience.js';

/**
 * SemElement — the shared base for every SemText custom element.
 *
 * Repays debt D2. Three things were being copy-pasted per element and drifting:
 * the light-DOM render root, the fallback→upgrade handoff, and a
 * requestAnimationFrame retry for the pre-parse children problem.
 *
 * The rAF retry was wrong in both directions. sem-note had no guard, so a note
 * whose `.sem-note-body` was never authored re-queued a frame forever. sem-facts
 * and sem-details had a one-shot `#retrying` flag, so children streamed in by a
 * slow parse (or injected later) after that single frame were never picked up.
 * `whenChildrenReady` replaces both with a MutationObserver: it costs nothing
 * while idle, fires the moment the children exist however late that is, and
 * disconnects on resolve or on disconnect.
 *
 * Lit is a reactive-attribute and lifecycle harness here, nothing more. There is
 * no shadow DOM and no `static styles`: content must stay searchable, copyable
 * and styleable by plain theme CSS (PRD §4 rule 5).
 */
export class SemElement extends LitElement {
  #observers = new Set<MutationObserver>();
  #deferred: Map<string, () => void> | null = null;

  /** Light DOM — theme CSS styles the `.sem-*` classes directly. */
  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /**
   * Upgrade claim. The element claims `data-sem-upgraded` at connect —
   * before the bundle scan reaches it where possible — and the vanilla
   * handlers skip anything already claimed. One marker, one runtime:
   * every CSS hide-rule gates on it, and `<html>` carries it too for
   * hide rules that have no per-element host.
   */
  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('data-sem-upgraded', '');
    // Document-level marker: hide rules that have no per-element host
    // (`.incorrect-statement` in a list-view deck) gate on the root instead.
    this.ownerDocument?.documentElement?.setAttribute('data-sem-upgraded', '');
  }

  disconnectedCallback(): void {
    for (const observer of this.#observers) observer.disconnect();
    this.#observers.clear();
    super.disconnectedCallback();
  }

  /**
   * Resolve once at least one descendant matches `selector`.
   *
   * Custom elements upgrade before their children are parsed, so the first
   * `updated()` of a document-authored element routinely sees an empty subtree.
   * Checks immediately, then watches childList/subtree until a match appears.
   * Never resolves if the element disconnects first — by design; the caller is
   * gone.
   *
   * While the document is still parsing, resolution is held until
   * DOMContentLoaded. Otherwise the observer would fire on the *first* child
   * the streaming parser appends and a caller like sem-facts would wire itself
   * against a partial deck. Callers get the full match set either way.
   */
  whenChildrenReady(selector: string): Promise<Element[]> {
    const found = (): Element[] => Array.from(this.querySelectorAll(selector));

    const settle = (resolve: (v: Element[]) => void): void => {
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => resolve(found()), { once: true });
        return;
      }
      resolve(found());
    };

    if (found().length > 0) {
      return new Promise<Element[]>(settle);
    }

    return new Promise<Element[]>((resolve) => {
      const observer = new MutationObserver(() => {
        if (found().length === 0) return;
        observer.disconnect();
        this.#observers.delete(observer);
        settle(resolve);
      });
      this.#observers.add(observer);
      observer.observe(this, { childList: true, subtree: true });
    });
  }

  /**
   * Run `fn` once the document has finished parsing (immediately when it
   * already has). `key` names the write: while the parse is still running,
   * a repeated key replaces the pending function, so one element flushes
   * each write once at DOMContentLoaded. After the parse the key is not a
   * memo — each call runs, because each call is a fresh write from a
   * later update. Pending writes of an element that has disconnected by
   * the time the flush runs are dropped (it has nothing to write to). Attribute writes an element makes at parse time land
   * BEFORE the fallback core's DOMContentLoaded pass — including the
   * `sem-source` snapshot, which must see the authored markup — so
   * anything that is not needed for anti-flash gating goes through here.
   */
  afterParse(key: string, fn: () => void): void {
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      // One listener per element; repeated calls with the same key (a
      // reactive update during parse) replace the pending write.
      if (!this.#deferred) {
        this.#deferred = new Map();
        document.addEventListener('DOMContentLoaded', () => {
          const pending = this.#deferred!;
          this.#deferred = null;
          if (this.isConnected) pending.forEach((f) => f());
        }, { once: true });
      }
      this.#deferred.set(key, fn);
      return;
    }
    fn();
  }

  /** Bubbling, composed CustomEvent — sem-navigate / sem-flip / sem-complete. */
  emit<T>(name: string, detail?: T): boolean {
    return this.dispatchEvent(
      new CustomEvent<T>(name, { bubbles: true, composed: true, detail: detail as T }),
    );
  }

  /** Parse a comma/space separated attribute on this element. */
  tokens(attr: string): string[] {
    return parseTokens(this.getAttribute(attr));
  }

  /**
   * Is this element visible to the document's active audience profile?
   *
   * Same attributes the fallback and extraction read (spec/schema/
   * sem-audiences.md): the spec is this element's `data-audience` /
   * `audience`; the active profile is `<html data-audience>` (where the
   * fallback reflects the resolved profile), else the root wrapper's
   * `data-audience` default. With no profiles declared this returns true
   * for everything, and an unknown token fails open for the same reason.
   */
  audienceMatches(spec?: string | null): boolean {
    const requested =
      spec === undefined
        ? this.getAttribute('data-audience') ?? this.getAttribute('audience')
        : spec;
    return matches(requested, this.#activeProfile(), this.#closure());
  }

  #activeProfile(): string | null {
    const doc = this.ownerDocument;
    const onHtml = doc?.documentElement?.getAttribute('data-audience');
    if (onHtml) return onHtml;
    const wrapper = this.closest('sem-enhanced-document, .sem-enhanced-document');
    return wrapper?.getAttribute('data-audience') ?? wrapper?.getAttribute('audience') ?? null;
  }

  #closure(): AudienceClosure {
    return closureFor(this.ownerDocument ?? this);
  }

  /** Author-facing warning, same channel as the vanilla fallback handler. */
  warn(message: string): void {
    semWarn(message);
  }

  /**
   * Idempotent registration. Standalone documents inline their bundle, so two
   * concatenated documents (or a page that loads the bundle twice) would
   * otherwise throw on the second `customElements.define`.
   */
  static register(tag: string, ctor: CustomElementConstructor): void {
    if (typeof customElements === 'undefined') return;
    if (customElements.get(tag)) return;
    customElements.define(tag, ctor);
  }
}
