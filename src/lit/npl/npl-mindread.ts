import { html, nothing } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl } from './shared.js';

/**
 * npl-mindread — display-only upgrade of an NPL mindread block (theory-of-mind
 * reading of the other party; NoizuPromptLingo npl-full §3.6 Social Cognition).
 *
 * Authoring form:
 *
 *   <npl-mindread confidence="0.7">
 *     <subject>who</subject>
 *     <signals><signal type="tone">observed evidence</signal></signals>
 *     <inferred><motive/><mood/><cognitive/><unspoken/></inferred>
 *     <adaptation>concrete behavioral change</adaptation>
 *   </npl-mindread>
 *
 * Rendered: labelled sections in canonical order — subject, signals,
 * inferred, adaptation — with a confidence meter above them when the
 * parameter is present. All chrome is additive: authored children are
 * only relocated into canonical order and given generated labels, never
 * hidden or rewritten (light DOM, searchable, copyable).
 *
 * `confidence` is a number 0..1; out-of-range (or non-numeric) authored
 * values are clamped and marked on the host — `data-confidence` carries
 * the clamped value, `data-confidence-out-of-range` the authored one.
 * Signal types follow the NPL vocabulary (tone|pattern|omission|context|
 * contradiction|expertise); an unknown or missing type renders its chip
 * marked `npl-mindread-signal-unknown` — shown, never dropped.
 *
 * Schema is normative: spec/schema/npl/npl-mindread.md.
 */

const SECTIONS = ['subject', 'signals', 'inferred', 'adaptation'] as const;
const SECTION_LABELS: Record<(typeof SECTIONS)[number], string> = {
  subject: 'Subject',
  signals: 'Signals',
  inferred: 'Inferred',
  adaptation: 'Adaptation',
};

const INFERRED_FIELDS = ['motive', 'mood', 'cognitive', 'unspoken'] as const;
const FIELD_LABELS: Record<(typeof INFERRED_FIELDS)[number], string> = {
  motive: 'Motive',
  mood: 'Mood',
  cognitive: 'Cognitive',
  unspoken: 'Unspoken',
};

/** NPL mindread signal vocabulary (npl-syntax-reference §3.6). */
const SIGNAL_TYPES = ['tone', 'pattern', 'omission', 'context', 'contradiction', 'expertise'];

/** Any authored section at all — the whenChildrenReady watch selector. */
const SECTION_SELECTOR =
  ':scope > subject, :scope > signals, :scope > inferred, :scope > adaptation';

export class NplMindread extends SemElement {
  static properties = {
    confidence: { type: Number, reflect: true },
  };

  declare confidence: number | undefined;

  #wired = false;
  #awaitingChildren = false;
  #warnedTypes = new Set<string>();

