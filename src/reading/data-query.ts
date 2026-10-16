/**
 * reading/data-query — phase 5 view chrome: the bucket registry, the
 * declarative sem-data-join materialization, and the editable default query
 * (sem-data-query) with its Run chrome.
 *
 * Spec: spec/data-visualizer.md §2 (join/query element contracts), §3
 * (default editable query + views), §8 (the SQL subset). Pure engines live in
 * src/data/query.ts; this module is DOM wiring only.
 */

import { param } from '../shared/attr.js';
import { warn } from '../shared/audience.js';
import { inferSchema, parseViews, resolveView, visibleColumns, type TableData } from '../data/table.js';
import { joinBuckets, parseQuery, runQuery, type Bucket, type BucketSet } from '../data/query.js';
import { normalizeRef } from '../data/names.js';
import { buildTable, wireSort, applyView } from './data-tableview.js';

const VISUALIZER = 'sem-data-visualizer, .sem-data-visualizer';
const SOURCE = 'sem-data-source, .sem-data-source';

/* ------------------------------------------------------------------ *
 * Bucket registry — per visualizer, keyed by §5 normalized reference
 * ------------------------------------------------------------------ */

const registries = new WeakMap<Element, Map<string, Bucket>>();

/** Find the enclosing visualizer (custom element or fallback class). */
function containerOf(el: Element): Element | null {
  return el.closest(VISUALIZER);
}

/** Register quietly. True when the bucket is new or its contents changed. */
function registerQuiet(container: Element, name: string, table: TableData): boolean {
  const ref = normalizeRef(name);
  if (!ref) return false;
  const map = registries.get(container) ?? new Map();
  const prev = map.get(ref);
  const changed = !prev || JSON.stringify(prev.table) !== JSON.stringify(table);
  map.set(ref, { name, table });
  registries.set(container, map);
  return changed;
}

/** Register a named bucket and announce it (listeners re-run queries). */
export function registerBucket(el: Element, name: string, table: TableData): void {
  const container = containerOf(el);
  if (!container) return;
  if (registerQuiet(container, name, table)) {
    container.dispatchEvent(new CustomEvent('sem-data-bucket', { bubbles: true, detail: { name } }));
  }
}

export function bucketsFor(container: Element): BucketSet {
  return registries.get(container) ?? new Map();
}

/* ------------------------------------------------------------------ *
 * sem-data-join — declarative inner join over two named buckets
 * ------------------------------------------------------------------ */

function joinError(j: Element, message: string): void {
  j.querySelectorAll(':scope > .sem-data-error').forEach((n) => n.remove());
  const p = document.createElement('p');
  p.className = 'sem-data-error';
  // Runtime chrome (§2.4): positional mapping must skip it.
  p.setAttribute('data-sem-chrome', '');
  p.setAttribute('role', 'alert');
  p.textContent = 'sem-data-join: ' + message;
  j.appendChild(p);
  warn('sem-data-join: ' + message);
}

/** Buckets minted by joins, per container. Lets a failing run withdraw a
 * join's own previous result without ever touching a source bucket. */
const joinMinted = new WeakMap<Element, Set<string>>();

function mintedRefs(container: Element): Set<string> {
  let refs = joinMinted.get(container);
  if (!refs) {
    refs = new Set();
    joinMinted.set(container, refs);
  }
  return refs;
}

/** The authored name of the bucket a join minted under `ref` in this
 * container, if any. The source path (reading/data.ts) uses it to refuse
 * shadowing a join result — the mirror of the guard in wireJoins. */
export function joinMintedName(container: Element, ref: string): string | null {
  const r = normalizeRef(ref);
  return mintedRefs(container).has(r) ? bucketsFor(container).get(r)?.name ?? null : null;
}

/**
 * Materialize every direct sem-data-join child. Idempotent: re-running on a
 * bucket event recomputes and overwrites the registered join bucket, so a
 * late-arriving file/API source heals joins that referenced it.
 */
