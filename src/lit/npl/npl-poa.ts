import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-poa — the NPL plan-of-action block: a decision tree with weighted
 * reasoning, display-only (recipe: src/lit/npl/index.ts header).
 *
 * Source is the NPL `poa` block: a ```mermaid fence for the decision
 * tree, a `<reasoning>` element with the weighted paths, and a
 * `<selected>` element naming the chosen option. This component never
 * loads mermaid or any runtime library — the tree degrades to its own
 * source, which reads as a plain code block stamped with
 * `data-npl-poa-tree` (a host that WANTS a rendered diagram may attach
 * one later, keyed on that attribute; this component never will).
 *
 * Enhancement is decoration-in-place, the sem-facts pattern: authored
 * children ARE the content and survive untouched beside the generated
 * chrome; nothing is hidden and nothing is re-written.
 *
 *   - the fence's code block is tagged `data-npl-poa-tree` +
 *     `data-direction` (the no-renderer contract);
 *   - the selected option is re-presented prominently as a generated
 *     `.npl-poa-choice` (`-label` / `-text` spans) inserted after it —
 *     the authored `<selected>` remains the source of record, so themes
 *     wanting a single presentation may hide it under
 *     `data-sem-upgraded` in their own CSS;
 *   - `<reasoning>` is left exactly as authored.
 *
 * `direction` (`lr` | `td`, default `lr`) declares the intended flow and
 * mirrors to `data-direction` (afterParse, the dual-form contract). The
 * fence's own `graph LR`/`graph TD` line stays the renderer's source of
 * truth — authored source is never rewritten.
 */
const TREE = 'pre > code.language-mermaid';
const REASONING = ':is(reasoning, .npl-poa-reasoning)';
const SELECTED = ':is(selected, .npl-poa-selected)';
const ANY_CHILD = `${TREE}, ${REASONING}, ${SELECTED}`;
const DIRECTIONS = new Set(['lr', 'td']);

export class NplPoa extends SemElement {
  static properties = {
    direction: { type: String },
  };

  declare direction: string;

  #wired = false;

  constructor() {
    super();
    this.direction = 'lr';
  }

  /** Authored direction resolved to `lr`|`td` — anything else falls back, loudly. */
  #resolvedDirection(): string {
    const authored = nplParam(this, 'direction', this.direction);
    if (DIRECTIONS.has(authored)) return authored;
    this.warn(`npl-poa: direction must be "lr" or "td"; got "${authored}" — using "lr".`);
    return 'lr';
  }

  updated(): void {
    // dual-form contract: data-direction mirrors the resolved value,
    // deferred past parse (a parse-time write would leak into a
    // sem-source snapshot), like npl-example's label mirror.
    this.afterParse('direction', () => this.setAttribute('data-direction', this.#resolvedDirection()));
    if (this.#wired) return;
    this.#wired = true;
    // children routinely upgrade after the host (pre-parse upgrade);
    // whenChildrenReady waits however late they stream in.
    this.whenChildrenReady(ANY_CHILD).then(() => this.#enhance());
  }

  async #enhance(): Promise<void> {
    const direction = this.#resolvedDirection();

    // Degrade contract: the decision tree stays a readable code block.
    const fence = this.querySelector(TREE);
    if (fence) {
      const block = (fence.closest('pre') ?? fence) as HTMLElement;
      block.setAttribute('data-npl-poa-tree', '');
      block.setAttribute('data-direction', direction);
    } else {
      this.warn('npl-poa: no mermaid fence (pre > code.language-mermaid) authored; the decision tree is missing.');
    }

    // Prominent presentation of the chosen option.
    const selected = this.querySelector(SELECTED);
    if (selected) {
      selected.setAttribute('data-npl-poa-selected', '');
      const text = (selected.textContent ?? '').trim();
      if (text) {
        const choice = document.createElement('p');
        choice.className = 'npl-poa-choice';
        choice.setAttribute('data-direction', direction);
        const label = document.createElement('span');
        label.className = 'npl-poa-choice-label';
        label.textContent = 'selected';
        const value = document.createElement('span');
        value.className = 'npl-poa-choice-text';
        value.textContent = text;
        choice.append(label, value);
        selected.insertAdjacentElement('afterend', choice);
      }
    } else {
      this.warn('npl-poa: no <selected> (or .npl-poa-selected) authored; nothing to feature.');
    }
    // <reasoning> needs no enhancement — authored prose survives untouched.
  }
}

defineNpl('npl-poa', NplPoa);
