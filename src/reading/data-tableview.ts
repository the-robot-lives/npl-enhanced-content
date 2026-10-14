/**
 * reading/data-tableview — table DOM + sort + views (phase 1/5 chrome),
 * split out of data.ts so the query chrome (data-query.ts) can reuse the
 * exact same table builder and sort wiring without an import cycle.
 */

import type { ColumnSchema, ColumnType } from '../data/table.js';

export const STAMP = 'data-sem-source-index';

export function buildTable(
  table: { columns: string[]; rows: string[][] },
  schema: ColumnSchema[],
  shown: boolean[],
  name: string,
): HTMLTableElement {
  const el = document.createElement('table');
  if (name) {
    const caption = document.createElement('caption');
    caption.textContent = name;
    el.appendChild(caption);
  }
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  table.columns.forEach((col, k) => {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = col;
    // Views hide columns with native `hidden` — the data stays in the DOM,
    // so extraction and a later view switch never lose it.
    if (!shown[k]) th.setAttribute('hidden', '');
    if (schema[k].nullable) th.setAttribute('data-nullable', '');
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  el.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell, k) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (!shown[k]) td.setAttribute('hidden', '');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
  return el;
}

/** Flip a rendered table to a view: toggle native `hidden` per column index. */
export function applyView(table: HTMLTableElement, shown: boolean[]): void {
  const heads = table.querySelectorAll(':scope > thead > tr:first-of-type > th');
  heads.forEach((th, k) => {
    if (shown[k]) th.removeAttribute('hidden');
    else th.setAttribute('hidden', '');
  });
  table.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    Array.from((tr as HTMLTableRowElement).cells).forEach((td, k) => {
      if (shown[k]) td.removeAttribute('hidden');
      else td.setAttribute('hidden', '');
    });
  });
}

/* Sort — the sem-table contract, typed by the inferred schema. */

function sortKey(type: ColumnType, text: string): number | boolean | string | null {
  if (text === '') return null;
  switch (type) {
    case 'integer':
    case 'number':
      return +text;
    case 'boolean':
      return text === 'true';
    case 'date':
      return Date.parse(text);
    default:
      return text;
  }
}

function compareValues(a: ReturnType<typeof sortKey>, b: ReturnType<typeof sortKey>): number {
  // Nulls sort last regardless of direction (handled by the caller's sign).
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return +a - +b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function wireSort(table: HTMLTableElement, schema: ColumnSchema[]): void {
  if (!table) return;
  const rows = (): HTMLTableRowElement[] =>
    Array.from(table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr'));
  rows().forEach((r, i) => {
    if (!r.hasAttribute(STAMP)) r.setAttribute(STAMP, String(i));
  });
  // A row inserted after enhancement has no stamp; treat it as 0.
  const stamp = (r: Element): number => +(r.getAttribute(STAMP) || 0);

  const heads = Array.from(
    table.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr:first-of-type > th'),
  );
  heads.forEach((th, col) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sem-data-sort';
    while (th.firstChild) b.appendChild(th.firstChild);
    th.appendChild(b);
    th.setAttribute('aria-sort', 'none');
    b.addEventListener('click', () => {
      const was = th.getAttribute('aria-sort');
      const dir = was === 'ascending' ? 'descending' : was === 'descending' ? 'none' : 'ascending';
      heads.forEach((h) => h.setAttribute('aria-sort', h === th ? dir : 'none'));
      const type = schema[col]?.type ?? 'string';
      const sign = dir === 'descending' ? -1 : 1;
      const cmp = (p: HTMLTableRowElement, q: HTMLTableRowElement): number =>
        (dir === 'none'
          ? 0
          : sign * compareValues(sortKey(type, (p.cells[col]?.textContent || '').trim()),
            sortKey(type, (q.cells[col]?.textContent || '').trim()))) ||
        stamp(p) - stamp(q);
      // Sort within each <tbody>; a sort reorders rows, it never re-parents
      // them, and the stamp keeps authored order as the tiebreak.
      const bodies = new Map<HTMLElement, HTMLTableRowElement[]>();
      rows().forEach((r) => {
        const body = r.parentElement as HTMLElement;
        (bodies.get(body) || bodies.set(body, []).get(body)!).push(r);
      });
      bodies.forEach((list, body) => list.sort(cmp).forEach((r) => body.appendChild(r)));
    });
  });
}
