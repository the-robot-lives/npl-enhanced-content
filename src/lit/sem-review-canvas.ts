import { html, nothing, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { SemElement } from './base.js';
import {
  REVIEW_COMMENTS,
  REVIEW_AUTHOR,
  REVIEW_SCREENSHOT_SVG,
  REVIEW_VERDICT_LABELS,
  REVIEW_VERDICT_PENDING,
  type ReviewComment,
  type ReviewVerdict,
} from './fixtures/agent-kit/reviews.js';

/**
 * sem-review-canvas — agent-kit upsell stub (plan §2, reviews row).
 *
 * A fixture screenshot with pixel-anchored comment pins, a click-to-comment
 * draft flow, and a three-state verdict control (approve / request changes /
 * comment). Interaction-only: every byte on screen comes from
 * src/lit/fixtures/agent-kit/reviews.js — no fetch, no socket, no storage.
 *
 * Zero-JS contract (PRD degradation rule): the authored children ARE the
 * no-JS view — screenshot, inert pins, and the comments listed beside it.
 * Inline `reviewFallbackHtml()` from the fixture module to author it. On
 * upgrade this render replaces the fallback with the interactive canvas;
 * an empty element upgrades to the fixture canvas directly.
 *
 * Accessible: pins are real buttons with labels (aria-expanded when their
 * thread is open); the verdict control is a native radio group; the verdict
 * label is aria-live so a radio change is announced.
 *
 * Emits `sem-review-complete` (detail: {verdict, comments}) when the verdict
 * changes — the hook point the phase-2 transport will replace with
 * POST /reviews/:id/complete.
 */
export class SemReviewCanvas extends SemElement {
  static properties = {
    comments: {
      type: Array,
      converter: {
        fromAttribute: (value: string | null): ReviewComment[] | undefined => {
          if (value === null) return undefined;
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : undefined;
          } catch {
            return undefined;
          }
        },
      },
    },
    verdict: { type: String, reflect: true },
    activeId: { type: String, state: true },
    draft: { type: Object, state: true },
  };

  declare comments: ReviewComment[];
  declare verdict: ReviewVerdict | 'pending';
  declare activeId: string | null;
  declare draft: { x: number; y: number } | null;

  #localSeq = 0;

  constructor() {
    super();
    this.comments = REVIEW_COMMENTS;
    this.verdict = 'pending';
    this.activeId = null;
    this.draft = null;
  }

  updated(): void {
    // v0.6 CSS keys the verdict state off data-verdict, not `verdict`;
    // deferred like sem-note's variant — a parse-time write would leak
    // into the sem-source snapshot of a document-authored canvas.
    this.afterParse('verdict', () => this.setAttribute('data-verdict', this.verdict));
    // The authored children are the zero-JS view; once the interactive
    // canvas has rendered, they are a duplicate — take them down.
    this.querySelector(':scope > .sem-review-fallback')?.remove();
  }

  /** The open comment, or undefined when nothing is open. */
  #active(): ReviewComment | undefined {
    return this.comments.find((c) => c.id === this.activeId);
  }

  #openPin(c: ReviewComment): void {
    this.activeId = this.activeId === c.id ? null : c.id;
    this.draft = null;
  }

  /** Click on empty stage: place a draft pin at the click's percent position. */
  #onStageClick(e: MouseEvent): void {
    const target = e.target as Element;
    if (target.closest('.sem-review-pin, .sem-review-pop, .sem-review-draft')) return;
    const stage = target.closest('.sem-review-stage') ?? this.querySelector('.sem-review-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    this.activeId = null;
    this.draft = {
      x: Math.min(100, Math.max(0, Math.round(x * 10) / 10)),
      y: Math.min(100, Math.max(0, Math.round(y * 10) / 10)),
    };
  }

  #commitDraft(): void {
    const input = this.querySelector<HTMLInputElement>('.sem-review-draft-input');
    const body = (input?.value ?? '').trim();
    if (!body || !this.draft) {
      this.draft = null;
      return;
    }
    const comment: ReviewComment = {
      id: `local-${++this.#localSeq}`,
      x: this.draft.x,
      y: this.draft.y,
      author: REVIEW_AUTHOR,
      body,
      resolved: false,
    };
    this.comments = [...this.comments, comment];
    this.draft = null;
    this.activeId = comment.id;
  }

  #onVerdictChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    this.verdict = input.value as ReviewVerdict;
    this.emit('sem-review-complete', { verdict: this.verdict, comments: this.comments });
  }

  static #pinStyle(pos: { x: number; y: number }): string {
    return `--sem-review-x:${pos.x}%;--sem-review-y:${pos.y}%`;
  }

  render(): TemplateResult {
    const active = this.#active();
    return html`<div class="sem-review-ui">
      <figure class="sem-review-stage" @click=${this.#onStageClick}>
        ${unsafeHTML(REVIEW_SCREENSHOT_SVG)}
        ${this.comments.map(
          (c) => html`<button
            type="button"
            class="sem-review-pin"
            data-pin-id=${c.id}
            data-resolved=${c.resolved ? '' : nothing}
            style=${SemReviewCanvas.#pinStyle(c)}
            aria-label="Comment by ${c.author}: ${c.body}"
            aria-expanded=${this.activeId === c.id ? 'true' : 'false'}
            @click=${() => this.#openPin(c)}
          >
            ${c.id.startsWith('local-') ? '+' : c.id.slice(1)}
          </button>`,
        )}
        ${active
          ? html`<div
              class="sem-review-pop"
              data-comment-id=${active.id}
              style=${SemReviewCanvas.#pinStyle(active)}
            >
              <strong class="sem-review-pop-author">${active.author}</strong>
              <p class="sem-review-pop-body">${active.body}</p>
            </div>`
          : nothing}
        ${this.draft
          ? html`<div
              class="sem-review-draft"
              style=${SemReviewCanvas.#pinStyle(this.draft)}
            >
              <input
                class="sem-review-draft-input"
                type="text"
                placeholder="Add a comment"
                aria-label="New comment"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Escape') this.draft = null;
                }}
              />
              <button type="button" class="sem-review-draft-add" @click=${this.#commitDraft}>
                Add
              </button>
            </div>`
          : nothing}
      </figure>
      <fieldset class="sem-review-verdict" @change=${this.#onVerdictChange}>
        <legend>Verdict</legend>
        <label><input type="radio" name="sem-review-verdict" value="approve" /> Approve</label>
        <label><input type="radio" name="sem-review-verdict" value="changes" /> Request changes</label>
        <label><input type="radio" name="sem-review-verdict" value="comment" /> Comment</label>
      </fieldset>
      <p class="sem-review-verdict-label" aria-live="polite">${this.#verdictLabel()}</p>
    </div>`;
  }

  #verdictLabel(): string {
    return this.verdict === 'pending'
      ? REVIEW_VERDICT_PENDING
      : REVIEW_VERDICT_LABELS[this.verdict];
  }
}

SemElement.register('sem-review-canvas', SemReviewCanvas);
