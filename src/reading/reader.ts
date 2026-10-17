/**
 * reading/reader — sem-reader: outline, progress and reader-side controls.
 *
 * Spec: spec/schema/sem-reader.md. One chrome per document, idempotent on
 * the chrome's presence so the bundle scan and the Lit wrapper may both
 * run. The reader writes three places and reads them back: attributes on
 * <html> (`data-sem-mode`, `data-sem-type`, `data-sem-font`,
 * `data-color-mode`) which the vocabulary CSS keys on; the `sem-audience`
 * hash parameter (shared/state) which the audience fallback applies; and
 * localStorage (fail-open) for the per-reader preferences. It never sets
 * `hidden` and never touches content — extraction skips it entirely.
 *
 * Outline links are plain `#id` anchors: the vanilla core's deep-link
 * resolver (vanilla/target.ts) answers the resulting `hashchange` and
 * opens whatever encloses the heading (closed reveal, inactive view), so
 * the outline stays complete instead of skipping hidden headings.
 *
 * Every listener and observer is recorded and released by
 * `disposeReaderElement`, which the Lit wrapper calls on disconnect.
 *
 * No global key bindings: `Escape` is handled only while focus is inside
 * the reader (spec a11y contract). Written tight: this is the largest
 * module in a budgeted bundle.
 */

import { param } from '../shared/attr.js';
import { parseProfiles } from '../shared/audience.js';
import { getParam, setParam, readLocal, writeLocal } from '../shared/state.js';

export const READER = ':is(sem-reader, .sem-reader)';
const WRAPPER = ':is(sem-enhanced-document, .sem-enhanced-document)';
const SIZES = ['s', 'm', 'l'];
const KEY = 'sem-reader:';
/** preference → [attribute on <html>, control that owns it]. */
const PREF: Record<string, [string, string]> = {
  mode: ['data-sem-mode', 'focus'], type: ['data-sem-type', 'type'],
  font: ['data-sem-font', 'type'], color: ['data-color-mode', 'color'],
};
/** Two-state toggles: act → [preference, on-value]. */
const TOGGLE: Record<string, [string, string]> = { focus: ['mode', 'focus'], font: ['font', 'serif'] };

const disposers = new WeakMap<Element, (() => void)[]>();
const root = (): HTMLElement => document.documentElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function get(pref: string): string {
  return root().getAttribute(PREF[pref][0]) || '';
}

