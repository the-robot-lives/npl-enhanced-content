import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-intent — display-only render of an NPL intent block: its goal
 * (the overview), scope, outcomes and an assumptions grid.
 *
 * Recipe: src/lit/npl/index.ts header. Light DOM via the SemElement base
 * (no shadow root, no `static styles`); authored children survive beside
 * the generated chrome so the block stays searchable and copyable.
 * `id` and `kind` ride the global attribute catalog (conventions §2) —
 * read with nplParam when needed, never re-declared; this component has
 * no own parameters, so there are no `static properties` to mirror.
 *
 * Children, in order:
 *   <npl-intent-overview>    the goal — labelled "Goal"
 *   <npl-intent-scope>       what is in and out — labelled "Scope"
 *   <npl-intent-outcomes>    what success looks like — labelled "Outcomes"
 *   <npl-intent-assumptions> the grid — labelled "Assumptions"
 *
 * The assumptions child is a grid of rows
 * (<npl-intent-assumption>, optional `confidence` parameter, either
 * spelling): enhanced, the rows become a two-column <table>
 * (Assumption | Confidence); the row text is moved into the cells, not
 * regenerated, so it stays searchable. With JS off nothing is hidden or
 * generated — the rows read as authored prose in the vocabulary's boxes.
 */

/** Dual-form child selector (conventions Appendix A): tag or class alias. */
const nplChild = (name: string): string =>
  `:scope > :is(npl-intent-${name}, .npl-intent-${name})`;

const OVERVIEW = nplChild('overview');
const SCOPE = nplChild('scope');
const OUTCOMES = nplChild('outcomes');
const ASSUMPTIONS = nplChild('assumptions');
const ROW = nplChild('assumption');

/** Any recognized section: the upgrade gate for an authored block. */
const ANY_SECTION = [OVERVIEW, SCOPE, OUTCOMES, ASSUMPTIONS].join(',');

/** Section chrome, authored order; the pair's second half is the label. */
const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['overview', 'Goal'],
  ['scope', 'Scope'],
  ['outcomes', 'Outcomes'],
  ['assumptions', 'Assumptions'],
];

export class NplIntent extends SemElement {
  #built = false;
  #awaited = false;

  updated(): void {
    if (this.#built) return;
    // Lit upgrades before the parser reaches the children: build now when
    // a section already exists, wait one step when the document is still
    // parsing, and never generate chrome for a block with no sections.
    if (this.querySelector(ANY_SECTION)) {
      this.#built = true;
      this.#enhance();
      return;
    }
    if (!this.#awaited && document.readyState === 'loading') {
      this.#awaited = true;
      void this.whenChildrenReady(':scope > *').then(() => this.requestUpdate());
      return;
    }
    this.#built = true;
  }

  #enhance(): void {
    for (const [name, label] of SECTIONS) {
      const section = this.querySelector(nplChild(name));
      if (!section || section.querySelector(':scope > .npl-intent-label')) continue;
      const chrome = document.createElement('span');
      chrome.className = 'npl-intent-label';
      chrome.textContent = label;
      section.insertBefore(chrome, section.firstChild);
      if (name === 'assumptions') this.#buildGrid(section);
    }
  }

  /** Render the authored assumption rows as a two-column table in place. */
  #buildGrid(grid: Element): void {
    if (grid.querySelector('.npl-intent-assumptions-table')) return;
    const rows = Array.from(grid.querySelectorAll(ROW));
    if (rows.length === 0) return;

    const table = document.createElement('table');
    table.className = 'npl-intent-assumptions-table';
    grid.insertBefore(table, rows[0]); // takes the rows' place, after the label

    const head = table.createTHead();
    const headRow = head.insertRow();
    for (const title of ['Assumption', 'Confidence']) {
      const th = document.createElement('th');
      th.textContent = title;
      headRow.appendChild(th);
    }

    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      const text = tr.insertCell();
      text.className = 'npl-intent-assumption-text';
      text.textContent = (row.textContent || '').trim();
      const confidence = tr.insertCell();
      confidence.className = 'npl-intent-assumption-confidence';
      confidence.textContent = nplParam(row, 'confidence', '—');
      row.remove();
    }
  }
}

defineNpl('npl-intent', NplIntent);
