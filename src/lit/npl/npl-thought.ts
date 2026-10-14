import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-thought — display-only typed associative thought bubble
 * (source: NPL thought blocks).
 *
 * The bubble is a container; its typed children are `npl-thought` tags
 * carrying a `type` attribute — one per NPL thought-block type. The
 * container itself stays untouched (authored children survive, light DOM);
 * each typed child annotates itself:
 *
 *   - known type    → class `npl-thought-<type>` and the `data-type`
 *                     mirror (dual-form contract, deferred past parse via
 *                     afterParse so a sem-source snapshot never sees the
 *                     runtime writes, exactly like sem-note / npl-example);
 *   - unknown type  → warning class `npl-thought-unknown` and the child's
 *                     content degraded to plain text (never rendered as
 *                     structured markup an unknown type did not promise);
 *   - no `type`     → a sub-container; nothing applied, children survive.
 *
 * `id` rides the global attribute catalog — optional, nothing to do.
 * Display-only: no render chrome, no events. Pattern proven by npl-example
 * (recipe: src/lit/npl/index.ts header).
 */

/** The NPL thought-block types `npl-thought` renders. */
export const THOUGHT_TYPES = [
  'observation',
  'tangent',
  'question',
  'relation',
  'concern',
  'affirmation',
  'reflection',
  'opportunity',
  'aversion',
  'interest',
  'eval',
] as const;

export type ThoughtType = (typeof THOUGHT_TYPES)[number];

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(THOUGHT_TYPES);

export class NplThought extends SemElement {
  static properties = {
    type: { type: String, reflect: true },
  };

  declare type: string;

  constructor() {
    super();
    this.type = '';
  }

  updated(): void {
    // Typed-child contract, deferred past parse (dual-form mirror + the
    // unknown-child flatten must not leak into a sem-source snapshot).
    this.afterParse('type', () => this.#applyType());
  }

  /** Annotate this bubble per its `type`: class, data-type mirror, flatten. */
  #applyType(): void {
    const authored = (nplParam(this, 'type', this.type) ?? '').trim();
    const type = authored.toLowerCase();
    if (type) {
      this.setAttribute('data-type', authored);
    } else {
      this.removeAttribute('data-type');
    }
    this.classList.remove(
      'npl-thought-unknown',
      ...THOUGHT_TYPES.map((t) => `npl-thought-${t}`),
    );
    if (!type) return;
    if (KNOWN_TYPES.has(type)) {
      this.classList.add(`npl-thought-${type}`);
      return;
    }
    // Unknown type: warning class + plain-text degradation of the content.
    this.classList.add('npl-thought-unknown');
    this.warn(`npl-thought: unknown thought type "${authored}" — rendering as plain text`);
    const text = this.textContent.trim();
    this.replaceChildren(this.ownerDocument.createTextNode(text));
  }

  /** Display-only: the typed children ARE the rendering; no generated chrome. */
  render() {
    return html``;
  }
}

defineNpl('npl-thought', NplThought);