export function wireJoins(container: Element): void {
  let changed = false;
  container.querySelectorAll(':scope > sem-data-join, :scope > .sem-data-join').forEach((j) => {
    const name = (param(j, 'name') ?? '').trim();
    const left = (param(j, 'left') ?? '').trim();
    const right = (param(j, 'right') ?? '').trim();
    const on = (param(j, 'on') ?? '').trim();
    const ref = name ? normalizeRef(name) : '';
    const buckets = bucketsFor(container);
    // A failing run withdraws this join's own previous result (an
    // unresolved join registers no bucket) and drops its stale ok state.
    const fail = (message: string): void => {
      if (ref && mintedRefs(container).has(ref)) {
        mintedRefs(container).delete(ref);
        buckets.delete(ref);
        changed = true; // queries must re-run against the withdrawn bucket
      }
      j.removeAttribute('data-sem-join-state');
      joinError(j, message);
    };
    if (!name || !left || !right || !on) {
      fail('join needs data-name, data-left, data-right and data-on');
      return;
    }
    // A result bucket must not shadow a source bucket (authoring error);
    // re-materializing this join's own bucket is the idempotent path.
    const prior = buckets.get(ref);
    if (prior && !mintedRefs(container).has(ref)) {
      fail('join name "' + name + '" collides with existing bucket "' + prior.name + '"');
      return;
    }
    const lb = buckets.get(normalizeRef(left));
    const rb = buckets.get(normalizeRef(right));
    if (!lb) { fail('unknown bucket "' + left + '"'); return; }
    if (!rb) { fail('unknown bucket "' + right + '"'); return; }
    const joined = joinBuckets(lb, rb, on);
    if (!joined.ok) { fail(joined.error); return; }
    j.querySelectorAll(':scope > .sem-data-error').forEach((n) => n.remove());
    if (ref) mintedRefs(container).add(ref);
    // Quiet register: the single event fires below if anything changed —
    // a per-join dispatch would re-enter this very listener forever.
    if (registerQuiet(container, name, joined.table)) changed = true;
    j.setAttribute('data-sem-join-state', 'ok');
  });
  if (changed) {
    container.dispatchEvent(new CustomEvent('sem-data-bucket', { bubbles: true }));
  }
}

/* ------------------------------------------------------------------ *
 * sem-data-query — the editable default query
 * ------------------------------------------------------------------ */

interface Chrome {
  q: Element;
  results: HTMLElement;
  status: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  /** The editable textarea (deep links read and set it). */
  input: HTMLTextAreaElement;
  /** Re-run the chrome (the debounced-edit path shares this). */
  rerun: () => void;
  /** The authored statement, captured at wire time — edits diverge from it. */
  authored: string;
}

const chomes = new WeakMap<Element, Chrome>();

function runQueryChrome(chrome: Chrome, container: Element): void {
  const text = (chrome.q.textContent ?? '').trim();
  chrome.results.querySelectorAll(':scope > :is(.sem-data-body, .sem-data-query-error)').forEach((n) => n.remove());
  if (!text) {
    chrome.status.textContent = 'No query.';
    return;
  }
  const parsed = parseQuery(text);
  if (!parsed.ok) {
    const err = document.createElement('p');
    err.className = 'sem-data-query-error';
    // Runtime chrome (§2.4): positional mapping must skip it.
    err.setAttribute('data-sem-chrome', '');
    err.setAttribute('role', 'alert');
    err.textContent = 'sem-data-query: ' + parsed.error;
    chrome.results.appendChild(err);
    chrome.status.textContent = 'The query failed to run.';
    return;
  }
  const result = runQuery(parsed.ast, bucketsFor(container));
  if (!result.ok) {
    const err = document.createElement('p');
    err.className = 'sem-data-query-error';
    // Runtime chrome (§2.4): positional mapping must skip it.
    err.setAttribute('data-sem-chrome', '');
    err.setAttribute('role', 'alert');
    err.textContent = 'sem-data-query: ' + result.error;
    chrome.results.appendChild(err);
    chrome.status.textContent = 'The query failed to run.';
    return;
  }
  const schema = inferSchema(result.table);
  const body = document.createElement('div');
  body.className = 'sem-data-body';
  // Runtime chrome (§2.4): positional mapping must skip it.
  body.setAttribute('data-sem-chrome', '');
  const table = buildTable(result.table, schema, result.table.columns.map(() => true), '');
  body.appendChild(table);
  chrome.results.appendChild(body);
  wireSort(table, schema);
  chrome.status.textContent = result.table.rows.length + (result.table.rows.length === 1 ? ' row.' : ' rows.');
}

/**
 * Rewrite the live statement without dropping a parked `.sem-data-raw`
 * box (reading/data.ts parkPayload): the box's text tracks the edit, the
 * element's other children are untouched.
 */
function setStatement(q: Element, text: string): void {
  const raw = q.querySelector(':scope > .sem-data-raw');
  if (raw) raw.textContent = text;
  else q.textContent = text;
}

