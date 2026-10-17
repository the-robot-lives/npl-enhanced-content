import { param } from '../shared/attr.js';

/**
 * Shared card internals for the reference-definition components
 * (sem-tag-def / sem-api-call, spec/schema/*.md). Both render their
 * authored rows as a real `<table>` — scoped column headers, one row per
 * authored row, chrome-classed cells. Native table semantics; no ARIA
 * repair.
 */

/** One authored row → a `<tr>` of the definition table. */
function rowCells(row: Element, prefix: string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const cell = (cls: string, text: string): void => {
    const td = document.createElement('td');
    td.className = prefix + '-cell-' + cls;
    td.textContent = text;
    tr.appendChild(td);
  };
  const name = document.createElement('td');
  name.className = prefix + '-cell-name';
  const code = document.createElement('code');
  code.textContent = param(row, 'name') || '';
  name.appendChild(code);
  tr.appendChild(name);
  cell('type', param(row, 'type') || '—');
  cell('required', row.hasAttribute('required') ? 'required' : 'optional');
  cell('default', param(row, 'default') ?? '—');
  const allowed = (param(row, 'allowed') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .join(', ');
  cell('allowed', allowed || '—');
  cell('desc', (row.textContent || '').replace(/\s+/g, ' ').trim());
  return tr;
}

/** The six-column definition table for a batch of authored rows. */
export function defTable(rows: Element[], prefix: string): HTMLTableElement {
  const table = document.createElement('table');
  table.className = prefix + '-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const label of ['Name', 'Type', 'Required', 'Default', 'Values', 'Description']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const row of rows) tbody.appendChild(rowCells(row, prefix));
  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

/** A row's chip container for a comma/space token list (`children`). */
export function tokenChips(prefix: string, tokens: string[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = prefix + '-children';
  for (const token of tokens) {
    const chip = document.createElement('code');
    chip.className = prefix + '-child';
    chip.textContent = token;
    wrap.appendChild(chip);
  }
  return wrap;
}
