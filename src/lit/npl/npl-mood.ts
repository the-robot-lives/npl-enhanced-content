import { html, nothing } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/** Detail children (spec/schema/npl/npl-mood.md): all optional; when any
 *  is authored it is grouped, once, into a generated `.npl-mood-detail`
 *  panel — the sem-note body-wrap pattern, light DOM throughout. */
const DETAIL_SELECTOR =
  ':scope > .npl-mood-tone, :scope > .npl-mood-context, :scope > .npl-mood-approach';

/**
 * npl-mood — affective-state chip (display-only). Source: NPL mood blocks.
 *
 * `mood` (required): one emoji plus an optional qualifier string,
 * whitespace-separated (`mood="🙂 wistful"`). Children (tone, context,
 * approach) are optional; the self-closing form is valid with none.
 *
 * Pattern per the barrel recipe (src/lit/npl/index.ts header): SemElement
 * base — light DOM, no shadow root, no static styles; the `mood` parameter
 * as a reactive `static property`, mirrored to `data-mood` in `updated()`
 * through afterParse; `render()` emits the chip; authored children survive
 * (regrouped into the detail panel, never hidden or dropped).
 */
export class NplMood extends SemElement {
  static properties = {
    mood: { type: String, reflect: true },
  };

  declare mood: string;

  #awaitingDetail = false;

  constructor() {
    super();
    this.mood = '';
  }

  updated(): void {
    // dual-form contract: mirror the EFFECTIVE mood (data-* wins) to
    // `data-mood` so CSS/extraction read one form, deferred past parse like
    // sem-note. Read it back through nplParam rather than the `mood`
    // property: the property tracks only the bare attribute, so the
    // class-form `data-mood` authoring would otherwise be overwritten with
    // the empty constructor default (and a later re-render would blank the
    // chip). The guard leaves an already-correct `data-mood` untouched.
    const mood = nplParam(this, 'mood', this.mood);
    this.afterParse('mood', () => {
      if (this.getAttribute('data-mood') !== mood) this.setAttribute('data-mood', mood);
    });
    this.#buildDetail();
  }

  render() {
    const [emoji = '', ...rest] = nplParam(this, 'mood', this.mood)
      .trim()
      .split(/\s+/);
    const qualifier = rest.join(' ');
    return html`
      <span class="npl-mood-chip">
        <span class="npl-mood-emoji">${emoji}</span
        >${qualifier ? html` <span class="npl-mood-qualifier">${qualifier}</span>` : nothing}
      </span>
    `;
  }

  /** Group authored detail children into the panel — only when present;
   *  children may still be streaming in, so await them once via
   *  whenChildrenReady (which harmlessly never resolves for the
   *  self-closing form). Idempotent: an existing panel short-circuits. */
  #buildDetail(): void {
    if (this.querySelector('.npl-mood-detail')) return;
    const parts = Array.from(this.querySelectorAll(DETAIL_SELECTOR));
    if (parts.length === 0) {
      if (!this.#awaitingDetail) {
        this.#awaitingDetail = true;
        void this.whenChildrenReady(DETAIL_SELECTOR).then(() => {
          this.#awaitingDetail = false;
          this.requestUpdate();
        });
      }
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'npl-mood-detail';
    this.appendChild(panel);
    for (const part of parts) panel.appendChild(part);
  }
}

defineNpl('npl-mood', NplMood);