/** Wire one sem-data-query element: chrome after it, debounced re-runs. */
function wireQuery(q: Element, container: Element): void {
  if (q.hasAttribute('data-sem-query-wired')) return;
  q.setAttribute('data-sem-query-wired', '');

  const text = (q.textContent ?? '').trim();
  const chromeEl = document.createElement('div');
  chromeEl.className = 'sem-data-query-chrome';
  // Runtime chrome (§2.4): positional mapping must skip it.
  chromeEl.setAttribute('data-sem-chrome', '');

  const label = document.createElement('label');
  label.className = 'sem-data-query-label';
  const id = 'sem-data-query-input-' + Math.random().toString(36).slice(2, 8);
  label.setAttribute('for', id);
  label.textContent = 'Query — SELECT … FROM <bucket> (WHERE / ORDER BY / LIMIT)';
  chromeEl.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.id = id;
  textarea.className = 'sem-data-query-input';
  // Runtime chrome (§2.4): positional mapping must skip it.
  textarea.setAttribute('data-sem-chrome', '');
  textarea.rows = 3;
  textarea.spellcheck = false;
  textarea.value = text;
  chromeEl.appendChild(textarea);

  const controls = document.createElement('div');
  controls.className = 'sem-data-query-controls';
  // Runtime chrome (§2.4): positional mapping must skip it.
  controls.setAttribute('data-sem-chrome', '');
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'sem-data-query-run';
  // Runtime chrome (§2.4): positional mapping must skip it.
  runBtn.setAttribute('data-sem-chrome', '');
  runBtn.textContent = 'Run';
  controls.appendChild(runBtn);
  const status = document.createElement('span');
  status.className = 'sem-data-query-status';
  // Runtime chrome (§2.4): positional mapping must skip it.
  status.setAttribute('data-sem-chrome', '');
  status.setAttribute('role', 'status');
  controls.appendChild(status);
  chromeEl.appendChild(controls);

  const results = document.createElement('div');
  results.className = 'sem-data-query-results';
  chromeEl.appendChild(results);

  const rerun = (): void => runQueryChrome(chrome, container);
  const chrome: Chrome = { q, results, status, timer: null, input: textarea, rerun, authored: text };
  chomes.set(q, chrome);
  q.insertAdjacentElement('afterend', chromeEl);

  runBtn.addEventListener('click', rerun);
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); rerun(); }
  });
  textarea.addEventListener('input', () => {
    if (chrome.timer) clearTimeout(chrome.timer);
    chrome.timer = setTimeout(() => {
      // Editing rewrites the live query node so extraction and re-wire see
      // the current statement; the authored attribute stays untouched.
      setStatement(q, textarea.value);
      rerun();
    }, 300);
  });
  rerun();
}

const listening = new WeakSet<Element>();

/** Late-bucket reaction, wired once per visualizer: joins heal, queries re-run. */
function wireBucketListener(container: Element): void {
  if (listening.has(container)) return;
  listening.add(container);
  container.addEventListener('sem-data-bucket', () => {
    wireJoins(container);
    container.querySelectorAll('sem-data-query, .sem-data-query').forEach((q) => {
      const c = chomes.get(q);
      if (c) runQueryChrome(c, container);
    });
  });
}

/** Wire views + query chrome + joins for one visualizer container. */
export function wireQueryChrome(container: Element): void {
  wireJoins(container);
  container.querySelectorAll(':scope > sem-data-query, :scope > .sem-data-query').forEach((q) => wireQuery(q, container));
  wireBucketListener(container);
}

/* ------------------------------------------------------------------ *
 * View switch buttons (§3): ≥2 declared views get a button group
 * ------------------------------------------------------------------ */

export function wireViewButtons(src: Element, table: HTMLTableElement, columns: string[]): void {
  const views = parseViews(param(src, 'views'));
  if (views.length < 2 || !table) return;
  const current = resolveView(views, param(src, 'view'));
  const nav = document.createElement('div');
  nav.className = 'sem-data-views';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', 'Views');
  views.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sem-data-view';
    b.textContent = v.name;
    b.setAttribute('aria-pressed', v.name === current.name ? 'true' : 'false');
    b.addEventListener('click', () => {
      applyView(table, visibleColumns(v, columns));
      nav.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
    });
    nav.appendChild(b);
  });
  table.parentElement?.insertBefore(nav, table);
}

/* ------------------------------------------------------------------ *
 * Deep-link entry points (phase 6, §10): the modal module reads and sets
 * the edited default query through these — the Chrome map stays private.
 * ------------------------------------------------------------------ */

/** The first editable query's text when it diverges from the authored one. */
export function currentQueryEdit(container: Element): string | null {
  for (const q of Array.from(container.querySelectorAll('sem-data-query, .sem-data-query'))) {
    const c = chomes.get(q);
    if (!c) continue;
    const now = c.input.value.trim();
    return now !== c.authored ? now : null;
  }
  return null;
}

/** Set the default query's text (a deep link landed) and re-run. True when a wired chrome was found. */
export function setQueryText(container: Element, text: string): boolean {
  for (const q of Array.from(container.querySelectorAll('sem-data-query, .sem-data-query'))) {
    const c = chomes.get(q);
    if (!c) continue;
    c.input.value = text;
    setStatement(c.q, text);
    c.rerun();
    return true;
  }
  return false;
}

export { SOURCE, VISUALIZER };
