import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-ref — display-only rendering of an NPL ref block: post-hoc
 * reflection over a finished turn (spec/schema/npl/npl-ref.md).
 *
 * Sections are authored as the element's own children, in either spelling
 * (tag form `<assessment>`, alias form `.npl-assessment` — Appendix A):
 * assessment, improvements, validation, eval, fine-tune. Any subset, in
 * authored order. `variant` picks the presentation:
 *
 *   - full (default): each section is labelled in place — the authored
 *     element gains `.npl-ref-section` + `data-section` and a generated
 *     `.npl-ref-label` header. Authored markup is never moved or dropped.
 *   - compact: one emoji line per section, appended as a `.npl-ref-lines`
 *     list; the authored sections are hidden. JS-off keeps them visible —
 *     nothing is hidden or generated without JS.
 *
 * Light DOM per PRD §4 rule 5 (no shadow root, no static styles); all
 * generated chrome uses `.npl-ref-*` classes, so the authored text stays
 * searchable and copyable either way. Display-only: no events, no
 * interactivity — the reflection is read, not replayed.
 */

interface RefSection {
  readonly name: string;
  readonly label: string;
  readonly emoji: string;
}

const SECTIONS: readonly RefSection[] = [
  { name: 'assessment', label: 'Assessment', emoji: '🧭' },
  { name: 'improvements', label: 'Improvements', emoji: '✨' },
  { name: 'validation', label: 'Validation', emoji: '✅' },
  { name: 'eval', label: 'Eval', emoji: '🧪' },
  { name: 'fine-tune', label: 'Fine-tune', emoji: '🎯' },
];

/** Direct-child selector matching every section in either authoring form. */
const SECTION_SEL =
  ':scope > :is(' + SECTIONS.flatMap((s) => [s.name, '.npl-' + s.name]).join(', ') + ')';

/** One flat line of text for a section's authored content. */
const flatText = (el: Element): string => (el.textContent || '').replace(/\s+/g, ' ').trim();

/** Resolve which section an authored child is (tag or class spelling). */
function sectionOf(el: Element): RefSection | null {
  const tag = el.tagName.toLowerCase();
  return SECTIONS.find((s) => tag === s.name || el.classList.contains('npl-' + s.name)) ?? null;
}

export class NplRef extends SemElement {
  static properties = {
    variant: { type: String },
  };

  declare variant: string;

  #wired = false;
  #awaitingSections = false;

  constructor() {
    super();
    this.variant = 'full';
  }

  updated(): void {
    // dual-form contract: either spelling resolves, unknown values fall
    // back to full, and the resolved variant mirrors to data-variant
    // (deferred past parse, like sem-note's data-variant — a parse-time
    // write would leak into a sem-source snapshot).
    const variant = nplParam(this, 'variant', this.variant) === 'compact' ? 'compact' : 'full';
    this.afterParse('variant', () => this.setAttribute('data-variant', variant));

    if (this.#wired) return;
    const sections = this.#sections();
    if (sections.length === 0) {
      // element upgraded pre-parse: children aren't there yet at first update
      this.#awaitSections();
      return;
    }
    this.#wired = true;
    if (variant === 'compact') this.#renderCompact(sections);
    else this.#renderFull(sections);
  }

  /** Authored sections as `[element, section]` pairs, in authored order. */
  #sections(): Array<[Element, RefSection]> {
    const pairs: Array<[Element, RefSection]> = [];
    for (const el of Array.from(this.querySelectorAll(SECTION_SEL))) {
      const section = sectionOf(el);
      if (section) pairs.push([el, section]);
    }
    return pairs;
  }

  /** full: label each authored section in place; markup stays untouched. */
  #renderFull(pairs: Array<[Element, RefSection]>): void {
    for (const [el, section] of pairs) {
      el.classList.add('npl-ref-section');
      el.setAttribute('data-section', section.name);
      const label = document.createElement('div');
      label.className = 'npl-ref-label';
      label.textContent = section.label;
      el.insertBefore(label, el.firstChild);
    }
  }

  /** compact: hide the authored sections, append one emoji line each. */
  #renderCompact(pairs: Array<[Element, RefSection]>): void {
    const list = document.createElement('ul');
    list.className = 'npl-ref-lines';
    for (const [el, section] of pairs) {
      el.setAttribute('hidden', '');
      const line = document.createElement('li');
      line.className = 'npl-ref-line';
      line.setAttribute('data-section', section.name);
      line.textContent = `${section.emoji} ${section.label} — ${flatText(el)}`;
      list.appendChild(line);
    }
    this.appendChild(list);
  }

  #awaitSections(): void {
    if (this.#awaitingSections) return;
    this.#awaitingSections = true;
    void this.whenChildrenReady(SECTION_SEL).then(() => {
      this.#awaitingSections = false;
      this.requestUpdate();
    });
  }
}

defineNpl('npl-ref', NplRef);
