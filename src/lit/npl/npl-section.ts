import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-section — generic typed section for NPL prompt-section blocks.
 * Display-only chrome over untouched authored content (light DOM): known
 * `type` values get a labelled header and a derived class; unknown or
 * missing ones get a warning class, their content plain, and one
 * author-facing warning. `type="note"` is known but deliberately renders
 * as a plain section — sem-note (src/lit/sem-note.ts) already owns the
 * callout behaviour (collapse, `role`, variant), and none of it is
 * duplicated here.
 */

/** Known section types with their header labels (alphabetical by type). */
const SECTION_LABELS: Record<string, string> = {
  alg: 'Algorithm',
  'alg-pseudo': 'Pseudocode',
  diagram: 'Diagram',
  example: 'Example',
  format: 'Format',
  logic: 'Logic',
  note: 'Note',
  syntax: 'Syntax',
  template: 'Template',
};

export class NplSection extends SemElement {
  static properties = {
    type: { type: String, reflect: true },
  };

  declare type: string;

  /** Derived class currently on the host (swapped atomically). */
  #chromeClass: string | null = null;
  /** Offending type values already warned about (one warn per value). */
  #warned = new Set<string>();

  constructor() {
    super();
    this.type = '';
  }

  /** Resolved type: the data-* spelling wins when both are authored. */
  #resolved(): string {
    const authored = nplParam(this, 'type', this.type);
    return authored ? authored : '';
  }

  updated(): void {
    // dual-form contract: data-type mirrors type (deferred past parse,
    // like sem-note — a parse-time write would leak into a sem-source
    // snapshot). An empty resolution removes the mirror, so the
    // attribute never reads as an authored empty value.
    this.afterParse('type', () => {
      const resolved = this.#resolved();
      if (resolved) this.setAttribute('data-type', resolved);
      else this.removeAttribute('data-type');
    });
    this.#syncChrome();
  }

  /**
   * Known type → `npl-section-<type>` on the host and a
   * `.npl-section-header` label as the first child (content untouched
   * beneath it, however late it parses in). Unknown or missing → the
   * header goes, `npl-section-warning` replaces the class, authored
   * content reads plain, and the author channel warns once per value.
   */
  #syncChrome(): void {
    const resolved = this.#resolved();
    const label = SECTION_LABELS[resolved];
    this.#applyClass(label !== undefined ? `npl-section-${resolved}` : 'npl-section-warning');

    let header = this.querySelector(':scope > .npl-section-header');
    if (label === undefined) {
      header?.remove();
      if (!this.#warned.has(resolved)) {
        this.#warned.add(resolved);
        this.warn(
          resolved
            ? `npl-section: unknown type "${resolved}" — expected one of: ${Object.keys(SECTION_LABELS).join(', ')}`
            : `npl-section: requires a type attribute — expected one of: ${Object.keys(SECTION_LABELS).join(', ')}`,
        );
      }
      return;
    }
    if (!header) {
      header = document.createElement('div');
      header.className = 'npl-section-header';
    }
    header.textContent = label;
    if (this.firstChild !== header) this.insertBefore(header, this.firstChild);
  }

  #applyClass(want: string): void {
    if (this.#chromeClass === want) return;
    if (this.#chromeClass) this.classList.remove(this.#chromeClass);
    this.classList.add(want);
    this.#chromeClass = want;
  }
}

defineNpl('npl-section', NplSection);
