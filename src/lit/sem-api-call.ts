import { SemElement } from './base.js';
import { param } from '../shared/attr.js';
import { defTable } from './def-card.js';

/**
 * sem-api-call — the Lit upgrade of the API-call definition card
 * (spec/schema/sem-api-call.md). Light DOM per PRD §4 rule 5.
 *
 * Reads the authored contract once the document settles: `name` /
 * `method` / `endpoint` / `status` from the attributes, the description
 * from the container's own prose, and one row per `sem-api-param`
 * (either spelling). Renders a labelled card — header row
 * `METHOD endpoint` (method as a chip, status as a second chip), the
 * description as prose, and the shared definition table per non-empty
 * `in` group (query, header, body, response) — and marks the authored
 * rows `hidden` + `sem-apicall-source`: the tables carry the display
 * while the authored markup stays in the DOM so extraction reads the
 * enhanced page exactly as the JS-off one (spec/extraction.md §5). The
 * generated chrome classes (`sem-apicall-*`) are extraction chrome: the
 * description prose stays content.
 *
 * JS-off (and class-form documents, which never upgrade): the theme
 * vocabulary renders the authored markup as a definition — a
 * `METHOD endpoint` heading via `attr()`, rows as `name :: description`.
 */

const ROWS = 'sem-api-param, .sem-api-param';
const PREFIX = 'sem-apicall';
/** Display order of the `in` groups; unknown tokens group last. */
const GROUPS = ['query', 'header', 'body', 'response'];

export class SemApiCall extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.afterParse('sem-api-call', () => this.#wire());
  }

  #wire(): void {
    if (this.#wired || !this.isConnected) return;
    const rows = Array.from(this.querySelectorAll(ROWS)).filter(
      (r) => r.parentElement === this,
    );
    this.#wired = true;

    const head = document.createElement('div');
    head.className = PREFIX + '-head';
    const method = document.createElement('span');
    method.className = PREFIX + '-method';
    method.textContent = (param(this, 'method') || 'GET').toUpperCase();
    head.appendChild(method);
    const endpoint = document.createElement('code');
    endpoint.className = PREFIX + '-endpoint';
    endpoint.textContent = param(this, 'endpoint') || '';
    head.appendChild(endpoint);
    const name = param(this, 'name');
    if (name) {
      const span = document.createElement('span');
      span.className = PREFIX + '-name';
      span.textContent = name;
      head.appendChild(span);
    }
    const status = param(this, 'status');
    if (status) {
      const chip = document.createElement('span');
      chip.className = PREFIX + '-status';
      chip.textContent = status;
      head.appendChild(chip);
    }

    const desc = document.createElement('div');
    desc.className = PREFIX + '-desc';
    for (const node of Array.from(this.childNodes)) {
      if (node.nodeType === 1 && (node as Element).matches(ROWS)) continue;
      desc.appendChild(node);
    }

    this.replaceChildren(head, desc);

    // The authored rows STAY in the DOM (hidden, chrome-classed): the
    // extraction contract reads them off the enhanced page exactly as it
    // does off the JS-off one (spec/extraction.md §5). Only their
    // rendering is retired — the group tables above carry the display.
    for (const row of rows) {
      row.classList.add(PREFIX + '-source');
      row.setAttribute('hidden', '');
      this.appendChild(row);
    }

    if (rows.length === 0) return;
    const groups = document.createElement('div');
    groups.className = PREFIX + '-groups';
    const buckets = new Map<string, Element[]>();
    for (const row of rows) {
      const where = (param(row, 'in') || 'query').toLowerCase();
      const list = buckets.get(where) || [];
      list.push(row);
      buckets.set(where, list);
    }
    const ordered = [
      ...GROUPS.filter((g) => buckets.has(g)),
      ...Array.from(buckets.keys()).filter((g) => !GROUPS.includes(g)),
    ];
    for (const where of ordered) {
      const section = document.createElement('div');
      section.className = PREFIX + '-group ' + PREFIX + '-group-' + where;
      const label = document.createElement('div');
      label.className = PREFIX + '-group-label';
      label.textContent = where;
      section.appendChild(label);
      section.appendChild(defTable(buckets.get(where)!, PREFIX));
      groups.appendChild(section);
    }
    this.appendChild(groups);
  }
}

SemElement.register('sem-api-call', SemApiCall);