  /**
   * Effective confidence for display/mirroring: null when the parameter is
   * absent; clamped into [0,1] otherwise (NaN — a non-numeric authoring —
   * clamps to 0). `out` marks any authored value that needed clamping.
   */
  #confidenceView(): { clamped: number; out: boolean } | null {
    const authored = this.confidence;
    if (authored === undefined) return null;
    if (Number.isNaN(authored)) return { clamped: 0, out: true };
    const clamped = Math.min(1, Math.max(0, authored));
    return { clamped, out: clamped !== authored };
  }

  updated(): void {
    const view = this.#confidenceView();
    // dual-form contract: the data-* spelling mirrors the bare attribute,
    // carrying the CLAMPED value; the authored one stays verbatim in the
    // out-of-range marker (deferred past parse, like sem-note).
    this.afterParse('confidence', () => {
      if (view === null) {
        this.removeAttribute('data-confidence');
        this.removeAttribute('data-confidence-out-of-range');
        return;
      }
      this.setAttribute('data-confidence', String(view.clamped));
      if (view.out) this.setAttribute('data-confidence-out-of-range', String(this.confidence));
      else this.removeAttribute('data-confidence-out-of-range');
    });

    if (this.#wired) return;
    if (this.querySelector(SECTION_SELECTOR)) {
      this.#wired = true;
      this.#layout();
    } else if (!this.#awaitingChildren) {
      // upgraded pre-parse: children aren't there yet at first update
      this.#awaitingChildren = true;
      void this.whenChildrenReady(SECTION_SELECTOR).then(() => {
        this.#awaitingChildren = false;
        this.#wired = true;
        this.#layout();
      });
    }
  }

  render() {
    const view = this.#confidenceView();
    if (view === null) return nothing;
    return html`<div class="npl-mindread-confidence">
      <span class="npl-mindread-confidence-label">Confidence</span>
      <span class="npl-mindread-confidence-value">${Math.round(view.clamped * 100)}%</span>
      ${view.out
        ? html`<span class="npl-mindread-confidence-out"
            >authored ${String(this.confidence)} — clamped</span
          >`
        : nothing}
    </div>`;
  }

  /**
   * One pass: label each authored section, decorate signals and inferred
   * fields, then move the sections into canonical order immediately after
   * the confidence chrome (Lit appended it last on first commit).
   */
  #layout(): void {
    let anchor: Element | null = this.querySelector(':scope > .npl-mindread-confidence');
    for (const name of SECTIONS) {
      const el = this.querySelector(':scope > ' + name);
      if (!el) continue;
      if (name === 'signals') this.#markSignals(el);
      if (name === 'inferred') this.#labelInferred(el);
      this.#generated(
        el,
        'h3',
        'npl-mindread-heading',
        SECTION_LABELS[name],
        (head) => head.matches('.npl-mindread-heading[data-npl-generated]'),
      );
      if (anchor) anchor.after(el);
      else this.appendChild(el);
      anchor = el;
    }
  }

  /** Mark each authored <signal type> with a type chip; unknown ones stay, flagged. */
  #markSignals(signals: Element): void {
    for (const sig of Array.from(signals.querySelectorAll(':scope > signal'))) {
      if (sig.querySelector(':scope > .npl-mindread-signal-type[data-npl-generated]')) continue;
      const type = sig.getAttribute('type');
      const known = type !== null && SIGNAL_TYPES.includes(type);
      const chip = document.createElement('span');
      chip.className = 'npl-mindread-signal-type';
      if (!known) {
        chip.classList.add('npl-mindread-signal-unknown');
        sig.setAttribute('data-unknown-signal-type', '');
        if (!this.#warnedTypes.has(String(type))) {
          this.#warnedTypes.add(String(type));
          this.warn(
            `npl-mindread: unknown signal type "${type ?? '(missing)'}" — known: ` +
              SIGNAL_TYPES.join(', '),
          );
        }
      }
      chip.textContent = type ?? 'signal';
      sig.insertAdjacentElement('afterbegin', chip);
    }
  }

  /** Label the authored motive/mood/cognitive/unspoken fields inside inferred. */
  #labelInferred(inferred: Element): void {
    for (const field of INFERRED_FIELDS) {
      const el = inferred.querySelector(':scope > ' + field);
      if (!el) continue;
      this.#generated(
        el,
        'span',
        'npl-mindread-field-label',
        FIELD_LABELS[field],
        (first) => first.matches('.npl-mindread-field-label[data-npl-generated]'),
      );
    }
  }

  /** Insert a generated label at the head of `el`, once. */
  #generated(
    el: Element,
    tag: string,
    className: string,
    text: string,
    already: (first: Element) => boolean,
  ): void {
    const first = el.firstElementChild;
    if (first && already(first)) return;
    const node = document.createElement(tag);
    node.className = className;
    node.setAttribute('data-npl-generated', '');
    node.textContent = text;
    el.insertAdjacentElement('afterbegin', node);
  }
}

defineNpl('npl-mindread', NplMindread);
