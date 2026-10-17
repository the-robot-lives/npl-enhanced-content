import { SemElement } from './base.js';
import { param } from '../shared/attr.js';
import { defTable, tokenChips } from './def-card.js';

/**
 * sem-tag-def — the Lit upgrade of the markup-tag definition card
 * (spec/schema/sem-tag-def.md). Light DOM per PRD §4 rule 5.
 *
 * Reads the authored contract once the document settles: `tag` / `name`
 * / `group` / `children` from the attributes, the description from the
 * container's own prose, and one row per `sem-tag-attr` (either
 * spelling). Renders a labelled card — header row, description, the
 * shared definition table (scoped column headers, no ARIA repair) and
 * the declared children as chips — and marks the authored rows
 * `hidden` + `sem-tagdef-source`: the table carries the display while
 * the authored markup stays in the DOM so extraction reads the enhanced
 * page exactly as the JS-off one (spec/extraction.md §5). The generated
 * chrome classes (`sem-tagdef-*`) are extraction chrome: the
 * description prose stays content.
 *
 * JS-off (and class-form documents, which never upgrade): the theme
 * vocabulary renders the authored markup as a definition — `data-tag`
 * heading via `attr()`, rows as `name :: description`.
 */

const ROWS = 'sem-tag-attr, .sem-tag-attr';
const PREFIX = 'sem-tagdef';

export class SemTagDef extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.afterParse('sem-tag-def', () => this.#wire());
  }

  #wire(): void {
    if (this.#wired || !this.isConnected) return;
    const rows = Array.from(this.querySelectorAll(ROWS)).filter(
      (r) => r.parentElement === this,
    );
    this.#wired = true;

    const head = document.createElement('div');
    head.className = PREFIX + '-head';
    const tag = document.createElement('code');
    tag.className = PREFIX + '-tag';
    tag.textContent = param(this, 'tag') || '';
    head.appendChild(tag);
    const name = param(this, 'name');
    if (name) {
      const span = document.createElement('span');
      span.className = PREFIX + '-name';
      span.textContent = name;
      head.appendChild(span);
    }
    const group = param(this, 'group');
    if (group) {
      const chip = document.createElement('span');
      chip.className = PREFIX + '-group';
      chip.textContent = group;
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
    // rendering is retired — the table above carries the display now.
    for (const row of rows) {
      row.classList.add(PREFIX + '-source');
      row.setAttribute('hidden', '');
      this.appendChild(row);
    }

    if (rows.length > 0) this.appendChild(defTable(rows, PREFIX));

    const children = (param(this, 'children') || '').trim();
    if (children) {
      this.appendChild(
        tokenChips(PREFIX, children.split(/[\s,]+/).filter(Boolean)),
      );
    }
  }
}

SemElement.register('sem-tag-def', SemTagDef);
