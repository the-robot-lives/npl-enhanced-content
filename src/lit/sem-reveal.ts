import { SemElement } from './base.js';
import { deriveSummary, normalize } from '../shared/summary.js';

/**
 * sem-reveal — the Lit upgrade of the Q→A disclosure (tag form; the
 * `div.sem-reveal` class alias keeps the native-details fallback).
 * Light DOM per PRD §4 rule 5 — theme CSS styles the `.sem-reveal-*`
 * classes directly.
 *
 * Round-2 contract (semtext.dev feedback): the body is HIDDEN until the
 * reader acts. The hidden state must read as an affordance, not as
 * broken rendering — theme CSS blurs and clips the body while the
 * control carries the label and a small-caps "Reveal" hint. The control
 * is a real `<button>` (native focus, Enter/Space, `aria-expanded`,
 * `aria-controls`); the body is `inert` + `aria-hidden` while hidden so
 * screen readers meet the same wall sighted readers do.
 *
 * The reveal is one-way, like sem-details' occlusion: after the click
 * the control is replaced by a small-caps heading carrying the same
 * label, the body joins the accessibility tree, and the host is marked
 * `data-revealed` (the CSS blur gate).
 *
 * Attributes: `summary`/`data-summary` label (derived from the leading
 * body text when absent — shared/summary.ts, the same rule extraction
 * uses); `open` starts revealed (no control, body live immediately);
 * `collapsed` is accepted for back-compat and is a no-op — hidden is
 * the default now.
 */
let bodySeq = 0;

export class SemReveal extends SemElement {
  #wired = false;
  #watching = false;
  #observer: MutationObserver | null = null;

  updated(): void {
    if (this.#wired) return;
    // Children stream in after the start tag upgrades the element;
    // afterParse holds the wrap until the document settles.
    this.afterParse('sem-reveal', () => this.#wire());
  }

  disconnectedCallback(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    super.disconnectedCallback();
  }

  #wire(): void {
    if (this.#wired || !this.isConnected) return;
    if (this.childNodes.length === 0) {
      // Authored empty (or content injected later than DOMContentLoaded):
      // watch once for the first child, then wire.
      if (!this.#watching) {
        this.#watching = true;
        this.#observer = new MutationObserver(() => {
          if (this.childNodes.length === 0) return;
          this.#observer?.disconnect();
          this.#observer = null;
          this.#wire();
        });
        this.#observer.observe(this, { childList: true });
      }
      return;
    }
    this.#wired = true;

    const label =
      this.getAttribute('data-summary') ??
      this.getAttribute('summary') ??
      deriveSummary(normalize(this.textContent ?? ''));
    if (label) this.setAttribute('data-summary', label);

    const body = document.createElement('div');
    body.className = 'sem-reveal-body';
    while (this.firstChild) body.appendChild(this.firstChild);

    if (this.hasAttribute('open')) {
      // Author pinned the revealed state: no control, no hiding at all.
      const head = document.createElement('div');
      head.className = 'sem-reveal-head';
      head.textContent = label ?? '';
      this.appendChild(head);
      this.appendChild(body);
      this.setAttribute('data-revealed', '');
      return;
    }

    const bodyId = `sem-reveal-body-${++bodySeq}`;
    body.id = bodyId;
    body.setAttribute('inert', '');
    body.setAttribute('aria-hidden', 'true');

    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'sem-reveal-control';
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', bodyId);
    const name = document.createElement('span');
    name.className = 'sem-reveal-label';
    name.textContent = label ?? '';
    const hint = document.createElement('span');
    hint.className = 'sem-reveal-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Reveal';
    control.appendChild(name);
    control.appendChild(hint);

    this.appendChild(control);
    this.appendChild(body);
    control.addEventListener('click', () => this.#reveal(control, body));
  }

  /** One-way: the control becomes a heading; the body joins the tree. */
  #reveal(control: HTMLButtonElement, body: HTMLElement): void {
    control.setAttribute('aria-expanded', 'true');
    const head = document.createElement('div');
    head.className = 'sem-reveal-head';
    head.textContent = this.getAttribute('data-summary') ?? '';
    control.replaceWith(head);
    body.removeAttribute('inert');
    body.removeAttribute('aria-hidden');
    this.setAttribute('data-revealed', '');
  }
}

SemElement.register('sem-reveal', SemReveal);
