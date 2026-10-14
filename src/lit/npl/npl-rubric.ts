import { html, nothing, TemplateResult } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-rubric — display-only weighted scoring rubric (spec/schema/npl/
 * npl-rubric.md is normative). Authored as NPL rubric blocks:
 *
 *     <npl-rubric title="Code review">
 *       <npl-criterion name="Correctness" weight="3" score="4"></npl-criterion>
 *       <npl-criterion name="Style" weight="1" score="5"></npl-criterion>
 *       <npl-overall-score value="4.2"></npl-overall-score>  <!-- optional
 *     </npl-rubric>
 *
 * Each criterion carries `name`, `weight` and `score` (numbers; the data-*
 * spelling wins, per nplParam). An optional `npl-overall-score` child states
 * the overall score (`value` attribute, else its trimmed text). Without one
 * the component computes the weighted average — sum(weight · score) over
 * sum(weight) — and marks the figure computed; a stated figure wins and is
 * marked stated. Criteria whose weight is missing or non-numeric are marked
 * and excluded (as are criteria with no numeric score — NaN must not reach
 * the average).
 *
 * Display-only: one light-DOM `<table>`, no events, no interactivity. The
 * authored criterion/overall-score children are the data, not prose, so
 * once consumed the table replaces them and speaks for them (JS-off keeps
 * the authored markup untouched).
 */

const CRITERION = ':scope > :is(npl-criterion, .npl-criterion)';
const OVERALL = ':scope > :is(npl-overall-score, .npl-overall-score)';

interface RubricRow {
  name: string;
  weight: string;
  score: string;
  weightNum: number | null;
  scoreNum: number | null;
}

/** Numeric reader: null for missing, blank or non-finite values. */
function num(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export class NplRubric extends SemElement {
  static properties = {
    title: { type: String, reflect: true },
  };

  declare title: string;

  /** Collected model; null until the authored children have been read. */
  #rows: RubricRow[] | null = null;
  #overall: { value: number; source: 'stated' | 'computed' } | null = null;
  #awaiting = false;

  constructor() {
    super();
    this.title = '';
  }

  updated(): void {
    // dual-form contract: the data-* spelling mirrors the EFFECTIVE title
    // (data-title wins when both are authored), so CSS/extraction read one
    // form and an authored data-title is never clobbered by the empty
    // property default. Deferred past parse, like sem-note.
    const title = nplParam(this, 'title', this.title);
    this.afterParse('title', () => {
      if (this.getAttribute('data-title') !== title) this.setAttribute('data-title', title);
    });
    if (this.#rows !== null || this.#awaiting) return;
    this.#awaiting = true;
    void this.whenChildrenReady(CRITERION).then(() => this.#collect());
    // Zero-criterion rubrics (title/overall-score only) never satisfy
    // whenChildrenReady — collect at DOMContentLoaded regardless. #collect
    // is idempotent, so whichever path lands first wins.
    this.afterParse('collect', () => this.#collect());
  }

  #collect(): void {
    if (this.#rows !== null) return;
    this.#awaiting = false;
    const overallEl = this.querySelector(OVERALL);
    const rows: RubricRow[] = Array.from(this.querySelectorAll(CRITERION)).map((el) => {
      const weight = nplParam(el, 'weight');
      const score = nplParam(el, 'score');
      return {
        name: nplParam(el, 'name') ?? (el.textContent || '').trim(),
        weight: weight ?? '',
        score: score ?? '',
        weightNum: num(weight),
        scoreNum: num(score),
      };
    });
    // The authored children are data, not prose — lit's light-DOM render
    // replaces them with the table (authored markup stays untouched when JS
    // never runs), so the table is the only statement of the rubric.
    const stated = overallEl
      ? num(nplParam(overallEl, 'value') ?? (overallEl.textContent || '').trim())
      : null;
    if (stated !== null) {
      this.#overall = { value: stated, source: 'stated' };
    } else {
      const usable = rows.filter((r) => r.weightNum !== null && r.scoreNum !== null);
      const totalWeight = usable.reduce((sum, r) => sum + (r.weightNum as number), 0);
      if (totalWeight !== 0) {
        const weighted = usable.reduce(
          (sum, r) => sum + (r.weightNum as number) * (r.scoreNum as number),
          0,
        );
        this.#overall = { value: weighted / totalWeight, source: 'computed' };
      }
    }
    this.#rows = rows;
    this.requestUpdate();
  }

  render(): TemplateResult {
    if (this.#rows === null) return html``; // children not parsed yet
    // The effective title (data-title wins) names the table; class-form
    // authoring of the title renders the caption too, not just the mirror.
    const title = nplParam(this, 'title', this.title);
    // An entirely empty rubric renders nothing; title/overall-only still show.
    if (this.#rows.length === 0 && !title && this.#overall === null) return html``;
    return html`
      <table class="npl-rubric-table">
        ${title ? html`<caption class="npl-rubric-title">${title}</caption>` : nothing}
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            <th scope="col">Weight</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          ${this.#rows.map((row) => this.#row(row))}
        </tbody>
        <tfoot>
          <tr class="npl-rubric-overall" data-source=${this.#overall?.source ?? 'none'}>
            <th scope="row">
              Overall
              ${this.#overall
                ? html`<span class="npl-rubric-source">(${this.#overall.source})</span>`
                : nothing}
            </th>
            <td colspan="2" class="npl-rubric-overall-value">
              ${this.#overall ? String(this.#overall.value) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /** One criterion row; excluded rows stay visible, marked, out of the math. */
  #row(row: RubricRow): TemplateResult {
    const reasons: string[] = [];
    if (row.weightNum === null) reasons.push('no numeric weight');
    if (row.scoreNum === null) reasons.push('no numeric score');
    return html`
      <tr class="npl-rubric-criterion" data-excluded=${reasons.length ? reasons.join('; ') : nothing}>
        <th scope="row">
          ${row.name}
          ${reasons.length
            ? html`<span class="npl-rubric-flag">ignored — ${reasons.join('; ')}</span>`
            : nothing}
        </th>
        <td>${row.weight || '—'}</td>
        <td>${row.score || '—'}</td>
      </tr>
    `;
  }
}

defineNpl('npl-rubric', NplRubric);