/** Apply a preference to <html> (empty removes) and persist it, fail-open. */
function set(pref: string, value: string): void {
  if (value) root().setAttribute(PREF[pref][0], value);
  else root().removeAttribute(PREF[pref][0]);
  writeLocal(KEY + pref, value);
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function outline(reader: Element, depth: number): HTMLElement {
  const nav = el('nav', 'sem-reader-outline');
  nav.setAttribute('aria-label', 'Contents');
  const scope = reader.closest(WRAPPER) || document.body;
  let sel = '';
  for (let l = 2; l <= depth; l++) sel += (sel ? ',h' : 'h') + l;
  // The root list is the h2 level: sibling h2s stay flat, an h3 nests
  // under the h2 before it, a leading h3 with no h2 sits at the root.
  const stack: { level: number; list: HTMLOListElement }[] = [{ level: 2, list: el('ol', '') }];
  nav.appendChild(stack[0].list);
  let n = 0;
  scope.querySelectorAll<HTMLElement>(sel).forEach((h) => {
    // headings rendered inside a sem-md are that record's content, not
    // the document's outline (spec/schema/sem-md.md)
    if (reader.contains(h) || h.closest('.sem-md-body')) return;
    // an id on a heading that mints a record would change extraction
    if (!h.id && (param(h, 'kind') !== null || param(h, 'tags') !== null)) return;
    if (!h.id) h.id = 'sem-h-' + ++n;
    const level = +h.tagName[1];
    // Pop only deeper levels: sibling h3s share one sub-list.
    while (stack.length > 1 && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    const last = top.list.lastElementChild;
    if (level > top.level && last) {
      top = { level, list: el('ol', '') };
      last.appendChild(top.list);
      stack.push(top);
    }
    const a = el('a', '', h.textContent!.trim() || h.id);
    a.href = '#' + h.id;
    top.list.appendChild(el('li', '')).appendChild(a);
  });
  return nav;
}

/** `aria-current="location"` on the link of the topmost heading in view. */
function track(nav: HTMLElement, bin: (() => void)[]): void {
  if (typeof IntersectionObserver == 'undefined') return;
  const links = new Map<Element, Element>();
  nav.querySelectorAll('a[href^="#"]').forEach((a) => {
    const t = document.getElementById(decode(a.getAttribute('href')!.slice(1)));
    if (t) links.set(t, a);
  });
  // Document order, not link order: an authored nav may list out of order.
  const targets = Array.from(links.keys()).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const visible = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
    const first = targets.find((t) => visible.has(t));
    if (first) links.forEach((a, t) => (t == first ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
  }, { rootMargin: '0px 0px -40% 0px' });
  targets.forEach((t) => io.observe(t));
  bin.push(() => io.disconnect());
}

function on(bin: (() => void)[], target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
  target.addEventListener(type, fn, opts);
  bin.push(() => target.removeEventListener(type, fn, opts));
}

function progress(chrome: HTMLElement, bin: (() => void)[]): void {
  const bar = el('div', 'sem-reader-progress');
  bar.setAttribute('aria-hidden', 'true');
  const fill = bar.appendChild(el('div', 'sem-reader-progress-fill'));
  chrome.appendChild(bar);
  const update = (): void => {
    const d = root();
    const max = d.scrollHeight - d.clientHeight;
    fill.style.width = (max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0).toFixed(1) + '%';
  };
  on(bin, window, 'scroll', update, { passive: true });
  on(bin, window, 'resize', update);
  update();
}

function select(cls: string, label: string, options: [string, string][]): HTMLSelectElement {
  const s = el('select', cls);
  s.setAttribute('aria-label', label);
  options.forEach(([v, t]) => {
    const o = s.appendChild(el('option', '', t));
    o.value = v;
  });
  return s;
}

/** Release every listener and observer the reader installed; chrome stays. */
export function disposeReaderElement(reader: Element): void {
  (disposers.get(reader) || []).forEach((f) => f());
  disposers.delete(reader);
}

export function enhanceReaderElement(reader: Element): void {
  if (reader.querySelector(':scope > .sem-reader-chrome')) return;
  const bin: (() => void)[] = [];
  disposers.set(reader, bin);
  const controls = (param(reader, 'controls') ?? 'outline,progress').split(/[,\s]+/);
  const has = (c: string): boolean => controls.indexOf(c) >= 0;
  // Persisted preferences are restored only for the controls this reader
  // offers: a document without a colour control keeps its own scheme.
  for (const pref in PREF) {
    const v = readLocal(KEY + pref);
    if (v && has(PREF[pref][1])) root().setAttribute(PREF[pref][0], v);
  }

  const chrome = el('div', 'sem-reader-chrome');
  chrome.setAttribute('role', 'region');
  chrome.setAttribute('aria-label', 'Reading controls');
  const button = (act: string, text: string, pressed?: boolean): HTMLButtonElement => {
    const b = chrome.appendChild(el('button', '', text));
    b.type = 'button';
    b.setAttribute('data-act', act);
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    return b;
  };

  let nav: HTMLElement | null = null;
  let toggle: HTMLButtonElement | null = null;
  if (has('outline')) {
    nav = reader.querySelector<HTMLElement>(':scope > nav[aria-label="Contents"]');
    if (!nav) {
      const depth = Math.min(6, Math.max(2, +(param(reader, 'outline-depth') || 3) || 3));
      nav = reader.appendChild(outline(reader, depth));
    }
    if (!nav.id) nav.id = (reader.id || 'sem-reader') + '-outline';
    nav.hidden = true;
    toggle = button('outline', 'Contents');
    toggle.className = 'sem-reader-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', nav.id);
    track(nav, bin);
  }
  if (has('progress')) progress(chrome, bin);
  if (has('focus')) button('focus', 'Focus', get('mode') == 'focus');

  const size = (): number => Math.max(0, SIZES.indexOf(get('type') || 'm'));
  const steps: HTMLButtonElement[] = [];
  if (has('type')) {
    steps.push(button('type-down', 'A−'), button('type-up', 'A+'));
    steps[0].setAttribute('aria-label', 'Smaller type');
    steps[1].setAttribute('aria-label', 'Larger type');
    button('font', 'Serif', get('font') == 'serif');
  }
  const syncType = (): void => {
    if (!steps.length) return;
    steps[0].disabled = size() == 0;
    steps[1].disabled = size() == 2;
  };
  syncType();

  if (has('color')) {
    const s = chrome.appendChild(select('sem-reader-color', 'Colour scheme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]));
    s.value = get('color') || 'auto';
    on(bin, s, 'change', () => set('color', s.value == 'auto' ? '' : s.value));
  }
  if (has('print')) button('print', 'Print');
  if (has('audience')) {
    const profiles = parseProfiles(document);
    if (profiles.length) {
      const s = chrome.appendChild(select('sem-reader-audience', 'Audience',
        [['', 'Everyone'] as [string, string]].concat(profiles.map((p) => [p.id, p.label || p.id] as [string, string]))));
      const reflect = (): void => { s.value = getParam('sem-audience') || ''; };
      on(bin, s, 'change', () => setParam('sem-audience', s.value || null));
      on(bin, window, 'hashchange', reflect);
      reflect();
    }
  }

  reader.insertBefore(chrome, reader.firstChild);

  // The bar's measured height feeds `scroll-margin-top` and sticky table
  // headers (`--sem-reader-offset`), so nothing lands underneath it.
  const measure = (): void => root().style.setProperty('--sem-reader-offset', chrome.offsetHeight + 8 + 'px');
  if (typeof ResizeObserver != 'undefined') {
    const ro = new ResizeObserver(measure);
    ro.observe(chrome);
    bin.push(() => ro.disconnect());
  } else on(bin, window, 'resize', measure);
  measure();
  bin.push(() => root().style.removeProperty('--sem-reader-offset'));

  const open = (o: boolean): void => {
    if (!nav) return;
    nav.hidden = !o;
    toggle!.setAttribute('aria-expanded', String(o));
  };

  on(bin, chrome, 'click', (e) => {
    const b = (e.target as Element).closest('button');
    const act = b && b.getAttribute('data-act');
    if (!act) return;
    if (act == 'outline') open(nav!.hidden);
    else if (act == 'print') window.print();
    else if (TOGGLE[act]) {
      const [pref, onValue] = TOGGLE[act];
      const next = get(pref) != onValue;
      set(pref, next ? onValue : '');
      b.setAttribute('aria-pressed', String(next));
    } else if (act == 'type-up' || act == 'type-down') {
      const i = size() + (act == 'type-up' ? 1 : -1);
      if (SIZES[i]) set('type', SIZES[i]);
      syncType();
    }
  });

  if (nav) {
    on(bin, nav, 'click', (e) => { if ((e.target as Element).closest('a')) open(false); });
    on(bin, reader, 'keydown', (e) => {
      if ((e as KeyboardEvent).key != 'Escape' || nav!.hidden) return;
      open(false);
      toggle!.focus();
    });
  }
}
